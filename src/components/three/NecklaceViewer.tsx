"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import type { MetalId } from "@/lib/rings/types";
import type { ADSpec } from "@/lib/jewellery/americanDiamond";
import { StudioEnvironment } from "./StudioEnvironment";
import { ADCollar3D } from "./ADCollar3D";

/**
 * The necklace at product scale, orbitable.
 *
 * This exists because the try-on cannot show you the design. On someone sitting far
 * enough back for both shoulders to be in frame, the whole piece is a couple of
 * hundred pixels wide — physically correct, and far too small to judge a cut stone
 * or a setting against.
 */
export function NecklaceViewer({
  metal,
  spec,
  className,
  autoRotate = true,
}: {
  metal: MetalId;
  spec: ADSpec;
  className?: string;
  autoRotate?: boolean;
}) {
  // A collar is a ring around a neck, so it has to be framed as a whole.
  const camera = { fov: 30, position: [0, 6, 320] } as const;
  const target: [number, number, number] = [0, -18, 0];
  return (
    <div className={className}>
      <Canvas
        gl={{ antialias: true, alpha: true, toneMapping: ACESFilmicToneMapping }}
        dpr={[1, 2]}
        camera={{ fov: camera.fov, position: [...camera.position] }}
      >
        <Suspense fallback={null}>
          <StudioEnvironment resolution={256} />
          <directionalLight position={[18, 26, 30]} intensity={1.3} />
          <directionalLight position={[-22, -6, 20]} intensity={0.45} color="#dce8ff" />
          <ADCollar3D spec={spec} neckRadiusMm={57} metal={metal} />
          <ContactShadows
            position={[0, -70, 0]}
            opacity={0.28}
            scale={260}
            blur={2.8}
            far={40}
            resolution={256}
          />
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          target={target}
          minDistance={120}
          maxDistance={520}
          autoRotate={autoRotate}
          autoRotateSpeed={0.7}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI - 0.3}
        />
      </Canvas>
    </div>
  );
}
