/**
 * Absolute scale from a bank card.
 *
 * Everything else in the sizing chain is a proportion: the tracker says how the
 * hand is shaped, but nothing in a single uncalibrated camera image says how
 * *big* it is. MediaPipe's metric landmarks paper over that by assuming a
 * canonical hand, which is why the estimate is systematically off for anyone
 * whose hands are not average — and no amount of filtering fixes a bias.
 *
 * A bank card breaks the tie. ISO/IEC 7810 ID-1 fixes every one of them at
 * 85.60 mm wide, to a tolerance far tighter than we need, and virtually everyone
 * has one within reach. Held in the same plane as the fingers and lined up with
 * an on-screen outline, it turns the picture into a ruler — no card detection
 * required, because the user does the alignment.
 */

/** ISO/IEC 7810 ID-1. */
export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 53.98;
export const CARD_ASPECT = CARD_HEIGHT_MM / CARD_WIDTH_MM;

/**
 * Computes the metric bias — how many times larger the model believes the hand
 * to be than it truly is.
 *
 * Both inputs are read from the *same* video frame, which is what makes this
 * independent of how far away the hand was held. The card fixes millimetres per
 * anchor-plane unit at that distance; `planeScale` is the model's own opinion of
 * the same quantity, inverted. Their ratio is the model's error, and because it
 * comes from a fixed assumption about hand proportions it stays constant
 * afterwards.
 *
 * @param planeScale       Anchor-plane units per metre, from the solver.
 * @param cardWidthInPlaneUnits Width of the aligned card outline, in the same units.
 */
export function computeMetricBias(
  planeScale: number,
  cardWidthInPlaneUnits: number,
): number | null {
  if (!(planeScale > 0) || !(cardWidthInPlaneUnits > 0)) return null;

  const trueMmPerUnit = CARD_WIDTH_MM / cardWidthInPlaneUnits;
  const modelMmPerUnit = 1000 / planeScale;

  const bias = modelMmPerUnit / trueMmPerUnit;

  // A bias outside this range means something went wrong — the card outline was
  // not actually matched, or the hand was at a very different distance from it.
  // Better to reject and ask again than to bake nonsense in.
  if (!Number.isFinite(bias) || bias < 0.5 || bias > 2) return null;
  return bias;
}

/**
 * Converts the calibration guide's on-screen width into anchor-plane units.
 *
 * The guide is sized as a fraction of the stage width, and one anchor-plane unit
 * is one display *height* — so the conversion has to go through the aspect
 * ratio rather than assuming square pixels of the same measure.
 */
export function guideWidthToPlaneUnits(
  guideWidthFractionOfStage: number,
  displayWidth: number,
  displayHeight: number,
): number {
  if (!(displayHeight > 0)) return 0;
  return (guideWidthFractionOfStage * displayWidth) / displayHeight;
}

/** How wide the card outline is drawn, as a fraction of the stage width. */
export const GUIDE_WIDTH_FRACTION = 0.52;
