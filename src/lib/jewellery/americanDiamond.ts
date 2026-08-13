import { BufferGeometry, CatmullRomCurve3, TorusGeometry, Vector3 } from "three";
import { mergeInto, ribbonProfile, sweepProfile } from "./necklace";

/**
 * A heavy American-diamond collar: a wide band of densely set colourless stones
 * following the neckline, with a cluster motif repeating along it and graduated
 * pear drops hanging from the lower edge.
 *
 * "American diamond" is cubic zirconia. Optically it is close enough to diamond
 * that it takes the same material here — colourless, high refraction, hard facets.
 * What distinguishes the *style* is not the stone but the density: an AD piece is
 * defined by covering as much metal as possible in stones, which is the opposite of
 * a solitaire's restraint and is why this design is built as rows and clusters
 * rather than as a single setting.
 *
 * Structurally it is also unlike both a pendant and a strand:
 *
 * - A pendant hangs from a chain and its length is the chain's.
 * - A strand sits on the neck and its length is the neck's circumference.
 * - A collar is a **rigid arc** covering the front of the neck, with a plain chain
 *   completing the circle at the back. It neither hangs nor drapes, so its shape
 *   comes from the neck's curve directly.
 *
 * All dimensions in millimetres. Local axes match the necklace pose frame:
 *   +X across the body    +Y up the neck    +Z out of the chest
 */

export type ADSpec = {
  /** How much of the way round the neck the decorated collar covers, in degrees. */
  collarSpanDeg: number;
  /** Vertical width of the collar band. This is what makes it read as heavy. */
  bandWidthMm: number;
  /** Radius of the wire forming the band's top and bottom rails. */
  railWireMm: number;
  /** Diameter of the stones in the band's main row, at the front. */
  mainStoneMm: number;
  /** Diameter of the smaller stones filling the rows above and below. */
  accentStoneMm: number;
  /** How many cluster motifs repeat along the collar. */
  clusterCount: number;
  /** Diameter of a cluster's centre stone. */
  clusterStoneMm: number;
  /** Petals of small stones around each cluster centre. */
  clusterPetals: number;
  /** How many pear drops hang from the lower rail. */
  dropCount: number;
  /** Width of the largest pear drop, at the centre front. */
  dropStoneMm: number;
  /** How far the collar's centre dips below the neck anchor. */
  frontDipMm: number;
  /** Plain chain closing the circle behind the neck. */
  chainWireMm: number;
  chainLinkMm: number;
};

/**
 * The heavy cut.
 *
 * A 12 mm band with three rows of stones, seven clusters and nine drops is a
 * genuinely substantial bridal-weight piece — and the weight is also what makes it
 * legible in try-on, where the whole necklace occupies a couple of hundred pixels.
 * A delicate version of this design would be invisible.
 */
export const AD_COLLAR: ADSpec = {
  collarSpanDeg: 208,
  bandWidthMm: 12,
  railWireMm: 0.95,
  mainStoneMm: 4.4,
  accentStoneMm: 2.3,
  clusterCount: 7,
  clusterStoneMm: 6.4,
  clusterPetals: 6,
  dropCount: 9,
  dropStoneMm: 6.2,
  frontDipMm: 16,
  chainWireMm: 0.55,
  chainLinkMm: 3.1,
};

export type StonePlacement = {
  position: [number, number, number];
  rotation: [number, number, number];
  /** Girdle radius in millimetres; the stone geometry is authored at radius 1. */
  scale: number;
};

/**
 * A point on the collar, with the local frame needed to lay stones on it.
 *
 * `up` is not simply world +Y: at the sides of the neck the collar turns away from
 * the camera, and offsetting rows along a fixed world axis would splay them off the
 * band there. Taking the direction perpendicular to both the curve's tangent and
 * its outward normal keeps the rows on the band all the way round.
 */
type CollarFrame = {
  point: Vector3;
  up: Vector3;
  outward: Vector3;
};

function collarFrames(
  spec: ADSpec,
  neckRadiusMm: number,
  samples: number,
): CollarFrame[] {
  const half = ((spec.collarSpanDeg / 2) * Math.PI) / 180;
  const frames: CollarFrame[] = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = -half + t * half * 2;
    const front = Math.max(0, Math.cos(angle));

    const point = new Vector3(
      Math.sin(angle) * neckRadiusMm,
      -spec.frontDipMm * Math.pow(front, 1.8),
      Math.cos(angle) * neckRadiusMm * 0.78,
    );

    // Outward from the neck's axis, in the horizontal plane.
    const outward = new Vector3(Math.sin(angle), 0, Math.cos(angle) * 0.78).normalize();
    // Along the collar.
    const tangent = new Vector3(
      Math.cos(angle) * neckRadiusMm,
      0,
      -Math.sin(angle) * neckRadiusMm * 0.78,
    ).normalize();
    const up = new Vector3().crossVectors(outward, tangent).normalize();
    // Keep it pointing up the body rather than flipping halfway round.
    if (up.y < 0) up.negate();

    frames.push({ point, up, outward });
  }
  return frames;
}

