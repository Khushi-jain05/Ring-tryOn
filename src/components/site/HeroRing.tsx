"use client";

import { useEffect, useState } from "react";
import { METALS, RINGS } from "@/lib/rings/catalog";
import { RingViewer } from "@/components/three/RingViewer";
import type { MetalId } from "@/lib/rings/types";

const HERO_RING = RINGS.find((r) => r.id === "aurora-solitaire") ?? RINGS[0];
const CYCLE: MetalId[] = ["yellow-gold", "rose-gold", "white-gold", "platinum"];

/**
 * The landing page's showpiece. It cycles metals on its own so the first thing
 * a visitor sees is the thing the site is actually for — the same ring looking
 * materially different — without them having to touch anything.
 */
export function HeroRing() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % CYCLE.length), 3600);
    return () => clearInterval(id);
  }, []);

  const metal = CYCLE[index];

  return (
    <div className="relative h-full min-h-[320px] w-full">
      <RingViewer ring={HERO_RING} metal={metal} className="h-full min-h-[320px] w-full" />

      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
        <p className="font-display text-lg">{HERO_RING.name}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">
          {METALS[metal].label}
        </p>
        <div className="mt-3 flex justify-center gap-1.5">
          {CYCLE.map((id, i) => (
            <span
              key={id}
              className={`h-0.5 w-6 rounded-full transition-colors ${
                i === index ? "bg-accent" : "bg-line"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
