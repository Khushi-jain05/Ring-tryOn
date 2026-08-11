import type { FingerName } from "./landmarks";

/**
 * A one-slot mailbox between the WebGL frame loop and the 2D diagnostics
 * overlay.
 *
 * The overlay needs the same landmarks the solver just used, thirty times a
 * second. Pushing that through React state would re-render the tree on every
 * frame; a plain mutable object costs nothing and the overlay simply reads
 * whatever is there on its own animation frame.
 */
export type DebugFrame = {
  /** Anchor-plane coordinates of all 21 landmarks. */
  planar: { x: number; y: number }[];
  finger: FingerName;
  /** Ring centre, in anchor-plane units. */
  seat: { x: number; y: number };
  /** Radius the band is drawn at, in anchor-plane units. */
  ringRadius: number;
  /** Radius of the finger itself, in anchor-plane units. */
  fingerRadius: number;
  /** What the pixel probe measured this frame, or 0 if it found no edges. */
  silhouetteHalfWidth: number;
  widthMm: number;
  usSize: number;
  planeScale: number;
  facing: number;
  /** Screen angle of the finger axis, degrees, 0 pointing right. */
  axisAngleDeg: number;
  /** How far the finger tilts out of the image plane, degrees. */
  tiltDeg: number;
  /** Diameter the band is drawn at, in true millimetres. */
  ringDiameterMm: number;
  /** Rotation applied about the finger axis by the anchor, degrees. */
  rotationOffsetDeg: number;
  stamp: number;
};

export const debugBus: { frame: DebugFrame | null } = { frame: null };

export function publishDebugFrame(frame: DebugFrame): void {
  debugBus.frame = frame;
}

export function clearDebugFrame(): void {
  debugBus.frame = null;
}
