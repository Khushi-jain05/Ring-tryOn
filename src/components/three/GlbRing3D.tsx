"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Mesh, MeshStandardMaterial } from "three";
import type { GlbSource } from "@/lib/rings/types";

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
 */
export function GlbRing3D({ source }: { source: GlbSource }) {
  const { scene } = useGLTF(source.url);

  // Cloned because useGLTF caches one scene per URL: mutating it would leak the
  // normalisation into the product viewer and the catalogue thumbnails, which draw
  // the same model at their own scales.
  const model = useMemo(() => {
    const root = scene.clone(true);

    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;

      // The model's own materials are kept — it is a designed asset, and replacing
      // its finish with the app's metal palette would be substituting a different
      // ring. They are only nudged to sit in this scene's lighting: a GLB authored
      // elsewhere carries whatever environment intensity that authoring tool used,
      // and at the default of 1 a polished metal reads flat against the studio
      // environment the generated rings are lit by.
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof MeshStandardMaterial) {
          material.envMapIntensity = source.envMapIntensity ?? 1.6;
          material.needsUpdate = true;
        }
      }
    });

    return root;
  }, [scene, source.envMapIntensity]);

  return (
    <group scale={source.scale} position={source.offset} rotation={source.rotation}>
      <primitive object={model} />
    </group>
  );
}

// Warm the cache so the first frame of try-on is not the one that decodes 800 KB.
useGLTF.preload("/models/ring.glb");
