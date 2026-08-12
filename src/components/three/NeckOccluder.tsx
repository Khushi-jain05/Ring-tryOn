"use client";

import { forwardRef, useMemo } from "react";
import { CylinderGeometry, type Mesh } from "three";

/**
 * How much shallower the neck is front-to-back than it is side-to-side.
 *
 * Unlike a finger under a ring, there is no metal here compressing anything into
 * a circle, so the neck's real oval section is the right model — and it matters:
 * the chain has to disappear behind the neck at the sides, which is exactly where
 * the two axes differ most.
 */
export const NECK_FLATTEN = 0.78;

/**
 * An invisible stand-in for the neck.
 *
 * A chain goes *around* something, so most of its length is behind the wearer and
 * must not be drawn. Without this the back of the chain renders straight over the
 * throat and the necklace reads as a flat loop pasted on the chest rather than
 * something worn.
 *
 * Same technique as the finger occluder: write depth, write no colour, and draw
 * before the jewellery so the depth buffer is already staked out. The cylinder is
 * generous in height because the neck continues up behind the jaw and down into
 * the chest, and a chain that vanished at the cylinder's rim would look cut off.
 *
 * Authored at radius 1 and unit height along +Y, matching the pose frame's neck
 * axis. The caller owns the scale.
 */
export const NeckOccluder = forwardRef<Mesh>(function NeckOccluder(_props, ref) {
  const geometry = useMemo(
    // Capped, so the chain cannot show through the ends when the head tips.
    () => new CylinderGeometry(1, 1, 1, 28, 1, false),
    [],
  );

  return (
    <mesh ref={ref} geometry={geometry} renderOrder={-2}>
      <meshBasicMaterial colorWrite={false} depthWrite depthTest />
    </mesh>
  );
});
