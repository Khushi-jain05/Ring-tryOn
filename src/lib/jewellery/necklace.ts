import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  TorusGeometry,
  Vector2,
  Vector3,
  type Curve,
} from "three";
import { brilliantLevels, buildOutlineStone, heartOutline } from "./facetedStone";

/**
 * The pendant from the reference photograph: a white-gold ribbon that twists once
 * on itself and opens into a frame cradling a heart-cut pale-blue stone, with one
 * of the two strands pavé-set in small round diamonds.
 *
 * Everything here is in **millimetres**. A pendant's real size does not depend on
 * who is wearing it, unlike a ring's band, so these are absolute; the necklace as
 * a whole is scaled to screen pixels per frame from the measured shoulder span.
 *
 * Local axes, matching what NecklacePoseSolver produces:
 *   +X across the body    +Y up the neck    +Z out of the chest
 * The bail sits at the origin and the pendant hangs into −Y, so the chain can be
 * threaded through the origin without knowing anything about the pendant.
 */

export type NecklaceSpec = {
  /** Overall height of the pendant below the bail. */
  dropMm: number;
  /** Half-width of the heart stone across its lobes. */
  heartHalfWidthMm: number;
  /** Radius of the ribbon's wire. */
  ribbonRadiusMm: number;
  /** How much the ribbon is flattened into a band, 1 being round. */
  ribbonFlatten: number;
  /** Radius of each pavé stone. */
  paveRadiusMm: number;
  /** How many pavé stones run along the set strand. */
  paveCount: number;
  /** Radius of the chain's wire. */
  chainWireMm: number;
  /** Long axis of each chain link. */
  chainLinkMm: number;
};

/**
 * The heavy cut of the design: a statement piece rather than a delicate one.
 *
 * Every dimension is up around 50% on the slender version below, and that is not
 * only an aesthetic choice — it is also what makes the piece legible in try-on. A
 * 19 mm pendant on someone sitting far enough back for both shoulders to be in
 * frame is about 35 screen pixels tall, at which point neither the twist nor the
 * cut of the stone survives. At 27 mm with a 10 mm heart and a 2 mm ribbon there
 * is something to look at.
 */
export const INFINITY_HEART: NecklaceSpec = {
  dropMm: 27,
  heartHalfWidthMm: 5.2,
  // A little over 2 mm of metal across the ribbon — substantial enough to carry a
  // bright edge highlight rather than reading as wire.
  ribbonRadiusMm: 1.05,
  ribbonFlatten: 0.62,
  paveRadiusMm: 0.5,
  paveCount: 24,
  chainWireMm: 0.52,
  chainLinkMm: 3,
};

/** The original proportions, kept as the lighter option in the range. */
export const INFINITY_HEART_SLENDER: NecklaceSpec = {
  dropMm: 18.5,
  heartHalfWidthMm: 3.4,
  ribbonRadiusMm: 0.62,
  ribbonFlatten: 0.55,
  paveRadiusMm: 0.34,
  paveCount: 17,
  chainWireMm: 0.32,
  chainLinkMm: 1.9,
};

/* ------------------------------------------------------------------ */
/* Sweeping a ribbon along a curve                                     */
/* ------------------------------------------------------------------ */

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
function sweepProfile(
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
function ribbonProfile(radius: number, flatten: number, segments = 10): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new Vector2(Math.cos(a) * radius, Math.sin(a) * radius * flatten));
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* The twist                                                           */
/* ------------------------------------------------------------------ */

/**
 * One strand of the twist, as a 3D curve.
 *
 * The pendant is two strands of the same helix half a turn apart — which is what
 * a twist *is*, and why the two cross exactly once on the way down. Giving the
 * helix a Z component as well as an X one is what makes that crossing a genuine
 * over-and-under rather than two lines meeting: at the crossing the strands are
 * on opposite sides in depth, so the depth buffer sorts them correctly from any
 * viewing angle.
 *
 * The radius is not constant. It starts almost closed at the bail, widens through
 * the twist, and opens to the heart's frame radius at the bottom, where the strand
 * stops descending and sweeps around the stone instead. That two-part shape — a
 * twist above, a cradle below — is the design.
 *
 * @param phase 0 for the plain strand, π for the pavé one.
 */
