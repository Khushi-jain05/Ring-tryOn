"use client";

import { useMemo } from "react";
import { CylinderGeometry, SphereGeometry } from "three";
import { METALS } from "@/lib/rings/catalog";
import type { MetalId } from "@/lib/rings/types";
import { buildPearlNecklace, type PearlSpec } from "@/lib/jewellery/pearls";
import { PearlMaterial } from "./PearlMaterial";

/**
 * The pearl choker: graduated strands hugging the neck, with a drop pearl.
 *
 * Authored in millimetres like the pendant, with the neck's axis at the origin —
 * but note the difference from the pendant: this piece's *shape* depends on the
 * wearer, because a strand's length is the neck's circumference. So the geometry is
 * rebuilt when the measured neck changes, rather than being a fixed model that
 * only gets scaled.
 */
export function PearlNecklace3D({
  spec,
  neckRadiusMm,
  metal,
}: {
  spec: PearlSpec;
  neckRadiusMm: number;
  metal: MetalId;
}) {
  const built = useMemo(() => buildPearlNecklace(spec, neckRadiusMm), [spec, neckRadiusMm]);

  // One unit sphere, instanced by scale — a strand is 40-odd pearls and they are
  // all the same shape.
  const pearl = useMemo(() => new SphereGeometry(1, 20, 16), []);
  const bail = useMemo(() => new CylinderGeometry(1, 1, 1, 8), []);
  const metalSpec = METALS[metal];

  return (
    <group>
      {built.strands.map((strand, s) =>
        strand.map((p, i) => (
          <mesh key={`${s}-${i}`} geometry={pearl} position={p.position} scale={p.radius}>
            {/* Slightly warmer on the outer strand, as a matched pair of real
                strands never is quite identical. */}
            <PearlMaterial tint={s === 0 ? "#f8f3ea" : "#f5efe4"} />
          </mesh>
        )),
      )}

      <mesh
        geometry={bail}
        position={built.bail.position}
        scale={[built.bail.radius, built.bail.height, built.bail.radius]}
      >
        <meshPhysicalMaterial
          color={metalSpec.color}
          metalness={1}
          roughness={metalSpec.roughness}
          envMapIntensity={1.6}
        />
      </mesh>

      <mesh geometry={pearl} position={built.drop.position} scale={built.drop.radius}>
        <PearlMaterial tint="#fbf6ee" />
      </mesh>
    </group>
  );
}
