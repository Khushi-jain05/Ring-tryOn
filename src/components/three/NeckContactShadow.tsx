"use client";

import { forwardRef, useMemo } from "react";
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  LinearFilter,
  type Mesh,
} from "three";

/**
 * The soft darkening where the collar meets skin.
 *
 * This is the difference between jewellery that looks worn and jewellery that looks
 * pasted on, and it was missing — the ring has had one from the start while the
 * necklace had none. A rendered piece composited over video sits in front of every
 * pixel behind it with a hard edge and no interaction with the skin at all, and the
 * eye reads that as a sticker however good the geometry and the placement are. Light
 * reaching the hollow between metal and neck is occluded by the metal, so there is a
 * band of shadow there in every real photograph of a necklace.
 *
 * Built the same way as the ring's: a translucent sleeve sitting just outside the
 * neck occluder, textured with a gradient that peaks where the piece rests and falls
 * away above and below. Just outside is what makes it work — the occluder then hides
 * the sleeve's far half exactly as it hides the collar's, so the shadow appears only
 * on the skin actually facing the camera.
 */

/** Just clear of the depth occluder, so the near half survives and the far half does not. */
const SLEEVE_CLEARANCE = 1.006;

/**
 * The gradient, running along the neck's axis.
 *
 * Weighted downward rather than symmetric. A collar rests *on* the shoulders and
 * collarbones, so the light it blocks is mostly the light that would have reached the
 * chest below it — the shadow pools under the piece, not above it.
 */
function createGradient(): CanvasTexture {
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // v = 0 is the top of the sleeve (up the neck), v = 1 the bottom (down the chest).
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0.0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.34, "rgba(0,0,0,0.06)");
  gradient.addColorStop(0.46, "rgba(0,0,0,0.30)");
  gradient.addColorStop(0.52, "rgba(0,0,0,0.42)");
  gradient.addColorStop(0.62, "rgba(0,0,0,0.26)");
  gradient.addColorStop(0.82, "rgba(0,0,0,0.07)");
  gradient.addColorStop(1.0, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, height);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

export const NeckContactShadow = forwardRef<Mesh>(function NeckContactShadow(_props, ref) {
  const geometry = useMemo(() => {
    // Open-ended: the caps would darken the throat itself rather than the skin
    // immediately around the piece.
    const g = new CylinderGeometry(SLEEVE_CLEARANCE, SLEEVE_CLEARANCE, 1, 48, 1, true);
    return g;
  }, []);

  const texture = useMemo(() => createGradient(), []);

  return (
    <mesh ref={ref} geometry={geometry} renderOrder={1}>
      <meshBasicMaterial
        map={texture}
        transparent
        // Never occludes anything itself: it is a stain on the video, not an object.
        depthWrite={false}
        depthTest
        // The sleeve is seen from inside as well as out where the neck curves away.
        side={DoubleSide}
        opacity={0.9}
      />
    </mesh>
  );
});
