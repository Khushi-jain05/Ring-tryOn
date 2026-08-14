import { Matrix4, Quaternion, Vector3 } from "three";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { FINGER_CHAINS, FINGER_NAMES, LM, type FingerName } from "./landmarks";
import { DEFAULT_ANCHOR, type RingAnchor } from "./anchor";
import { DEFAULT_ONE_EURO, OneEuroVector, type OneEuroConfig } from "./oneEuro";
import { projectToAnchorPlane, type FrameGeometry } from "./projection";
import {
  MedianTracker,
  measureFinger,
  type FingerMeasurement,
  type Point3,
} from "./measure";
import { estimatePlaneScale } from "./scale";
import { sizeToDiameterMm } from "@/lib/rings/sizes";

export type RingPose = {
  /** Centre of the band, on the anchor plane. */
  position: Vector3;
  /** Band axis along the finger; local +Y points out the back of the hand. */
  quaternion: Quaternion;
  /** Inner radius the band is actually drawn at, in anchor-plane units. */
  ringRadius: number;
  /** The finger's own radius, in anchor-plane units. Drives the occluder. */
  fingerRadius: number;
  /** Length of the proximal phalanx, in anchor-plane units. */
  phalanxLength: number;
  /** How square-on the finger is to the camera: 0 end-on, 1 side-on. */
  facing: number;
  /** Anchor-plane units per metre — the screen-to-millimetres bridge. */
  planeScale: number;
  /** Raw measurement from the model, still carrying its metric bias. */
  measurement: FingerMeasurement | null;
  /** Finger width in millimetres, after correcting for the metric bias. */
  trueWidthMm: number;
  /** Finger circumference in millimetres, after correcting for the bias. */
  trueCircumferenceMm: number;
  /** Smoothed anchor-plane landmarks, for the diagnostics overlay. */
  planar: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Depth of each landmark in anchor-plane units, positive toward the camera,
   * measured relative to the band. Without this every part of the hand sits on
   * one plane and nothing can pass in front of anything.
   */
  depth: ReadonlyArray<number>;
  /** Half-width of each finger in anchor-plane units, indexed by finger name. */
  fingerHalfWidth: Record<FingerName, number>;
  /**
   * The finger's on-screen silhouette half-width this frame, in plane units.
   * Rolls with the hand — unlike `fingerRadius`, which must not.
   */
  silhouetteHalfWidth: number;
  /**
   * Depth of the band itself, in anchor-plane units, positive toward the camera
   * and measured from the palm.
   *
   * `position` is where the band lands *on the anchor plane*; this is how far in
   * front of or behind that plane it actually is. Keeping the two separate lets
   * the renderer decide the perspective compensation, and lets the diagnostics
   * overlay draw the seat in plain screen coordinates.
   */
  seatDepth: number;
};

export type SolverOptions = {
  /** Where on which finger the ring sits, in finger-relative terms only. */
  anchor: RingAnchor;
  /** US ring size to draw at true scale. */
  ringSize: number;
  /**
   * How many times larger MediaPipe believes this hand to be than it really is.
   *
   * World landmarks are regressed against a canonical hand, so for anyone whose
   * hands are not average the metric output carries a roughly constant scale
   * error. 1 means "believe the model"; calibration measures the real value.
   *
   * Note this does **not** affect how large the ring is drawn in auto-fit — the
   * bias cancels there, because the finger measurement and the pixels-per-metre
   * estimate are wrong by the same factor in opposite directions. It matters for
   * the size we *report*, and for drawing a specific US size to true scale.
   */
  metricBias: number;
  /** Draw at the measured finger size instead of the selected ring size. */
  autoFit: boolean;
  /** Override when the setting ends up facing into the palm. */
  flipGem: boolean;
  /**
   * Present the setting to the viewer rather than to the back of the hand.
   *
   * Anatomically the stone belongs on the dorsal side and should disappear as the
   * wrist rolls — which is exactly what a shopper does not want, since the stone
   * is what they are trying to look at. With this on, the band still wraps and
   * occludes correctly; only the roll about the finger's own axis changes.
   */
  settingFacesCamera: boolean;
  /** Whether the preview is mirrored, which flips the pose as well as the pixels. */
  mirrored: boolean;
  /**
   * Half the finger's width as read off the video pixels, in anchor-plane units,
   * or null when the probe could not find both edges.
   *
   * This is the only unbiased width we have: the anthropometric estimates are
   * population averages and can be several percent out on any given hand, which
   * is precisely the error that shows as a gap between the skin and the band.
   */
  silhouetteHalfWidth: number | null;
  smoothing: OneEuroConfig;
};

