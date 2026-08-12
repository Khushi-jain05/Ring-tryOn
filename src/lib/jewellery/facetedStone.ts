import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from "three";

/**
 * A faceted gemstone built from stacked horizontal cross-sections of an arbitrary
 * girdle outline.
 *
 * The ring stones are surfaces of revolution, which is enough for round, oval and
 * step cuts — you revolve the correct profile and squeeze the result. A heart
 * cannot be made that way at all: its outline has a cleft and a point, neither of
 * which is reachable by scaling a circle. So this takes the outline as data and
 * stacks scaled copies of it up the stone's height.
 *
 * The result is deliberately **non-indexed**, so `computeVertexNormals` gives one
 * flat normal per triangle rather than averaging across neighbours. That is the
 * whole point: a cut stone reads as a cut stone because each facet catches the
 * light at its own angle, and smooth-shaded gems look like plastic beads.
 */

export type StoneLevel = {
  /** Height of this slice, with the girdle at 0. */
  y: number;
  /** Scale applied to the outline here. 0 collapses the slice to a point. */
  scale: number;
  /**
   * Alternating in/out wobble applied to consecutive outline vertices.
   *
   * This is what turns a smooth cone into the V-shaped pavilion mains and crown
   * stars a brilliant cut needs in order to scintillate. Step cuts leave it off.
   */
  zig?: number;
};

/** Shoelace area, used to normalise the outline's winding. */
function signedArea(points: Vector2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    total += p.x * q.y - q.x * p.y;
  }
  return total / 2;
}

/**
 * @param outlineIn Girdle outline in the XZ plane, as (x, z) pairs.
 * @param levels    Bottom-to-top slices. The last one is capped as the table.
 */
export function buildOutlineStone(
  outlineIn: Vector2[],
  levels: StoneLevel[],
): BufferGeometry {
  // Normalise winding so the triangle order below faces outward. Getting this
  // backwards renders the stone inside-out, which reads as a dark hole rather
  // than an obviously flipped surface — easy to miss, so it is forced here.
  const outline = signedArea(outlineIn) > 0 ? [...outlineIn].reverse() : [...outlineIn];
  const count = outline.length;

  const sliceAt = (level: StoneLevel): Vector3[] =>
    outline.map((p, i) => {
      const wobble = level.zig ? 1 + (i % 2 === 0 ? level.zig : -level.zig) : 1;
      const s = level.scale * wobble;
      return new Vector3(p.x * s, level.y, p.y * s);
    });

  const slices = levels.map(sliceAt);
  const positions: number[] = [];
  const push = (v: Vector3) => positions.push(v.x, v.y, v.z);

  // A slice whose scale collapses to nothing is a single point — the culet.
  const isApex = (level: StoneLevel) => Math.abs(level.scale) < 1e-6;

  for (let l = 0; l < slices.length - 1; l++) {
    const lower = slices[l];
    const upper = slices[l + 1];

    // Against an apex, emit a proper triangle fan. Treating it as a quad ring
    // instead leaves one zero-area triangle per segment, and `computeVertexNormals`
    // then averages a meaningless normal from each of them into its neighbours —
    // which is exactly what dulls the facets nearest the point, the part of a
    // brilliant that should be flashing hardest.
    if (isApex(levels[l])) {
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        push(lower[0]);
        push(upper[j]);
        push(upper[i]);
      }
      continue;
    }
    if (isApex(levels[l + 1])) {
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        push(lower[i]);
        push(lower[j]);
        push(upper[0]);
      }
      continue;
    }

    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      push(lower[i]);
      push(upper[j]);
      push(upper[i]);
      push(lower[i]);
      push(lower[j]);
      push(upper[j]);
    }
  }

  // Table: a flat fan across the top slice. A degenerate bottom slice — a culet
  // collapsed to a point — needs no cap, because the side quads already close it.
  const top = slices[slices.length - 1];
  const centre = new Vector3(0, top[0].y, 0);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    push(centre);
    push(top[i]);
    push(top[j]);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A heart-shaped girdle outline: two lobes, a cleft between them, and a point.
 *
 * Traced parametrically rather than from bezier control points so the lobe
 * fullness and cleft depth stay adjustable — a heart cut lives or dies on those
 * two proportions, and a heart whose lobes are too flat just reads as a triangle.
 *
 * @param halfWidth Half the stone's width at its widest, across the lobes.
 * @param segments  Outline vertices. Low counts read as a coarser cut.
 */
export function heartOutline(halfWidth: number, segments = 28): Vector2[] {
  const points: Vector2[] = [];
  const lobe = 0.62; // how round the lobes are
  const cleft = 0.3; // how deep the notch between them cuts

  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    // A cardioid-like trace, flattened vertically and given a sharper tip than a
    // true cardioid so it reads as a cut stone rather than a valentine.
    const sin = Math.sin(t);
    const x = Math.pow(Math.abs(sin), 0.86) * Math.sign(sin) * (1 - lobe * 0.18);
    const cos = Math.cos(t);
    const z = cos * 0.82 + cleft * Math.pow(Math.max(0, cos), 2.2) - 0.12;

    points.push(new Vector2(x * halfWidth, z * halfWidth * 1.06));
  }
  return points;
}

/**
 * Brilliant-cut slice heights, as fractions of the stone's width.
 *
 * A heart is a brilliant, so it converges to a single culet and carries the
 * alternating `zig` through the pavilion and crown that produces its fire.
 */
export function brilliantLevels(halfWidth: number): StoneLevel[] {
  const w = halfWidth;
  return [
    { y: -1.28 * w, scale: 0.0 }, // culet
    { y: -0.66 * w, scale: 0.56, zig: 0.08 }, // pavilion mains
    { y: -0.24 * w, scale: 0.88, zig: 0.04 },
    { y: 0.0, scale: 1.0 }, // girdle
    { y: 0.09 * w, scale: 1.0 }, // girdle thickness
    { y: 0.3 * w, scale: 0.84, zig: 0.05 }, // crown mains and stars
    { y: 0.46 * w, scale: 0.56 }, // table
  ];
}
