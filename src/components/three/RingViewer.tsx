"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import type { MetalId, Ring } from "@/lib/rings/types";
import { RingStage } from "./RingStage";

/**
 * The full-size, orbitable product viewer used on a ring's own page. Unlike the
 * catalogue thumbnails this owns its context, so it can afford real refraction
 * through the stones.
 */
export function RingViewer({
  ring,
  metal,
  className,
}: {
  ring: Ring;
  metal: MetalId;
  className?: string;
}) {
  return (
    <div className={className}>
      <Canvas
        gl={{ antialias: true, alpha: true, toneMapping: ACESFilmicToneMapping }}
        dpr={[1, 2]}
        camera={{ fov: 30, position: [0, 0.4, 6.6] }}
      >
        <Suspense fallback={null}>
          <RingStage ring={ring} metal={metal} quality="showcase" />
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={3.6}
          maxDistance={11}
          autoRotate
          autoRotateSpeed={0.5}
          // Stop just short of the poles; looking exactly down the axis flips
          // the up-vector and the ring appears to snap.
          minPolarAngle={0.35}
          maxPolarAngle={Math.PI - 0.35}
        />
      </Canvas>
    </div>
  );
}
