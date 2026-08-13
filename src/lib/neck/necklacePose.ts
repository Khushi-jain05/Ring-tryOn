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

const scratch = {
  planar: Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0 })),
  world: Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 })),
  point: { x: 0, y: 0 },
  left: new Vector3(),
  right: new Vector3(),
  shoulderMid: new Vector3(),
  headMid: new Vector3(),
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

  readonly pose: NecklacePose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    neckRadius: 0.05,
    neckRadiusMm: 57,
    neckCircumferenceMm: 360,
    neckLengthMm: 150,
    neckFromHead: false,
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
    if (!landmarks || !world || landmarks.length < POSE_LANDMARK_COUNT) {
      this.lastTimestamp = null;
      return null;
    }

    // A necklace hangs off the shoulder girdle, so a frame that has the face but
    // not both shoulders — someone leaning out of view, or cropped at the chin —
    // has nothing to hang it from. Better to hide the piece than to guess.
    for (const index of REQUIRED_LANDMARKS) {
      const lm = landmarks[index] as { visibility?: number };
      if (lm.visibility !== undefined && lm.visibility < 0.5) {
        this.lastTimestamp = null;
        return null;
      }
    }

    const dt =
      this.lastTimestamp === null ? 1 / 30 : (timestampMs - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestampMs;

    if (dt > 0.5) this.reset();

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

    // Pixels per metre, from the shoulder span measured both ways. One rigid
    // segment is enough here — unlike a hand, the shoulders are wide, far apart
    // and among the most reliably located landmarks the model produces.
    const planarSpan = Math.hypot(
      scratch.planar[PL.LEFT_SHOULDER].x - scratch.planar[PL.RIGHT_SHOULDER].x,
      scratch.planar[PL.LEFT_SHOULDER].y - scratch.planar[PL.RIGHT_SHOULDER].y,
    );
    const worldSpan = this.worldDistance(PL.LEFT_SHOULDER, PL.RIGHT_SHOULDER);
    if (worldSpan > 0.15) {
      this.scaleSmoothed = this.scaleFilter.filter(
        [planarSpan / worldSpan],
        dt,
        this.scaleSmoothed,
      );
    }
  }

  private worldDistance(a: number, b: number): number {
    const p = scratch.world[a];
    const q = scratch.world[b];
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
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

    // Head direction from the mouth corners rather than the nose: the nose swings
    // a long way as the head turns, while the mouth's midpoint stays close to the
    // neck's own axis, which is what the chain actually follows.
    this.planarAt(PL.LEFT_MOUTH, scratch.a);
    this.planarAt(PL.RIGHT_MOUTH, scratch.b);
    scratch.headMid.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);

    scratch.up.subVectors(scratch.headMid, scratch.shoulderMid);
    if (scratch.up.lengthSq() < 1e-10) scratch.up.set(0, 1, 0);
    scratch.up.normalize();

    // --- Neck width: two independent cues, in millimetres ------------------
    const earSpanM = this.worldDistance(PL.LEFT_EAR, PL.RIGHT_EAR);
    const ratio = shoulderWorldM > 0 ? earSpanM / shoulderWorldM : 0;
    const earUsable = ratio > MIN_EAR_SPAN_RATIO && ratio < MAX_EAR_SPAN_RATIO;

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

    // --- Where the chain crosses, from the neck's own length ---------------
    // The distance up to the mouth is essentially neck plus a fixed bit of jaw, so
    // a fraction of it lands at the sternal notch on a short neck and a long one
    // alike. A fraction of shoulder breadth cannot: breadth says nothing about how
    // long a neck is.
    const neckLength = scratch.shoulderMid.distanceTo(scratch.headMid);
    pose.neckLengthMm = planeScale > 0 ? (neckLength / planeScale) * 1000 : 0;

    const rise = neckLength * NOTCH_FROM_NECK_LENGTH + pose.neckRadius * anchor.riseOffset;
    pose.position.copy(scratch.shoulderMid).addScaledVector(scratch.up, rise);

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

    this.worldAt(PL.LEFT_MOUTH, scratch.a);
    this.worldAt(PL.RIGHT_MOUTH, scratch.b);
    scratch.headMid.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);
    this.worldAt(PL.LEFT_SHOULDER, scratch.a);
    this.worldAt(PL.RIGHT_SHOULDER, scratch.b);
    scratch.shoulderMid.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);

    scratch.up.subVectors(scratch.headMid, scratch.shoulderMid);
    if (scratch.up.lengthSq() < 1e-10) scratch.up.set(0, 1, 0);
    scratch.up.normalize();

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

    scratch.basis.makeBasis(scratch.across, scratch.up, scratch.forward);
    pose.quaternion.setFromRotationMatrix(scratch.basis);

    // How square-on the shoulders are. In profile the span collapses and a
    // necklace should mostly disappear behind the neck.
    pose.facing = Math.sqrt(Math.max(0, 1 - scratch.across.z * scratch.across.z));

    // Depth of the neck relative to the shoulder line, so the chain can sit in
    // the same 3D space as the neck occluder rather than flat on the plane.
    if (planeScale > 0) {
      const shoulderZ =
        (scratch.world[PL.LEFT_SHOULDER].z + scratch.world[PL.RIGHT_SHOULDER].z) / 2;
      const neckZ =
        (scratch.world[PL.LEFT_MOUTH].z + scratch.world[PL.RIGHT_MOUTH].z) / 2;
      pose.anchorDepth = (neckZ - shoulderZ) * planeScale * 0.5;
    } else {
      pose.anchorDepth = 0;
    }

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
