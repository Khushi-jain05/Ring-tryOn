"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Group, type Mesh } from "three";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker } from "@/lib/neck/tracker";
import {
  NecklacePoseSolver,
  type NecklaceSolverOptions,
} from "@/lib/neck/necklacePose";
import { ANCHOR_DISTANCE, type FrameGeometry } from "@/lib/hand/projection";
import { fixedFraming } from "@/lib/hand/framing";
import { useTryOnStore } from "@/lib/store/tryon";
import type { MetalId } from "@/lib/rings/types";
import { dropFactorFor, type Necklace } from "@/lib/jewellery/catalog";
import { Necklace3D } from "./Necklace3D";
import { NeckOccluder } from "./NeckOccluder";
import { NECK_OCCLUDER } from "@/lib/jewellery/fit";

/** Frames the upper body may go missing before the piece is hidden. */
const MISS_GRACE_FRAMES = 8;

/**
 * Height of the neck occluder, in neck radii — and it must stay short.
 *
 * This was 7 radii, centred on the neck anchor, which is 400 mm of cylinder on a
 * typical neck: 200 mm of it hanging *below* the sternal notch, straight over
 * where the pendant hangs. The occluder writes depth and no colour, so the effect
 * was not a visible block but the pendant and most of the chain simply never
 * being drawn. An occluder that covers more than the thing it stands for deletes
 * the jewellery instead of hiding the far side of it.
 *
 * A neck is about 100 mm from the notch to the jaw, so 2.6 radii spans it with a
 * margin at each end.
 */
const NECK_LENGTH = NECK_OCCLUDER.length;

/**
 * How far above the anchor the cylinder is centred, in neck radii.
 *
 * The neck runs upward from the anchor, not symmetrically around it, so the
 * cylinder is offset to match. This is what keeps its lower rim just under the
 * notch — below the chain's back run, which needs hiding, and above the pendant,
 * which does not.
 */
const NECK_RISE = NECK_OCCLUDER.rise;

/**
 * The occluder's radius as a fraction of the chain's own path.
 *
 * The chain lies *on* the neck, so an occluder of exactly the same radius would
 * coincide with it and z-fight. Slightly inside it instead splits the chain the
 * way a real neck does: the front run is nearer the camera than the occluder's
 * surface and draws, the back run is behind it and does not.
 */
const NECK_PRESS = NECK_OCCLUDER.press;

/** Scratch, so the frame loop allocates nothing. */
const NECK_AXIS = new Vector3();

