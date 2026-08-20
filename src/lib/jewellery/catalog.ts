import type { GemId, MetalId } from "@/lib/rings/types";
import { AD_COLLAR, collarDropFactor, type ADSpec } from "./americanDiamond";

/**
 * Necklaces. Kept apart from the ring catalogue because the two are tracked by
 * different models and sized against different parts of the body — a shared
 * "product" type would only paper over that.
 */
export type Necklace = {
  id: string;
  name: string;
  collection: string;
  description: string;
  metals: MetalId[];
  gem: GemId;
  spec: ADSpec;
  carat?: number;
  /** Used where a single carat weight would be meaningless — a densely set
   * collar has hundreds of stones, not one. */
  stoneNote?: string;
};

/**
 * How far this piece's lowest point falls below the neck anchor, in neck radii.
 *
 * Derived from the piece rather than fixed, because length is what separates one
 * kind of necklace from another: a collar's drop is a fraction of a neck radius
 * where a princess-length chain's is a couple of whole ones. A single default would
 * place one of them badly wrong.
 */
export function dropFactorFor(necklace: Necklace, neckRadiusMm: number): number {
  return collarDropFactor(necklace.spec, neckRadiusMm);
}

/**
 * How far the piece must be lifted so the part that rests on the neck actually does.
 *
 * The solver puts the *anchor* at the base of the neck, and a piece is modelled
 * hanging from its own origin — so seating the origin on the anchor leaves the band
 * you can see hanging below it. On this collar that was 16 mm low, which is exactly
 * the amount the wearer was having to dial back by hand.
 *
 * A collar's front dip is how far its band falls below its origin, so lifting by that
 * puts the band on the neck and lets the drops hang below where they belong. In
 * millimetres, so it scales with the measured wearer rather than being a fixed nudge.
 */
export function seatOffsetMm(necklace: Necklace): number {
  return necklace.spec.frontDipMm;
}

export const NECKLACES: Necklace[] = [
  {
    id: "ad-collar",
    name: "Zohra Collar",
    collection: "American Diamond",
    description:
      "A twelve-millimetre collar set solid with American diamond — three rows of graduated round stones, seven claw-set clusters spaced along it, and nine pear drops falling from the lower edge. Bridal weight, and deliberately so: an American diamond piece is defined by how little metal it leaves showing.",
    metals: ["white-gold", "platinum", "yellow-gold", "rose-gold"],
    gem: "diamond",
    stoneNote: "≈200 stones · 4.4 mm mains · 6.2 mm pear drops",
    spec: AD_COLLAR,
  },
];

export function getNecklace(id: string): Necklace | undefined {
  return NECKLACES.find((n) => n.id === id);
}
