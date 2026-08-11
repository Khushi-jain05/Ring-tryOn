/**
 * A fixed digital zoom on the centre of the frame.
 *
 * A webcam framed for a face puts the hand in a small part of the picture, so the
 * ring ends up a few dozen pixels across — too small to judge. Cropping in fixes
 * that without touching the tracker, which still sees the full frame and so keeps
 * its accuracy.
 *
 * An earlier version followed the hand automatically. It was a mistake: a view
 * that chases the subject means the whole picture drifts whenever the tracker
 * twitches, and the user cannot tell their own movement from the camera's. A
 * fixed crop is calmer and predictable — hold your hand in the middle and it
 * stays put.
 *
 * The crop must be applied identically to the video element and to the landmark
 * projection or the ring immediately slides off the finger, so both read the same
 * state from here.
 */
export type Framing = {
  /** Magnification, 1 being the untouched frame. */
  zoom: number;
  /** Point in video-normalized coordinates held at the centre of the stage. */
  centerU: number;
  centerV: number;
};

export const IDENTITY_FRAMING: Framing = { zoom: 1, centerU: 0.5, centerV: 0.5 };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/** A crop of the middle of the frame at the given magnification. */
export function fixedFraming(zoom: number): Framing {
  const z = Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : 1;
  return { zoom: z, centerU: 0.5, centerV: 0.5 };
}

/**
 * The CSS transform that crops the video element to match a framing.
 *
 * Returned as an explicit matrix rather than a `scale`/`translate` chain because
 * mirroring, the `object-fit: cover` offset and the crop all have to compose in
 * one step — and because the projection code has to be able to reproduce exactly
 * this mapping. `transform-origin: 0 0` is assumed.
 */
export function framingTransform(
  framing: Framing,
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number,
  mirrored: boolean,
): string {
  if (videoWidth <= 0 || videoHeight <= 0 || displayHeight <= 0) return "none";

  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (displayWidth - renderedWidth) / 2;
  const offsetY = (displayHeight - renderedHeight) / 2;

  const z = framing.zoom;
  const anchorX = offsetX + framing.centerU * renderedWidth;
  const anchorY = offsetY + framing.centerV * renderedHeight;

  const a = mirrored ? -z : z;
  const e = mirrored ? displayWidth / 2 + z * anchorX : displayWidth / 2 - z * anchorX;
  const f = displayHeight / 2 - z * anchorY;

  return `matrix(${a}, 0, 0, ${z}, ${e}, ${f})`;
}