function strandCurve(spec: NecklaceSpec, phase: number): CatmullRomCurve3 {
  const points: Vector3[] = [];
  const TWIST_END = 0.52; // where the descent gives way to the cradle
  const TURNS = 0.78;
  const frameRadius = spec.heartHalfWidthMm * 1.28;
  const topRadius = spec.ribbonRadiusMm * 1.5;
  const steps = 26;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    if (t <= TWIST_END) {
      const u = t / TWIST_END;
      const angle = phase + u * Math.PI * 2 * TURNS;
      // Ease the radius open so the strands leave the bail almost touching.
      const radius = topRadius + (frameRadius - topRadius) * smoothstep(0.1, 1, u);
      points.push(
        new Vector3(
          Math.sin(angle) * radius,
          -spec.dropMm * 0.5 * u,
          Math.cos(angle) * radius * 0.42,
        ),
      );
    } else {
      // The cradle: an arc around the heart's centre, continuing from wherever
      // the twist left this strand so the two pieces meet tangentially.
      const u = (t - TWIST_END) / (1 - TWIST_END);
      const startAngle = phase + Math.PI * 2 * TURNS;
      const angle = startAngle + u * Math.PI * 1.02;
      const heartY = -spec.dropMm * 0.74;
      points.push(
        new Vector3(
          Math.sin(angle) * frameRadius,
          heartY - Math.cos(angle) * frameRadius * 0.98 - spec.dropMm * 0.02,
          Math.cos(angle * 0.5) * frameRadius * 0.2,
        ),
      );
    }
  }

  return new CatmullRomCurve3(points, false, "centripetal");
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export type Placement = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export type NecklaceGeometry = {
  /** Polished ribbon: the plain strand, the bail and the prongs. */
  polished: BufferGeometry;
  /** The strand that carries the pavé, kept separate only for clarity. */
  paveRail: BufferGeometry;
  /** The heart stone, at its own transform. */
  heart: { geometry: BufferGeometry; position: [number, number, number] };
  /** Small round accents set along the pavé strand. */
  pave: Placement[];
  /** Claws holding the heart. */
  prongs: Placement[];
  /** Where the chain threads through, in local millimetres. */
  bailPosition: [number, number, number];
};

export function buildNecklaceGeometry(spec: NecklaceSpec = INFINITY_HEART): NecklaceGeometry {
  const profile = ribbonProfile(spec.ribbonRadiusMm, spec.ribbonFlatten);

  const plainCurve = strandCurve(spec, 0);
  const paveCurve = strandCurve(spec, Math.PI);

  const plain = sweepProfile(plainCurve, profile, 150);
  const paveRail = sweepProfile(paveCurve, profile, 150);

  // Bail: a small ring at the origin for the chain to pass through, standing in
  // the XY plane so the chain runs through it across the body.
  const bail = new TorusGeometry(spec.ribbonRadiusMm * 2.4, spec.ribbonRadiusMm * 0.75, 8, 20);
  bail.rotateY(Math.PI / 2);
  bail.translate(0, spec.ribbonRadiusMm * 1.2, 0);

  const heartY = -spec.dropMm * 0.735;
  const heart = buildOutlineStone(
    heartOutline(spec.heartHalfWidthMm),
    brilliantLevels(spec.heartHalfWidthMm),
  );
  // The stone's outline is traced in the XZ plane, so it lies flat; stand it up to
  // face out of the chest, which is where a pendant presents its stone.
  heart.rotateX(-Math.PI / 2);

  // Pavé, spaced along the arc length of its strand so the stones sit evenly
  // however sharply the curve bends — spacing by parameter instead would bunch
  // them up through the tight part of the twist.
  const pave: Placement[] = [];
  const seat = spec.ribbonRadiusMm * spec.ribbonFlatten * 0.45;
  for (let i = 0; i < spec.paveCount; i++) {
    const t = (i + 0.5) / spec.paveCount;
    const point = paveCurve.getPointAt(t);
    const tangent = paveCurve.getTangentAt(t);
    // Set the stone into the strand's outward face.
    const outward = new Vector3(point.x, 0, point.z).normalize();
    if (outward.lengthSq() < 0.5) outward.set(0, 0, 1);
    pave.push({
      position: [
        point.x + outward.x * seat,
        point.y,
        point.z + outward.z * seat + spec.paveRadiusMm * 0.35,
      ],
      rotation: [Math.atan2(tangent.y, tangent.z) * 0.2, 0, 0],
      scale: spec.paveRadiusMm,
    });
  }

  // Four claws on the heart: one at the point, one in the cleft, one per lobe.
  const hw = spec.heartHalfWidthMm;
  const prongs: Placement[] = [
    { position: [0, heartY - hw * 1.05, 0], rotation: [0, 0, 0], scale: hw * 0.13 },
    { position: [0, heartY + hw * 0.92, 0], rotation: [0, 0, 0], scale: hw * 0.12 },
    { position: [-hw * 0.94, heartY + hw * 0.3, 0], rotation: [0, 0, 0.4], scale: hw * 0.13 },
    { position: [hw * 0.94, heartY + hw * 0.3, 0], rotation: [0, 0, -0.4], scale: hw * 0.13 },
  ];

  return {
    polished: mergeInto([plain, bail]),
    paveRail,
    heart: { geometry: heart, position: [0, heartY, spec.heartHalfWidthMm * 0.1] },
    pave,
    prongs,
    bailPosition: [0, spec.ribbonRadiusMm * 1.2, 0],
  };
}

