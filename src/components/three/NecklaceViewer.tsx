"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { ACESFilmicToneMapping, SphereGeometry } from "three";
import { GEMS, METALS } from "@/lib/rings/catalog";
import type { GemId, MetalId } from "@/lib/rings/types";
import {
  buildChainLink,
  buildNecklaceGeometry,
  chainLinkPlacements,
  type NecklaceSpec,
} from "@/lib/jewellery/necklace";
import type { NecklaceStyle } from "@/lib/jewellery/catalog";
import { StudioEnvironment } from "./StudioEnvironment";
import { PearlNecklace3D } from "./PearlNecklace3D";

/**
 * The pendant at product scale, orbitable.
 *
 * This exists because the try-on cannot show you the design. A 19 mm pendant on
 * someone sitting far enough back for both shoulders to be in frame is about 35
 * pixels tall — physically correct, and far too small to judge a cut stone or a
 * twist against. So the design gets its own view, framed on the pendant with just
 * enough chain to show how it hangs.
 *
 * Framing the whole necklace would defeat the point: the chain is 400 mm across
 * and the pendant 19 mm, so fitting the chain shrinks the pendant to nothing all
 * over again.
 */
export function NecklaceViewer({
  metal,
  gem,
  style,
  className,
  autoRotate = true,
}: {
  metal: MetalId;
  gem: GemId;
  style: NecklaceStyle;
  className?: string;
  autoRotate?: boolean;
}) {
  // A choker is a ring around a neck, so it has to be framed as a whole; a pendant
  // is 20 mm of detail on 400 mm of chain, so it has to be framed on the pendant.
  const isPearls = style.kind === "pearls";
  const camera = isPearls
    ? ({ fov: 30, position: [0, 6, 320] } as const)
    : ({ fov: 30, position: [0, -9, 62] } as const);
  const target: [number, number, number] = isPearls ? [0, -18, 0] : [0, -12, 0];
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
          {isPearls ? (
            <PearlNecklace3D spec={style.spec} neckRadiusMm={57} metal={metal} />
          ) : (
            <PendantOnly metal={metal} gem={gem} spec={style.spec} />
          )}
          <ContactShadows
            position={[0, isPearls ? -70 : -30, 0]}
            opacity={0.28}
            scale={isPearls ? 260 : 70}
            blur={2.8}
            far={40}
            resolution={256}
          />
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          target={target}
          minDistance={isPearls ? 120 : 26}
          maxDistance={isPearls ? 520 : 130}
          autoRotate={autoRotate}
          autoRotateSpeed={0.7}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI - 0.3}
        />
      </Canvas>
    </div>
  );
}

/** The pendant plus a short run of chain, rather than the whole necklace. */
function PendantOnly({
  metal,
  gem,
  spec,
}: {
  metal: MetalId;
  gem: GemId;
  spec: NecklaceSpec;
}) {
  const parts = useMemo(() => buildNecklaceGeometry(spec), [spec]);
  const link = useMemo(() => buildChainLink(spec), [spec]);
  const accent = useMemo(() => new SphereGeometry(1, 12, 10), []);
  const prong = useMemo(() => {
    const g = new SphereGeometry(1, 12, 10);
    g.scale(1, 1.9, 1);
    return g;
  }, []);

  // Only the links nearest the bail, so the chain reads as a chain without pulling
  // the camera back to fit 400 mm of it.
  const links = useMemo(() => {
    const all = chainLinkPlacements(30, 14, spec.chainLinkMm, 1);
    return all
      .filter((l) => l.position[1] < -6)
      .slice(0, 26);
  }, [spec.chainLinkMm]);

  const metalSpec = METALS[metal];
  const gemSpec = GEMS[gem];

  const metalMaterial = (
    <meshPhysicalMaterial
      color={metalSpec.color}
      metalness={1}
      roughness={metalSpec.roughness}
      envMapIntensity={1.8}
    />
  );

  return (
    <group>
      {links.map((placement, i) => (
        <mesh key={i} geometry={link} position={placement.position} rotation={placement.rotation}>
          {metalMaterial}
        </mesh>
      ))}

      <group position={[0, -14, 0]}>
        <mesh geometry={parts.polished}>{metalMaterial}</mesh>
        <mesh geometry={parts.paveRail}>{metalMaterial}</mesh>

        <mesh geometry={parts.heart.geometry} position={parts.heart.position}>
          <meshPhysicalMaterial
            color={gemSpec.color}
            metalness={0}
            roughness={gemSpec.roughness}
            transmission={gemSpec.transmission}
            thickness={1.1}
            ior={gemSpec.ior}
            dispersion={gemSpec.dispersion}
            attenuationColor={gemSpec.color}
            attenuationDistance={5}
            envMapIntensity={2.6}
            flatShading
          />
        </mesh>

        {parts.prongs.map((p, i) => (
          <mesh key={i} geometry={prong} position={p.position} rotation={p.rotation} scale={p.scale}>
            {metalMaterial}
          </mesh>
        ))}

        {parts.pave.map((p, i) => (
          <mesh key={i} geometry={accent} position={p.position} scale={p.scale}>
            <meshPhysicalMaterial
              color="#ffffff"
              metalness={0}
              roughness={0}
              transmission={1}
              thickness={0.5}
              ior={2.42}
              dispersion={2.6}
              envMapIntensity={3}
              flatShading
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
