"use client";

import Link from "next/link";
import { useState } from "react";
import { GEMS, METALS } from "@/lib/rings/catalog";
import type { MetalId, Ring } from "@/lib/rings/types";
import { RingThumb } from "@/components/three/RingGallery";

export function RingCard({ ring, priority = false }: { ring: Ring; priority?: boolean }) {
  const [metal, setMetal] = useState<MetalId>(ring.metals[0]);
  const [hovered, setHovered] = useState(false);

  return (
    <article
      className="group relative flex flex-col"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={`/rings/${ring.id}`}
        className="relative block overflow-hidden rounded-2xl bg-surface-muted"
      >
        <RingThumb
          ring={ring}
          metal={metal}
          autoRotate={hovered || priority}
          className="aspect-square w-full"
        />
      </Link>

      <div className="mt-4">
        <h3 className="truncate font-display text-lg leading-tight">
          <Link href={`/rings/${ring.id}`} className="hover:text-accent">
            {ring.name}
          </Link>
        </h3>
        <p className="mt-0.5 text-xs uppercase tracking-[0.1em] text-muted">
          {ring.collection} · {GEMS[ring.gem].label}
          {ring.carat ? ` · ${ring.carat.toFixed(2)} ct` : ""}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {ring.metals.map((id) => {
            const spec = METALS[id];
            const active = id === metal;
            return (
              <button
                key={id}
                type="button"
                aria-label={spec.label}
                aria-pressed={active}
                onClick={() => setMetal(id)}
                className={`size-5 rounded-full ring-offset-2 ring-offset-background transition ${
                  active ? "ring-1 ring-accent" : "ring-1 ring-line hover:ring-muted"
                }`}
                style={{
                  background: `linear-gradient(140deg, ${spec.swatch[0]}, ${spec.swatch[1]})`,
                }}
              />
            );
          })}
        </div>
        <Link
          href={`/try-on?ring=${ring.id}&metal=${metal}`}
          className="text-xs font-medium text-accent underline-offset-4 hover:underline"
        >
          Try it on →
        </Link>
      </div>
    </article>
  );
}
