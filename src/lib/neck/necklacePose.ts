import { Matrix4, Quaternion, Vector3 } from "three";
import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { DEFAULT_ONE_EURO, OneEuroVector, type OneEuroConfig } from "@/lib/hand/oneEuro";
import { projectToAnchorPlane, type FrameGeometry } from "@/lib/hand/projection";
import {
  MAX_SHOULDER_WIDTH_MM,
  MIN_SHOULDER_WIDTH_MM,
  NOMINAL_SHOULDER_WIDTH_MM,
  PL,
  POSE_LANDMARK_COUNT,
  REQUIRED_LANDMARKS,
} from "./landmarks";
import { estimateNeckPlaneScale } from "./scale";
import { MedianTracker } from "@/lib/hand/measure";

export type NecklacePose = {
  /** Where the chain crosses the base of the neck, on the anchor plane. */
  position: Vector3;
  /** +X along the shoulders, +Y up the neck, +Z out of the chest. */
  quaternion: Quaternion;
  /** Half the neck's width, in anchor-plane units — the chain's radius. */
  neckRadius: number;
  /** The same, in real millimetres — what the piece is actually sized against. */
  neckRadiusMm: number;
  /** Neck circumference in millimetres, the figure a necklace is sold by. */
  neckCircumferenceMm: number;
  /** Length from the shoulder line to the mouth, in millimetres. */
  neckLengthMm: number;
  /** True when the head-breadth cue was usable and folded into the estimate. */
  neckFromHead: boolean;
  /** How far the head is turned relative to the shoulders, in degrees. */
  headTurnDeg: number;
  /**
   * Visibility of the least-certain landmark the solve depends on, 0 to 1.
   *
   * Low means part of the pose is inferred rather than seen — typical on a profile
   * view, where the away shoulder is behind the torso. Reported rather than acted on:
   * refusing to place the piece was worse than placing it from an inferred landmark.
   */
  confidence: number;
  /** Shoulder-to-shoulder span, in anchor-plane units. */
  shoulderSpan: number;
  /** Measured shoulder breadth in millimetres, for sizing chain lengths. */
  shoulderWidthMm: number;
  /** Anchor-plane units per metre. */
  planeScale: number;
  /** Depth of the neck anchor relative to the shoulder line. */
  anchorDepth: number;
  /** How square-on the shoulders are: 1 facing the camera, 0 in profile. */
  facing: number;
  /** Smoothed anchor-plane landmarks, for diagnostics. */
  planar: ReadonlyArray<{ x: number; y: number }>;
};

/**
 * Why a frame produced no pose.
 *
 * A bare null is the same to the renderer whatever went wrong, so "the necklace is not
 * visible" covered a model that never loaded, a person the model could not find, and a
 * shoulder out of frame — three different problems with three different fixes, and no
 * way to tell them apart from the outside. Naming the reason is what makes that
 * distinguishable without a debugger.
 */
export type NecklaceRejection =
  | "no-person"
  | "incomplete-landmarks"
  | "shoulder-not-visible";

export type NecklaceAnchor = {
  /**
   * Trim on the piece's own length, 1 being as designed.
   *
   * Deliberately a multiplier and not an absolute length: a choker and a
   * princess-length chain differ by a factor of ten, so a single absolute default
   * would place one of them badly wrong. Each piece supplies its own drop and this
   * only nudges it.
   */
  dropFactor: number;
  /** Scales the whole piece against the measured neck. 1 is true to size. */
  sizeMultiplier: number;
  /** Shifts the piece along the neck axis, in neck radii. */
  riseOffset: number;
};

export const DEFAULT_NECKLACE_ANCHOR: NecklaceAnchor = {
  dropFactor: 1,
  sizeMultiplier: 1,
  riseOffset: 0,
};

export type NecklaceSolverOptions = {
  anchor: NecklaceAnchor;
  mirrored: boolean;
  smoothing: OneEuroConfig;
};

export const DEFAULT_NECKLACE_OPTIONS: NecklaceSolverOptions = {
  anchor: DEFAULT_NECKLACE_ANCHOR,
  mirrored: true,
  smoothing: DEFAULT_ONE_EURO,
};

