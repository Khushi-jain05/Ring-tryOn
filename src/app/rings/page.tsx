import type { Metadata } from "next";
import { COLLECTIONS, RINGS } from "@/lib/rings/catalog";
import { RingGallery } from "@/components/three/RingGallery";
import { RingCard } from "@/components/site/RingCard";
import { CollectionFilter } from "@/components/site/CollectionFilter";

export const metadata: Metadata = {
  title: "All Rings",
  description:
    "Browse the Aurelia collection — bridal solitaires, coloured stones, eternity bands and everyday pieces, each viewable in 3D and on your own hand.",
};

export default async function RingsPage({ searchParams }: PageProps<"/rings">) {
  const params = await searchParams;
  const raw = params.collection;
  const selected = typeof raw === "string" && COLLECTIONS.includes(raw as never) ? raw : null;

  const rings = selected ? RINGS.filter((r) => r.collection === selected) : RINGS;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl sm:text-5xl">Rings</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Every piece here is modelled in 3D rather than photographed, which is
          what lets you spin it, change its metal, and put it on your own hand
          without waiting for a sample to arrive.
        </p>
      </header>

      <CollectionFilter selected={selected} />

      <RingGallery>
        <div className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {rings.map((ring, i) => (
            <RingCard key={ring.id} ring={ring} priority={i < 3} />
          ))}
        </div>
      </RingGallery>

      {rings.length === 0 && (
        <p className="mt-12 text-sm text-muted">Nothing in this collection yet.</p>
      )}
    </div>
  );
}
