/**
 * Samples the room's colour and brightness from the live video.
 *
 * A piece lit by a fixed studio and composited over a warm, dim room reads as pasted
 * on however good the geometry and the placement are — mismatched colour temperature
 * is one of the first things the eye picks up, and it is a large part of why rendered
 * jewellery looks like a sticker. The other part is the contact shadow, which is
 * handled separately.
 *
 * The tint is pulled only part of the way on purpose: a fully tinted piece stops
 * reading as white metal and starts reading as coloured plastic.
 */

export type RoomLight = {
  /** Multipliers to apply to a light's colour, centred on 1. */
  r: number;
  g: number;
  b: number;
  /** Rough scene luminance, 0 to 1. */
  luminance: number;
};

export const NEUTRAL_ROOM: RoomLight = { r: 1, g: 1, b: 1, luminance: 0.45 };

/** How far toward the room's own cast the tint is taken. */
const TINT_PULL = 0.45;

/** Drift rate per sample, so a hand waving past does not swing the lighting. */
const DRIFT = 0.12;

export class RoomLightProbe {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private state = { r: 0.5, g: 0.5, b: 0.5, luminance: 0.45 };

  readonly light: RoomLight = { ...NEUTRAL_ROOM };

  /**
   * @param video The live frame, read directly and never uploaded anywhere.
   * @returns the smoothed light, or null if the frame could not be read.
   */
  sample(video: HTMLVideoElement): RoomLight | null {
    if (video.videoWidth === 0) return null;
    if (!this.ctx) {
      if (typeof document === "undefined") return null;
      this.canvas = document.createElement("canvas");
      // 32x24 is ample: this is an average, and a small target keeps the GPU
      // readback cheap enough to do several times a second.
      this.canvas.width = 32;
      this.canvas.height = 24;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
      if (!this.ctx) return null;
    }

    try {
      this.ctx.drawImage(video, 0, 0, 32, 24);
    } catch {
      return null;
    }

    let data: Uint8ClampedArray;
    try {
      data = this.ctx.getImageData(0, 0, 32, 24).data;
    } catch {
      // A tainted canvas cannot be read; leave the lighting neutral rather than
      // failing, since this is a refinement and not the feature.
      return null;
    }

    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const norm = (data.length / 4) * 255;
    r /= norm;
    g /= norm;
    b /= norm;

    this.state.r += (r - this.state.r) * DRIFT;
    this.state.g += (g - this.state.g) * DRIFT;
    this.state.b += (b - this.state.b) * DRIFT;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    this.state.luminance += (lum - this.state.luminance) * DRIFT;

    // Normalised against the brightest channel, so this is a *cast* rather than an
    // exposure — brightness is reported separately and applied to intensity.
    const max = Math.max(this.state.r, this.state.g, this.state.b, 1e-3);
    this.light.r = 1 + (this.state.r / max - 1) * TINT_PULL;
    this.light.g = 1 + (this.state.g / max - 1) * TINT_PULL;
    this.light.b = 1 + (this.state.b / max - 1) * TINT_PULL;
    this.light.luminance = this.state.luminance;

    return this.light;
  }

  reset(): void {
    this.state = { r: 0.5, g: 0.5, b: 0.5, luminance: 0.45 };
    Object.assign(this.light, NEUTRAL_ROOM);
  }
}
