import type { Point3 } from "./measure";

const LANDMARK_COUNT = 21;

/**
 * Estimates how many anchor-plane units correspond to one metre of real hand.
 *
 * This is the conversion the whole sizing system rests on: with it, a ring
 * specified as 17.3 mm across can be drawn 17.3 mm across on the user's finger.
 *
 * The trick is that MediaPipe's world landmarks are **image-aligned** — +x is
 * frame right and +y is frame down, the same axes the normalized landmarks use,
 * with only the depth added. So the two sets are already in the same orientation
 * and the scale between them is a plain least-squares fit over all 21 points:
 *
 *     plane ≈ scale · world      (in x and y; z is what we do not observe)
 *
 * Foreshortening needs no special handling, because it is already present in
 * *both* sides. A finger turned toward the lens has a small extent in world x/y
 * and a correspondingly small extent on screen; the ratio is unchanged. That is
 * what makes this stable as the hand rotates.
 *
 * An earlier version measured several spans across the palm and took the largest
 * plane-to-world ratio, on the reasoning that projection can only shorten a
 * segment so the maximum must be closest to the truth. That works front-on but
 * degrades badly through a turn: every span shortens at once near edge-on, the
 * winning pair keeps changing, and the estimate walks around — so the ring
 * visibly changed size as the hand rotated toward the palm. Fitting all the
 * points at once removes both problems.
 */
export function estimatePlaneScale(
  planar: ReadonlyArray<{ x: number; y: number }>,
  world: ReadonlyArray<Point3>,
): number | null {
  if (planar.length < LANDMARK_COUNT || world.length < LANDMARK_COUNT) return null;

  let pcx = 0;
  let pcy = 0;
  let wcx = 0;
  let wcy = 0;
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    pcx += planar[i].x;
    pcy += planar[i].y;
    wcx += world[i].x;
    wcy += world[i].y;
  }
  pcx /= LANDMARK_COUNT;
  pcy /= LANDMARK_COUNT;
  wcx /= LANDMARK_COUNT;
  wcy /= LANDMARK_COUNT;

  // Fit the axes separately. A mirrored preview negates plane x but not world x,
  // so a combined fit would have the x terms cancelling the y terms; taking each
  // axis's magnitude is agnostic to that, and lets a nearly-degenerate axis fall
  // out of the weighting on its own.
  let numX = 0;
  let denX = 0;
  let numY = 0;
  let denY = 0;

  for (let i = 0; i < LANDMARK_COUNT; i++) {
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

  // Weight each axis by how much of the hand's spread it actually carries: a
  // hand held straight up has almost no horizontal extent to fit against.
  const scaleX = denX > 1e-9 ? Math.abs(numX) / denX : 0;
  const scaleY = denY > 1e-9 ? Math.abs(numY) / denY : 0;
  const scale = (scaleX * denX + scaleY * denY) / (denX + denY);

  return scale > 0 && Number.isFinite(scale) ? scale : null;
}
