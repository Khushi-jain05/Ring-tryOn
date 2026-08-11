"use client";

import { useImperativeHandle, useMemo, useRef } from "react";
import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { ANCHOR_DISTANCE } from "@/lib/hand/projection";
import { FINGER_CHAINS, FINGER_NAMES, LM, THUMB_CHAIN, type FingerName } from "@/lib/hand/landmarks";
import type { RingPose } from "@/lib/hand/ringPose";

/**
 * A depth-only stand-in for the entire hand.
 *
 * The ring's own finger occluder can hide the far side of the band, but it knows
 * nothing about the rest of the hand — so a neighbouring finger folded across
 * the ring draws *behind* it, and the ring appears to float on top of the hand.
 * Fixing that needs two things the single cylinder did not have: geometry for
 * every finger, and genuine depth.
 *
 * Depth is the interesting part. Everything else in this system is anchored to a
 * single plane, which is what keeps the ring locked to the pixels of the finger —
 * but on one plane nothing can be in front of anything. So each joint is pushed
 * to its true relative depth from the metric landmarks, and its plane position is
 * scaled by `(D - z) / D` to compensate. That is exactly the perspective divide,
 * so a joint keeps the same screen position it had on the plane while gaining a
 * depth that can win or lose the depth test.
 */

/** Joints linked by a segment, as [from, to] landmark pairs. */
type Segment = [number, number, FingerName | "thumb"];

function buildSegments(): Segment[] {
  const segments: Segment[] = [];

  for (const name of FINGER_NAMES) {
    const c = FINGER_CHAINS[name];
    // The proximal segment of the ring-wearing finger is deliberately left to
    // the precise elliptical occluder inside the ring group; a coarse circular
    // capsule there would eat into the band.
    segments.push([c.mcp, c.pip, name]);
    segments.push([c.pip, c.dip, name]);
    segments.push([c.dip, c.tip, name]);
  }

  const t = THUMB_CHAIN;
  segments.push([t.cmc, t.mcp, "thumb"]);
  segments.push([t.mcp, t.ip, "thumb"]);
  segments.push([t.ip, t.tip, "thumb"]);

  return segments;
}

const SEGMENTS = buildSegments();

/** Joints that get a sphere, so the capsule chain has no gaps at the bends. */
const JOINTS: [number, FingerName | "thumb"][] = [
  ...FINGER_NAMES.flatMap((name) => {
    const c = FINGER_CHAINS[name];
    return [
      [c.pip, name],
      [c.dip, name],
      [c.tip, name],
    ] as [number, FingerName][];
  }),
  [THUMB_CHAIN.mcp, "thumb"],
  [THUMB_CHAIN.ip, "thumb"],
  [THUMB_CHAIN.tip, "thumb"],
];

/** Fingers taper toward the tip; these are multipliers on the base half-width. */
const SEGMENT_TAPER = [1, 0.88, 0.76];

/**
 * Slight over-coverage on the occluding capsules. Their only job is to hide, and
 * they are never drawn, so erring generous is free — whereas erring small leaves
 * the ring showing through a finger that is in front of it.
 */
const COVER_MARGIN = 1.04;

/** A palm is appreciably deeper than a finger, measured in finger half-widths. */
const PALM_THICKNESS = 1.32;

/**
 * Pushes the neighbouring fingers slightly away from the lens, in finger
 * half-widths.
 *
 * Adjacent fingers are only a few millimetres apart in depth, and MediaPipe's z
 * is its noisiest output — so without a bias a neighbour flickers into "in front
 * of the ring" and bites a hole out of the band. Erring backwards makes the
 * failure mode "a little too much ring shows" instead of "part of the ring
 * disappears", which is far less noticeable.
 */
const NEIGHBOUR_DEPTH_BIAS = 0.35;

const UP = new Vector3(0, 1, 0);
const AWAY_FROM_LENS = new Vector3(0, 0, -1);

/**
 * Ahead of the band's own occluder (−1) and the ring itself (0), so the whole
 * hand's depth is laid down before any metal is drawn.
 */
const OCCLUDER_RENDER_ORDER = -2;

export type HandOccluderHandle = {
  update: (pose: RingPose, excludeProximalOf: FingerName) => void;
  hide: () => void;
};