/**
 * Where the band sits along the proximal phalanx.
 *
 * MediaPipe's MCP landmark sits at the centre of the knuckle *joint*, which is
 * noticeably proximal to the crease a ring actually rests against — so a naive
 * seat near 0 puts the band down in the web between the fingers. Just under half
 * way to the middle joint lands it where a worn ring sits; from the palm side the
 * joint landmark is further from the visible finger base still, which is why this
 * is higher than the geometry alone suggests.
 */
export const DEFAULT_SEAT = 0.47;

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  anchor: DEFAULT_ANCHOR,
  ringSize: 6.5,
  metricBias: 1,
  autoFit: true,
  flipGem: false,
  settingFacesCamera: false,
  mirrored: true,
  silhouetteHalfWidth: null,
  smoothing: DEFAULT_ONE_EURO,
};

const LANDMARK_COUNT = 21;

/** Scratch objects — the solver runs every frame and must not allocate. */
const scratch = {
  planar: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 })),
  world: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 })),
  depth: new Array<number>(LANDMARK_COUNT).fill(0),
  point: { x: 0, y: 0 },
  mcp: new Vector3(),
  pip: new Vector3(),
  dip: new Vector3(),
  bend: new Vector3(),
  next: new Vector3(),
  axis: new Vector3(),
  across: new Vector3(),
  along: new Vector3(),
  dorsal: new Vector3(),
  thumb: new Vector3(),
  up: new Vector3(),
  right: new Vector3(),
  basis: new Matrix4(),
  wrist: new Vector3(),
  a: new Vector3(),
  b: new Vector3(),
  spin: new Quaternion(),
  palm: new Vector3(),
};

/**
 * Points that lean toward the palm on a relaxed, open hand: the thumb's chain,
 * which is rotated out of the plane of the other metacarpals, and the four
 * fingertips, which are never quite hyperextended.
 */
const LEAN_POINTS = [
  LM.THUMB_CMC,
  LM.THUMB_MCP,
  LM.THUMB_IP,
  LM.THUMB_TIP,
  LM.INDEX_TIP,
  LM.MIDDLE_TIP,
  LM.RING_TIP,
  LM.PINKY_TIP,
];

/** Landmarks defining the palm plane the lean is measured against. */
const PALM_POINTS = [
  LM.WRIST,
  LM.INDEX_MCP,
  LM.MIDDLE_MCP,
  LM.RING_MCP,
  LM.PINKY_MCP,
];

/** In three.js the camera sits on +Z, so this points out of the screen. */
const TOWARD_VIEWER = new Vector3(0, 0, 1);

/**
 * Turns a frame of hand landmarks into a ring pose.
 *
 * The solve is deliberately *hybrid*, because the landmark sets MediaPipe gives
 * us are each reliable at exactly one thing:
 *
 * - **Where** comes from the normalized image landmarks. Anchoring to the image
 *   guarantees the ring sits on the pixels of the finger, with no dependence on
 *   an unknown camera intrinsic.
 * - **Which way it is turned** comes from the metric world landmarks, which
 *   carry real 3D structure that flat image coordinates cannot express.
 * - **How big** comes from both: the metric landmarks measure the finger in
 *   millimetres, and the ratio between the two spaces converts that back to
 *   pixels. This is what lets a US 7 render as an actual US 7.
 */
export class RingPoseSolver {
  private planarFilter = new OneEuroVector(LANDMARK_COUNT * 2);
  private worldFilter = new OneEuroVector(LANDMARK_COUNT * 3);
  private scaleFilter = new OneEuroVector(1, { minCutoff: 0.35, beta: 0.004, dCutoff: 1 });
  private planarSmoothed: number[] = [];
  private worldSmoothed: number[] = [];
  private scaleSmoothed: number[] = [];
  private lastTimestamp: number | null = null;

