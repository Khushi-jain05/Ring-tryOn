import { WIDTH_NEIGHBOURS, WIDTH_RATIO, type FingerName } from "./landmarks";

/**
 * Turning a hand on camera into millimetres.
 *
 * MediaPipe emits two landmark sets, and the second one is the whole reason
 * accurate sizing is possible at all: `worldLandmarks` are in **metres**,
 * recovered by the model from learned hand proportions rather than from any
 * camera calibration. So we can measure a finger in real units without knowing
 * anything about the lens, and then draw a ring at its true diameter instead of
 * at whatever size happens to look plausible.
 */

/**
 * Fingers are ellipses, not circles — roughly 0.88 as deep as they are wide.
 * Ring size is defined by circumference, so using the width as a diameter would
 * over-measure. Ramanujan's first approximation for an ellipse of axes w and
 * 0.88w gives a perimeter of about 0.9407·πw.
 */
export const FINGER_ELLIPSE_RATIO = 0.88;

const PERIMETER_FACTOR = ellipsePerimeterFactor(FINGER_ELLIPSE_RATIO);

function ellipsePerimeterFactor(depthRatio: number): number {
  // Ramanujan: P ≈ π[3(a+b) − √((3a+b)(a+3b))], with a = 0.5, b = 0.5·ratio.
  const a = 0.5;
  const b = 0.5 * depthRatio;
  const p = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  // Express as the diameter of the circle with the same perimeter, over width.
  return p / Math.PI;
}

/**
 * Width of the proximal phalanx as a fraction of its length.
 *
 * Anthropometric surveys of adult hands put ring-finger base width at about
 * 45% of proximal phalanx length, and the ratio is remarkably stable across
 * hand sizes — which is what makes it usable as a second opinion when the
 * knuckle span is foreshortened.
 */
export const PHALANX_WIDTH_RATIO: Record<FingerName, number> = {
  index: 0.46,
  middle: 0.46,
  ring: 0.45,
  pinky: 0.4,
};

export type Point3 = { x: number; y: number; z: number };

function distance(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export type FingerMeasurement = {
  /** Width of the finger at the base of the proximal phalanx, in millimetres. */
  widthMm: number;
  /** Circumference at that point, accounting for the finger's oval section. */
  circumferenceMm: number;
  /** Length of the proximal phalanx, in millimetres. */
  phalanxMm: number;
};

/**
 * Measures a finger from a frame of metric world landmarks.
 *
 * Two independent estimates are combined. The knuckle span is the more direct
 * measurement but inflates when the fingers are splayed; the phalanx-length
 * ratio is immune to splay but assumes average proportions. Taking the smaller
 * of the two suppresses the splay error, which is the larger and more common
 * of the two failure modes in a hand held up to a camera.
 */
export function measureFinger(
  world: ReadonlyArray<Point3>,
  finger: FingerName,
  chain: { mcp: number; pip: number },
): FingerMeasurement | null {
  if (world.length < 21) return null;

  const [left, right] = WIDTH_NEIGHBOURS[finger];
  const spanM = distance(world[left], world[right]);
  const phalanxM = distance(world[chain.mcp], world[chain.pip]);
  if (!(spanM > 0) || !(phalanxM > 0)) return null;

  const fromSpan = spanM * WIDTH_RATIO[finger];
  const fromPhalanx = phalanxM * PHALANX_WIDTH_RATIO[finger];

  const widthM = Math.min(fromSpan, fromPhalanx);
  const widthMm = widthM * 1000;

  return {
    widthMm,
    circumferenceMm: Math.PI * widthMm * PERIMETER_FACTOR,
    phalanxMm: phalanxM * 1000,
  };
}

/**
 * A running median of recent measurements.
 *
 * Per-frame estimates wander by a millimetre or so as the model re-fits the
 * hand. Averaging would let one bad frame — a partly occluded hand, a hand at
 * the edge of the sensor — drag the result; a median simply ignores it.
 */
export class MedianTracker {
  private samples: number[] = [];

  constructor(private readonly capacity = 45) {}

  push(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.samples.push(value);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count(): number {
    return this.samples.length;
  }

  /** True once there are enough samples for the median to mean anything. */
  get settled(): boolean {
    return this.samples.length >= Math.min(20, this.capacity);
  }

  get value(): number | null {
    return this.quantile(0.5);
  }

  /**
   * @param q 0 for the minimum, 1 for the maximum, 0.5 for the median.
   *
   * A high quantile is the right summary for a quantity whose error is one-sided.
   * The finger's silhouette can only ever look *narrower* than the finger really
   * is — rolling the hand turns its width into its depth — so the upper end of
   * the distribution is the honest estimate and the lower end is foreshortening.
   */
  quantile(q: number): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (sorted.length - 1) * Math.min(1, Math.max(0, q));
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  }

  /**
   * Spread of the middle half of the samples, as a fraction of the median.
   * A tight interquartile range means the hand is being held steadily and the
   * reading can be trusted; a wide one means keep measuring.
   */
  get spread(): number | null {
    if (this.samples.length < 8) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const median = this.value;
    if (!median) return null;
    return (q3 - q1) / median;
  }

  reset(): void {
    this.samples.length = 0;
  }
}
