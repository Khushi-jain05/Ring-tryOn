"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Group, type Mesh } from "three";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { POSE_MODEL_PATH, getPoseLandmarker } from "@/lib/neck/tracker";
import {
  NecklacePoseSolver,
  type NecklaceSolverOptions,
} from "@/lib/neck/necklacePose";
import { ANCHOR_DISTANCE, maskUvTransform, type FrameGeometry } from "@/lib/hand/projection";
import { fixedFraming } from "@/lib/hand/framing";
import { useTryOnStore } from "@/lib/store/tryon";
import type { MetalId } from "@/lib/rings/types";
import { dropFactorFor, type Necklace } from "@/lib/jewellery/catalog";
import { Necklace3D } from "./Necklace3D";
import { NeckOccluder } from "./NeckOccluder";
import {
  SegmentationOccluder,
  type SegmentationOccluderHandle,
} from "./SegmentationOccluder";
import { NECK_OCCLUDER } from "@/lib/jewellery/fit";
import { clearNeckDebug, publishNeckDebug } from "@/lib/neck/debugBus";

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

/**
 * How much of the necklace's own neighbourhood the mask occluder may cover before it
 * is treated as broken rather than as informative.
 *
 * Some covering is exactly the point — that is a hand or a mug in front. But the
 * wearer's neck is, by construction, the wearer, so a mask that reports most of the
 * area around the piece as not-wearer is not describing this frame.
 */
const MAX_MASK_COVERAGE = 0.7;

/**
 * Fraction of the area around the piece that the mask calls "not the wearer".
 *
 * Sampled on a coarse grid over the neck's neighbourhood rather than the whole frame:
 * what matters is whether the occluder would swallow the jewellery, not what the mask
 * says about the far corners of the picture.
 */
