"use client";

import { useMemo } from "react";
import { DoubleSide, type BufferGeometry } from "three";
import { GEMS, METALS } from "@/lib/rings/catalog";
import { GlbRing3D } from "./GlbRing3D";
import {
  createBandGeometry,
  createGemGeometry,
  createHeadGeometry,
  createProngGeometry,
  eternityPlacements,
  haloPlacements,
  pavePlacements,
  prongPlacements,
  sideStonePlacements,
  type Placement,
} from "@/lib/rings/geometry";
import { DEFAULT_FLORAL, createFloralGeometry } from "@/lib/rings/floral";
import type { GemId, MetalId, Ring } from "@/lib/rings/types";

/**
 * Gem rendering is the single most expensive thing on screen. Real refraction
 * needs three.js to re-render the scene into a transmission buffer every frame,
 * which is fine for a still product shot but halves the frame rate when a
 * webcam and a neural network are already competing for the GPU.
 *
 * "showcase" buys the physics; "live" fakes it with a mirror-bright surface,
 * which at the size a stone occupies on a finger is very hard to tell apart.
 */
export type RenderQuality = "showcase" | "live";

type Ring3DProps = {
  ring: Ring;
  metal: MetalId;
  quality?: RenderQuality;
};

function useRingGeometries(ring: Ring) {
  return useMemo(() => {
    const { design } = ring;
    const band = createBandGeometry(design);
    const gem = design.gemSize > 0 ? createGemGeometry(design.gemCut) : null;
    const accent = createGemGeometry("round");
    const prong = createProngGeometry();
    const head = design.setting === "solitaire" ? createHeadGeometry(design) : null;

    let accents: Placement[] = [];
    let prongs: Placement[] = [];
    let sides: Placement[] = [];

    switch (design.setting) {
      case "solitaire":
        prongs = prongPlacements(design, Math.max(3, design.accentCount || 4));
        break;
      case "halo":
        accents = haloPlacements(design);
        prongs = prongPlacements(design, 4);
        break;
      case "three-stone":
        sides = sideStonePlacements(design);
        prongs = prongPlacements(design, 4);
        break;
      case "pave":
        accents = pavePlacements(design);
        break;
      case "eternity":
        accents = eternityPlacements(design);
        break;
      case "plain":
      default:
        break;
    }

    return { band, gem, accent, prong, head, accents, prongs, sides };
  }, [ring]);
}

function MetalSurface({ metal, finish = "polished" }: { metal: MetalId; finish?: "polished" | "matte" }) {
  const spec = METALS[metal];
  return (
    <meshPhysicalMaterial
      color={spec.color}
      metalness={1}
      // A sandblasted face scatters its reflection instead of mirroring it;
      // the contrast against the polished rim is what reads as "two finishes".
      roughness={finish === "matte" ? 0.46 : spec.roughness}
      envMapIntensity={finish === "matte" ? 1.05 : 1.6}
      // Cast geometry is thin and open in places (tube heads, knife edges);
      // drawing both faces avoids see-through gaps at grazing angles.
      side={DoubleSide}
    />
  );
}

function GemSurface({ gem, quality }: { gem: GemId; quality: RenderQuality }) {
  const spec = GEMS[gem];

  if (spec.transmission === 0) {
    return (
      <meshPhysicalMaterial
        color={spec.color}
        metalness={0}
        roughness={spec.roughness}
        clearcoat={1}
        clearcoatRoughness={0.04}
        envMapIntensity={1.4}
        flatShading
      />
    );
  }

  if (quality === "live") {
    // No transmission pass: lean on a mirror-smooth clearcoat and a strong
    // environment to stand in for the light bouncing inside the stone.
    return (
      <meshPhysicalMaterial
        color={spec.color}
        metalness={0.1}
        roughness={0}
        clearcoat={1}
        clearcoatRoughness={0}
        reflectivity={1}
        iridescence={spec.dispersion > 1 ? 0.6 : 0.2}
        iridescenceIOR={1.6}
        envMapIntensity={3.2}
        flatShading
      />
    );
  }

  return (
    <meshPhysicalMaterial
      color={spec.color}
      metalness={0}
      roughness={spec.roughness}
      transmission={spec.transmission}
      thickness={1.1}
      ior={spec.ior}
      dispersion={spec.dispersion}
      specularIntensity={1}
      envMapIntensity={2.4}
      attenuationColor={spec.color}
      attenuationDistance={3}
      flatShading
    />
  );
}

function Placed({
  placements,
  geometry,
  children,
}: {
  placements: Placement[];
  geometry: BufferGeometry;
  children: React.ReactNode;
}) {
  return (
    <>
      {placements.map((p, i) => (
        <mesh
          key={i}
          geometry={geometry}
          position={p.position}
          rotation={p.rotation}
          scale={p.scale}
        >
          {children}
        </mesh>
      ))}
    </>
  );
}

function FloralRing({ ring, metal, quality }: Required<Ring3DProps>) {
  const { design } = ring;
  const g = useMemo(() => {
    const spec = design.floral ?? DEFAULT_FLORAL;
    return {
      ...createFloralGeometry(spec, {
        inner: design.bandInnerScale,
        thickness: design.bandThickness,
        width: design.bandWidth,
      }),
      stone: createGemGeometry(design.gemCut),
      prong: createProngGeometry(),
    };
  }, [design]);

  return (
    <group>
      <mesh geometry={g.polished}>
        <MetalSurface metal={metal} />
      </mesh>
      <mesh geometry={g.matte}>
        <MetalSurface metal={metal} finish="matte" />
      </mesh>
      <mesh geometry={g.stone} position={g.gem.position} scale={g.gem.radius}>
        <GemSurface gem={ring.gem} quality={quality} />
      </mesh>
      <Placed placements={g.prongs} geometry={g.prong}>
        <MetalSurface metal={metal} />
      </Placed>
    </group>
  );
}

/**
 * A complete ring, authored so that a finger of radius 1 passes through it
 * along the local +Z axis with the setting standing off local +Y.
 */
export function Ring3D({ ring, metal, quality = "showcase" }: Ring3DProps) {
  // An imported mesh is already a finished ring; there is nothing to assemble.
  if (ring.glb) return <GlbRing3D source={ring.glb} />;

  const isFloral = ring.design.setting === "floral";
  if (isFloral) return <FloralRing ring={ring} metal={metal} quality={quality} />;
  return <StandardRing ring={ring} metal={metal} quality={quality} />;
}

function StandardRing({ ring, metal, quality }: Required<Ring3DProps>) {
  const g = useRingGeometries(ring);
  const { design } = ring;
  const gemY =
    design.bandInnerScale + design.bandThickness + design.gemSize * 0.62;

  return (
    <group>
      <mesh geometry={g.band} castShadow receiveShadow>
        <MetalSurface metal={metal} />
      </mesh>

      {g.head && (
        <mesh geometry={g.head}>
          <MetalSurface metal={metal} />
        </mesh>
      )}

      {g.gem && (
        <mesh geometry={g.gem} position={[0, gemY, 0]} scale={design.gemSize}>
          <GemSurface gem={ring.gem} quality={quality} />
        </mesh>
      )}

      <Placed placements={g.prongs} geometry={g.prong}>
        <MetalSurface metal={metal} />
      </Placed>

      <Placed placements={g.sides} geometry={g.accent}>
        <GemSurface gem="diamond" quality={quality} />
      </Placed>

      <Placed placements={g.accents} geometry={g.accent}>
        <GemSurface gem="diamond" quality={quality} />
      </Placed>
    </group>
  );
}
