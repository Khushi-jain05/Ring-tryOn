import type { FingerName } from "./landmarks";

/**
 * Where a ring sits on a finger, expressed entirely in the finger's own frame.
 *
 * Every quantity here is a *ratio* or an *angle*, never a screen coordinate. That
 * is what makes the placement survive the hand moving, turning or changing
 * distance: `positionAlongFinger` means a fraction of this frame's proximal
 * phalanx, `widthMultiplier` scales against this frame's measured finger width,
 * and the offsets are in band radii. A pixel value anywhere in this type would be
 * a bug, because it would be meaningful only at one hand pose.
 */
export type RingAnchor = {
  finger: FingerName;
  /**
   * 0 sits the band at the knuckle joint, 1 at the middle joint.
   *
   * MediaPipe's MCP landmark is at the centre of the joint, which is further from
   * the visible base of the finger than it looks — especially from the palm side —
   * so the value that lands where a ring is actually worn is a little under half.
   */
  positionAlongFinger: number;
  /** Scales the band against the measured fit. 1 is the size that fits. */
  widthMultiplier: number;
  /** Rotation about the finger axis, in radians. Turns the setting round. */
  rotationOffset: number;
  /**
   * Shifts the band across the finger, positive toward the back of the hand, in
   * band radii. Corrects for the joint landmark sitting nearer the visible
   * knuckle than the bone's true axis.
   */
  crossOffset: number;
};

export const DEFAULT_ANCHOR: RingAnchor = {
  finger: "ring",
  positionAlongFinger: 0.47,
  widthMultiplier: 1,
  rotationOffset: 0,
  crossOffset: 0,
};

/** Sensible per-finger starting points; a pinky ring sits higher than a thumb's. */
export const ANCHOR_PRESETS: Record<FingerName, Partial<RingAnchor>> = {
  index: { positionAlongFinger: 0.45 },
  middle: { positionAlongFinger: 0.46 },
  ring: { positionAlongFinger: 0.47 },
  pinky: { positionAlongFinger: 0.5 },
};

export function anchorFor(finger: FingerName, overrides?: Partial<RingAnchor>): RingAnchor {
  return { ...DEFAULT_ANCHOR, finger, ...ANCHOR_PRESETS[finger], ...overrides };
}
