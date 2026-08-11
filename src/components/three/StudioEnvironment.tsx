"use client";

import { Environment, Lightformer } from "@react-three/drei";

/**
 * A jeweller's lightbox, built out of area lights rather than an HDRI.
 *
 * Metal and faceted stones are almost entirely reflection — with a flat
 * environment a gold band renders as a dull ochre tube. Drei's `Environment`
 * presets would fix that but fetch HDRIs from a CDN at runtime, which breaks
 * offline and under a strict CSP. Rendering our own lightformers into a cube
 * target keeps the specular highlights and ships nothing over the wire.
 */
export function StudioEnvironment({ resolution = 256 }: { resolution?: number }) {
  return (
    <Environment resolution={resolution} frames={1}>
      {/* Key: a broad softbox above and slightly forward. */}
      <Lightformer
        form="rect"
        intensity={6}
        position={[0, 5, 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[8, 6, 1]}
        color="#ffffff"
      />
      {/* Two vertical strips: these are what draw the long highlight down a band. */}
      <Lightformer
        form="rect"
        intensity={4}
        position={[-4, 1, 2]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[6, 4, 1]}
        color="#e8f0ff"
      />
      <Lightformer
        form="rect"
        intensity={4}
        position={[4, 1, 2]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[6, 4, 1]}
        color="#fff4e6"
      />
      {/* Warm rim from behind, so the silhouette separates from a dark page. */}
      <Lightformer
        form="ring"
        intensity={3}
        position={[0, 1, -5]}
        scale={[5, 5, 1]}
        color="#ffd9a8"
      />
      {/* Dim floor bounce — without it the pavilion of every stone goes black. */}
      <Lightformer
        form="rect"
        intensity={1.2}
        position={[0, -4, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[8, 6, 1]}
        color="#b9c2d0"
      />
    </Environment>
  );
}