/** Concatenates geometries that already share a material. */
function mergeInto(parts: BufferGeometry[]): BufferGeometry {
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

/* ------------------------------------------------------------------ */
/* The chain                                                           */
/* ------------------------------------------------------------------ */

/**
 * Where each link of the chain sits, in the neck's local frame.
 *
 * A chain is not a rigid body, so there is no transform to solve for it — it
 * hangs. The curve it hangs on is close to a catenary, but a catenary in free
 * space is the wrong shape here: the chain is draped over a neck, so its upper
 * run is held out at the neck's radius and only the front dips freely. This
 * blends the two — an arc around the neck at the back, easing into a free hang at
 * the front, which is what puts the pendant at the sternum rather than the chin.
 *
 * Links alternate a quarter turn, as a real cable chain does; without that they
 * read as a smooth tube rather than a chain.
 *
 * @param neckRadius Radius of the neck, in the same units as the output.
 * @param drop       How far below the neck's base the lowest link hangs.
 */
export function chainLinkPlacements(
  neckRadius: number,
  drop: number,
  linkLengthMm: number,
  scaleMmToUnits: number,
): Placement[] {
  const linkLength = linkLengthMm * scaleMmToUnits;
  // Links overlap by about a third, which is what makes a cable chain look
  // continuous rather than like beads on a string.
  const step = linkLength * 0.62;

  const points: Vector3[] = [];
  const SAMPLES = 220;
  for (let i = 0; i <= SAMPLES; i++) {
    // Angle around the neck: 0 at the front, ±π at the nape.
    const t = (i / SAMPLES) * 2 - 1; // -1 .. 1
    const angle = t * Math.PI;

    // Around the neck.
    const x = Math.sin(angle) * neckRadius;
    const z = Math.cos(angle) * neckRadius * 0.78;

    // The free hang, strongest at the front and gone by the nape. cos⁴ falls off
    // fast enough that the chain is flat against the neck at the sides.
    const front = Math.max(0, Math.cos(angle));
    const y = -drop * Math.pow(front, 1.7);

    points.push(new Vector3(x, y, z));
  }

  const curve = new CatmullRomCurve3(points, false, "centripetal");
  const total = curve.getLength();
  const linkCount = Math.max(8, Math.floor(total / step));

  const placements: Placement[] = [];
  const tangent = new Vector3();
  for (let i = 0; i < linkCount; i++) {
    const t = (i + 0.5) / linkCount;
    const point = curve.getPointAt(t);
    curve.getTangentAt(t, tangent);
    placements.push({
      position: [point.x, point.y, point.z],
      // Aim the link along the chain, then alternate a quarter turn about that
      // same direction so consecutive links interlock.
      rotation: [
        Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z)),
        Math.atan2(tangent.x, tangent.z),
        i % 2 === 0 ? 0 : Math.PI / 2,
      ],
      scale: 1,
    });
  }
  return placements;
}

/** A single cable-chain link: a torus, elongated along its own axis. */
export function buildChainLink(spec: NecklaceSpec): BufferGeometry {
  const geometry = new TorusGeometry(spec.chainLinkMm * 0.5, spec.chainWireMm, 6, 16);
  // Stretch into the oval a drawn cable link actually is, and stand it up so its
  // hole runs along the chain's direction.
  geometry.scale(1, 0.62, 1);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}
