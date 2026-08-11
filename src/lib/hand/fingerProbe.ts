/**
 * Measures the finger's width from the video pixels.
 *
 * Everything up to now inferred the finger's width from *proportions* — the span
 * between neighbouring knuckles times an anthropometric ratio, or the length of
 * the phalanx times another. Those are population averages, so for any particular
 * hand they can be several percent out, and a few percent is exactly the error
 * that shows as a sliver of background between the skin and the band. No amount
 * of filtering fixes a bias; the only way to remove it is to measure the finger
 * that is actually on screen.
 *
 * So: sample a line of pixels straight across the finger at the point the ring
 * sits, and find the two edges where the finger stops. That is the ground truth
 * the ring has to line up with, with no assumption about hand proportions at all.
 */

export type Probe = {
  /** Half the finger's width at the seat, in video pixels. */
  halfWidthPx: number;
  /** 0–1, from how decisively the edges stood out against the interior. */
  confidence: number;
};

/** Scan no further out than this multiple of the expected half-width. */
const SCAN_REACH = 2.3;

/** Ignore edges closer in than this — nails, creases and knuckle shading. */
const MIN_EDGE_FRACTION = 0.62;

/**
 * An edge counts as the silhouette if it is at least this strong relative to the
 * strongest step on the scan line.
 */
const EDGE_RELATIVE = 0.55;

/** Below this many grey levels of step, there is no edge worth trusting. */
const MIN_EDGE_STRENGTH = 9;

/** Scan lines taken along the finger and combined, to ride out local noise. */
const SCAN_OFFSETS = [-0.14, -0.07, 0, 0.07, 0.14];

/** Cap on the region we pull off the GPU each time. */
const MAX_ROI = 192;

export class FingerWidthProbe {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private ensureCanvas(): CanvasRenderingContext2D | null {
    if (this.ctx) return this.ctx;
    if (typeof document === "undefined") return null;
    this.canvas = document.createElement("canvas");
    this.canvas.width = MAX_ROI;
    this.canvas.height = MAX_ROI;
    // `willReadFrequently` keeps the surface in CPU memory; without it every
    // getImageData forces a GPU readback and the frame rate collapses.
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    return this.ctx;
  }

  /**
   * @param video  The live frame. Read directly, never uploaded anywhere.
   * @param mcp    Knuckle position, in video pixels.
   * @param pip    Middle joint, in video pixels.
   * @param seat   Fraction along the phalanx that the band sits at.
   */
  measure(
    video: HTMLVideoElement,
    mcp: { x: number; y: number },
    pip: { x: number; y: number },
    seat: number,
  ): Probe | null {
    const ctx = this.ensureCanvas();
    if (!ctx || video.videoWidth === 0) return null;

    const axisX = pip.x - mcp.x;
    const axisY = pip.y - mcp.y;
    const phalanx = Math.hypot(axisX, axisY);
    if (phalanx < 12) return null; // Hand too far away to measure meaningfully.

    const ax = axisX / phalanx;
    const ay = axisY / phalanx;
    // Perpendicular, in pixels — which is why this works in pixel space rather
    // than normalized coordinates, where the two axes have different units and
    // "perpendicular" would be skewed by the frame's aspect ratio.
    const px = -ay;
    const py = ax;

    const seatX = mcp.x + axisX * seat;
    const seatY = mcp.y + axisY * seat;

    // Anthropometric width only as a starting guess for how far to look.
    const expectedHalf = phalanx * 0.225;
    const reach = expectedHalf * SCAN_REACH;
    const alongReach = phalanx * 0.18;

    // Region of interest, clamped to the frame.
    const spanX = Math.abs(px) * reach + Math.abs(ax) * alongReach + 2;
    const spanY = Math.abs(py) * reach + Math.abs(ay) * alongReach + 2;
    const x0 = Math.max(0, Math.floor(seatX - spanX));
    const y0 = Math.max(0, Math.floor(seatY - spanY));
    const x1 = Math.min(video.videoWidth, Math.ceil(seatX + spanX));
    const y1 = Math.min(video.videoHeight, Math.ceil(seatY + spanY));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 8 || h < 8) return null;

