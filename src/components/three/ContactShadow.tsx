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
 * How far outside the finger the shadow sleeve sits. Just enough to clear the
 * depth occluder, so the sleeve's front half survives and its back half is
 * correctly hidden behind the finger.
 */
const SLEEVE_CLEARANCE = 1.008;

/** Length of the sleeve as a multiple of the band's width. */
const SLEEVE_SPAN = 3.4;

/**
 * Builds the soft dark gradient that stands in for occluded light.
 *
 * Alpha peaks where the metal meets skin and falls away along the finger. It is
 * asymmetric on purpose — light in the studio rig comes from above, so the
 * shadow pools slightly toward the palm side.
 */
function createGradient(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0.0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.28, "rgba(0,0,0,0.1)");
  gradient.addColorStop(0.42, "rgba(0,0,0,0.42)");
  gradient.addColorStop(0.5, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.58, "rgba(0,0,0,0.42)");
  gradient.addColorStop(0.74, "rgba(0,0,0,0.1)");
  gradient.addColorStop(1.0, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, size);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

/**
 * A soft shadow where the band meets the skin.
 *
 * Correct geometry and correct occlusion still leave the ring looking stuck on
 * top of the video, because a real ring darkens the finger around it — contact
 * shadow at the edges of the band, and ambient light blocked underneath. There
 * is no real skin here to receive a shadow, so we fake the result directly: a
 * translucent black sleeve just outside the finger, faded along its length.
 *
 * It works because the WebGL layer composites over the video with alpha, so
 * drawing black at partial opacity genuinely darkens the pixels of the hand
 * beneath it.
 */
export const ContactShadow = forwardRef<Mesh, { bandWidth: number }>(
  function ContactShadow({ bandWidth }, ref) {
    const geometry = useMemo(() => {
      const g = new CylinderGeometry(1, 1, 1, 32, 1, true);
      // Author along +Z to match the band axis the pose solver produces.
      g.rotateX(Math.PI / 2);
      return g;
    }, []);

    const texture = useMemo(() => createGradient(), []);

    return (
      <mesh
        ref={ref}
        geometry={geometry}
        scale={[SLEEVE_CLEARANCE, SLEEVE_CLEARANCE, bandWidth * SLEEVE_SPAN]}
        // After the occluder has laid down depth, before the metal is drawn.
        renderOrder={0}
      >
        <meshBasicMaterial
          map={texture}
          transparent
          // Writing depth here would punch a hole in the ring behind it.
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    );
  },
);

export { SLEEVE_CLEARANCE, SLEEVE_SPAN };
