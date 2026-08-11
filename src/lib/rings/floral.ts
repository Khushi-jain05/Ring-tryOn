import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { FloralSpec } from "./types";

/**
 * The floral head.
 *
 * A flower ring is the one design in the range that cannot be described by band
 * profile plus setting, so it gets its own builder. Each petal is a scalloped
 * outline extruded with a bevel, then bent onto a shallow dome and tilted
 * outward — which is what gives a cast flower its cupped look rather than
 * reading as a flat rosette stamped on the shank.
 *
 * Authored in finger-radius-1 units like everything else, with the flower
 * standing off local +Y and the finger passing through along +Z.
 */

export type { FloralSpec };

export const DEFAULT_FLORAL: FloralSpec = {
  petals: 6,
  headRadius: 0.92,
  gemRadius: 0.19,
  scallop: 0.42,
  cup: 0.38,
};

/**
 * One petal, drawn in 2D looking down at the flower.
 *
 * The outline is a teardrop with a wavy edge: narrow where it meets the centre,
 * broad and scalloped at the tip. Built from cubic curves rather than sampled
 * points so the bevel that follows has clean tangents to work with.
 */
function petalShape(spec: FloralSpec): Shape {
  const length = 1;
  const width = (Math.PI * 2) / spec.petals / 1.55;
  const s = spec.scallop;

  const shape = new Shape();
  shape.moveTo(0, 0.06);

  // Right side, sweeping out to the shoulder then in to the notch.
  shape.bezierCurveTo(width * 0.55, 0.16, width * 0.98, 0.42, width * 0.86, 0.66);
  // The scallop: a shallow inward bite before the tip lobe.
  shape.bezierCurveTo(
    width * (0.78 - 0.18 * s),
    0.78,
    width * (0.62 + 0.2 * s),
    0.84,
    width * 0.5,
    0.9,
  );
  shape.bezierCurveTo(width * 0.34, 0.97, width * 0.14, length, 0, length);

  // Left side, mirrored.
  shape.bezierCurveTo(-width * 0.14, length, -width * 0.34, 0.97, -width * 0.5, 0.9);
  shape.bezierCurveTo(
    -width * (0.62 + 0.2 * s),
    0.84,
    -width * (0.78 - 0.18 * s),
    0.78,
    -width * 0.86,
    0.66,
  );
  shape.bezierCurveTo(-width * 0.98, 0.42, -width * 0.55, 0.16, 0, 0.06);

  return shape;
}

/**
 * Bends a flat extruded petal onto a dome and tilts it outward.
 *
 * Extrusion can only produce a prism, so the curvature has to be applied
 * afterwards by displacing vertices: lift with the square of the distance from
 * the centre, which approximates the spherical cap a petal is pressed into.
 */
function curvePetal(geometry: BufferGeometry, spec: FloralSpec): BufferGeometry {
  const position = geometry.attributes.position;
  const array = position.array as Float32Array;

  for (let i = 0; i < array.length; i += 3) {
    const y = array[i + 1];
    const t = Math.min(1, Math.max(0, y));
    // Lift the tip and roll the edges up slightly, so light runs along the fold.
    array[i + 2] += spec.cup * t * t;
    array[i] *= 1 - 0.1 * t * t;
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** The raised rim that runs around a petal's edge, catching a bright highlight. */
function petalRim(spec: FloralSpec, scale: number): BufferGeometry | null {
  const shape = petalShape(spec);
  const points = shape.getPoints(60).map((p) => new Vector3(p.x, p.y, 0));
  if (points.length < 4) return null;

  for (const p of points) {
    const t = Math.min(1, Math.max(0, p.y));
    p.z += spec.cup * t * t;
    p.x *= 1 - 0.1 * t * t;
  }

  const curve = new CatmullRomCurve3(points, true, "centripetal");
  const tube = new TubeGeometry(curve, 130, 0.032, 8, true);
  tube.scale(scale, scale, scale);
  return tube;
}

/**
 * The tapered shank. A flower head this broad needs the band to narrow as it
 * approaches, or the join looks like a lump rather than a shoulder.
 */
function floralShank(inner: number, thickness: number, width: number): BufferGeometry {
  const profile: Vector2[] = [
    new Vector2(inner, -width / 2),
    new Vector2(inner + thickness, -width / 2.35),
    new Vector2(inner + thickness, width / 2.35),
    new Vector2(inner, width / 2),
    new Vector2(inner, -width / 2),
  ];
  const lathe = new LatheGeometry(profile, 128);
  lathe.rotateX(Math.PI / 2);

  const position = lathe.attributes.position;
  const array = position.array as Float32Array;

  // Taper toward the top of the ring, where the flower sits.
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i];
    const y = array[i + 1];
    const radial = Math.hypot(x, y);
    if (radial < 1e-6) continue;
    // 1 at the top of the band, 0 at the bottom.
    const top = Math.max(0, y / radial);
    const shrink = 1 - 0.26 * top * top;
    array[i + 2] *= shrink;
  }

  position.needsUpdate = true;
  lathe.computeVertexNormals();
  return lathe;
}

