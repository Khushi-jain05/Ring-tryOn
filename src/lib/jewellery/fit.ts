import { INFINITY_HEART, type NecklaceSpec } from "./necklace";

/**
 * How the neck occluder is sized and placed, in neck radii.
 *
 * Kept here rather than inside the renderer so the numbers can be asserted
 * without a camera. The relationship these encode is easy to get catastrophically
 * wrong in a way that produces *no* visible error message: an occluder writes
 * depth and no colour, so one that is too long does not draw a block over the
 * jewellery — the jewellery simply never appears. That is exactly what happened
 * with a 7-radius cylinder centred on the neck, which put 200 mm of invisible
 * geometry straight over the pendant.
 */
export const NECK_OCCLUDER = {
  /** Total height of the cylinder. A neck is ~100 mm from notch to jaw. */
  length: 2.6,
  /** How far above the anchor it is centred; the neck runs up, not both ways. */
  rise: 0.9,
  /** Radius as a fraction of the chain's own path, so the two cannot z-fight. */
  press: 0.97,
  /** Necks are shallower front-to-back than they are wide. */
  flatten: 0.78,
} as const;

/** Lowest and highest point the occluder reaches, in neck radii from the anchor. */
export function occluderExtent(): { bottom: number; top: number } {
  const half = NECK_OCCLUDER.length / 2;
  return {
    bottom: NECK_OCCLUDER.rise - half,
    top: NECK_OCCLUDER.rise + half,
  };
}

/**
 * How far below the anchor the pendant's bail hangs, in neck radii.
 *
 * The chain's drop is expressed in neck radii by the anchor's `dropFactor`, so
 * this is just that — but naming it makes the comparison against the occluder
 * legible, which is the whole point.
 */
export function pendantTop(dropFactor: number): number {
  return -dropFactor;
}

/** Lowest point of the pendant, in neck radii, including its full drop. */
export function pendantBottom(
  dropFactor: number,
  neckRadiusMm: number,
  spec: NecklaceSpec = INFINITY_HEART,
): number {
  return -dropFactor - spec.dropMm / neckRadiusMm;
}
