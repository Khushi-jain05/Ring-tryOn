import type { GemId, MetalId } from "@/lib/rings/types";
import { INFINITY_HEART, type NecklaceSpec } from "./necklace";

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
  spec: NecklaceSpec;
  carat?: number;
};

export const NECKLACES: Necklace[] = [
  {
    id: "infinity-heart",
    name: "Infinity Heart",
    collection: "Pendants",
    description:
      "A ribbon of white gold twisted once on itself, opening into a frame that cradles a heart-cut aquamarine. One strand is left polished and the other pavé-set with seventeen brilliants, so the twist reads as light against light rather than as a single band.",
    metals: ["white-gold", "platinum", "yellow-gold", "rose-gold"],
    gem: "aquamarine",
    carat: 0.55,
    spec: INFINITY_HEART,
  },
];

export function getNecklace(id: string): Necklace | undefined {
  return NECKLACES.find((n) => n.id === id);
}
