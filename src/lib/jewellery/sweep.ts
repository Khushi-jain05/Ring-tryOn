import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector2,
  Vector3,
  type Curve,
} from "three";

/**
 * Sweeping a profile along a curve, and merging the results.
 *
 * Extracted from the pendant these were written for, which has since been removed
 * from the range — the collar sweeps its rails the same way, and a mesh built by
 * sweeping a shaped profile is a general enough thing to want again.
 */

/**
 * Sweeps a 2D profile along a 3D curve.
 *
 * `TubeGeometry` would be the obvious choice, but it only produces a circular
 * tube — and the ribbon in the reference is a flattened band, which is what gives
 * it a bright edge highlight and a dimmer face. Scaling a finished tube
 * non-uniformly does not work either: it would flatten the band along a fixed
 * world axis rather than along its own, so the ribbon would look like a band in
 * some places and a wire in others as the curve turned.
 *
 * So the profile is placed in each point's own Frenet frame. Three.js computes
 * those frames for us, including the parallel-transport pass that stops the
 * profile spinning as the curve twists.
 */
export function sweepProfile(
  curve: Curve<Vector3>,
  profile: Vector2[],
  segments: number,
  closed = false,
): BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, closed);
  const count = profile.length;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const point = new Vector3();
  const vertex = new Vector3();
  const normal = new Vector3();

  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, point);
    const N = frames.normals[Math.min(i, frames.normals.length - 1)];
    const B = frames.binormals[Math.min(i, frames.binormals.length - 1)];

    for (const p of profile) {
      vertex
        .copy(point)
        .addScaledVector(N, p.x)
        .addScaledVector(B, p.y);
      positions.push(vertex.x, vertex.y, vertex.z);

      // For a convex profile centred on the curve, the outward normal is just the
      // direction from the axis to the surface.
      normal.set(0, 0, 0).addScaledVector(N, p.x).addScaledVector(B, p.y).normalize();
      normals.push(normal.x, normal.y, normal.z);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < count; j++) {
      const jNext = (j + 1) % count;
      const a = i * count + j;
      const b = i * count + jNext;
      const c = (i + 1) * count + jNext;
      const d = (i + 1) * count + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return geometry;
}

/** An elliptical cross-section: a flattened band rather than a round wire. */
export function ribbonProfile(radius: number, flatten: number, segments = 10): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new Vector2(Math.cos(a) * radius, Math.sin(a) * radius * flatten));
  }
  return points;
}

/** Concatenates geometries that already share a material. */
export function mergeInto(parts: BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const part of parts) {
    const pos = part.attributes.position;
    const nor = part.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    const index = part.index;
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }
    offset += pos.count;
  }

  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return geometry;
}
