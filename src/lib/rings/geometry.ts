import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GemCut, RingDesign } from "./types";

/**
 * All ring geometry is authored in "finger radius = 1" units. The pose solver
 * measures the finger every frame and scales the whole group, so nothing here
 * needs to know about millimetres, ring sizes, or camera distance.
 */

const BAND_SEGMENTS = 128;
const GEM_SEGMENTS = 16;

/**
 * A surface of revolution about the finger axis.
 *
 * Winding matters: `LatheGeometry` emits an outward-facing normal when the
 * profile is traversed so that the outer wall runs in +y. Feeding the profile
 * in the wrong order gives a ring lit entirely from the inside, which reads as
 * a flat grey band no matter how good the material is.
 */
function revolve(profile: Vector2[], segments = BAND_SEGMENTS): BufferGeometry {
  const geometry = new LatheGeometry(profile, segments);
  // Lathe revolves around +Y; the solver's band axis is local +Z.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Rounds a corner of the band cross-section into `steps` points. */
function arcPoints(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  steps: number,
): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    points.push(new Vector2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
  }
  return points;
}

const CORNER_STEPS = 6;

/**
 * A rounded-rectangle cross-section, traversed as one clean closed loop:
 * bottom face outward, up the outside, top face inward, down the inside.
 *
 * That order is not arbitrary — `LatheGeometry` derives its normals from the
 * direction of travel, so reversing it lights the band from the inside and it
 * renders as a flat grey tube.
 *
 * The previous version generated a circular arc and then clamped it back inside
 * the band's bounds. Clamping collapsed runs of points onto the same coordinate,
 * which produces zero-area triangles; `computeVertexNormals` then averages
 * garbage normals into their neighbours, and the band picks up dark faceted
 * patches — worst on the arc furthest from the light, which is the part behind
 * the finger.
 */
function roundedProfile(
  inner: number,
  outer: number,
  half: number,
  outerCorner: number,
  innerCorner: number,
): Vector2[] {
  const thickness = outer - inner;
  // A corner cannot be deeper than the band is thick, nor wider than it is wide.
  const limit = Math.min(thickness, half) * 0.98;
  const ro = Math.max(0, Math.min(outerCorner, limit));
  const ri = Math.max(0, Math.min(innerCorner, limit));

  return dedupe([
    new Vector2(inner + ri, -half),
    new Vector2(outer - ro, -half),
    ...arcPoints(outer - ro, -half + ro, ro, -Math.PI / 2, 0, CORNER_STEPS),
    ...arcPoints(outer - ro, half - ro, ro, 0, Math.PI / 2, CORNER_STEPS),
    new Vector2(inner + ri, half),
    ...arcPoints(inner + ri, half - ri, ri, Math.PI / 2, Math.PI, CORNER_STEPS),
    ...arcPoints(inner + ri, -half + ri, ri, Math.PI, (3 * Math.PI) / 2, CORNER_STEPS),
    new Vector2(inner + ri, -half),
  ]);
}

/**
 * Drops points that repeat their predecessor.
 *
 * Each corner arc starts exactly where the preceding straight run ended, so a
 * naive concatenation leaves a duplicate at every join. `LatheGeometry` revolves
 * those into whole rings of zero-area triangles, and the garbage normals they
 * contribute get averaged into their neighbours by `computeVertexNormals` —
 * which is what put dark faceted patches on the band. The closing point is kept
 * deliberately: that is the segment that seals the loop.
 */
function dedupe(points: Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/**
 * The band's cross-section, in (radius, axial) coordinates.
 *
 * Profile is what separates a convincing ring from a torus: a comfort-fit band
 * is domed outside and rounded inside, a knife-edge peaks at the centreline,
 * and a flat band is square with just enough chamfer to catch a highlight.
 */
function bandProfile(design: RingDesign): Vector2[] {
  const inner = design.bandInnerScale;
  const outer = inner + design.bandThickness;
  const half = design.bandWidth / 2;

  switch (design.profile) {
    case "knife": {
      return [
        new Vector2(inner, -half),
        new Vector2(outer, 0),
        new Vector2(inner, half),
        new Vector2(inner, -half),
      ];
    }
    case "flat": {
      // Square, with just enough chamfer to catch a highlight along each edge.
      const c = Math.min(design.bandThickness, half) * 0.18;
      return roundedProfile(inner, outer, half, c, c * 0.7);
    }
    case "comfort":
    case "twist":
    default: {
      // Domed outside, gently rounded inside — the shape you can wear all day.
      return roundedProfile(
        inner,
        outer,
        half,
        design.bandThickness * 0.55,
        design.bandThickness * 0.3,
      );
    }
  }
}

/** How far each strand winds in and out radially, as a fraction of its own radius. */
const TWIST_WOBBLE = 0.35;

/** Two shanks wound around each other, used by the Helix design. */
function twistedBand(design: RingDesign): BufferGeometry {
  const tube = design.bandThickness / 2;
  /**
   * Centreline radius of a strand at the *inward* end of its wind.
   *
   * The wobble has to be accounted for here or it eats into the bore. Placing the
   * centreline at `bandInnerScale + tube` puts a *non-wobbling* tube's inner surface
   * exactly on the bore — but each strand then winds a further `TWIST_WOBBLE * tube`
   * inward of that, and this ring's bore came out at 0.967 instead of 1.0.
   *
   * Every other ring in the catalogue presents a bore of exactly 1.0, and all of the
   * placement is expressed in multiples of it — so this one alone was being fitted
   * 3% tighter than the rest, biting into the finger. Nothing looks wrong about the
   * ring on its own; the fault is only visible by comparison, which is why the
   * catalogue-wide bore check exists.
   *
   * A real twisted band's bore *is* the innermost point of the winding, so lifting
   * the base radius by the wobble is also the physically correct construction.
   */
  const inner = design.bandInnerScale + tube + tube * TWIST_WOBBLE;
  const amplitude = design.bandWidth / 2.4;
  const turns = 5;

  const strand = (phase: number) => {
    const points: Vector3[] = [];
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const wobble = Math.sin(t * turns + phase);
      points.push(
        new Vector3(
          Math.cos(t) * (inner + wobble * tube * TWIST_WOBBLE),
          Math.sin(t) * (inner + wobble * tube * TWIST_WOBBLE),
          Math.cos(t * turns + phase) * amplitude,
        ),
      );
    }
    const curve = new CatmullRomCurve3(points, true, "centripetal");
    return new TubeGeometry(curve, 220, tube, 12, true);
  };

  return mergeGeometries([strand(0), strand(Math.PI)], false) ?? strand(0);
}