function maskCoverage(
  mask: { data: Uint8Array; width: number; height: number },
  geometry: FrameGeometry,
  pose: { position: Vector3; neckRadius: number },
): number {
  const uv = maskUvTransform(geometry);
  const aspect = geometry.displayWidth / Math.max(1, geometry.displayHeight);
  const reach = Math.max(pose.neckRadius, 1e-4) * 1.6;

  const STEPS = 9;
  let covered = 0;
  let counted = 0;

  for (let i = 0; i < STEPS; i++) {
    for (let j = 0; j < STEPS; j++) {
      const px = pose.position.x + ((i / (STEPS - 1)) * 2 - 1) * reach;
      const py = pose.position.y + ((j / (STEPS - 1)) * 2 - 1) * reach;
      // Plane units to the quad's UV, then through the same transform the shader uses.
      const u = (px / aspect + 0.5) * uv.scaleX + uv.offsetX;
      const v = (py + 0.5) * uv.scaleY + uv.offsetY;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      const x = Math.min(mask.width - 1, Math.max(0, Math.round(u * (mask.width - 1))));
      const y = Math.min(mask.height - 1, Math.max(0, Math.round(v * (mask.height - 1))));
      counted++;
      if (mask.data[y * mask.width + x] <= 127) covered++;
    }
  }

  return counted > 0 ? covered / counted : 1;
}

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
  const maskRef = useRef<SegmentationOccluderHandle | null>(null);
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
        // Say what failed and where the file should be. A necklace that never appears
        // is indistinguishable from one placed wrongly unless the reason is shown.
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(
          "error",
          `Could not load the pose tracking model (${POSE_MODEL_PATH}). ${detail} — run "npm run setup:mediapipe" if the file is missing.`,
        );
        console.error("[pose] model failed to load", err);
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
    let mask: { data: Uint8Array; width: number; height: number } | null = null;
    try {
      const result = landmarker.detectForVideo(video, now);
      pose = solver.solve(result, geometry, options, now);

      // The per-pixel wearer mask, **copied** before the mask is closed.
      //
      // getAsUint8Array can hand back a view into WASM memory rather than a copy, and
      // closing frees it — so keeping the reference and uploading it a few lines later
      // reads memory that has already been released. What that produces is not a crash
      // but garbage in the mask, and garbage in the mask hides the necklace completely.
      const raw = result.segmentationMasks?.[0];
      if (raw && state.maskOcclusion) {
        const bytes = raw.getAsUint8Array();
        mask = { data: bytes.slice(), width: raw.width, height: raw.height };
      }
      result.segmentationMasks?.forEach((m) => m.close());
    } catch {
      return;
    }

    if (pose) {
      missCount.current = 0;
      group.quaternion.copy(pose.quaternion);

      // Same depth treatment as the ring: place the piece at its real Z, then
      // undo the perspective shift and resize so the screen position and size are
      // the ones the solver measured. See TrackedRing for the derivation.
      const z = pose.anchorDepth;
      const k = (ANCHOR_DISTANCE - z) / ANCHOR_DISTANCE;
      group.position.set(pose.position.x * k, pose.position.y * k, z);

      // Everything inside the group is authored in millimetres, so the group's scale
      // *is* the millimetres-to-plane-units conversion — and without it the piece is
      // drawn at a hundred times the size of the screen.
      //
      // Which is what happened. The group was made visible before this, and the scale
      // was skipped when there was no usable pixels-per-metre yet: on the frames before
      // the scale filter has settled, and permanently if the fit ever fails. A group
      // left at scale 1 draws a 114 mm collar as 114 plane units on a plane that is one
      // unit tall, so it is not merely wrong — it is entirely off screen, which looks
      // exactly like the necklace not working. Nothing is shown until the scale is real.
      const unitsPerMm = pose.planeScale > 0 ? (pose.planeScale / 1000) * k : 0;
      if (unitsPerMm <= 0) {
        group.visible = false;
        occluder.scale.setScalar(0);
        maskRef.current?.hide();
        return;
      }
      group.scale.setScalar(unitsPerMm);
      group.visible = true;

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

      // Hide the piece wherever something that is not the wearer covers them.
      // Placed just in front of the necklace's nearest point, so it can occlude the
      // piece without being occluded by it.
      //
      // Checked before it is trusted, because this occluder's failure mode is the
      // severe one: it writes depth wherever the mask says "not the wearer", so a
      // mask that is empty, inverted, or misaligned does not degrade the occlusion —
      // it deletes the necklace, with nothing in the console to say why. The same
      // cliff the neck cylinder fell off. `maskCoverage` measures what fraction of
      // the piece's own neighbourhood the quad would cover, and an implausible
      // answer means the mask is not describing this frame.
      if (mask && maskCoverage(mask, geometry, pose) < MAX_MASK_COVERAGE) {
        maskRef.current?.update(
          mask.data,
          mask.width,
          mask.height,
          maskUvTransform(geometry),
          z + neckRadiusUnits * 1.2,
          size.width / Math.max(1, size.height),
        );
      } else {
        maskRef.current?.hide();
      }

      if (state.showDiagnostics) {
        publishNeckDebug(pose, dropFactorFor(necklace, neckRadiusMm) * unitsPerMm * neckRadiusMm, now);
      }

      if (state.status !== "tracking") setStatus("tracking");
    } else if (++missCount.current > MISS_GRACE_FRAMES) {
      // Report which gate closed. "Not visible" covered three unrelated problems and
      // there was no way to tell them apart without a debugger.
      const why = solver.lastRejection;
      if (state.status !== "error") {
        setStatus(
          "searching",
          why === "no-person"
            ? "Looking for you — sit back until your head and both shoulders are in frame."
            : why === "shoulder-not-visible"
              ? "One shoulder is out of frame — square up to the camera a little."
              : undefined,
        );
      }

      group.visible = false;
      occluder.scale.setScalar(0);
      maskRef.current?.hide();
      clearNeckDebug();
    }

    const window = fpsWindow.current;
    window.frames++;
    if (now - window.since > 500) {
      setFps(Math.round((window.frames * 1000) / (now - window.since)));
      window.frames = 0;
      window.since = now;
    }
  });


  return (
    <>
      <NeckOccluder ref={occluderRef} />
      <SegmentationOccluder ref={maskRef} />
      <group ref={groupRef} visible={false}>
        <Necklace3D
          metal={metal}
          quality="live"
          neckRadiusMm={neckSize}
          spec={necklace.spec}
        />
      </group>
    </>
  );
}
