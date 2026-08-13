import type { Metadata } from "next";
import Link from "next/link";
import { NECKLACES } from "@/lib/jewellery/catalog";
import { GEMS, METAL_ORDER } from "@/lib/rings/catalog";
import { NecklaceDetail } from "@/components/site/NecklaceDetail";

export const metadata: Metadata = {
  title: "Necklaces",
  description:
    "Aurelia's pendants, modelled in 3D and viewable on your own neck through your camera.",
};

export default function NecklacesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl sm:text-5xl">Necklaces</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Spin each pendant to see it from any angle. Try-on shows it at the size
          it really is on your neck, which is small — this is where the design
          itself can actually be looked at.
        </p>
      </header>

      <div className="mt-12 space-y-20">
        {NECKLACES.map((necklace) => (
          <NecklaceDetail
            key={necklace.id}
            necklace={necklace}
            gemLabel={GEMS[necklace.gem].label}
            metalOrder={METAL_ORDER}
          />
        ))}
      </div>

      <div className="rule my-16" />

      <Link
        href="/try-on"
        className="inline-block rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background transition hover:opacity-85"
      >
        Try one on
      </Link>
    </div>
  );
}