    // Downscale only if the region is large; the edges we want are strong.
    const scale = Math.min(1, MAX_ROI / Math.max(w, h));
    const cw = Math.max(4, Math.round(w * scale));
    const ch = Math.max(4, Math.round(h * scale));

    try {
      ctx.drawImage(video, x0, y0, w, h, 0, 0, cw, ch);
    } catch {
      // A cross-origin or not-yet-ready frame taints the canvas; give up quietly.
      return null;
    }

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch {
      return null;
    }

    const luminance = (vx: number, vy: number): number => {
      // Video pixels → ROI canvas pixels.
      const sx = Math.round((vx - x0) * scale);
      const sy = Math.round((vy - y0) * scale);
      if (sx < 0 || sy < 0 || sx >= cw || sy >= ch) return -1;
      const i = (sy * cw + sx) * 4;
      // Rec. 601 luma is enough, and cheaper than a colour-space conversion.
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };

    const halves: number[] = [];
    const strengths: number[] = [];

    for (const offset of SCAN_OFFSETS) {
      const ox = seatX + ax * phalanx * offset;
      const oy = seatY + ay * phalanx * offset;

      const left = findEdge(luminance, ox, oy, -px, -py, reach, expectedHalf);
      const right = findEdge(luminance, ox, oy, px, py, reach, expectedHalf);
      if (left && right) {
        halves.push((left.distance + right.distance) / 2);
        strengths.push(Math.min(left.strength, right.strength));
      }
    }

    if (halves.length < 2) return null;

    // Median across the scan lines: one line crossing a crease or a highlight
    // should not move the answer, which an average would allow.
    halves.sort((a, b) => a - b);
    strengths.sort((a, b) => a - b);
    const mid = halves.length >> 1;
    const halfWidthPx =
      halves.length % 2 ? halves[mid] : (halves[mid - 1] + halves[mid]) / 2;
    const strength = strengths[strengths.length >> 1];

    return {
      halfWidthPx,
      // 12 grey levels is a weak edge, 60 is a decisive one.
      confidence: Math.max(0, Math.min(1, (strength - 12) / 48)),
    };
  }
}

/**
 * Walks outward from the centre of the finger and returns where the finger ends.
 *
 * Takes the **outermost** sufficiently-strong brightness step, not the strongest
 * one. That distinction is the whole ballgame. A finger is covered in creases,
 * knuckle shading and nail edges, and against a pale wall one of those interior
 * features is very often a sharper transition than the silhouette itself — so
 * "strongest" picks a crease, reports a finger far narrower than it is, and every
 * downstream consumer shrinks with it. The silhouette is instead the *last* real
 * edge before the background, whatever its rank.
 */
function findEdge(
  luminance: (x: number, y: number) => number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  reach: number,
  expectedHalf: number,
): { distance: number; strength: number } | null {
  const minDistance = expectedHalf * MIN_EDGE_FRACTION;

  // Collect every candidate step first; the threshold depends on the strongest,
  // which is not known until the whole line has been walked.
  const gradients: { distance: number; strength: number }[] = [];
  let strongest = 0;
  let previous = -1;

  for (let d = 1; d <= reach; d += 1) {
    const value = luminance(cx + dx * d, cy + dy * d);
    if (value < 0) break; // Walked out of the frame.

    if (previous >= 0 && d >= minDistance) {
      const strength = Math.abs(value - previous);
      if (strength >= MIN_EDGE_STRENGTH) {
        // The edge lies between the two samples.
        gradients.push({ distance: d - 0.5, strength });
        if (strength > strongest) strongest = strength;
      }
    }
    previous = value;
  }

  if (strongest < MIN_EDGE_STRENGTH) return null;

  const threshold = strongest * EDGE_RELATIVE;
  for (let i = gradients.length - 1; i >= 0; i--) {
    if (gradients[i].strength >= threshold) return gradients[i];
  }
  return null;
}
