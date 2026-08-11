import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How try-on works",
  description:
    "How Aurelia's virtual ring try-on tracks your hand, sizes the ring, and hides the band behind your finger — all on-device, with nothing uploaded.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <header>
        <p className="text-xs uppercase tracking-[0.24em] text-accent">Behind it</p>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl">
          How the try-on works
        </h1>
        <p className="mt-5 text-base leading-relaxed text-muted">
          Most virtual try-ons paste a flat picture of the product over a
          detected point. That falls apart the moment you rotate your hand. This
          one solves for the finger&rsquo;s position in three dimensions and renders
          a real model into it.
        </p>
      </header>

      <div className="rule my-12" />

      <section className="space-y-10">
        <Block
          step="01"
          title="Twenty-one points, thirty times a second"
          body="A hand-landmark model runs on your GPU inside the browser tab and returns twenty-one joints per frame — knuckles, joints and fingertips — in both image coordinates and true metric 3D. Nothing is sent anywhere; the model file is served from this site and the inference happens on your device."
        />
        <Block
          step="02"
          title="Position from the picture, rotation from the space"
          body="Those two coordinate sets are each good at one thing. The flat image coordinates say exactly which pixels your finger occupies, so the ring is anchored and scaled to them and lands on the right spot at any camera resolution. The metric coordinates carry the real 3D structure, so the tilt of the band is solved from those. Using either one alone breaks: image-only orientation collapses when you turn your hand, and world-only positioning needs a calibrated camera nobody has."
        />
        <Block
          step="03"
          title="The ring is measured, not guessed"
          body="The world landmarks are metric, so the finger can be measured in millimetres and the ring drawn at its true diameter — a US 7 renders as an actual US 7. And because a ring that fits is narrower than the finger is wide (fingers are oval, and ring size is defined by circumference), the band correctly sits just inside the silhouette with skin either side of it, rather than spanning the finger edge to edge like a sticker."
        />
        <Block
          step="04"
          title="A bank card makes it exact"
          body="One thing a single camera genuinely cannot know is how big your hand is — the tracker assumes average proportions, so for anyone whose hands are not average the millimetres carry a constant error. Every bank card in the world is 85.60 mm wide by international standard, so holding one against your fingers and lining it up with an outline turns the picture into a ruler. From that one frame we learn the model's error and correct every measurement after it."
        />
        <Block
          step="05"
          title="An invisible finger"
          body="The single most important trick. A ring is a closed loop, so half of it is behind your finger — but the renderer has no idea your finger exists. So we build a stand-in for the hand: a cylinder through the band, tapered capsules down every finger, and a slab for the palm, all writing to the depth buffer while writing no colour. The far side of the band, and anything a neighbouring finger crosses in front of, fails the depth test and vanishes behind a hand that was never drawn. A translucent sleeve just outside the band darkens the skin at its edges — the contact shadow that stops the ring looking stuck on top of the picture."
        />
        <Block
          step="06"
          title="Which side the stone sits on"
          body="A ring is worn on the back of the finger, so the setting has to stay there through a full turn of the wrist. Working that out from the palm alone is ambiguous — a hand and its mirror image give the same plane — and the tracker's own left/right label is defined against a mirroring convention that has changed between releases. Fingers, though, only curl toward the palm, so the direction a finger bends says where the palm is regardless of which hand it is. That decision is then latched, so passing through a pose with no clear evidence cannot make the stone jump to the far side."
        />
        <Block
          step="07"
          title="Steady without being sluggish"
          body="Raw landmarks jitter by a pixel or two every frame even on a perfectly still hand. A One Euro filter smooths hard while you hold still and barely at all while you move, which removes the buzz without adding the lag a plain average would."
        />
      </section>

      <div className="rule my-12" />

      <section id="privacy" className="scroll-mt-24">
        <h2 className="font-display text-3xl">Privacy</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          The camera stream never leaves your device. There is no upload, no
          recording, and no analytics on the video. The tracking model and its
          WebAssembly runtime are served from this domain rather than a
          third-party CDN, so no outside service learns that you opened the
          try-on at all. Closing the tab ends the stream; photos you capture are
          saved only if you press Save.
        </p>
      </section>

      <section id="materials" className="mt-12 scroll-mt-24">
        <h2 className="font-display text-3xl">Materials</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Every ring is generated as real geometry from a specification — band
          profile, setting style, stone cut, accent count — rather than loaded
          from a fixed model file. That is why the metal can change instantly and
          why the same design can be rendered with refraction through the stones
          on its product page but with a cheaper approximation over live video,
          where the GPU is already busy running the hand tracker.
        </p>
      </section>

      <div className="mt-14 flex flex-wrap gap-3">
        <Link
          href="/try-on"
          className="rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background transition hover:opacity-85"
        >
          Try it yourself
        </Link>
        <Link
          href="/rings"
          className="rounded-full border border-line px-7 py-3.5 text-sm font-medium transition hover:border-muted"
        >
          Browse rings
        </Link>
      </div>
    </div>
  );
}

function Block({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[4rem_1fr] sm:gap-6">
      <span className="font-display text-2xl text-accent">{step}</span>
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}
