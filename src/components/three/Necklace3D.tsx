"use client";

import { useMemo } from "react";
import { DoubleSide, SphereGeometry } from "three";
import { GEMS, METALS } from "@/lib/rings/catalog";
import type { GemId, MetalId } from "@/lib/rings/types";
import {
  buildChainLink,
  buildNecklaceGeometry,
  chainLinkPlacements,
  type NecklaceSpec,
} from "@/lib/jewellery/necklace";
import type { NecklaceStyle } from "@/lib/jewellery/catalog";
import type { RenderQuality } from "./Ring3D";
import { PearlNecklace3D } from "./PearlNecklace3D";

/**
 * The pendant and chain, authored in millimetres with the bail at the origin.
 *
 * The parent scales the whole group from millimetres to screen units, so nothing
 * here needs to know how far away the wearer is. The chain's own curve is built
 * from the *measured* neck rather than being part of the model, because a chain
 * is not a rigid body — it drapes, and how far it drapes depends on the neck it
 * is on.
 */
export function Necklace3D({
  metal,
  gem,
  quality = "showcase",
  neckRadiusMm,
  dropMm,
  style,
}: {
  metal: MetalId;
  gem: GemId;
  quality?: RenderQuality;
  /** Radius of the wearer's neck, in millimetres. */
  neckRadiusMm: number;
  /** How far the chain's lowest point hangs below the neck's base, in mm. */
  dropMm: number;
  style: NecklaceStyle;
}) {
  // A strand's geometry depends on the neck it is on, so it is built rather than
  // scaled; the pendant is a fixed model on a chain that drapes.
  if (style.kind === "pearls") {
    return (
      <PearlNecklace3D spec={style.spec} neckRadiusMm={neckRadiusMm} metal={metal} />
    );
  }
  return (
    <PendantNecklace
      metal={metal}
      gem={gem}
      quality={quality}
      neckRadiusMm={neckRadiusMm}
      dropMm={dropMm}
      spec={style.spec}
    />
  );
}

function PendantNecklace({
  metal,
  gem,
  quality,
  neckRadiusMm,
  dropMm,
  spec,
}: {
  metal: MetalId;
  gem: GemId;
  quality: RenderQuality;
  neckRadiusMm: number;
  dropMm: number;
  spec: NecklaceSpec;
}) {
  const parts = useMemo(() => buildNecklaceGeometry(spec), [spec]);
  const link = useMemo(() => buildChainLink(spec), [spec]);
  const accent = useMemo(() => new SphereGeometry(1, 10, 8), []);
  const prong = useMemo(() => {
    const g = new SphereGeometry(1, 10, 8);
    g.scale(1, 1.9, 1);
    return g;
  }, []);

  // The chain is re-laid whenever the neck changes size, not every frame — its
  // shape depends only on the neck's dimensions, which move slowly.
  const links = useMemo(
    () => chainLinkPlacements(neckRadiusMm, dropMm, spec.chainLinkMm, 1),
    [neckRadiusMm, dropMm, spec.chainLinkMm],
  );

  const metalSpec = METALS[metal];
  const gemSpec = GEMS[gem];

  const metalMaterial = (
    <meshPhysicalMaterial
      color={metalSpec.color}
      metalness={1}
      roughness={metalSpec.roughness}
      envMapIntensity={1.7}
      // Chain links and a swept ribbon are thin and open-ended in places; drawing
      // both faces avoids see-through gaps at grazing angles.
      side={DoubleSide}
    />
  );

  const stoneMaterial =
    quality === "live" ? (
      <meshPhysicalMaterial
        color={gemSpec.color}
        metalness={0.1}
        roughness={0}
        clearcoat={1}
        clearcoatRoughness={0}
        reflectivity={1}
        iridescence={0.35}
        iridescenceIOR={1.5}
        envMapIntensity={3}
        flatShading
      />
    ) : (
      <meshPhysicalMaterial
        color={gemSpec.color}
        metalness={0}
        roughness={gemSpec.roughness}
        transmission={gemSpec.transmission}
        thickness={0.9}
        ior={gemSpec.ior}
        dispersion={gemSpec.dispersion}
        attenuationColor={gemSpec.color}
        attenuationDistance={4}
        envMapIntensity={2.4}
        flatShading
      />
    );

  return (
    <group>
      {/* Chain, laid on the neck's own curve. */}
      {links.map((placement, i) => (
        <mesh
          key={i}
          geometry={link}
          position={placement.position}
          rotation={placement.rotation}
        >
          {metalMaterial}
        </mesh>
      ))}

      {/* The pendant hangs from the front of the chain. */}
      <group position={[0, -dropMm, 0]}>
        <mesh geometry={parts.polished}>{metalMaterial}</mesh>
        <mesh geometry={parts.paveRail}>{metalMaterial}</mesh>

        <mesh geometry={parts.heart.geometry} position={parts.heart.position}>
          {stoneMaterial}
        </mesh>

        {parts.prongs.map((p, i) => (
          <mesh key={i} geometry={prong} position={p.position} rotation={p.rotation} scale={p.scale}>
            {metalMaterial}
          </mesh>
        ))}

        {/* Pavé: small brilliants set into the outward face of one strand. */}
        {parts.pave.map((p, i) => (
          <mesh key={i} geometry={accent} position={p.position} scale={p.scale}>
            <meshPhysicalMaterial
              color="#ffffff"
              metalness={0.05}
              roughness={0}
              clearcoat={1}
              clearcoatRoughness={0}
              reflectivity={1}
              envMapIntensity={3.4}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