/**
 * Neck radius as a fraction of shoulder breadth.
 *
 * Anthropometric surveys put adult neck circumference near 360 mm against a
 * biacromial breadth near 395 mm, so the neck's radius is a little under a
 * seventh of the shoulder span.
 */
const NECK_RADIUS_FROM_SHOULDERS = 0.145;

/**
 * Neck radius as a fraction of head breadth, ear to ear.
 *
 * A second, independent estimate. Adult head breadth is around 150 mm against a
 * neck 115 mm across, so the neck's radius is a little under two fifths of it.
 *
 * Two cues rather than one because they fail in unrelated ways, and a single fixed
 * ratio is exactly the weakness that made the ring's sizing unreliable. Shoulder
 * breadth is thrown off by posture and by heavy clothing; ear span collapses when
 * the head turns and one ear goes out of view. Averaging them when both are
 * plausible, and falling back when one is not, is far steadier than trusting
 * either.
 */
const NECK_RADIUS_FROM_HEAD = 0.385;

/**
 * How far above the shoulder line the chain crosses the neck, as a fraction of the
 * distance from the shoulders to the mouth.
 *
 * Measured against the **neck's own length** rather than against shoulder breadth,
 * which is the fix for placement not adapting to the wearer. Shoulder breadth says
 * nothing about how long someone's neck is, so a fraction of it puts the collar at
 * the base of an average neck, too high on a short one and too low on a long one.
 * The shoulder-to-mouth distance is essentially the neck plus a fixed bit of jaw,
 * so a fraction of that tracks the individual.
 */
const NOTCH_FROM_NECK_LENGTH = 0.2;

/** Plausible bounds on the head-derived neck estimate, in shoulder breadths. */
const MIN_EAR_SPAN_RATIO = 0.28;
const MAX_EAR_SPAN_RATIO = 0.52;

/**
 * How far the head may be turned before each measurement stops being trusted.
 *
 * The two limits differ because the measurements are not equally pose-sensitive. The
 * ears straddle the neck's axis, so an occluded one only starts to matter at a large
 * angle. The mouth sits well *forward* of that axis, so the shoulder-to-mouth
 * distance — the neck's length — starts changing almost immediately.
 */
const MAX_HEAD_TURN_FOR_WIDTH_DEG = 38;
const MAX_HEAD_TURN_FOR_LENGTH_DEG = 12;

/**
 * How far forward of the shoulder line the chain crosses, in neck radii.
 *
 * The acromion sits at the side of the torso and the sternal notch at the front
 * centre, so the notch is a little nearer the camera when someone faces it.
 */
const NOTCH_FORWARD_OF_SHOULDERS = 0.35;

/**
 * Below this, the model has no useful opinion about where a landmark is.
 *
 * Deliberately low. An occluded shoulder on a profile view still gets a position
 * inferred from the rest of the body, and using that is much better than hiding the
 * piece — which is what a 0.5 threshold did at precisely the angle a wearer turns to.
 */
const MIN_LANDMARK_VISIBILITY = 0.15;

/** Fallback neck length, used only until a square-on frame has been seen. */
const NOMINAL_NECK_LENGTH_MM = 150;

/** Up, in the metric world frame, once y-down has been flipped to y-up. */
const WORLD_UP = new Vector3(0, 1, 0);

const scratch = {
  planar: Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0 })),
  world: Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 })),
  point: { x: 0, y: 0 },
  left: new Vector3(),
  right: new Vector3(),
  shoulderMid: new Vector3(),
  headMid: new Vector3(),
  upWorld: new Vector3(),
  shoulderWorld: new Vector3(),
  hipWorld: new Vector3(),
  earAcross: new Vector3(),
  shoulderAcross: new Vector3(),
  across: new Vector3(),
  up: new Vector3(),
  forward: new Vector3(),
  basis: new Matrix4(),
  a: new Vector3(),
  b: new Vector3(),
};