export function createBandGeometry(design: RingDesign): BufferGeometry {
  if (design.profile === "twist") return twistedBand(design);
  return revolve(bandProfile(design));
}

/* ------------------------------------------------------------------------- */
/* Gemstones                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Brilliant-cut silhouette in profile: table on top, a short girdle at the
 * waist, and a pavilion tapering to the culet. Revolved at a low segment count
 * and rendered with flat shading, the facets fall out for free.
 */
function brilliantProfile(): Vector2[] {
  const table = 0.53;
  const crown = 0.3;
  const girdle = 0.06;
  const pavilion = 0.82;
  return [
    new Vector2(0, crown + girdle / 2),
    new Vector2(table, crown + girdle / 2),
    new Vector2(1, girdle / 2),
    new Vector2(1, -girdle / 2),
    new Vector2(0, -girdle / 2 - pavilion),
  ];
}

/** Step cuts trade sparkle for broad flashes — emerald and princess stones. */
function stepProfile(): Vector2[] {
  const table = 0.74;
  const crown = 0.2;
  const girdle = 0.08;
  const pavilion = 0.66;
  return [
    new Vector2(0, crown + girdle / 2),
    new Vector2(table, crown + girdle / 2),
    new Vector2(0.93, girdle / 2),
    new Vector2(1, girdle / 2),
    new Vector2(1, -girdle / 2),
    new Vector2(0.55, -girdle / 2 - pavilion * 0.7),
    new Vector2(0.18, -girdle / 2 - pavilion),
    new Vector2(0, -girdle / 2 - pavilion),
  ];
}

/**
 * Squeezes a revolved stone into a fancy shape.
 *
 * Fancy cuts are not surfaces of revolution, so rather than model each one we
 * revolve the correct *profile* and then reshape the girdle outline. `taper`
 * pulls one end to a point (pear), `pinch` pulls both (marquise).
 */
