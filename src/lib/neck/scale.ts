/**
 * Pixels per metre for the upper body.
 *
 * The previous version divided the shoulders' **on-screen** span by their **full
 * 3D** span. Front-on those agree, so it looked right — but they are not the same
 * quantity, and turning the torso pulls them apart: the screen span foreshortens
 * toward zero while the 3D span stays exactly 395 mm, because the shoulders have
 * not moved relative to each other. The estimate therefore collapsed as the wearer
 * rotated, and the necklace shrank with it. This is the same mistake that made the
 * ring shrink when a hand turned edge-on.
 *
 * The fix is the same too, and it works because MediaPipe's world landmarks are
 * **image-aligned**: +x is frame right and +y is frame down, the same axes the
 * normalized landmarks use, with only depth added. So a segment's screen length
 * compares against its world *x and y* — never its full 3D length — and
 * foreshortening cancels because it is present on both sides.
 */
import type { Point3 } from "@/lib/hand/measure";
import { PL } from "./landmarks";

/**
 * Landmarks used for the fit: the head and the shoulder girdle.
 *
 * Deliberately not the whole body. Hips and below are often out of frame for a
 * necklace try-on and are the least reliably placed points when they are visible,
 * so including them would add noise rather than evidence.
 */
const FIT_POINTS = [
  PL.NOSE,
  PL.LEFT_EYE,
  PL.RIGHT_EYE,
  PL.LEFT_EAR,
  PL.RIGHT_EAR,
  PL.LEFT_MOUTH,
  PL.RIGHT_MOUTH,
  PL.LEFT_SHOULDER,
  PL.RIGHT_SHOULDER,
];

export function estimateNeckPlaneScale(
  planar: ReadonlyArray<{ x: number; y: number }>,
  world: ReadonlyArray<Point3>,
): number | null {
  if (planar.length <= PL.RIGHT_SHOULDER || world.length <= PL.RIGHT_SHOULDER) return null;

  let pcx = 0;
  let pcy = 0;
  let wcx = 0;
  let wcy = 0;
  for (const i of FIT_POINTS) {
    pcx += planar[i].x;
    pcy += planar[i].y;
    wcx += world[i].x;
    wcy += world[i].y;
  }
  const n = FIT_POINTS.length;
  pcx /= n;
  pcy /= n;
  wcx /= n;
  wcy /= n;

  // Fit each axis separately and take magnitudes. A mirrored preview negates plane
  // x but not world x, so a combined fit would have the x terms cancelling the y
  // terms; this is agnostic to that, and lets a nearly-degenerate axis drop out of
  // the weighting on its own — which matters here, because a head-and-shoulders
  // crop has far more horizontal spread than vertical.
  let numX = 0;
  let denX = 0;
  let numY = 0;
  let denY = 0;

  for (const i of FIT_POINTS) {
    const px = planar[i].x - pcx;
    const py = planar[i].y - pcy;
    const wx = world[i].x - wcx;
    const wy = world[i].y - wcy;
    numX += px * wx;
    denX += wx * wx;
    numY += py * wy;
    denY += wy * wy;
  }

  if (denX + denY < 1e-9) return null;

  const scaleX = denX > 1e-9 ? Math.abs(numX) / denX : 0;
  const scaleY = denY > 1e-9 ? Math.abs(numY) / denY : 0;
  const scale = (scaleX * denX + scaleY * denY) / (denX + denY);

  return scale > 0 && Number.isFinite(scale) ? scale : null;
}