export type FloralGeometry = {
  /** Polished metal: shank, petal rims, prongs. */
  polished: BufferGeometry;
  /** Matte metal: the petal faces themselves. */
  matte: BufferGeometry;
  /** Where the centre stone sits, and how big. */
  gem: { position: [number, number, number]; radius: number };
  prongs: { position: [number, number, number]; rotation: [number, number, number]; scale: number }[];
};

export function createFloralGeometry(
  spec: FloralSpec = DEFAULT_FLORAL,
  band: { inner: number; thickness: number; width: number } = {
    inner: 1,
    thickness: 0.1,
    width: 0.19,
  },
): FloralGeometry {
  const faces: BufferGeometry[] = [];
  const rims: BufferGeometry[] = [];

  const baseY = band.inner + band.thickness * 0.6;
  const shape = petalShape(spec);

  for (let i = 0; i < spec.petals; i++) {
    const angle = (i / spec.petals) * Math.PI * 2;

    const face = new ExtrudeGeometry(shape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.026,
      bevelSegments: 3,
      curveSegments: 24,
    });
    curvePetal(face, spec);
    face.scale(spec.headRadius, spec.headRadius, spec.headRadius);

    // Petals are drawn lying in XY with their length along +Y. Standing them up
    // puts the length along -Z and the extrusion depth along +Y, so the flower's
    // axis is +Y and the petals radiate in the XZ plane.
    //
    // They must therefore fan about **Y**, not Z. Rotating about Z leaves every
    // petal pointing the same way along -Z and merely spins its width, so instead
    // of a flower you get six petals stacked on top of each other, splayed across
    // the band — which is why the head looked nothing like a bloom.
    face.rotateX(-Math.PI / 2);
    face.rotateY(angle);
    face.translate(0, baseY, 0);
    faces.push(face);

    const rim = petalRim(spec, spec.headRadius);
    if (rim) {
      rim.rotateX(-Math.PI / 2);
      rim.rotateY(angle);
      rim.translate(0, baseY, 0);
      rims.push(rim);
    }
  }

  rims.push(floralShank(band.inner, band.thickness, band.width));

  // The collet the centre stone drops into, and a fine bezel around it.
  const gemY = baseY + spec.cup * 0.32 * spec.headRadius + spec.gemRadius * 0.72;
  const collet = new CylinderGeometry(
    spec.gemRadius * 1.02,
    spec.gemRadius * 0.5,
    spec.gemRadius * 1.5,
    20,
    1,
    true,
  );
  collet.translate(0, gemY - spec.gemRadius * 0.62, 0);
  rims.push(collet);

  const bezel = new TorusGeometry(spec.gemRadius * 1.08, spec.gemRadius * 0.13, 10, 28);
  bezel.rotateX(Math.PI / 2);
  bezel.translate(0, gemY - spec.gemRadius * 0.1, 0);
  rims.push(bezel);

  const prongCount = 6;
  const prongs = Array.from({ length: prongCount }, (_, i) => {
    const a = (i / prongCount) * Math.PI * 2 + Math.PI / prongCount;
    return {
      position: [
        Math.cos(a) * spec.gemRadius * 0.96,
        gemY + spec.gemRadius * 0.18,
        Math.sin(a) * spec.gemRadius * 0.96,
      ] as [number, number, number],
      rotation: [Math.sin(a) * 0.22, -a, -Math.cos(a) * 0.22] as [number, number, number],
      scale: spec.gemRadius * 0.2,
    };
  });

  return {
    polished: mergeGeometries(rims, false) ?? rims[0],
    matte: mergeGeometries(faces, false) ?? faces[0],
    gem: { position: [0, gemY, 0], radius: spec.gemRadius },
    prongs,
  };
}