  /**
   * The crop the filters' history was accumulated under. See the matching note in
   * NecklacePoseSolver: a zoom change rescales every plane coordinate, so the
   * filter memory has to be converted rather than smoothed across, or the ring
   * slides for a second after each zoom adjustment.
   */
  private lastZoom = 1;

  /**
   * Which way round the palm-plane normal is. Held between frames because the
   * evidence for it comes and goes: a straight finger offers none at all, and
   * recomputing from scratch every frame lets the setting flick from one side of
   * the finger to the other as the hand turns.
   */
  private dorsalSign: 1 | -1 = 1;

  /**
   * Ratio of the measured silhouette to the anthropometric estimate, collected
   * over a window. Its high quantile is the correction we want: the silhouette is
   * unbiased but shrinks as the hand rolls, so the top of the distribution is the
   * frames where the finger was square-on and the estimate is honest.
   */
  private widthCorrection = new MedianTracker(90);

  readonly pose: RingPose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    ringRadius: 0.02,
    fingerRadius: 0.02,
    phalanxLength: 0.08,
    facing: 1,
    planeScale: 1,
    measurement: null,
    trueWidthMm: 0,
    trueCircumferenceMm: 0,
    planar: scratch.planar,
    depth: scratch.depth,
    fingerHalfWidth: { index: 0, middle: 0, ring: 0, pinky: 0 },
    silhouetteHalfWidth: 0,
    seatDepth: 0,
  };

  reset(): void {
    this.planarFilter.reset();
    this.worldFilter.reset();
    this.scaleFilter.reset();
    this.widthCorrection.reset();
    this.lastTimestamp = null;
  }

  /**
   * @returns the shared pose object, or null when no usable hand was found.
   *          The object is reused between frames — read it, don't retain it.
   */
  solve(
    result: HandLandmarkerResult,
    geometry: FrameGeometry,
    options: SolverOptions,
    timestampMs: number,
  ): RingPose | null {
    const landmarks = result.landmarks?.[0];
    const world = result.worldLandmarks?.[0];
    if (!landmarks || !world || landmarks.length < LANDMARK_COUNT) {
      this.lastTimestamp = null;
      return null;
    }

    const dt =
      this.lastTimestamp === null ? 1 / 60 : (timestampMs - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestampMs;

    // A long gap means tracking dropped and re-acquired; a stale filter state
    // would drag the ring across the screen from wherever the hand used to be.
    if (dt > 0.5) {
      this.planarFilter.reset();
      this.worldFilter.reset();
      this.scaleFilter.reset();
    }

    this.project(landmarks, geometry);
    this.smooth(dt, world, options);

    return this.compose(options);
  }

  /** Image landmarks → anchor-plane coordinates, flattened for the filter. */
  private project(
    landmarks: ReadonlyArray<{ x: number; y: number }>,
    geometry: FrameGeometry,
  ): void {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = landmarks[i];
      projectToAnchorPlane(lm.x, lm.y, geometry, scratch.point);
      scratch.planar[i].x = scratch.point.x;
      scratch.planar[i].y = scratch.point.y;
    }
  }

  private smooth(
    dt: number,
    world: ReadonlyArray<Point3>,
    options: SolverOptions,
  ): void {
    this.planarFilter.setConfig(options.smoothing);
    this.worldFilter.setConfig(options.smoothing);

    const planarRaw: number[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      planarRaw[i * 2] = scratch.planar[i].x;
      planarRaw[i * 2 + 1] = scratch.planar[i].y;
    }
    this.planarSmoothed = this.planarFilter.filter(planarRaw, dt, this.planarSmoothed);

    const worldRaw: number[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = world[i];
      // MediaPipe world space is image-aligned: +x right, +y down, +z away from
      // the viewer. three.js is y-up and looks down -z, so two axes invert.
      // Chirality is preserved here; mirroring is applied to the finished basis
      // instead, where it can be done without corrupting the handedness.
      worldRaw[i * 3] = lm.x;
      worldRaw[i * 3 + 1] = -lm.y;
      worldRaw[i * 3 + 2] = -lm.z;
    }
    this.worldSmoothed = this.worldFilter.filter(worldRaw, dt, this.worldSmoothed);

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      scratch.planar[i].x = this.planarSmoothed[i * 2];
      scratch.planar[i].y = this.planarSmoothed[i * 2 + 1];
      scratch.world[i].x = this.worldSmoothed[i * 3];
      scratch.world[i].y = this.worldSmoothed[i * 3 + 1];
      scratch.world[i].z = this.worldSmoothed[i * 3 + 2];
    }

    // The scale drifts slowly and matters a lot, so it gets its own much
    // heavier filter — a ring that breathes in and out with the estimate looks
    // far worse than one that takes an extra beat to settle.
    const raw = estimatePlaneScale(scratch.planar, scratch.world);
    if (raw !== null) {
      this.scaleSmoothed = this.scaleFilter.filter([raw], dt, this.scaleSmoothed);
    }
  }

  private planarAt(index: number, out: Vector3): Vector3 {
    return out.set(scratch.planar[index].x, scratch.planar[index].y, 0);
  }

  private worldAt(index: number, out: Vector3): Vector3 {
    const w = scratch.world[index];
    return out.set(w.x, w.y, w.z);
  }

  /**
   * Widths for every finger, not just the one wearing the ring — the others need
   * them to be occluders of the right thickness when they pass in front.
   */
  private measureAllFingers(options: SolverOptions): void {
    const bias = options.metricBias > 0 ? options.metricBias : 1;
    const planeScale = this.scaleSmoothed[0] ?? 0;
    const unitsPerTrueMm = (planeScale * bias) / 1000;

    for (const name of FINGER_NAMES) {
      const m = measureFinger(scratch.world, name, FINGER_CHAINS[name]);
      this.pose.fingerHalfWidth[name] =
        m && unitsPerTrueMm > 0 ? (m.widthMm / bias / 2) * unitsPerTrueMm : 0;
    }
  }

  /**
   * Relative depth for every landmark, in anchor-plane units.
   *
   * The metric landmarks carry MediaPipe's scale bias, and `planeScale` carries
   * its reciprocal, so the product is unbiased — no correction needed here.
   *
   * The datum is the **palm**, not the band. It used to be the band, which made
   * the band's own depth zero by definition — so the ring alone sat flat on the
   * anchor plane while every occluder around it had a real depth. Relative
   * ordering still came out right, but the ring itself could never move in Z: no
   * parallax, and no foreshortening from a finger reaching toward the lens.
   * Referencing the palm instead gives the band a depth like everything else, and
   * puts the whole hand in one consistent 3D space.
   */
  private computeDepths(
    chain: { mcp: number; pip: number },
    planeScale: number,
    seat: number,
  ): void {
    const zRef = scratch.palm.z;

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      scratch.depth[i] = (scratch.world[i].z - zRef) * planeScale;
    }

    this.pose.seatDepth =
      scratch.depth[chain.mcp] +
      (scratch.depth[chain.pip] - scratch.depth[chain.mcp]) * seat;
  }

  /**
   * Decides which face of the palm plane is the back of the hand, and so which
   * side of the finger the setting stands on.
   *
   * The cross product that produced `scratch.dorsal` points dorsally for one
   * hand and palmar-ward for the other — it encodes chirality, which a single
   * plane cannot resolve. MediaPipe does report handedness, but its label is
   * defined relative to a selfie-mirroring convention that has changed between
   * releases, so building the whole orientation on it is asking for a ring whose
   * stone is on the wrong side of the finger.
   *
   * Two better witnesses, in order of preference:
   *
   * 1. **How the finger bends.** Fingers only curl toward the palm, so the
   *    sideways component of the DIP direction relative to the PIP direction
   *    points palmar-ward. This is *chirality-free* — it works identically for
   *    either hand and needs no label at all. It is only unavailable when the
   *    finger is perfectly straight.
   * 2. **Where the thumb sits.** The thumb's metacarpal is rotated out of the
   *    plane of the other four, toward the palm. Weaker, because the
   *    out-of-plane component is small next to the noise in the palm fit, but it
   *    covers the flat-hand case the bend cue cannot.
   *
   * Whichever fires, the answer is latched: below the confidence threshold the
   * previous decision stands, which is what stops the setting flicking across
   * the finger as the hand rotates through a pose with no clear evidence.
   */
  private orientDorsal(chain: { mcp: number; pip: number; dip: number }): void {
    const CONFIDENT_BEND = 0.1;
    const CONFIDENT_LEAN = 0.035;

    this.worldAt(chain.mcp, scratch.mcp);
    this.worldAt(chain.pip, scratch.pip);
    this.worldAt(chain.dip, scratch.dip);

    scratch.bend.subVectors(scratch.pip, scratch.mcp);
    scratch.next.subVectors(scratch.dip, scratch.pip);

    const bendLen = scratch.bend.length();
    const nextLen = scratch.next.length();

    if (bendLen > 1e-6 && nextLen > 1e-6) {
      // Component of the second segment perpendicular to the first: the
      // direction the finger is curling, which is the palm side.
      const along = scratch.next.dot(scratch.bend) / (bendLen * bendLen);
      scratch.next.addScaledVector(scratch.bend, -along);
      const curl = scratch.next.length() / nextLen;

      if (curl > CONFIDENT_BEND) {
        scratch.next.normalize();
        // dorsal is opposite the curl, so a positive dot means the current
        // dorsal is pointing the wrong way.
        this.dorsalSign = scratch.next.dot(scratch.dorsal) > 0 ? -1 : 1;
        return;
      }
    }

    // The hand is flat, which is the pose people actually hold up to a camera —
    // and the one where the bend cue says nothing. The previous fallback measured
    // only the thumb, dividing its out-of-plane offset by its *full* length; the
    // large in-plane component swamped the signal, the result sat right on the
    // threshold, and so on an extended hand neither cue fired and the sign kept
    // whatever it was initialised to. That is a coin flip, and losing it puts the
    // stone on the palm.
    //
    // The fix is to aggregate. The thumb's metacarpal is rotated toward the palm,
    // and a relaxed hand's fingertips are all slightly flexed the same way, so
    // eight points lean palmar together. Measuring their mean offset from the palm
    // plane — and scaling it by the hand's own width rather than by each point's
    // distance — turns eight weak cues into one that fires on a flat hand.
    let lean = 0;
    for (const index of LEAN_POINTS) {
      lean += this.worldAt(index, scratch.thumb).sub(scratch.palm).dot(scratch.dorsal);
    }
    lean /= LEAN_POINTS.length;

    this.worldAt(LM.INDEX_MCP, scratch.a);
    this.worldAt(LM.PINKY_MCP, scratch.b);
    const palmWidth = scratch.a.distanceTo(scratch.b);
    if (palmWidth < 1e-6) return;

    const normalised = lean / palmWidth;
    if (Math.abs(normalised) > CONFIDENT_LEAN) {
      // Those points lean toward the palm, so a positive offset along `dorsal`
      // means `dorsal` is the palmar direction and has to be flipped.
      this.dorsalSign = normalised > 0 ? -1 : 1;
    }
    // Otherwise: keep whatever we decided last time.
  }

  private compose(options: SolverOptions): RingPose {
    const { anchor } = options;
    const chain = FINGER_CHAINS[anchor.finger];
    const { pose } = this;

    // --- Position: on the anchor plane, seated just above the knuckle -------
    this.planarAt(chain.mcp, scratch.mcp);
    this.planarAt(chain.pip, scratch.pip);
    pose.phalanxLength = scratch.mcp.distanceTo(scratch.pip);
    pose.position.lerpVectors(scratch.mcp, scratch.pip, anchor.positionAlongFinger);

    // --- Scale: real millimetres, via the metric landmarks ------------------
    const planeScale = this.scaleSmoothed[0] ?? 0;
    const measurement = measureFinger(scratch.world, anchor.finger, chain);
    pose.planeScale = planeScale;
    pose.measurement = measurement;

    if (planeScale > 0 && measurement) {
      const bias = options.metricBias > 0 ? options.metricBias : 1;

      // `planeScale` came from dividing pixels by MediaPipe's metres, so it is
      // too *small* by the same factor the metres are too large. Undoing the
      // bias here is what makes one true millimetre convert correctly.
      const unitsPerTrueMm = (planeScale * bias) / 1000;

      let trueWidthMm = measurement.widthMm / bias;
      const anthropometricRadius = (trueWidthMm / 2) * unitsPerTrueMm;

      // Correct the population-average width against what the camera can actually
      // see of this finger.
      //
      // The silhouette cannot be used directly: rolling the hand turns the
      // finger's width into its depth, so the measurement shrinks by a tenth or
      // more through a turn, and a ring that followed it would visibly breathe.
      // But that error is *one-sided* — the silhouette is never wider than the
      // finger truly is — so the top of the distribution over a couple of seconds
      // is the frames where the finger was square-on, and that is the honest
      // number. Applying it as a ratio keeps the result rotation-invariant while
      // removing the bias.
      // Reject a measurement that disagrees wildly with the proportional estimate.
      // The probe is reading pixels, so it can lock onto a crease, a nail edge or
      // the far side of a neighbouring finger; a single such frame used unchecked
      // is enough to shrink the occluder to nothing and leave the entire ring —
      // including the arc that should be behind the finger — drawn flat on top of
      // the hand. The two methods fail in unrelated ways, so requiring them to
      // roughly agree is a cheap and effective sanity gate.
      const raw = options.silhouetteHalfWidth;
      const ratio = raw && anthropometricRadius > 0 ? raw / anthropometricRadius : 0;
      const plausible = ratio >= 0.72 && ratio <= 1.32;

      pose.silhouetteHalfWidth = plausible ? (raw as number) : 0;
      if (plausible) this.widthCorrection.push(ratio);
      const correction = this.widthCorrection.settled
        ? (this.widthCorrection.quantile(0.82) ?? 1)
        : 1;
      // Refuse a wild correction; a probe locking onto a background edge should
      // not be able to double the size of the ring.
      const safe = Math.min(1.35, Math.max(0.74, correction));

      trueWidthMm *= safe;
      pose.fingerRadius = anthropometricRadius * safe;
      pose.trueWidthMm = trueWidthMm;
      pose.trueCircumferenceMm = (measurement.circumferenceMm / bias) * safe;

      // A ring that fits is *not* as wide as the finger. Fingers are oval, and
      // ring size is defined by circumference, so the band that fits a finger
      // 17.0 mm across has an inner diameter nearer 16.0 mm — it sits slightly
      // inside the silhouette at the sides while standing proud of the
      // shallower front face. Drawing it at the full width instead is the
      // classic "sticker on a photo" look: a band exactly as wide as the finger
      // with no flesh either side of it.
      const fittingDiameterMm = pose.trueCircumferenceMm / Math.PI;
      pose.ringRadius =
        (options.autoFit
          ? (fittingDiameterMm / 2) * unitsPerTrueMm
          : (sizeToDiameterMm(options.ringSize) / 2) * unitsPerTrueMm) *
        anchor.widthMultiplier;
    } else {
      // No metric estimate yet — fall back to the finger's on-screen width so
      // the ring is at least plausible while the scale settles.
      const fallback = pose.phalanxLength * 0.225;
      pose.fingerRadius = fallback;
      pose.ringRadius = fallback * 0.94 * anchor.widthMultiplier;
      pose.trueWidthMm = 0;
      pose.trueCircumferenceMm = 0;
      pose.silhouetteHalfWidth = options.silhouetteHalfWidth ?? 0;
    }

    this.measureAllFingers(options);

    // Centroid of the palm: the origin both the palmar lean and every landmark
    // depth are measured from.
    scratch.palm.set(0, 0, 0);
    for (const index of PALM_POINTS) {
      scratch.palm.add(this.worldAt(index, scratch.a));
    }
    scratch.palm.multiplyScalar(1 / PALM_POINTS.length);

    this.computeDepths(chain, planeScale, anchor.positionAlongFinger);

    // --- Orientation: from the metric world landmarks -----------------------
    this.worldAt(chain.mcp, scratch.a);
    this.worldAt(chain.pip, scratch.b);
    scratch.axis.subVectors(scratch.b, scratch.a);
    if (scratch.axis.lengthSq() < 1e-12) return pose;
    scratch.axis.normalize();

    // Palm plane: the knuckle line crossed with the wrist-to-knuckles line.
    this.worldAt(LM.INDEX_MCP, scratch.a);
    this.worldAt(LM.PINKY_MCP, scratch.b);
    scratch.across.subVectors(scratch.b, scratch.a);

    this.worldAt(LM.WRIST, scratch.wrist);
    this.worldAt(LM.MIDDLE_MCP, scratch.a);
    scratch.along.subVectors(scratch.a, scratch.wrist);

    scratch.dorsal.crossVectors(scratch.along, scratch.across);
    if (scratch.dorsal.lengthSq() < 1e-12) return pose;
    scratch.dorsal.normalize();

    this.orientDorsal(chain);
    scratch.dorsal.multiplyScalar(this.dorsalSign);
    if (options.flipGem) scratch.dorsal.negate();

    // Gram-Schmidt the dorsal direction against the finger axis so the basis is
    // orthonormal even when the finger is splayed out of the palm plane.
    scratch.up
      .copy(scratch.dorsal)
      .addScaledVector(scratch.axis, -scratch.dorsal.dot(scratch.axis));
    if (scratch.up.lengthSq() < 1e-10) {
      // Finger points straight out of the palm — any perpendicular will do.
      scratch.up.set(0, 0, 1).cross(scratch.axis);
      if (scratch.up.lengthSq() < 1e-10) scratch.up.set(0, 1, 0).cross(scratch.axis);
    }
    scratch.up.normalize();

    // A mirrored preview flips the pixels, so the pose has to flip with them.
    // Negating x on the vectors alone would leave a left-handed basis, which is
    // not a rotation; rebuilding `right` from the flipped pair restores it.
    // The band is symmetric about that axis, so nothing visible is lost.
    if (options.mirrored) {
      scratch.axis.x = -scratch.axis.x;
      scratch.up.x = -scratch.up.x;
    }

    // Roll the setting round to face the viewer, if asked. Done after mirroring so
    // the camera direction is the one the user is actually looking down, and only
    // the roll is affected — the band's axis still follows the finger exactly, so
    // the wrap and the occlusion are unchanged.
    if (options.settingFacesCamera) {
      scratch.up
        .copy(TOWARD_VIEWER)
        .addScaledVector(scratch.axis, -TOWARD_VIEWER.dot(scratch.axis));
      // Degenerate when the finger points straight at the lens; the palm-derived
      // direction is still meaningful there, so leave it alone.
      if (scratch.up.lengthSq() > 0.02) scratch.up.normalize();
      else scratch.up.set(0, 1, 0).addScaledVector(scratch.axis, -scratch.axis.y).normalize();
      if (options.flipGem) scratch.up.negate();
    }

    scratch.right.crossVectors(scratch.up, scratch.axis).normalize();

    scratch.basis.makeBasis(scratch.right, scratch.up, scratch.axis);
    pose.quaternion.setFromRotationMatrix(scratch.basis);

    // Turn the setting round the finger, if the anchor asks for it.
    //
    // Nothing else is applied on top of this. In particular there is no
    // "off-axis" correction for the hand being away from the centre of the frame:
    // MediaPipe's world landmarks are already expressed in the *camera's* frame,
    // not in some hand-facing frame, so they carry the true orientation relative
    // to the lens, and the perspective camera handles the rest. Rotating the pose
    // toward the viewing ray on top of that double-counts the effect — it tips the
    // band by up to 20° for a hand held high or wide, which opens the ellipse out
    // and makes the ring read as a hoop lying on the hand instead of a band
    // wrapped round the finger.
    if (anchor.rotationOffset !== 0) {
      scratch.spin.setFromAxisAngle(scratch.axis, anchor.rotationOffset);
      pose.quaternion.premultiply(scratch.spin);
    }

    // How side-on the finger is: 1 when it lies across the frame, 0 when it
    // points at the lens. Drives the occluder's length.
    pose.facing = Math.sqrt(Math.max(0, 1 - scratch.axis.z * scratch.axis.z));

    return pose;
  }
}