export function HandOccluder({ ref }: { ref?: React.Ref<HandOccluderHandle> }) {
  const segmentsRef = useRef<InstancedMesh>(null);
  const jointsRef = useRef<InstancedMesh>(null);
  const palmRef = useRef<InstancedMesh>(null);

  const geometries = useMemo(
    () => ({
      // Unit cylinder along Y, so a segment is placed by rotating Y onto it.
      cylinder: new CylinderGeometry(1, 1, 1, 14, 1, true),
      sphere: new SphereGeometry(1, 14, 10),
    }),
    [],
  );

  const scratch = useMemo(
    () => ({
      dummy: new Object3D(),
      from: new Vector3(),
      to: new Vector3(),
      mid: new Vector3(),
      dir: new Vector3(),
      quat: new Quaternion(),
      hidden: new Matrix4().makeScale(0, 0, 0),
      a: new Vector3(),
      b: new Vector3(),
      c: new Vector3(),
    }),
    [],
  );

  // Imperative handle: this updates every frame and must not touch React state.
  const handle = useMemo<HandOccluderHandle>(
    () => ({
      hide() {
        for (const mesh of [segmentsRef.current, jointsRef.current, palmRef.current]) {
          if (!mesh) continue;
          for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, scratch.hidden);
          mesh.instanceMatrix.needsUpdate = true;
        }
      },

      update(pose, excludeProximalOf) {
        const segments = segmentsRef.current;
        const joints = jointsRef.current;
        const palm = palmRef.current;
        if (!segments || !joints || !palm) return;

        /**
         * Places a landmark in 3D: plane position for the screen, metric depth
         * for the ordering, with the plane position divided down so the two agree.
         */
        const place = (index: number, out: Vector3) => {
          const z = pose.depth[index];
          const k = (ANCHOR_DISTANCE - z) / ANCHOR_DISTANCE;
          const p = pose.planar[index];
          return out.set(p.x * k, p.y * k, z);
        };

        const radiusOf = (finger: FingerName | "thumb") =>
          finger === "thumb"
            ? pose.fingerHalfWidth.index * 1.18
            : pose.fingerHalfWidth[finger];

        for (let i = 0; i < SEGMENTS.length; i++) {
          const [from, to, finger] = SEGMENTS[i];
          const base = radiusOf(finger);
          const isNeighbour = finger !== excludeProximalOf;

          const isExcludedProximal =
            finger === excludeProximalOf && from === FINGER_CHAINS[excludeProximalOf].mcp;

          if (base <= 0 || isExcludedProximal) {
            segments.setMatrixAt(i, scratch.hidden);
            continue;
          }

          place(from, scratch.from);
          place(to, scratch.to);
          scratch.dir.subVectors(scratch.to, scratch.from);
          const length = scratch.dir.length();
          if (length < 1e-6) {
            segments.setMatrixAt(i, scratch.hidden);
            continue;
          }

          const taper = SEGMENT_TAPER[i % 3] ?? 1;
          const radius = base * taper;

          scratch.dir.divideScalar(length);
          scratch.quat.setFromUnitVectors(UP, scratch.dir);
          scratch.mid.addVectors(scratch.from, scratch.to).multiplyScalar(0.5);

          scratch.dummy.position.copy(scratch.mid);
          if (isNeighbour) {
            scratch.dummy.position.addScaledVector(AWAY_FROM_LENS, base * NEIGHBOUR_DEPTH_BIAS);
          }
          scratch.dummy.quaternion.copy(scratch.quat);
          // Circular, not flattened to a finger's real oval section. `setFrom-
          // UnitVectors` produces an arbitrary roll about the segment, so an
          // elliptical cross-section here would be flattened in a random
          // direction — sometimes the wrong one, leaving the ring visible through
          // a finger that is plainly in front of it. A little over-coverage costs
          // nothing on a surface that is never drawn.
          scratch.dummy.scale.set(radius * COVER_MARGIN, length, radius * COVER_MARGIN);
          scratch.dummy.updateMatrix();
          segments.setMatrixAt(i, scratch.dummy.matrix);
        }
        segments.instanceMatrix.needsUpdate = true;

        for (let i = 0; i < JOINTS.length; i++) {
          const [index, finger] = JOINTS[i];
          const base = radiusOf(finger);
          if (base <= 0) {
            joints.setMatrixAt(i, scratch.hidden);
            continue;
          }
          place(index, scratch.from);
          scratch.dummy.position.copy(scratch.from);
          scratch.dummy.quaternion.identity();
          const joint = base * 0.9 * COVER_MARGIN;
          scratch.dummy.scale.set(joint, joint, joint);
          scratch.dummy.updateMatrix();
          joints.setMatrixAt(i, scratch.dummy.matrix);
        }
        joints.instanceMatrix.needsUpdate = true;

        // The palm: a flattened ellipsoid from the wrist up to the knuckle line.
        // Without it a ring on a folded-in finger shows through the hand.
        //
        // Its extent has to stop *at* the knuckles. Centring it on the centroid
        // of wrist and knuckles while giving it a half-height of two thirds of
        // the palm pushes the top a third of a palm past them — directly over
        // where the ring sits, which hides the ring almost completely.
        const palmThickness = pose.fingerHalfWidth.middle;
        place(LM.WRIST, scratch.a);
        place(LM.INDEX_MCP, scratch.b);
        place(LM.PINKY_MCP, scratch.c);

        // Midpoint of the knuckle line, and the axis running up to it.
        scratch.mid.copy(scratch.b).add(scratch.c).multiplyScalar(0.5);
        const across = scratch.b.distanceTo(scratch.c);
        scratch.dir.copy(scratch.mid).sub(scratch.a);
        const along = scratch.dir.length();

        if (palmThickness <= 0 || along < 1e-6) {
          palm.setMatrixAt(0, scratch.hidden);
        } else {
          scratch.dir.divideScalar(along);
          scratch.quat.setFromUnitVectors(UP, scratch.dir);
          // Centred halfway up the palm, and stopping just short of the knuckles
          // so the ellipsoid never reaches into the fingers.
          scratch.dummy.position.copy(scratch.a).addScaledVector(scratch.dir, along / 2);
          scratch.dummy.quaternion.copy(scratch.quat);
          scratch.dummy.scale.set(
            (across / 2) * 1.06,
            (along / 2) * 0.88,
            palmThickness * PALM_THICKNESS,
          );
          scratch.dummy.updateMatrix();
          palm.setMatrixAt(0, scratch.dummy.matrix);
        }
        palm.instanceMatrix.needsUpdate = true;
      },
    }),
    [scratch],
  );

  // The frame loop drives this imperatively; nothing here belongs in state.
  useImperativeHandle(ref, () => handle, [handle]);

  return (
    <group>
      {/*
        `renderOrder` must go on each mesh, not on the group — three.js sorts by
        an object's own value and does not inherit it down the tree. A depth-only
        occluder that draws *after* the ring is useless: the ring's colour is
        already in the buffer, and writing depth over it changes nothing. That is
        what let a neighbouring finger overlap the ring instead of hiding it.
        Instanced meshes make it worse, because their sort key is the mesh origin
        rather than the instances, so the automatic front-to-back ordering has no
        relation to where the fingers actually are.
      */}
      <instancedMesh
        ref={segmentsRef}
        args={[geometries.cylinder, undefined, SEGMENTS.length]}
        frustumCulled={false}
        renderOrder={OCCLUDER_RENDER_ORDER}
      >
        <meshBasicMaterial colorWrite={false} depthWrite depthTest />
      </instancedMesh>
      <instancedMesh
        ref={jointsRef}
        args={[geometries.sphere, undefined, JOINTS.length]}
        frustumCulled={false}
        renderOrder={OCCLUDER_RENDER_ORDER}
      >
        <meshBasicMaterial colorWrite={false} depthWrite depthTest />
      </instancedMesh>
      <instancedMesh
        ref={palmRef}
        args={[geometries.sphere, undefined, 1]}
        frustumCulled={false}
        renderOrder={OCCLUDER_RENDER_ORDER}
      >
        <meshBasicMaterial colorWrite={false} depthWrite depthTest />
      </instancedMesh>
    </group>
  );
}
