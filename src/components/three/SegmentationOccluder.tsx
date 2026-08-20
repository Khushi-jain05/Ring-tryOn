"use client";

import { useImperativeHandle, useRef } from "react";
import {
  DataTexture,
  RedFormat,
  UnsignedByteType,
  type Mesh,
  type ShaderMaterial,
} from "three";
import { ANCHOR_DISTANCE } from "@/lib/hand/projection";

/**
 * Occlusion driven by a per-pixel person mask rather than by geometry.
 *
 * The geometric occluders elsewhere are stand-ins for parts of the body: a cylinder
 * for the neck, capsules for fingers. They work because we know where those are. But
 * the scene contains nothing else — so anything real that comes between the camera
 * and the wearer, a hand or a mug or a phone, has no representation at all, and the
 * jewellery cheerfully draws on top of it. No amount of tuning the neck cylinder
 * fixes that, because the problem is that the obstruction does not exist in the scene.
 *
 * The pose model's segmentation mask does know. It labels every pixel as wearer or
 * not-wearer, and a necklace only ever belongs on the wearer — so wherever a pixel
 * is *not* the wearer, the necklace must not be drawn.
 *
 * Expressed as depth rather than as alpha, which keeps it consistent with every other
 * occluder here: a full-view quad sits just in front of the piece, writes depth and no
 * colour, and discards itself wherever the mask says "wearer". Where it survives —
 * over the obstruction — the necklace behind it fails the depth test and is never
 * drawn.
 *
 * Its limitation is worth being plain about: the mask separates the wearer from
 * everything else, not one part of the wearer from another. The wearer's own hand is
 * still "wearer", so raising a hand to the throat will not hide the piece. That needs
 * part-level segmentation, which this model does not produce.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec2 maskUv = vUv * uUvScale + uUvOffset;
    // Outside the camera frame there is no evidence either way. Treat it as wearer,
    // so the piece is never clipped by the edge of the mask itself.
    if (maskUv.x < 0.0 || maskUv.x > 1.0 || maskUv.y < 0.0 || maskUv.y > 1.0) discard;
    float wearer = texture2D(uMask, maskUv).r;
    // Where this is the wearer, get out of the way. Where it is not, stay and write
    // depth — which is what hides the jewellery behind the obstruction.
    if (wearer > uThreshold) discard;
    gl_FragColor = vec4(0.0);
  }
`;

export type SegmentationOccluderHandle = {
  /**
   * @param mask   Mask bytes, row-major from the top, 255 meaning wearer.
   * @param width  Mask dimensions, which need not match the video's.
   * @param uv     Maps this quad's UV to mask UV, replaying the preview's crop.
   * @param depth  Depth to sit at, in anchor-plane units.
   */
  update: (
    mask: Uint8Array,
    width: number,
    height: number,
    uv: { scaleX: number; offsetX: number; scaleY: number; offsetY: number },
    depth: number,
    /** Display aspect, so the quad covers exactly the view and no more. */
    aspect: number,
  ) => void;
  hide: () => void;
};

export function SegmentationOccluder({
  ref,
}: {
  ref?: React.Ref<SegmentationOccluderHandle>;
}) {
  const meshRef = useRef<Mesh>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const textureRef = useRef<DataTexture | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      hide() {
        const mesh = meshRef.current;
        if (mesh) mesh.visible = false;
      },

      update(mask, width, height, uv, depth, aspect) {
        const mesh = meshRef.current;
        const material = materialRef.current;
        if (!mesh || !material) return;

        if (width <= 0 || height <= 0 || mask.length < width * height) {
          mesh.visible = false;
          return;
        }

        // One channel: the mask is a confidence, not a colour. Reallocated only when
        // the dimensions change, which in practice is once.
        let texture = textureRef.current;
        if (!texture || texture.image.width !== width || texture.image.height !== height) {
          texture?.dispose();
          texture = new DataTexture(
            new Uint8Array(mask),
            width,
            height,
            RedFormat,
            UnsignedByteType,
          );
          textureRef.current = texture;
          material.uniforms.uMask.value = texture;
        } else {
          (texture.image.data as Uint8Array).set(mask);
        }
        texture.needsUpdate = true;

        material.uniforms.uUvScale.value = [uv.scaleX, uv.scaleY];
        material.uniforms.uUvOffset.value = [uv.offsetX, uv.offsetY];

        // Sit just in front of the piece, covering **exactly** the view at that depth.
        //
        // Exactly matters: the shader reads this quad's own UV, and the transform it is
        // given maps "0 to 1 across the display" onto the frame. A quad larger than the
        // view breaks that correspondence, so the mask gets sampled from the wrong place
        // — it was four units square against a view under one unit tall, which sampled a
        // small patch near the centre of the frame and treated everything else as out of
        // range. The visible height at the anchor plane is one unit by construction, and
        // it shrinks in proportion as the plane approaches the camera.
        const distance = ANCHOR_DISTANCE - depth;
        const viewHeight = distance / ANCHOR_DISTANCE;
        mesh.position.set(0, 0, depth);
        mesh.scale.set(viewHeight * aspect, viewHeight, 1);
        mesh.visible = true;
      },
    }),
    [],
  );

  return (
    <mesh ref={meshRef} renderOrder={-3} frustumCulled={false} visible={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={{
          uMask: { value: null },
          // A scale and offset rather than the crop's individual terms, so the shader
          // stays one multiply-add and the awkward algebra lives in JS.
          uUvScale: { value: [1, 1] },
          uUvOffset: { value: [0, 0] },
          uThreshold: { value: 0.5 },
        }}
        colorWrite={false}
        depthWrite
        depthTest
      />
    </mesh>
  );
}
