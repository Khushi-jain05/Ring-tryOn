"use client";

import { forwardRef, useMemo } from "react";
import { CylinderGeometry, type Mesh } from "three";

/**
 * How far the band sinks into the skin, as a multiple of its inner radius.
 *
 * Slightly over 1 so a hair of the band's inner edge is buried rather than
 * floating exactly tangent to the surface — which is the difference between a
 * ring resting on a finger and one being worn on it.
 */
export const BORE_PRESS = 1.014;

/**
 * Hard limits on the bore, whatever the pixel probe reports.
 *
 * The lower bound is the important one and it must stay above 1. The occluder
 * only hides the band's far arc across screen positions it actually covers, so
 * once the bore drops below the band's inner radius the far arc becomes visible
 * along its whole length and the ring reads as a flat oval drawn over the hand,
 * rather than a band wrapped round a finger. There is no graceful degradation
 * through that point — it is a cliff — so the measurement is never allowed near it.
 */
export const BORE_MIN = 1.004;
export const BORE_MAX = 1.055;

/**
 * An invisible stand-in for the length of finger the band encircles.
 *
 * Without it the ring renders as a complete circle floating over the video —
 * you can see the far side of the band straight through the finger, and the
 * illusion dies instantly. Real occlusion needs real geometry, so we place a
 * cylinder where the finger is and let it write depth while writing no colour.
 * The far side of the band then fails the depth test and disappears behind a
 * finger the renderer cannot actually see.
 *
 * `colorWrite={false}` is what makes it invisible; `renderOrder={-1}` is what
 * makes it work, because the depth buffer has to be populated before the ring
 * is tested against it.
 *
 * **The cross-section is circular, and that is deliberate.** An earlier version
 * made it an ellipse, on the reasoning that fingers are wider than they are
 * deep. That is true of a bare finger and wrong underneath a ring: the band's
 * bore is circular and the flesh conforms to it. Modelling the finger as a rigid
 * ellipse left the occluder shallower than the band's inner radius, so front-on
 * the band was fine but as the hand turned edge-on a sliver of background opened
 * up between the skin and the metal, and the ring read as floating. A circular
 * bore also means the visible fraction of the band cannot change with
 * orientation, which is what makes the ring read identically from every angle.
 *
 * Authored at radius 1 and unit length. The caller owns the scale and the offset
 * along the finger, because both change every frame and driving them through
 * React state would re-render the tree thirty times a second.
 */
export const FingerOccluder = forwardRef<Mesh>(function FingerOccluder(_props, ref) {
  const geometry = useMemo(() => {
    // Capped: an open tube would let the ring show through the end when the
    // finger points toward the lens.
    const g = new CylinderGeometry(1, 1, 1, 28, 1, false);
    // Author along +Z to match the band axis the pose solver produces.
    g.rotateX(Math.PI / 2);
    return g;
  }, []);

  return (
    <mesh ref={ref} geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial colorWrite={false} depthWrite depthTest />
    </mesh>
  );
});