/** Curve through the collar at a given offset above or below its centre line. */
function railCurve(frames: CollarFrame[], offset: number): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    frames.map((f) => f.point.clone().addScaledVector(f.up, offset)),
    false,
    "centripetal",
  );
}

export type ADGeometry = {
  /** All the metalwork: rails, cluster collets, drop links. */
  metal: BufferGeometry;
  /** Round stones in the main row. */
  mainStones: StonePlacement[];
  /** Small round stones in the rows above and below the main one. */
  accentStones: StonePlacement[];
  /** Cluster centres and their petals, all round. */
  clusterStones: StonePlacement[];
  /** Pear drops along the lower edge. */
  drops: StonePlacement[];
  /** The plain chain closing the circle behind the neck. */
  chainAngles: { position: [number, number, number]; rotation: [number, number, number] }[];
  /** Lowest point the piece reaches, for placement checks. */
  lowestMm: number;
};

export function buildADCollar(spec: ADSpec, neckRadiusMm: number): ADGeometry {
  const frames = collarFrames(spec, neckRadiusMm, 96);
  const halfBand = spec.bandWidthMm / 2;

  // ---- metalwork -------------------------------------------------------
  const railProfile = ribbonProfile(spec.railWireMm, 0.85, 8);
  const parts: BufferGeometry[] = [
    sweepProfile(railCurve(frames, halfBand), railProfile, 140),
    sweepProfile(railCurve(frames, -halfBand), railProfile, 140),
    // A third rail down the middle, which is what the main row is set into and
    // what stops a 12 mm band reading as an empty channel between two wires.
    sweepProfile(railCurve(frames, 0), ribbonProfile(spec.railWireMm * 0.8, 0.85, 8), 140),
  ];

  const frameAt = (t: number): CollarFrame => {
    const i = Math.min(frames.length - 1, Math.max(0, Math.round(t * (frames.length - 1))));
    return frames[i];
  };

  /** How much larger an element is at the front than at the ends of the collar. */
  const graduate = (t: number, ratio: number) => {
    const fromCentre = Math.abs(t - 0.5) * 2;
    return 1 - (1 - ratio) * fromCentre;
  };

  // Stones sit proud of the metal, facing out of the chest.
  const seat = (f: CollarFrame, offset: number, lift: number) =>
    f.point.clone().addScaledVector(f.up, offset).addScaledVector(f.outward, lift);

  /**
   * Aims a stone's table along the collar's outward normal.
   *
   * The stone geometry is authored with its table facing +Y, so it is first tipped
   * forward a quarter turn and then yawed to follow the neck round. Without the yaw
   * the stones at the sides of the collar would face straight ahead while the band
   * beneath them curves away, and the setting would visibly float off the metal.
   */
  const aim = (f: CollarFrame): [number, number, number] => [
    -Math.PI / 2,
    Math.atan2(f.outward.x, f.outward.z),
    0,
  ];

  // ---- main row --------------------------------------------------------
  const mainStones: StonePlacement[] = [];
  const mainRadius = spec.mainStoneMm / 2;
  const mainCount = Math.round((neckRadiusMm * 3.4) / spec.mainStoneMm);
  for (let i = 0; i < mainCount; i++) {
    const t = (i + 0.5) / mainCount;
    const f = frameAt(t);
    const scale = mainRadius * graduate(t, 0.72);
    mainStones.push({
      position: seat(f, 0, scale * 0.55).toArray() as [number, number, number],
      rotation: aim(f),
      scale,
    });
  }

  // ---- accent rows -----------------------------------------------------
  const accentStones: StonePlacement[] = [];
  const accentRadius = spec.accentStoneMm / 2;
  const accentCount = Math.round((neckRadiusMm * 3.4) / spec.accentStoneMm);
  for (const row of [1, -1]) {
    const offset = row * (halfBand - accentRadius - spec.railWireMm * 0.6);
    for (let i = 0; i < accentCount; i++) {
      const t = (i + 0.5) / accentCount;
      const f = frameAt(t);
      const scale = accentRadius * graduate(t, 0.8);
      accentStones.push({
        position: seat(f, offset, scale * 0.5).toArray() as [number, number, number],
        rotation: aim(f),
        scale,
      });
    }
  }

  // ---- cluster motifs --------------------------------------------------
  const clusterStones: StonePlacement[] = [];
  const clusterRadius = spec.clusterStoneMm / 2;
  for (let c = 0; c < spec.clusterCount; c++) {
    const t = (c + 0.5) / spec.clusterCount;
    const f = frameAt(t);
    const centreScale = clusterRadius * graduate(t, 0.68);

    clusterStones.push({
      position: seat(f, 0, centreScale * 0.8).toArray() as [number, number, number],
      rotation: aim(f),
      scale: centreScale,
    });

    // Petals ringing the centre, in the band's own plane.
    const petalScale = centreScale * 0.42;
    const ring = centreScale + petalScale * 1.02;
    const along = new Vector3().crossVectors(f.up, f.outward).normalize();
    for (let p = 0; p < spec.clusterPetals; p++) {
      const a = (p / spec.clusterPetals) * Math.PI * 2;
      const position = seat(f, 0, centreScale * 0.55)
        .addScaledVector(along, Math.cos(a) * ring)
        .addScaledVector(f.up, Math.sin(a) * ring);
      clusterStones.push({
        position: position.toArray() as [number, number, number],
        rotation: aim(f),
        scale: petalScale,
      });
    }

    // A collet under the cluster, so it is set into the band rather than stuck on.
    const collet = new TorusGeometry(centreScale * 1.06, centreScale * 0.16, 8, 18);
    const seatPoint = seat(f, 0, centreScale * 0.42);
    collet.rotateX(Math.PI / 2);
    collet.rotateY(Math.atan2(f.outward.x, f.outward.z));
    collet.translate(seatPoint.x, seatPoint.y, seatPoint.z);
    parts.push(collet);
  }

  // ---- pear drops ------------------------------------------------------
  const drops: StonePlacement[] = [];
  let lowest = -spec.frontDipMm - halfBand;

  for (let d = 0; d < spec.dropCount; d++) {
    // Drops occupy only the middle of the collar; a drop behind the ear would be
    // resting on the shoulder.
    const t = 0.5 + ((d + 0.5) / spec.dropCount - 0.5) * 0.62;
    const f = frameAt(t);
    const width = (spec.dropStoneMm / 2) * graduate(t, 0.62);
    // Pear geometry is 1.4 long for 1 wide, point at -Z before it is stood up.
    const length = width * 1.5;

    const link = width * 0.55;
    const top = f.point.clone().addScaledVector(f.up, -halfBand);
    const centre = top
      .clone()
      .addScaledVector(f.up, -(link + length))
      .addScaledVector(f.outward, width * 0.35);

    drops.push({
      position: centre.toArray() as [number, number, number],
      // Point downward: the pear's tip goes toward the collar, its round end away.
      rotation: [-Math.PI / 2, Math.atan2(f.outward.x, f.outward.z), Math.PI],
      scale: width,
    });
    lowest = Math.min(lowest, centre.y - length);

    const jump = new TorusGeometry(link * 0.6, spec.railWireMm * 0.42, 6, 14);
    const jumpAt = top.clone().addScaledVector(f.up, -link * 0.6);
    jump.rotateY(Math.atan2(f.outward.x, f.outward.z));
    jump.translate(jumpAt.x, jumpAt.y, jumpAt.z);
    parts.push(jump);
  }

  // ---- chain behind the neck -------------------------------------------
  // The collar covers the front; a plain chain closes the circle. Without it the
  // piece reads as a floating arc rather than something fastened on.
  const half = ((spec.collarSpanDeg / 2) * Math.PI) / 180;
  const chainAngles: ADGeometry["chainAngles"] = [];
  const gap = Math.PI * 2 - half * 2;
  const linkStep = (spec.chainLinkMm * 0.62) / neckRadiusMm;
  const linkCount = Math.max(6, Math.floor(gap / linkStep));
  for (let i = 0; i < linkCount; i++) {
    const angle = half + ((i + 0.5) / linkCount) * gap;
    const position: [number, number, number] = [
      Math.sin(angle) * neckRadiusMm,
      0,
      Math.cos(angle) * neckRadiusMm * 0.78,
    ];
    chainAngles.push({
      position,
      rotation: [0, Math.atan2(Math.cos(angle), -Math.sin(angle)), i % 2 ? Math.PI / 2 : 0],
    });
  }

  return {
    metal: mergeInto(parts),
    mainStones,
    accentStones,
    clusterStones,
    drops,
    chainAngles,
    lowestMm: lowest,
  };
}

/** How far the piece's lowest point falls below the neck anchor, in neck radii. */
export function collarDropFactor(spec: ADSpec, neckRadiusMm: number): number {
  const { lowestMm } = buildADCollar(spec, neckRadiusMm);
  return Math.abs(lowestMm) / neckRadiusMm;
}
