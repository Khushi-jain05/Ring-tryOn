"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker } from "@/lib/neck/tracker";
import {
  NecklacePoseSolver,
  type NecklaceSolverOptions,
} from "@/lib/neck/necklacePose";
import { ANCHOR_DISTANCE, type FrameGeometry } from "@/lib/hand/projection";
import { fixedFraming } from "@/lib/hand/framing";
import { useTryOnStore } from "@/lib/store/tryon";
import type { GemId, MetalId } from "@/lib/rings/types";
import { Necklace3D } from "./Necklace3D";
import { NECK_FLATTEN, NeckOccluder } from "./NeckOccluder";

/** Frames the upper body may go missing before the piece is hidden. */
const MISS_GRACE_FRAMES = 8;

/** Height of the neck occluder, in neck radii. Covers jaw to collarbone. */
const NECK_LENGTH = 7;

/** Just inside the skin, so the chain's front run is never swallowed. */
const NECK_PRESS = 0.99;

export function TrackedNecklace({
  video,
  metal,
  gem,
}: {
  video: HTMLVideoElement | null;
  metal: MetalId;
  gem: GemId;
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

      const neckRadiusMm = pose.shoulderWidthMm * 0.145 * state.necklaceAnchor.sizeMultiplier;
      // Only publish a change worth relaying links for.
      if (Math.abs(neckRadiusMm - neckSize) > 0.8) setNeckSize(neckRadiusMm);

      // The occluder is outside the scaled group, in plane units.
      const neckRadiusUnits = neckRadiusMm * unitsPerMm * NECK_PRESS;
      occluder.position.copy(group.position);
      occluder.quaternion.copy(group.quaternion);
      occluder.scale.set(
        neckRadiusUnits,
        neckRadiusUnits * NECK_LENGTH,
        neckRadiusUnits * NECK_FLATTEN,
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

  const dropMm = neckSize * anchor.dropFactor;

  return (
    <>
      <NeckOccluder ref={occluderRef} />
      <group ref={groupRef} visible={false}>
        <Necklace3D
          metal={metal}
          gem={gem}
          quality="live"
          neckRadiusMm={neckSize}
          dropMm={dropMm}
        />
      </group>
    </>
  );
}
