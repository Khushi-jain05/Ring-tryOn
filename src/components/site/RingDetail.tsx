"use client";

import Link from "next/link";
import { useState } from "react";
import { METALS } from "@/lib/rings/catalog";
import type { MetalId, Ring } from "@/lib/rings/types";
import { RingViewer } from "@/components/three/RingViewer";
import { RingGallery } from "@/components/three/RingGallery";
import { RingCard } from "./RingCard";

export function RingDetail({
  ring,
  specs,
  related,
}: {
  ring: Ring;
  specs: [string, string][];
  related: Ring[];
}) {
  const [metal, setMetal] = useState<MetalId>(ring.metals[0]);

  return (
    <>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl bg-surface-muted">
          <RingViewer ring={ring} metal={metal} className="aspect-square w-full" />
          <p className="pb-4 text-center text-xs text-muted">
            Drag to rotate · Scroll to zoom
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-accent">{ring.collection}</p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">{ring.name}</h1>
          <p className="mt-5 text-sm leading-relaxed text-muted">{ring.description}</p>

          <div className="mt-8">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">
              Metal — {METALS[metal].label}
            </p>
            <div className="flex flex-wrap gap-2">
              {ring.metals.map((id) => {
                const spec = METALS[id];
                const active = id === metal;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMetal(id)}
                    aria-label={spec.label}
                    aria-pressed={active}
                    className={`size-9 rounded-full ring-offset-2 ring-offset-background transition ${
                      active ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-muted"
                    }`}
                    style={{
                      background: `linear-gradient(140deg, ${spec.swatch[0]}, ${spec.swatch[1]})`,
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href={`/try-on?ring=${ring.id}&metal=${metal}`}
              className="flex-1 rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-accent-contrast transition hover:brightness-105"
            >
              Try it on your hand
            </Link>
            <Link
              href="/size-guide"
              className="rounded-full border border-line px-6 py-3.5 text-sm font-medium transition hover:border-muted"
            >
              Size guide
            </Link>
          </div>

          <dl className="mt-10 divide-y divide-line border-y border-line text-sm">
            {specs.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-3">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-20">
          <div className="rule mb-12" />
          <h2 className="font-display text-3xl">You might also like</h2>
          <RingGallery>
            <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <RingCard key={r.id} ring={r} />
              ))}
            </div>
          </RingGallery>
        </section>
      )}
    </>
  );
}
