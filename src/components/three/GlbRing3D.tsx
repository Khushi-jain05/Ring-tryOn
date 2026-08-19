"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { GEMS, METALS } from "@/lib/rings/catalog";
import type { GemId, GlbSource, MetalId } from "@/lib/rings/types";
import type { RenderQuality } from "./Ring3D";

/**
 * A ring loaded from a GLB, normalised into the same convention the procedural
 * rings use so it goes through the identical placement path.
 *
 * That convention is:
 *
 *   bore radius 1  ·  +Z along the finger  ·  +Y toward the back of the hand
 *   origin at the centre of the bore
 *
 * Everything downstream — the pose solver, the finger occluder, the contact shadow,
 * the depth compensation — is expressed in multiples of the band's inner radius. So a
 * model normalised to those terms needs no special handling anywhere: `TrackedRing`
 * scales the group by the measured bore radius and the model lands exactly where a
 * generated band would. That is the whole reason to normalise rather than to add a
 * parallel path for imported meshes.
 *
 * The numbers come from `scripts/fit-glb-ring.mjs`, which finds the bore as the
 * largest *enclosed* empty circle — see that file for why the obvious alternatives
 * (smallest bounding-box extent, largest principal moment of inertia) both pick the
 * wrong axis on a real ring with a substantial head.
 *
 * **Materials are replaced, not kept.** A GLB arrives with its finish baked in, so
 * left alone the metal and stone pickers do nothing for it while working on every
 * other ring — which reads as the controls being broken rather than as the model
 * being fixed. Instead each of the model's materials is assigned a *role* in the
 * catalogue, and the roles are filled from the same palettes the generated rings use.
 * The mesh is the design; the colour is the option.
 */
export function GlbRing3D({
  source,
  metal,
  gem,
  quality = "showcase",
}: {
  source: GlbSource;
  metal: MetalId;
  gem: GemId;
  quality?: RenderQuality;
}) {
  const { scene } = useGLTF(source.url);

  const model = useMemo(() => {
    const metalSpec = METALS[metal];
    const gemSpec = GEMS[gem];

    const metalMaterial = new MeshPhysicalMaterial({
      color: metalSpec.color,
      metalness: 1,
      roughness: metalSpec.roughness,
      envMapIntensity: source.envMapIntensity ?? 1.6,
    });

    /**
     * Over live video the stone is drawn without refraction.
     *
     * `transmission` needs the renderer to capture what is behind the object, and
     * behind this one there is only a transparent canvas over a video element — so it
     * refracts nothing and renders near-black. A mirror-bright approximation reads
     * far better there; the product view, which has a real environment behind the
     * ring, gets the real thing.
     */
    const stoneMaterial =
      quality === "live"
        ? new MeshPhysicalMaterial({
            color: gemSpec.color,
            metalness: 0.08,
            roughness: 0,
            clearcoat: 1,
            clearcoatRoughness: 0,
            reflectivity: 1,
            iridescence: 0.35,
            iridescenceIOR: 1.5,
            envMapIntensity: 3,
          })
        : new MeshPhysicalMaterial({
            color: gemSpec.color,
            metalness: 0,
            roughness: gemSpec.roughness,
            transmission: gemSpec.transmission,
            thickness: 0.5,
            ior: gemSpec.ior,
            dispersion: gemSpec.dispersion,
            attenuationColor: gemSpec.color,
            attenuationDistance: 2.5,
            envMapIntensity: 2.6,
          });

    // Accents stay white regardless of the centre stone: melee in a halo is diamond,
    // and tinting it with the centre's colour is not a thing a jeweller does.
    const accentMaterial = new MeshPhysicalMaterial({
      color: "#ffffff",
      metalness: 0.05,
      roughness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0,
      reflectivity: 1,
      envMapIntensity: 3.2,
    });

    const byRole = {
      metal: metalMaterial,
      centre: stoneMaterial,
      accent: accentMaterial,
    } as const;

    // Cloned because useGLTF caches one scene per URL: assigning materials to the
    // cached copy would leak this ring's colours into every other view of the model.
    const root = scene.clone(true);

    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;

      const existing = Array.isArray(object.material) ? object.material : [object.material];
      const replaced = existing.map((material) => {
        const name = material instanceof MeshStandardMaterial ? material.name : "";
        const role = source.materials?.[name];
        // An unmapped material keeps its own appearance rather than being guessed at,
        // so adding a mesh with parts nobody has classified degrades quietly instead
        // of turning something the wrong colour.
        return role ? byRole[role] : material;
      });

      object.material = replaced.length === 1 ? replaced[0] : replaced;
    });

    return root;
  }, [scene, metal, gem, quality, source.envMapIntensity, source.materials]);

  return (
    <group scale={source.scale} position={source.offset} rotation={source.rotation}>
      <primitive object={model} />
    </group>
  );
}

// Warm the cache so the first frame of try-on is not the one that decodes 800 KB.
useGLTF.preload("/models/ring.glb");
