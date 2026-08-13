"use client";

import Link from "next/link";
import { useState } from "react";
import { METALS } from "@/lib/rings/catalog";
import type { MetalId } from "@/lib/rings/types";
import type { Necklace } from "@/lib/jewellery/catalog";
import { NecklaceViewer } from "@/components/three/NecklaceViewer";

export function NecklaceDetail({
  necklace,
  gemLabel,
  metalOrder,
}: {
  necklace: Necklace;
  gemLabel: string;
  metalOrder: MetalId[];
}) {
  const [metal, setMetal] = useState<MetalId>(necklace.metals[0]);
  const metals = metalOrder.filter((m) => necklace.metals.includes(m));

  const specs: [string, string][] =
    necklace.style.kind === "pearls"
      ? [
          ["Strands", String(necklace.style.spec.strands)],
          ["Largest pearl", `${necklace.style.spec.pearlMm.toFixed(1)} mm`],
          [
            "Graduated to",
            `${(necklace.style.spec.pearlMm * necklace.style.spec.gradation).toFixed(1)} mm at the nape`,
          ],
          ["Drop pearl", `${necklace.style.spec.dropPearlMm.toFixed(1)} mm`],
          ["Length", "Choker — sits at the base of the neck"],
        ]
      : [
          ["Pendant height", `${necklace.style.spec.dropMm.toFixed(1)} mm`],
          ["Heart width", `${(necklace.style.spec.heartHalfWidthMm * 2).toFixed(1)} mm`],
          ["Pavé stones", String(necklace.style.spec.paveCount)],
          ["Chain link", `${necklace.style.spec.chainLinkMm.toFixed(1)} mm cable`],
          ["Length", "Princess — falls to the sternum"],
        ];

  return (
    <section className="grid gap-10 lg:grid-cols-2">
      <div className="overflow-hidden rounded-3xl bg-surface-muted">
        <NecklaceViewer
          metal={metal}
          gem={necklace.gem}
          style={necklace.style}
          className="aspect-square w-full"
        />
        <p className="pb-4 text-center text-xs text-muted">
          Drag to rotate · Scroll to zoom
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-accent">
          {necklace.collection}
        </p>
        <h2 className="mt-3 font-display text-4xl">{necklace.name}</h2>
        <p className="mt-1.5 text-xs text-muted">
          {necklace.pearlNote ??
            `${gemLabel}${necklace.carat ? ` · ${necklace.carat.toFixed(2)} ct` : ""}`}
        </p>
        <p className="mt-5 text-sm leading-relaxed text-muted">{necklace.description}</p>

        <div className="mt-8">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Metal — {METALS[metal].label}
          </p>
          <div className="flex flex-wrap gap-2">
            {metals.map((id) => {
              const spec = METALS[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMetal(id)}
                  aria-label={spec.label}
                  aria-pressed={id === metal}
                  className={`size-9 rounded-full ring-offset-2 ring-offset-background transition ${
                    id === metal ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-muted"
                  }`}
                  style={{
                    background: `linear-gradient(140deg, ${spec.swatch[0]}, ${spec.swatch[1]})`,
                  }}
                />
              );
            })}
          </div>
        </div>

        <dl className="mt-10 divide-y divide-line border-y border-line text-sm">
          {specs.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-3">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>

        <Link
          href="/try-on"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3.5 text-sm font-medium text-accent-contrast transition hover:brightness-105"
        >
          See it on your neck
        </Link>
      </div>
    </section>
  );
}