function shapeGirdle(
  geometry: BufferGeometry,
  scaleX: number,
  scaleZ: number,
  mode: "none" | "taper" | "pinch",
): BufferGeometry {
  const position = geometry.attributes.position;
  const array = position.array as Float32Array;

  for (let i = 0; i < array.length; i += 3) {
    const x = array[i];
    let z = array[i + 2];

    if (mode !== "none") {
      // Normalised position along the long axis, before stretching.
      const t = (x + 1) / 2;
      const factor =
        mode === "taper"
          ? 1 - Math.pow(Math.max(0, (t - 0.35) / 0.65), 1.6)
          : Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      z *= Math.max(0.04, factor);
    }

    array[i] = x * scaleX;
    array[i + 2] = z * scaleZ;
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

const CUT_SPECS: Record<
  GemCut,
  { segments: number; scaleX: number; scaleZ: number; mode: "none" | "taper" | "pinch"; step: boolean; spin: number }
> = {
  round: { segments: GEM_SEGMENTS, scaleX: 1, scaleZ: 1, mode: "none", step: false, spin: 0 },
  oval: { segments: GEM_SEGMENTS, scaleX: 1.34, scaleZ: 0.78, mode: "none", step: false, spin: 0 },
  pear: { segments: GEM_SEGMENTS, scaleX: 1.4, scaleZ: 0.84, mode: "taper", step: false, spin: 0 },
  marquise: { segments: GEM_SEGMENTS, scaleX: 1.7, scaleZ: 0.92, mode: "pinch", step: false, spin: 0 },
  princess: { segments: 4, scaleX: 1, scaleZ: 1, mode: "none", step: true, spin: Math.PI / 4 },
  emerald: { segments: 8, scaleX: 1.24, scaleZ: 0.86, mode: "none", step: true, spin: Math.PI / 8 },
};

/**
 * A stone with its girdle in the XZ plane and its table facing +Y, sized so the
 * girdle radius is 1.
 */
export function createGemGeometry(cut: GemCut): BufferGeometry {
  const spec = CUT_SPECS[cut];
  const profile = spec.step ? stepProfile() : brilliantProfile();
  const geometry = new LatheGeometry(profile, spec.segments);

  // Square and rectangular cuts need a corner, not a flat, facing forward.
  if (spec.spin) geometry.rotateY(spec.spin);

  // Step cuts revolve as inscribed polygons; push them back out to full width.
  if (spec.step) {
    const inflate = 1 / Math.cos(Math.PI / spec.segments);
    geometry.scale(inflate, 1, inflate);
  }

  return shapeGirdle(geometry, spec.scaleX, spec.scaleZ, spec.mode);
}

/** Bounding half-height of a stone below its girdle, for setting it into a head. */
export function gemPavilionDepth(cut: GemCut): number {
  return CUT_SPECS[cut].step ? 0.74 : 0.85;
}

/* ------------------------------------------------------------------------- */
/* Settings                                                                    */
/* ------------------------------------------------------------------------- */

export type Placement = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

/**
 * Claws around the centre stone. They lean inward so their tips close over the
 * crown rather than standing off it like fence posts.
 */
export function prongPlacements(design: RingDesign, count: number): Placement[] {
  const gemRadius = design.gemSize;
  const seat = design.bandInnerScale + design.bandThickness + gemRadius * 0.55;
  const out: Placement[] = [];

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    out.push({
      position: [Math.cos(a) * gemRadius * 0.92, seat, Math.sin(a) * gemRadius * 0.92],
      rotation: [Math.sin(a) * 0.18, -a, -Math.cos(a) * 0.18],
      scale: gemRadius * 0.16,
    });
  }
  return out;
}

/** Accent stones ringing the centre stone. */
export function haloPlacements(design: RingDesign): Placement[] {
  const count = Math.max(6, design.accentCount);
  const radius = design.gemSize * 1.42;
  const y = design.bandInnerScale + design.bandThickness + design.gemSize * 0.28;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return {
      position: [Math.cos(a) * radius, y, Math.sin(a) * radius] as [number, number, number],
      rotation: [0, -a, 0] as [number, number, number],
      scale: design.gemSize * 0.2,
    };
  });
}

/** Accents running around the full circumference of the band. */
export function eternityPlacements(design: RingDesign): Placement[] {
  const count = Math.max(8, design.accentCount);
  const radius = design.bandInnerScale + design.bandThickness * 0.96;
  const stone = (Math.PI * 2 * radius) / count / 2.35;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return {
      position: [Math.cos(a) * radius, Math.sin(a) * radius, 0] as [number, number, number],
      rotation: [0, 0, a - Math.PI / 2] as [number, number, number],
      scale: stone,
    };
  });
}

/** Accents along the shoulders only, fading out toward the palm. */
export function pavePlacements(design: RingDesign): Placement[] {
  const count = Math.max(6, design.accentCount);
  const radius = design.bandInnerScale + design.bandThickness * 0.92;
  const stone = (Math.PI * 2 * radius) / (count * 1.9) / 2.2;
  const arc = Math.PI * 1.15;

  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const a = Math.PI / 2 - arc / 2 + arc * t;
    const lane = i % 2 === 0 ? 1 : -1;
    return {
      position: [
        Math.cos(a) * radius,
        Math.sin(a) * radius,
        lane * design.bandWidth * 0.22,
      ] as [number, number, number],
      rotation: [0, 0, a - Math.PI / 2] as [number, number, number],
      scale: stone,
    };
  });
}

/** Two tapered side stones, as used in three-stone settings. */
export function sideStonePlacements(design: RingDesign): Placement[] {
  const y = design.bandInnerScale + design.bandThickness + design.gemSize * 0.18;
  const x = design.gemSize * 1.5;
  return [1, -1].map((dir) => ({
    position: [dir * x, y, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: design.gemSize * 0.52,
  }));
}

/** The head: the metal cup a solitaire sits in, bridging stone to shank. */
export function createHeadGeometry(design: RingDesign): BufferGeometry {
  const top = design.gemSize * 0.86;
  const bottom = design.gemSize * 0.34;
  const height = design.gemSize * 0.72;
  const geometry = new CylinderGeometry(top, bottom, height, 24, 1, true);
  geometry.translate(
    0,
    design.bandInnerScale + design.bandThickness + height / 2 - design.gemSize * 0.06,
    0,
  );
  return geometry;
}

/** A single claw, modelled once and instanced at every prong placement. */
export function createProngGeometry(): BufferGeometry {
  const geometry = new SphereGeometry(1, 12, 10);
  geometry.scale(1, 2.6, 1);
  return geometry;
}
