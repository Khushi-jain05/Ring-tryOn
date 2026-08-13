"use client";

import { useMemo } from "react";
import { DoubleSide, TorusGeometry } from "three";
import { METALS } from "@/lib/rings/catalog";
import type { MetalId } from "@/lib/rings/types";
import { createGemGeometry } from "@/lib/rings/geometry";
import { buildADCollar, type ADSpec } from "@/lib/jewellery/americanDiamond";
import type { RenderQuality } from "./Ring3D";

/**
 * The American-diamond collar.
 *
 * Its geometry depends on the wearer, because a collar's arc is the neck's own
 * curve — so this is rebuilt when the measured neck changes rather than being a
 * fixed model that only gets scaled. The parent still handles millimetres to
 * screen units.
 *
 * Roughly two hundred stones are drawn here. They are all one of two geometries,
 * placed by transform, so it is two distinct shapes on screen rather than two
 * hundred — which is what keeps this affordable on top of live pose tracking.
 */
export function ADCollar3D({
  spec,
  neckRadiusMm,
  metal,
  quality = "showcase",
}: {
  spec: ADSpec;
  neckRadiusMm: number;
  metal: MetalId;
  quality?: RenderQuality;
}) {
  const built = useMemo(() => buildADCollar(spec, neckRadiusMm), [spec, neckRadiusMm]);
  const round = useMemo(() => createGemGeometry("round"), []);
  const pear = useMemo(() => createGemGeometry("pear"), []);
  const link = useMemo(() => {
    const g = new TorusGeometry(spec.chainLinkMm * 0.5, spec.chainWireMm, 6, 14);
    g.scale(1, 0.62, 1);
    g.rotateY(Math.PI / 2);
    return g;
  }, [spec.chainLinkMm, spec.chainWireMm]);

  const metalSpec = METALS[metal];

  const metalMaterial = (
    <meshPhysicalMaterial
      color={metalSpec.color}
      metalness={1}
      roughness={metalSpec.roughness}
      envMapIntensity={1.7}
      side={DoubleSide}
    />
  );

  /**
   * Cubic zirconia, not diamond — and the difference is small but real. CZ has a
   * slightly lower refractive index and noticeably *more* dispersion, so it throws
   * more coloured fire and slightly less white brilliance. Rendered with real
   * refraction in the product view and a mirror-bright approximation over live
   * video, where the GPU is already running pose tracking.
   */
  const stoneMaterial =
    quality === "live" ? (
      <meshPhysicalMaterial
        color="#ffffff"
        metalness={0.08}
        roughness={0}
        clearcoat={1}
        clearcoatRoughness={0}
        reflectivity={1}
        iridescence={0.5}
        iridescenceIOR={1.6}
        envMapIntensity={3.4}
        flatShading
      />
    ) : (
      <meshPhysicalMaterial
        color="#ffffff"
        metalness={0}
        roughness={0}
        transmission={1}
        thickness={0.7}
        ior={2.16}
        dispersion={4.2}
        envMapIntensity={2.8}
        flatShading
      />
    );

  return (
    <group>
      <mesh geometry={built.metal}>{metalMaterial}</mesh>

      {built.chainAngles.map((l, i) => (
        <mesh key={`c${i}`} geometry={link} position={l.position} rotation={l.rotation}>
          {metalMaterial}
        </mesh>
      ))}

      {built.mainStones.map((s, i) => (
        <mesh key={`m${i}`} geometry={round} position={s.position} rotation={s.rotation} scale={s.scale}>
          {stoneMaterial}
        </mesh>
      ))}

      {built.accentStones.map((s, i) => (
        <mesh key={`a${i}`} geometry={round} position={s.position} rotation={s.rotation} scale={s.scale}>
          {stoneMaterial}
        </mesh>
      ))}

      {built.clusterStones.map((s, i) => (
        <mesh key={`k${i}`} geometry={round} position={s.position} rotation={s.rotation} scale={s.scale}>
          {stoneMaterial}
        </mesh>
      ))}

      {built.drops.map((s, i) => (
        <mesh key={`d${i}`} geometry={pear} position={s.position} rotation={s.rotation} scale={s.scale}>
          {stoneMaterial}
        </mesh>
      ))}
    </group>
  );
}
