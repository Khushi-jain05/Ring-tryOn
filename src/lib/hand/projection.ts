import { MathUtils } from "three";

/**
 * The 3D canvas is a transparent overlay on top of an `object-fit: cover` video.
 * MediaPipe reports landmarks in *video* normalized space, so before anything
 * can be drawn on top of the hand we have to replay the same cover crop the
 * browser applied — otherwise the ring drifts off the finger the moment the
 * webcam's aspect ratio stops matching the element's.
 */
export type FrameGeometry = {
  /** Intrinsic size of the camera frame. */
  videoWidth: number;
  videoHeight: number;
  /** CSS size of the element the video is painted into. */
  displayWidth: number;
  displayHeight: number;
  /** True when the preview is flipped for a selfie-style view. */
  mirrored: boolean;
  /**
   * Digital crop applied to the preview. The video element gets the equivalent
   * CSS transform, and both must agree exactly or the ring drifts off the finger.
   */
  zoom: number;
  centerU: number;
  centerV: number;
};

/** Vertical field of view of the virtual camera, in degrees. */
export const CAMERA_FOV = 42;

/**
 * Distance from the camera to the anchor plane, chosen so the plane is exactly
 * one world unit tall. That makes the conversion trivial: a length of 1.0 in
 * world space is one display height on screen, at any resolution.
 */
export const ANCHOR_DISTANCE = 0.5 / Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2);

export function isFrameReady(geometry: FrameGeometry): boolean {
  return (
    geometry.videoWidth > 0 &&
    geometry.videoHeight > 0 &&
    geometry.displayWidth > 0 &&
    geometry.displayHeight > 0
  );
}

/**
 * Projects a video-normalized landmark onto the anchor plane.
 *
 * Writes into `out` to keep this allocation-free — it runs 21+ times per frame
 * at 60 fps and the garbage would show up as periodic hitching.
 */
export function projectToAnchorPlane(
  u: number,
  v: number,
  geometry: FrameGeometry,
  out: { x: number; y: number },
): { x: number; y: number } {
  const {
    videoWidth,
    videoHeight,
    displayWidth,
    displayHeight,
    mirrored,
    zoom,
    centerU,
    centerV,
  } = geometry;

  // Replicate `object-fit: cover`: scale until both axes are filled, centre the overflow.
  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;

  const z = zoom > 0 ? zoom : 1;
  const su = mirrored ? 1 - u : u;
  const sc = mirrored ? 1 - centerU : centerU;

  // Then the digital crop: the centre point is pinned to the middle of the stage
  // and everything else scales away from it. This is the same mapping
  // `framingTransform` hands to the video element.
  const px = displayWidth / 2 + (su - sc) * renderedWidth * z;
  const py = displayHeight / 2 + (v - centerV) * renderedHeight * z;

  // Normalise by display *height* so one world unit == one display height.
  out.x = (px - displayWidth / 2) / displayHeight;
  out.y = (displayHeight / 2 - py) / displayHeight;
  return out;
}

/** Half-width of the anchor plane in world units, i.e. the canvas aspect / 2. */
export function anchorHalfWidth(geometry: FrameGeometry): number {
  return geometry.displayWidth / geometry.displayHeight / 2;
}

/**
 * Converts a length measured in video pixels into anchor-plane units.
 *
 * A distance in the source frame is stretched by the cover fit and again by the
 * digital crop before it reaches the screen, and one plane unit is one display
 * height — so both factors have to be applied, in that order.
 */
export function videoPixelsToPlaneUnits(pixels: number, geometry: FrameGeometry): number {
  const { videoWidth, videoHeight, displayWidth, displayHeight, zoom } = geometry;
  if (videoWidth <= 0 || videoHeight <= 0 || displayHeight <= 0) return 0;
  const cover = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  return (pixels * cover * (zoom > 0 ? zoom : 1)) / displayHeight;
}

/**
 * Maps a full-view quad's UV onto the source frame's UV.
 *
 * The inverse of `projectToAnchorPlane`'s screen mapping, needed to sample anything
 * that lives in *video* space — a segmentation mask — from a shader drawing in
 * *screen* space. Both the cover fit and the digital crop have to be undone, or the
 * mask lands offset from the picture it was computed from and the occlusion appears
 * in the wrong place.
 *
 * Returned as a scale and an offset per axis so the shader is one multiply-add.
 */
export function maskUvTransform(geometry: FrameGeometry): {
  scaleX: number;
  offsetX: number;
  scaleY: number;
  offsetY: number;
} {
  const { videoWidth, videoHeight, displayWidth, displayHeight, mirrored, zoom } = geometry;
  const z = zoom > 0 ? zoom : 1;

  const cover = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const renderedWidth = videoWidth * cover;
  const renderedHeight = videoHeight * cover;

  // Forward: px = dw/2 + (su - sc) * rw * z, with su mirrored if the preview is.
  // Inverting for su, in terms of a UV that runs 0..1 across the display:
  const kx = displayWidth / (renderedWidth * z);
  const sc = mirrored ? 1 - geometry.centerU : geometry.centerU;
  let scaleX = kx;
  let offsetX = sc - kx / 2;
  // Undo the mirror last, so it composes with the crop rather than fighting it.
  if (mirrored) {
    scaleX = -scaleX;
    offsetX = 1 - offsetX;
  }

  // The quad's V runs bottom-to-top while the frame's runs top-to-bottom.
  const ky = displayHeight / (renderedHeight * z);
  const scaleY = -ky;
  const offsetY = ky / 2 + geometry.centerV;

  return { scaleX, offsetX, scaleY, offsetY };
}
