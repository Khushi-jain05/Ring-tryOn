"use client";

import type { MetalId } from "@/lib/rings/types";
import type { ADSpec } from "@/lib/jewellery/americanDiamond";
import type { RenderQuality } from "./Ring3D";
import { ADCollar3D } from "./ADCollar3D";

/**
 * The necklace, authored in millimetres with the neck's axis at the origin.
 *
 * A thin wrapper now that the range holds one design. It is kept because it is the
 * seam the tracked renderer talks to — that code should not need to know which kind
 * of necklace it is drawing, and a collar's geometry depends on the wearer's neck
 * in a way a pendant's would not.
 */
export function Necklace3D({
  metal,
  quality = "showcase",
  neckRadiusMm,
  spec,
}: {
  metal: MetalId;
  quality?: RenderQuality;
  /** Radius of the wearer's neck, in millimetres. */
  neckRadiusMm: number;
  spec: ADSpec;
}) {
  return (
    <ADCollar3D
      spec={spec}
      neckRadiusMm={neckRadiusMm}
      metal={metal}
      quality={quality}
    />
  );
}
