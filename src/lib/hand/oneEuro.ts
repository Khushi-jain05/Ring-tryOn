/**
 * One Euro Filter — Casiez, Roussel & Vogel (CHI 2012).
 *
 * Raw MediaPipe landmarks jitter by a pixel or two every frame even on a
 * perfectly still hand, which reads as the ring "buzzing". A plain low-pass
 * fixes the buzz but adds lag you can feel when the hand moves.
 *
 * One Euro adapts its cutoff to the signal's own speed: heavy smoothing while
 * slow (kills jitter), light smoothing while fast (kills lag). That trade is
 * exactly the one AR overlays need.
 */

const TWO_PI = Math.PI * 2;

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  private y: number | null = null;

  filter(value: number, a: number): number {
    this.y = this.y === null ? value : a * value + (1 - a) * this.y;
    return this.y;
  }

  get hasValue(): boolean {
    return this.y !== null;
  }

  reset(): void {
    this.y = null;
  }

  rescale(factor: number): void {
    if (this.y !== null) this.y *= factor;
  }
}

export type OneEuroConfig = {
  /** Cutoff at rest, in Hz. Lower = smoother but laggier when still. */
  minCutoff: number;
  /** Speed coefficient. Higher = snappier response to fast motion. */
  beta: number;
  /** Cutoff of the derivative filter, in Hz. */
  dCutoff: number;
};

export const DEFAULT_ONE_EURO: OneEuroConfig = {
  minCutoff: 1.7,
  beta: 0.035,
  dCutoff: 1.0,
};

export class OneEuroFilter {
  private xFilter = new LowPass();
  private dxFilter = new LowPass();
  private prev: number | null = null;

  constructor(private config: OneEuroConfig = DEFAULT_ONE_EURO) {}

  setConfig(config: OneEuroConfig): void {
    this.config = config;
  }

  filter(value: number, dt: number): number {
    if (!Number.isFinite(value)) return value;
    // Guard against zero/negative frame deltas from timestamp hiccups.
    const step = dt > 1e-6 ? dt : 1 / 60;

    const rawDerivative = this.prev === null ? 0 : (value - this.prev) / step;
    this.prev = value;

    const derivative = this.dxFilter.filter(rawDerivative, alpha(this.config.dCutoff, step));
    const cutoff = this.config.minCutoff + this.config.beta * Math.abs(derivative);
    return this.xFilter.filter(value, alpha(cutoff, step));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.prev = null;
  }

  /**
   * Multiplies the filter's memory by a constant.
   *
   * For a *known* change of units — the preview's digital zoom changing, which
   * rescales every plane coordinate by a fixed ratio — this is the right response
   * and a reset is not. The filter's stored history is in the old units, so
   * smoothing across the change makes it chase a step that never physically
   * happened: on screen the jewellery slides for a second or so after every zoom
   * adjustment and then settles. Resetting instead loses all history and pops.
   * Rescaling converts the history into the new units so smoothing simply
   * continues, and the change is invisible.
   */
  rescale(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.xFilter.rescale(factor);
    this.dxFilter.rescale(factor);
    if (this.prev !== null) this.prev *= factor;
  }
}

/** A One Euro filter applied component-wise to a fixed-length vector. */
export class OneEuroVector {
  private filters: OneEuroFilter[];

  constructor(size: number, config: OneEuroConfig = DEFAULT_ONE_EURO) {
    this.filters = Array.from({ length: size }, () => new OneEuroFilter(config));
  }

  setConfig(config: OneEuroConfig): void {
    for (const f of this.filters) f.setConfig(config);
  }

  filter(values: ArrayLike<number>, dt: number, out: number[] = []): number[] {
    for (let i = 0; i < this.filters.length; i++) {
      out[i] = this.filters[i].filter(values[i], dt);
    }
    return out;
  }

  reset(): void {
    for (const f of this.filters) f.reset();
  }

  /** See OneEuroFilter.rescale — a known change of units, not a new measurement. */
  rescale(factor: number): void {
    for (const f of this.filters) f.rescale(factor);
  }
}
