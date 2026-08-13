import { CatmullRomCurve3, Vector3 } from "three";

/**
 * A multi-strand pearl choker with a drop pearl, as in the reference photograph.
 *
 * Structurally the opposite of a pendant necklace, and it is worth being explicit
 * about why, because the placement code has to treat them differently. A pendant
 * hangs: the chain is incidental and the piece is defined by how far it falls. A
 * choker *sits*: the strands hug the base of the neck and barely fall at all, so
 * what defines it is the neck's own circumference. Feeding a choker through
 * pendant-length placement puts it somewhere around the sternum, which is not a
 * choker.
 *
 * All dimensions in millimetres.
 */
export type PearlSpec = {
  /** How many strands. Two, in the reference. */
  strands: number;
  /** Diameter of the largest pearl, at the front centre. */
  pearlMm: number;
  /**
   * How much smaller the pearls get toward the nape, as a fraction of the front
   * pearl. Graduated strands are the norm on a real strand: it keeps the weight
   * off the back of the neck and puts the largest pearls where they are seen.
   */
  gradation: number;
  /** Radial and vertical separation between consecutive strands. */
  strandGapMm: number;
  /** Diameter of the pearl hanging at the front. */
  dropPearlMm: number;
  /** How far the drop hangs below the lowest strand. */
  dropOffsetMm: number;
  /** Extra dip at the front of each strand, beyond hugging the neck. */
  frontDipMm: number;
};

export const PEARL_CHOKER: PearlSpec = {
  strands: 2,
  // A 5 mm akoya is the classic choker pearl; the reference reads about this size
  // against the wearer's neck.
  pearlMm: 5.2,
  gradation: 0.78,
  strandGapMm: 5.6,
  dropPearlMm: 7.4,
  dropOffsetMm: 4.2,
  frontDipMm: 9,
};

export type PearlPlacement = {
  position: [number, number, number];
  /** Radius of this pearl, already graduated. */
  radius: number;
};

/**
 * Lays the pearls of one strand around the neck.
 *
 * The curve is a flattened ellipse around the neck with a shallow dip at the
 * front — the shape a strand actually takes when it is short enough to rest on the
 * collarbones rather than hang from them. Pearls are then stepped along it by arc
 * length so they touch; spacing by angle instead would leave gaps at the front,
 * where the curve is longest per degree.
 *
 * @param neckRadiusMm Radius of the wearer's neck.
 * @param strandIndex  0 for the innermost strand.
 */
export function pearlStrand(
  spec: PearlSpec,
  neckRadiusMm: number,
  strandIndex: number,
): PearlPlacement[] {
  // Each strand outside the first sits a little lower and a little wider, so the
  // strands lie against each other instead of intersecting.
  const radius = neckRadiusMm + strandIndex * spec.strandGapMm * 0.34;
  const dip = spec.frontDipMm + strandIndex * spec.strandGapMm;

  const points: Vector3[] = [];
  const SAMPLES = 200;
  for (let i = 0; i <= SAMPLES; i++) {
    const angle = ((i / SAMPLES) * 2 - 1) * Math.PI;
    const front = Math.max(0, Math.cos(angle));
    points.push(
      new Vector3(
        Math.sin(angle) * radius,
        // A choker's dip is gentle and confined to the front; the sides sit level
        // on the collarbones.
        -dip * Math.pow(front, 2.1),
        Math.cos(angle) * radius * 0.78,
      ),
    );
  }

  const curve = new CatmullRomCurve3(points, false, "centripetal");
  const total = curve.getLength();

  // Pearls at the front are full size and shrink toward the nape, so the average
  // is what sets the count.
  const averageDiameter = spec.pearlMm * (1 + spec.gradation) / 2;
  const count = Math.max(12, Math.round(total / (averageDiameter * 0.97)));

  const placements: PearlPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const point = curve.getPointAt(t);
    // t runs nape → front → nape, so distance from the middle is distance from the
    // front centre.
    const fromFront = Math.abs(t - 0.5) * 2;
    const diameter = spec.pearlMm * (1 - (1 - spec.gradation) * fromFront);
    placements.push({
      position: [point.x, point.y, point.z],
      radius: diameter / 2,
    });
  }
  return placements;
}

export type PearlNecklaceGeometry = {
  strands: PearlPlacement[][];
  /** The single larger pearl hanging at the front. */
  drop: PearlPlacement;
  /** Where the drop's bail meets the lowest strand. */
  bail: { position: [number, number, number]; radius: number; height: number };
};

export function buildPearlNecklace(
  spec: PearlSpec,
  neckRadiusMm: number,
): PearlNecklaceGeometry {
  const strands = Array.from({ length: spec.strands }, (_, i) =>
    pearlStrand(spec, neckRadiusMm, i),
  );

  // The drop hangs from the lowest strand's front centre. That is the pearl
  // nearest t = 0.5, which is the middle of the array by construction.
  const lowest = strands[strands.length - 1];
  const centre = lowest[Math.floor(lowest.length / 2)];
  const dropRadius = spec.dropPearlMm / 2;
  const dropY = centre.position[1] - centre.radius - spec.dropOffsetMm - dropRadius;

  return {
    strands,
    drop: {
      position: [0, dropY, centre.position[2]],
      radius: dropRadius,
    },
    bail: {
      position: [0, (centre.position[1] - centre.radius + dropY + dropRadius) / 2, centre.position[2]],
      radius: dropRadius * 0.16,
      height: Math.max(0.5, centre.position[1] - centre.radius - (dropY + dropRadius)),
    },
  };
}

/**
 * How far a choker's lowest strand falls below the neck anchor, in neck radii.
 *
 * Used as the anchor's drop factor so the placement code does not need to know
 * anything about pearls — it just gets a much smaller number than a pendant would
 * supply, which is exactly the difference between a choker and a princess-length
 * chain.
 */
export function chokerDropFactor(spec: PearlSpec, neckRadiusMm: number): number {
  const lowestDip = spec.frontDipMm + (spec.strands - 1) * spec.strandGapMm;
  return (lowestDip + spec.dropOffsetMm + spec.dropPearlMm) / neckRadiusMm;
}
