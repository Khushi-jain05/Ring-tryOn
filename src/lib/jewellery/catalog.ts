import type { GemId, MetalId } from "@/lib/rings/types";
import {
  INFINITY_HEART,
  INFINITY_HEART_SLENDER,
  type NecklaceSpec,
} from "./necklace";
import { PEARL_CHOKER, chokerDropFactor, type PearlSpec } from "./pearls";

/**
 * Necklaces. Kept apart from the ring catalogue because the two are tracked by
 * different models and sized against different parts of the body — a shared
 * "product" type would only paper over that.
 */
/**
 * A necklace is one of two structurally different things, and the difference
 * reaches all the way into placement — so it is a discriminated union rather than
 * one type with optional fields. A pendant *hangs* and is defined by how far it
 * falls; a strand *sits* and is defined by the neck's circumference.
 */
export type NecklaceStyle =
  | { kind: "pendant"; spec: NecklaceSpec }
  | { kind: "pearls"; spec: PearlSpec };

export type Necklace = {
  id: string;
  name: string;
  collection: string;
  description: string;
  metals: MetalId[];
  gem: GemId;
  style: NecklaceStyle;
  carat?: number;
  /** Pearls are strung; a carat weight would be meaningless. */
  pearlNote?: string;
};

/**
 * How far this piece's lowest point falls below the neck anchor, in neck radii.
 *
 * This is the number that makes a choker a choker. A pendant supplies its chain
 * length directly; a strand's is derived from its own dip and drop, which is a
 * small fraction of what a chain gives.
 */
export function dropFactorFor(necklace: Necklace, neckRadiusMm: number): number {
  return necklace.style.kind === "pearls"
    ? chokerDropFactor(necklace.style.spec, neckRadiusMm)
    : 2.15;
}

export const NECKLACES: Necklace[] = [
  {
    id: "pearl-choker",
    name: "Two-Strand Pearl Choker",
    collection: "Pearls",
    description:
      "Two graduated strands of white pearls sitting at the base of the neck, with a single larger pearl dropping below them. Graduated on purpose: the largest pearls sit at the front where they are seen, and the strand tapers toward the nape so the weight stays off the back of the neck.",
    metals: ["white-gold", "yellow-gold"],
    gem: "diamond",
    pearlNote: "5.2 mm graduated strands · 7.4 mm drop",
    style: { kind: "pearls", spec: PEARL_CHOKER },
  },
  {
    id: "infinity-heart",
    name: "Infinity Heart",
    collection: "Pendants",
    description:
      "A heavy ribbon of white gold twisted once on itself, opening into a frame that cradles a ten-millimetre heart-cut aquamarine. One strand is left polished and the other pavé-set with twenty-four brilliants, so the twist reads as light against light rather than as a single band. Deliberately substantial — at this scale the twist and the stone's facets are both legible at arm's length.",
    metals: ["white-gold", "platinum", "yellow-gold", "rose-gold"],
    gem: "aquamarine",
    carat: 2.4,
    style: { kind: "pendant", spec: INFINITY_HEART },
  },
  {
    id: "infinity-heart-slender",
    name: "Infinity Heart, Slender",
    collection: "Pendants",
    description:
      "The same twist drawn fine: a seven-millimetre heart on a ribbon barely a millimetre across, on a delicate cable chain. Reads as a everyday piece rather than a statement one, and disappears under a collar.",
    metals: ["white-gold", "platinum", "rose-gold"],
    gem: "aquamarine",
    carat: 0.55,
    style: { kind: "pendant", spec: INFINITY_HEART_SLENDER },
  },
];

export function getNecklace(id: string): Necklace | undefined {
  return NECKLACES.find((n) => n.id === id);
}
