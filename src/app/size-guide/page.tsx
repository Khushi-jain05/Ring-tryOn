import type { Metadata } from "next";
import Link from "next/link";
import { RingSizer } from "@/components/site/RingSizer";

export const metadata: Metadata = {
  title: "Ring Size Guide",
  description:
    "Find your ring size by measuring a ring you already own against a calibrated on-screen circle, or by wrapping your finger. Includes a US/UK conversion chart.",
};

export default function SizeGuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.24em] text-accent">Fit</p>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl">Find your size</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Try-on shows you how a ring looks; this tells you which one to order.
          The most accurate method is measuring a ring that already fits the
          right finger, so start there if you can.
        </p>
      </header>

      <div className="mt-10">
        <RingSizer />
      </div>

      <section className="mt-14">
        <h2 className="font-display text-2xl">Things that shift a size</h2>
        <ul className="mt-5 space-y-4 text-sm leading-relaxed text-muted">
          <li>
            <strong className="text-foreground">Temperature.</strong> Fingers
            shrink in the cold and swell in heat. Measure at room temperature,
            late in the day.
          </li>
          <li>
            <strong className="text-foreground">Knuckle size.</strong> If your
            knuckle is much wider than the base of the finger, size to slide over
            the knuckle and expect a little movement below it.
          </li>
          <li>
            <strong className="text-foreground">Band width.</strong> Anything
            over about 6 mm wears tighter. Go up a half size for a broad band.
          </li>
          <li>
            <strong className="text-foreground">Which hand.</strong> Your dominant
            hand is usually a quarter to a half size larger.
          </li>
        </ul>
      </section>

      <section id="resizing" className="mt-14 scroll-mt-24">
        <h2 className="font-display text-2xl">Resizing</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Every ring except the eternity bands can be resized once within the
          first year at no cost, up or down by two sizes. Eternity bands are set
          the whole way around, so there is no plain metal to cut — those have to
          be remade, which is why the size guide matters most for them.
        </p>
        <Link
          href="/try-on"
          className="mt-7 inline-block rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background transition hover:opacity-85"
        >
          Back to try-on
        </Link>
      </section>
    </div>
  );
}
