import Link from "next/link";
import { RINGS } from "@/lib/rings/catalog";
import { RingGallery } from "@/components/three/RingGallery";
import { RingCard } from "@/components/site/RingCard";
import { HeroRing } from "@/components/site/HeroRing";

const STEPS = [
  {
    title: "Turn on your camera",
    body: "One click, no app, no sign-up. The video never leaves your device — everything runs in the browser tab.",
  },
  {
    title: "We measure your finger",
    body: "The tracker reports your hand in real millimetres, so the ring is drawn at its true diameter and we can tell you the size you actually wear.",
  },
  {
    title: "Switch and compare",
    body: "Change the metal, the design, even the finger, and watch the difference on your own hand rather than a stock photo.",
  },
];

export default function HomePage() {
  const featured = RINGS.filter((r) => r.bestseller).slice(0, 3);
  const rest = RINGS.filter((r) => !r.bestseller).slice(0, 6);

  return (
    <>
      <section className="relative overflow-hidden border-b border-line/70">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-6 lg:py-24">
          <div className="relative z-10">
            <p className="text-xs uppercase tracking-[0.24em] text-accent">
              Virtual try-on
            </p>
            <h1 className="mt-5 font-display text-5xl leading-[1.05] sm:text-6xl lg:text-7xl">
              See it on your hand
              <span className="block italic text-muted">before you decide.</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
              Choosing a ring from a photograph is guesswork. Aurelia tracks your
              finger through your camera and places the ring in real 3D — correct
              size, correct angle, correctly hidden where your finger passes in
              front of it.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/try-on"
                className="rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background transition hover:opacity-85"
              >
                Start virtual try-on
              </Link>
              <Link
                href="/rings"
                className="rounded-full border border-line px-7 py-3.5 text-sm font-medium transition hover:border-muted"
              >
                Browse rings
              </Link>
            </div>
            <p className="mt-5 text-xs text-muted">
              Works on desktop and mobile · Nothing is uploaded
            </p>
          </div>

          <div className="relative min-h-[320px] lg:min-h-[520px]">
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 size-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-soft/60 blur-3xl"
            />
            <HeroRing />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="grid gap-10 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <span className="font-display text-3xl text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-3 font-display text-xl">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <RingGallery>
        <section className="mx-auto max-w-6xl px-5 pb-8 sm:px-8">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-3xl sm:text-4xl">Most tried on</h2>
            <Link
              href="/rings"
              className="shrink-0 text-sm text-accent underline-offset-4 hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((ring) => (
              <RingCard key={ring.id} ring={ring} priority />
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="rule mb-14" />
          <h2 className="font-display text-3xl sm:text-4xl">The full collection</h2>
          <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((ring) => (
              <RingCard key={ring.id} ring={ring} />
            ))}
          </div>
        </section>
      </RingGallery>

      <section className="mx-auto max-w-4xl px-5 pb-8 text-center sm:px-8">
        <div className="rounded-3xl border border-line bg-surface-muted/50 px-6 py-14">
          <h2 className="font-display text-3xl sm:text-4xl">Not sure of your size?</h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
            Measure with a strip of paper and a ruler, or let the camera estimate
            it from your hand. Both take about a minute.
          </p>
          <Link
            href="/size-guide"
            className="mt-8 inline-block rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background transition hover:opacity-85"
          >
            Find your size
          </Link>
        </div>
      </section>
    </>
  );
}