/**
 * Turns a frame of pose landmarks into a necklace pose.
 *
 * The split is the same one that makes the ring work, for the same reason: the
 * *image* landmarks say which pixels the neck occupies, so anchoring to them puts
 * the chain on the body with no dependence on camera intrinsics; the *world*
 * landmarks are metric, so they give the shoulder breadth in millimetres and, by
 * comparison with the image, a true pixels-per-metre.
 *
 * A necklace is easier than a ring in one way and harder in another. Easier,
 * because the shoulder girdle is a large rigid structure — far less noisy than a
 * finger. Harder, because a chain is not a rigid body: it hangs. So the solve
 * produces a *frame* for the neck rather than a transform for a solid object, and
 * the chain's curve is generated inside that frame.
 */
export class NecklacePoseSolver {
  private planarFilter = new OneEuroVector(POSE_LANDMARK_COUNT * 2);
  private worldFilter = new OneEuroVector(POSE_LANDMARK_COUNT * 3);
  private scaleFilter = new OneEuroVector(1, { minCutoff: 0.3, beta: 0.003, dCutoff: 1 });
  private planarSmoothed: number[] = [];
  private worldSmoothed: number[] = [];
  private scaleSmoothed: number[] = [];
  private lastTimestamp: number | null = null;

  /**
   * The crop the filters' history was accumulated under.
   *
   * Every plane coordinate scales linearly with the preview's digital zoom, so
   * changing it changes the units the filter memory is in. Left alone, the filters
   * treat that as a real, sudden movement and the piece slides for a second after
   * each adjustment before settling — which looks exactly like the placement
   * breaking when you zoom.
   */
  private lastZoom = 1;

  /**
   * The wearer's neck length in millimetres, collected only from frames where the
   * head was square enough to measure it. Held through the rest, because a neck
   * does not change length when someone turns their head.
   */
  private neckLengthTracker = new MedianTracker(60);

  /** Per-landmark visibility from the most recent frame. */
  private visibility: number[] = [];

  /** Why the last frame produced nothing, for the renderer to report. */
  private rejection: NecklaceRejection | null = null;

  get lastRejection(): NecklaceRejection | null {
    return this.rejection;
  }

