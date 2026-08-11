"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import type { Group } from "three";
import type { MetalId, Ring } from "@/lib/rings/types";
import { Ring3D, type RenderQuality } from "./Ring3D";
import { StudioEnvironment } from "./StudioEnvironment";

/**
 * The ring as a product shot: presented at a three-quarter angle rather than
 * face-on, because a ring photographed straight down its axis reads as a flat
 * circle and hides the whole profile of the band.
 */
export const PRESENTATION_ROTATION: [number, number, number] = [0.34, -0.62, 0.12];

export function RingStage({
  ring,
  metal,
  quality = "showcase",
  autoRotate = false,
  shadows = true,
}: {
  ring: Ring;
  metal: MetalId;
  quality?: RenderQuality;
  autoRotate?: boolean;
  shadows?: boolean;
}) {
  const groupRef = useRef<Group>(null);

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) groupRef.current.rotation.y += delta * 0.35;
  });

  return (
    <>
      <StudioEnvironment resolution={256} />
      {/* A little direct light on top of the environment, so the metal has a
          crisp specular terminator rather than only soft reflections. */}
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#cfe0ff" />

      <group rotation={PRESENTATION_ROTATION}>
        <group ref={groupRef}>
          <Ring3D ring={ring} metal={metal} quality={quality} />
        </group>
      </group>

      {shadows && (
        <ContactShadows
          position={[0, -1.35, 0]}
          opacity={0.34}
          scale={7}
          blur={2.6}
          far={3}
          resolution={256}
        />
      )}
    </>
  );
}