export function TrackedNecklace({
  video,
  metal,
  necklace,
}: {
  video: HTMLVideoElement | null;
  metal: MetalId;
  necklace: Necklace;
}) {
  const groupRef = useRef<Group>(null);
  const occluderRef = useRef<Mesh>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const solver = useMemo(() => new NecklacePoseSolver(), []);
  const missCount = useRef(0);
  const lastVideoTime = useRef(-1);
  const fpsWindow = useRef({ frames: 0, since: 0 });

  // Laying fifty chain links is not something to redo thirty times a second, and
  // the shape depends only on the neck's dimensions — which barely move. So the
  // measured radius is published to the store with a dead band, and the links are
  // rebuilt only when it changes by enough to see.
  const neckSize = useTryOnStore((s) => s.neckSizeMm);
  const setNeckSize = useTryOnStore((s) => s.setNeckSizeMm);
  const setNeckReading = useTryOnStore((s) => s.setNeckReading);
  const anchor = useTryOnStore((s) => s.necklaceAnchor);

  const { size } = useThree();
  const setStatus = useTryOnStore((s) => s.setStatus);
  const setFps = useTryOnStore((s) => s.setFps);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading-model");
    getPoseLandmarker()
      .then((lm) => {
        if (cancelled) return;
        landmarkerRef.current = lm;
        setStatus("searching");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus(
          "error",
          err instanceof Error ? err.message : "Could not load the pose tracking model.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [setStatus]);

  useFrame(() => {
    const group = groupRef.current;
    const occluder = occluderRef.current;
    const landmarker = landmarkerRef.current;
    if (!group || !occluder) return;
    if (!landmarker || !video || video.readyState < 2 || video.videoWidth === 0) return;

    if (video.currentTime === lastVideoTime.current) return;
    lastVideoTime.current = video.currentTime;

    const now = performance.now();
    const state = useTryOnStore.getState();
    const framing = fixedFraming(state.zoom);

    const geometry: FrameGeometry = {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      displayWidth: size.width,
      displayHeight: size.height,
      mirrored: state.mirrored,
      zoom: framing.zoom,
      centerU: framing.centerU,
      centerV: framing.centerV,
    };

    const options: NecklaceSolverOptions = {
      anchor: state.necklaceAnchor,
      mirrored: state.mirrored,
      smoothing: state.smoothing,
    };

    let pose = null;
    try {
      const result = landmarker.detectForVideo(video, now);
      pose = solver.solve(result, geometry, options, now);
    } catch {
      return;
    }

    if (pose) {
      missCount.current = 0;
      group.visible = true;
      group.quaternion.copy(pose.quaternion);

      // Same depth treatment as the ring: place the piece at its real Z, then
      // undo the perspective shift and resize so the screen position and size are
      // the ones the solver measured. See TrackedRing for the derivation.
      const z = pose.anchorDepth;
      const k = (ANCHOR_DISTANCE - z) / ANCHOR_DISTANCE;
      group.position.set(pose.position.x * k, pose.position.y * k, z);

      // Everything inside the group is authored in millimetres, so the group's
      // scale is the millimetres-to-plane-units conversion.
      const unitsPerMm = pose.planeScale > 0 ? (pose.planeScale / 1000) * k : 0;
      if (unitsPerMm > 0) group.scale.setScalar(unitsPerMm);

      // Measured by the solver from two cues; see NecklacePoseSolver.
      const neckRadiusMm = pose.neckRadiusMm;
      // Only publish a change worth relaying links for.
      if (Math.abs(neckRadiusMm - neckSize) > 0.8) {
        setNeckSize(neckRadiusMm);
        setNeckReading({
          circumferenceMm: pose.neckCircumferenceMm,
          lengthMm: pose.neckLengthMm,
          twoCues: pose.neckFromHead,
        });
      }

      // The occluder is outside the scaled group, so it is sized in plane units.
      const neckRadiusUnits = neckRadiusMm * unitsPerMm * NECK_PRESS;
      occluder.quaternion.copy(group.quaternion);
      occluder.scale.set(
        neckRadiusUnits,
        neckRadiusUnits * NECK_LENGTH,
        neckRadiusUnits * NECK_OCCLUDER.flatten,
      );
      // Offset up the neck's own axis, not the screen's — a tilted head has to
      // carry the occluder with it.
      occluder.position
        .copy(group.position)
        .addScaledVector(
          NECK_AXIS.set(0, 1, 0).applyQuaternion(group.quaternion),
          neckRadiusUnits * NECK_RISE,
        );

      if (state.status !== "tracking") setStatus("tracking");
    } else if (++missCount.current > MISS_GRACE_FRAMES) {
      group.visible = false;
      occluder.scale.setScalar(0);
      if (state.status === "tracking") setStatus("searching");
    }

    const window = fpsWindow.current;
    window.frames++;
    if (now - window.since > 500) {
      setFps(Math.round((window.frames * 1000) / (now - window.since)));
      window.frames = 0;
      window.since = now;
    }
  });

  // A choker's drop comes from the piece itself — its own dip plus the drop pearl —
  // whereas a pendant's is the chain length. The anchor's factor then only trims
  // that, rather than defining it, which is what stops a choker being placed
  // somewhere near the sternum.
  const dropMm = neckSize * dropFactorFor(necklace, neckSize) * anchor.dropFactor;

  return (
    <>
      <NeckOccluder ref={occluderRef} />
      <group ref={groupRef} visible={false}>
        <Necklace3D
          metal={metal}
          gem={necklace.gem}
          quality="live"
          neckRadiusMm={neckSize}
          dropMm={dropMm}
          style={necklace.style}
        />
      </group>
    </>
  );
}