  readonly pose: NecklacePose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    neckRadius: 0.05,
    neckRadiusMm: 57,
    neckCircumferenceMm: 360,
    neckLengthMm: 150,
    neckFromHead: false,
    headTurnDeg: 0,
    confidence: 1,
    shoulderSpan: 0.35,
    shoulderWidthMm: NOMINAL_SHOULDER_WIDTH_MM,
    planeScale: 1,
    anchorDepth: 0,
    facing: 1,
    planar: scratch.planar,
  };

  reset(): void {
    this.planarFilter.reset();
    this.worldFilter.reset();
    this.scaleFilter.reset();
    this.neckLengthTracker.reset();
    this.lastTimestamp = null;
  }

  /**
   * @returns the shared pose object, or null when no usable upper body was found.
   *          Reused between frames — read it, don't retain it.
   */
  solve(
    result: PoseLandmarkerResult,
    geometry: FrameGeometry,
    options: NecklaceSolverOptions,
    timestampMs: number,
  ): NecklacePose | null {
    const landmarks = result.landmarks?.[0];
    const world = result.worldLandmarks?.[0];
    if (!landmarks || !world) {
      this.rejection = "no-person";
      this.lastTimestamp = null;
      return null;
    }
    if (landmarks.length < POSE_LANDMARK_COUNT) {
      this.rejection = "incomplete-landmarks";
      this.lastTimestamp = null;
      return null;
    }

    // A necklace hangs off the shoulder girdle, so a frame that has the face but
    // not both shoulders — someone leaning out of view, or cropped at the chin —
    // has nothing to hang it from. Better to hide the piece than to guess.
    // Present, not confidently seen.
    //
    // This demanded 0.5 visibility on *both* shoulders, and that is why the necklace
    // disappeared on a profile view: turn far enough and the away shoulder is behind
    // the torso, its visibility falls below the threshold, and the solve was refused
    // at exactly the angle someone turns to in order to see how a necklace sits.
    //
    // The model still reports a position for an occluded shoulder — inferred from the
    // rest of the body rather than seen. That is less accurate than a clear view and
    // far better than nothing, because the quantities it feeds are either latched
    // already (the neck's size) or heavily smoothed (the anchor). So the gate now only
    // rejects a landmark the model has effectively no opinion about, and how much of
    // the pose is inferred is reported instead of being grounds for refusal.
    let weakest = 1;
    for (const index of REQUIRED_LANDMARKS) {
      const lm = landmarks[index] as { visibility?: number };
      const v = lm.visibility ?? 1;
      if (v < weakest) weakest = v;
      if (v < MIN_LANDMARK_VISIBILITY) {
        this.rejection = "shoulder-not-visible";
        this.lastTimestamp = null;
        return null;
      }
    }
    this.pose.confidence = weakest;

    const dt =
      this.lastTimestamp === null ? 1 / 30 : (timestampMs - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestampMs;

    if (dt > 0.5) this.reset();

    // A zoom change is a known change of units, not a new measurement, so convert
    // the filter history into the new units rather than smoothing across it.
    const zoom = geometry.zoom > 0 ? geometry.zoom : 1;
    if (zoom !== this.lastZoom) {
      const factor = zoom / this.lastZoom;
      this.planarFilter.rescale(factor);
      this.scaleFilter.rescale(factor);
      for (let i = 0; i < this.planarSmoothed.length; i++) this.planarSmoothed[i] *= factor;
      for (let i = 0; i < this.scaleSmoothed.length; i++) this.scaleSmoothed[i] *= factor;
      this.lastZoom = zoom;
    }

    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      this.visibility[i] = (landmarks[i] as { visibility?: number }).visibility ?? 1;
    }

    this.rejection = null;
    this.project(landmarks, geometry);
    this.smooth(dt, world, options);

    return this.compose(options);
  }

  private project(
    landmarks: ReadonlyArray<{ x: number; y: number }>,
    geometry: FrameGeometry,
  ): void {
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      const lm = landmarks[i];
      projectToAnchorPlane(lm.x, lm.y, geometry, scratch.point);
      scratch.planar[i].x = scratch.point.x;
      scratch.planar[i].y = scratch.point.y;
    }
  }

  private smooth(
    dt: number,
    world: ReadonlyArray<{ x: number; y: number; z: number }>,
    options: NecklaceSolverOptions,
  ): void {
    this.planarFilter.setConfig(options.smoothing);
    this.worldFilter.setConfig(options.smoothing);

    const planarRaw: number[] = [];
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      planarRaw[i * 2] = scratch.planar[i].x;
      planarRaw[i * 2 + 1] = scratch.planar[i].y;
    }
    this.planarSmoothed = this.planarFilter.filter(planarRaw, dt, this.planarSmoothed);

    const worldRaw: number[] = [];
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      const lm = world[i];
      // Pose world space is image-aligned like the hand model's: +x right, +y
      // down, +z away from the viewer. three.js is y-up looking down -z.
      worldRaw[i * 3] = lm.x;
      worldRaw[i * 3 + 1] = -lm.y;
      worldRaw[i * 3 + 2] = -lm.z;
    }
    this.worldSmoothed = this.worldFilter.filter(worldRaw, dt, this.worldSmoothed);

    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      scratch.planar[i].x = this.planarSmoothed[i * 2];
      scratch.planar[i].y = this.planarSmoothed[i * 2 + 1];
      scratch.world[i].x = this.worldSmoothed[i * 3];
      scratch.world[i].y = this.worldSmoothed[i * 3 + 1];
      scratch.world[i].z = this.worldSmoothed[i * 3 + 2];
    }

    // Pixels per metre, from a least-squares fit over the head and shoulders. See
    // estimateNeckPlaneScale for why this cannot be one screen span divided by one
    // 3D span: those are different quantities, and turning the torso pulls them
    // apart until the piece shrinks to nothing.
    const raw = estimateNeckPlaneScale(scratch.planar, scratch.world);
    if (raw !== null) {
      this.scaleSmoothed = this.scaleFilter.filter([raw], dt, this.scaleSmoothed);
    }
  }

  private worldDistance(a: number, b: number): number {
    const p = scratch.world[a];
    const q = scratch.world[b];
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  }

  /**
   * Whether the model is confident it can actually see a landmark.
   *
   * Pose Landmarker reports every one of its 33 points on every frame whether or
   * not they are in view, filling the rest in by inference — so for anything
   * outside the crop, like the hips in a head-and-shoulders shot, the coordinates
   * are a guess. Treating a guess as a measurement is worse than not having one.
   */
  private visible(index: number): boolean {
    const v = this.visibility[index];
    return v === undefined || v > 0.6;
  }

  private planarAt(index: number, out: Vector3): Vector3 {
    return out.set(scratch.planar[index].x, scratch.planar[index].y, 0);
  }

  private worldAt(index: number, out: Vector3): Vector3 {
    const w = scratch.world[index];
    return out.set(w.x, w.y, w.z);
  }

  private compose(options: NecklaceSolverOptions): NecklacePose {
    const { pose } = this;
    const { anchor } = options;

    // --- Scale and size ----------------------------------------------------
    const planeScale = this.scaleSmoothed[0] ?? 0;
    pose.planeScale = planeScale;

    const shoulderWorldM = this.worldDistance(PL.LEFT_SHOULDER, PL.RIGHT_SHOULDER);
    pose.shoulderWidthMm = clamp(
      shoulderWorldM * 1000,
      MIN_SHOULDER_WIDTH_MM,
      MAX_SHOULDER_WIDTH_MM,
    );

    // --- Neck anchor, on the anchor plane ----------------------------------
    this.planarAt(PL.LEFT_SHOULDER, scratch.left);
    this.planarAt(PL.RIGHT_SHOULDER, scratch.right);
    scratch.shoulderMid.addVectors(scratch.left, scratch.right).multiplyScalar(0.5);
    pose.shoulderSpan = scratch.left.distanceTo(scratch.right);

    // --- How far the head is turned, relative to the torso -----------------
    //
    // From the ear line against the shoulder line. Both are rigid, so the angle
    // between them is head yaw and nothing else — it does not move when the whole
    // body turns, or when the wearer moves nearer the camera.
    //
    // The obvious-looking alternative, watching the ear span shrink, does not work:
    // the span is a distance between two metric points, and a rigid rotation leaves
    // any such distance unchanged. A gate built on it therefore never fires at all,
    // which is what allowed turned frames into the neck-length estimate.
    this.worldAt(PL.LEFT_EAR, scratch.a);
    this.worldAt(PL.RIGHT_EAR, scratch.b);
    scratch.earAcross.subVectors(scratch.a, scratch.b);
    this.worldAt(PL.LEFT_SHOULDER, scratch.a);
    this.worldAt(PL.RIGHT_SHOULDER, scratch.b);
    scratch.shoulderAcross.subVectors(scratch.a, scratch.b);

    const headTurnRad =
      scratch.earAcross.lengthSq() > 1e-8 && scratch.shoulderAcross.lengthSq() > 1e-8
        ? scratch.earAcross.angleTo(scratch.shoulderAcross)
        : 0;
    pose.headTurnDeg = (headTurnRad * 180) / Math.PI;

    // --- Neck width: two independent cues, in millimetres ------------------
    const earSpanM = this.worldDistance(PL.LEFT_EAR, PL.RIGHT_EAR);
    const ratio = shoulderWorldM > 0 ? earSpanM / shoulderWorldM : 0;
    const earUsable =
      ratio > MIN_EAR_SPAN_RATIO &&
      ratio < MAX_EAR_SPAN_RATIO &&
      pose.headTurnDeg < MAX_HEAD_TURN_FOR_WIDTH_DEG;

    const fromShoulders = pose.shoulderWidthMm * NECK_RADIUS_FROM_SHOULDERS;
    const fromHead = earSpanM * 1000 * NECK_RADIUS_FROM_HEAD;
    // Both when both are trustworthy; shoulders alone when the head is turned far
    // enough that one ear has gone out of view and its span has collapsed.
    const neckRadiusMm =
      (earUsable ? (fromShoulders + fromHead) / 2 : fromShoulders) * anchor.sizeMultiplier;

    pose.neckRadiusMm = neckRadiusMm;
    pose.neckCircumferenceMm = neckCircumference(neckRadiusMm);
    pose.neckFromHead = earUsable;

    // Converted to plane units through the same scale everything else uses, so the
    // piece is drawn at the size it was measured to be.
    pose.neckRadius =
      planeScale > 0
        ? (neckRadiusMm / 1000) * planeScale
        : pose.shoulderSpan * NECK_RADIUS_FROM_SHOULDERS * anchor.sizeMultiplier;

    // --- Orientation -------------------------------------------------------
    // Built from the metric landmarks, so it stays a true frame as the torso
    // turns rather than skewing with the stage's aspect ratio.
    this.worldAt(PL.LEFT_SHOULDER, scratch.a);
    this.worldAt(PL.RIGHT_SHOULDER, scratch.b);
    // Right shoulder to left shoulder: on an unmirrored image the subject's left
    // is on the viewer's right, so this runs with screen +X.
    scratch.across.subVectors(scratch.a, scratch.b);
    if (scratch.across.lengthSq() < 1e-10) return pose;
    scratch.across.normalize();

    // Up the torso. The hips give this directly when they are in frame; for the
    // head-and-shoulders framing a necklace try-on usually has, they are not, and
    // the fallback is the world's own up made perpendicular to the shoulder line.
    //
    // Either way it is a torso measurement. Deriving it from the mouth — as this
    // did — is what let head rotation swing the whole piece.
    // These go in their own slots. `shoulderMid` already holds the *plane*
    // midpoint from further up, and the anchor's position is built from it — so
    // reusing it for the metric one silently reinterpreted metres as plane units
    // and put the whole necklace at the centre of the frame instead of on the neck.
    this.worldAt(PL.LEFT_HIP, scratch.a);
    this.worldAt(PL.RIGHT_HIP, scratch.b);
    scratch.hipWorld.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);
    this.worldAt(PL.LEFT_SHOULDER, scratch.a);
    this.worldAt(PL.RIGHT_SHOULDER, scratch.b);
    scratch.shoulderWorld.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);

    const hipsVisible =
      this.visible(PL.LEFT_HIP) &&
      this.visible(PL.RIGHT_HIP) &&
      scratch.shoulderWorld.distanceTo(scratch.hipWorld) > 0.12;

    if (hipsVisible) {
      scratch.up.subVectors(scratch.shoulderWorld, scratch.hipWorld).normalize();
    } else {
      // Gravity, less whatever component runs along the shoulders. A leaning torso
      // tilts the shoulder line, and this tilts with it.
      scratch.up
        .copy(WORLD_UP)
        .addScaledVector(scratch.across, -WORLD_UP.dot(scratch.across));
      if (scratch.up.lengthSq() < 1e-8) scratch.up.copy(WORLD_UP);
      scratch.up.normalize();
    }

    // Anterior direction: out of the chest, the way the pendant faces.
    scratch.forward.crossVectors(scratch.across, scratch.up);
    if (scratch.forward.lengthSq() < 1e-10) return pose;
    scratch.forward.normalize();

    // Re-orthogonalise so the basis is clean even when the shoulders are not
    // exactly perpendicular to the neck.
    scratch.across.crossVectors(scratch.up, scratch.forward).normalize();

    // A mirrored preview flips the pixels, so the pose flips with them. Negating
    // x on the vectors alone leaves a left-handed basis, which is not a rotation;
    // rebuilding `across` from the flipped pair restores it.
    if (options.mirrored) {
      scratch.up.x = -scratch.up.x;
      scratch.forward.x = -scratch.forward.x;
      scratch.across.crossVectors(scratch.up, scratch.forward).normalize();
    }

    scratch.upWorld.copy(scratch.up);
    scratch.basis.makeBasis(scratch.across, scratch.up, scratch.forward);
    pose.quaternion.setFromRotationMatrix(scratch.basis);

    // --- Where the chain crosses, in screen space --------------------------
    //
    // The direction up the neck *on screen* is the world up-axis with its depth
    // dropped — both spaces are image-aligned, so the world axis's x and y are
    // already the screen direction. Taking it from the world basis rather than
    // recomputing it here matters: a perpendicular to the shoulder line in the image
    // plane collapses when the shoulders go edge-on at a quarter turn, and the
    // solve would bail out at exactly the pose it most needs to handle.
    scratch.up.set(scratch.upWorld.x, scratch.upWorld.y, 0);
    if (scratch.up.lengthSq() < 1e-8) scratch.up.set(0, 1, 0);
    scratch.up.normalize();

    // A fraction of the neck's length lands at the sternal notch on a short neck
    // and a long one alike, where a fraction of shoulder breadth cannot — breadth
    // says nothing about how long a neck is.
    //
    // But the only way to see the top of a neck is to measure to the head, and the
    // head moves independently of it. So the length is **measured when the head is
    // square and held otherwise**: the same gate the width cue uses, and the same
    // pattern as the ring's latched dorsal sign. Someone's neck does not get longer
    // when they look sideways, so remembering it is not merely a smoothing trick —
    // it is the physically correct thing to do.
    this.planarAt(PL.LEFT_MOUTH, scratch.a);
    this.planarAt(PL.RIGHT_MOUTH, scratch.b);
    scratch.headMid.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);

    if (pose.headTurnDeg < MAX_HEAD_TURN_FOR_LENGTH_DEG && planeScale > 0) {
      // Both points are on the anchor plane — mixing a metric point with a plane one
      // here produced a neck several times too long, and it is the same class of
      // mistake as the anchor collision above.
      const seenMm = (scratch.shoulderMid.distanceTo(scratch.headMid) / planeScale) * 1000;
      if (seenMm > 60 && seenMm < 320) this.neckLengthTracker.push(seenMm);
    }
    const heldMm = this.neckLengthTracker.value;
    pose.neckLengthMm = heldMm ?? NOMINAL_NECK_LENGTH_MM;

    // Converted back to plane units through the current scale, so the collar keeps
    // its place as the wearer moves nearer or further away.
    const riseUnits =
      planeScale > 0 ? (pose.neckLengthMm / 1000) * planeScale : pose.shoulderSpan * 0.16;

    const rise = riseUnits * NOTCH_FROM_NECK_LENGTH + pose.neckRadius * anchor.riseOffset;
    pose.position.copy(scratch.shoulderMid).addScaledVector(scratch.up, rise);


    // How square-on the shoulders are. In profile the span collapses and a
    // necklace should mostly disappear behind the neck.
    pose.facing = Math.sqrt(Math.max(0, 1 - scratch.across.z * scratch.across.z));

    // Depth of the neck, so the chain sits in the same 3D space as the occluder
    // rather than flat on the plane.
    //
    // Taken forward of the shoulder line by a fraction of the neck's own radius,
    // which is where the sternal notch sits relative to the shoulder joints. This
    // used to interpolate toward the *mouth's* depth — the last place head pose was
    // still leaking into the placement. Turning the head moves the mouth forward and
    // back, so the collar shifted in depth, and because depth is compensated back
    // into screen position it shifted on screen too.
    pose.anchorDepth = pose.neckRadius * NOTCH_FORWARD_OF_SHOULDERS;

    return pose;
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Circumference of the neck from its radius.
 *
 * A neck is not round — it is appreciably shallower front-to-back than it is wide,
 * the same as a finger — so the circumference is an ellipse's perimeter, not a
 * circle's. Using 2πr would over-report by about 6%, which on a necklace is most of
 * a size.
 */
export function neckCircumference(radiusMm: number): number {
  const a = radiusMm;
  const b = radiusMm * 0.78;
  // Ramanujan's first approximation.
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}
