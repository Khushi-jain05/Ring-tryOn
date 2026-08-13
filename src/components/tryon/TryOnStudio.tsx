"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FINGER_LABELS, type FingerName } from "@/lib/hand/landmarks";
import { GEMS, METALS, RINGS, getRing } from "@/lib/rings/catalog";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/hand/framing";
import { NECKLACES, getNecklace } from "@/lib/jewellery/catalog";
import { useTryOnStore } from "@/lib/store/tryon";
import type { MetalId } from "@/lib/rings/types";
import { TryOnStage } from "./TryOnStage";
import { SizePanel } from "./SizePanel";
import { Field, Segmented, Slider, Toggle } from "./controls";

const FINGERS: FingerName[] = ["index", "middle", "ring", "pinky"];

export function TryOnStudio() {
  const params = useSearchParams();
  const store = useTryOnStore();
  const [advanced, setAdvanced] = useState(false);

  const { setRing, setMetal } = store;
  const ringParam = params.get("ring");
  const metalParam = params.get("metal");

  // Deep links from the catalogue land here with a ring already chosen.
  useEffect(() => {
    if (ringParam && getRing(ringParam)) setRing(ringParam);
  }, [ringParam, setRing]);

  useEffect(() => {
    if (metalParam && metalParam in METALS) setMetal(metalParam as MetalId);
  }, [metalParam, setMetal]);

  const ring = getRing(store.ringId) ?? RINGS[0];
  const necklace = getNecklace(store.necklaceId) ?? NECKLACES[0];
  const isNecklace = store.mode === "necklace";
  // The two share a description block, a metal picker and a stone label; only the
  // sizing and placement controls below differ.
  const piece = isNecklace ? necklace : ring;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10">
      {/*
        A real mode switch, not a filter over one catalogue. Rings are tracked by
        the hand model and necklaces by the pose model, so the two share the
        composited stage and almost nothing else — including what "size" means.
      */}
      <div className="mx-auto mb-6 max-w-xs">
        <Segmented
          options={[
            { value: "ring", label: "Rings" },
            { value: "necklace", label: "Necklaces" },
          ]}
          value={store.mode}
          onChange={(v) => store.setMode(v as "ring" | "necklace")}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_366px]">
        <div>
          <TryOnStage ring={ring} />

          <div className="mx-auto mt-4 flex max-w-md items-center gap-3">
            <span className="text-xs text-muted">Zoom</span>
            <input
              type="range"
              aria-label="Zoom"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={store.zoom}
              onChange={(e) => store.setZoom(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-accent"
            />
            <span className="w-10 text-right text-xs tabular-nums text-muted">
              {store.zoom.toFixed(1)}&times;
            </span>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">
              {isNecklace ? "Choose a necklace" : "Choose a ring"}
            </p>
            <div className="-mx-5 mt-3 flex snap-x gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
              {(isNecklace
                ? NECKLACES.map((n) => ({
                    id: n.id,
                    name: n.name,
                    collection: n.collection,
                    select: () => store.setNecklace(n.id),
                    active: n.id === necklace.id,
                  }))
                : RINGS.map((r) => ({
                    id: r.id,
                    name: r.name,
                    collection: r.collection,
                    select: () => store.setRing(r.id),
                    active: r.id === ring.id,
                  }))
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.select}
                  aria-pressed={item.active}
                  className={`w-32 shrink-0 snap-start rounded-xl border px-3 py-2.5 text-left transition ${
                    item.active
                      ? "border-accent bg-accent-soft/50"
                      : "border-line hover:border-muted"
                  }`}
                >
                  <span className="block truncate font-display text-sm">{item.name}</span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-[0.1em] text-muted">
                    {item.collection}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-accent">
              {piece.collection}
            </p>
            <h1 className="mt-1.5 font-display text-3xl">{piece.name}</h1>
            <p className="mt-1 text-xs text-muted">
              {GEMS[piece.gem].label}
              {piece.carat ? ` · ${piece.carat.toFixed(2)} ct` : ""}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">{piece.description}</p>
          </div>

          <Field label="Metal">
            <div className="flex flex-wrap gap-2">
              {piece.metals.map((id) => {
                const spec = METALS[id];
                const active = id === store.metal;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => store.setMetal(id)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-xs transition ${
                      active ? "border-accent" : "border-line hover:border-muted"
                    }`}
                  >
                    <span
                      className="size-5 rounded-full"
                      style={{
                        background: `linear-gradient(140deg, ${spec.swatch[0]}, ${spec.swatch[1]})`,
                      }}
                    />
                    {spec.label.replace(/^(18K|950) /, "")}
                  </button>
                );
              })}
            </div>
          </Field>

          {isNecklace ? (
            <div className="space-y-5 rounded-2xl border border-line bg-surface-muted/40 p-5">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                    Measured from your neck
                  </p>
                  {store.neckReading && (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                        store.neckReading.twoCues
                          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {store.neckReading.twoCues ? "Two cues" : "One cue"}
                    </span>
                  )}
                </div>

                {store.neckReading ? (
                  <>
                    <p className="mt-2 font-display text-3xl tabular-nums">
                      {store.neckReading.circumferenceMm.toFixed(0)} mm
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      around · {(store.neckSizeMm * 2).toFixed(0)} mm across ·{" "}
                      {store.neckReading.lengthMm.toFixed(0)} mm long
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {store.neckReading.twoCues
                        ? "Measured from your shoulder breadth and your head breadth together, so the estimate does not rest on one assumed proportion."
                        : "Head turned too far to use its breadth, so this is from shoulder breadth alone — square up to the camera for a steadier reading."}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    Sit back until both shoulders are in frame and face the camera
                    squarely.
                  </p>
                )}

                <p className="mt-2.5 text-xs leading-relaxed text-muted">
                  Both the piece&rsquo;s size and where it sits are derived from
                  this: the collar follows your own neck&rsquo;s curve, and how high
                  it crosses comes from your neck&rsquo;s length rather than an
                  average.
                </p>
              </div>

              <Slider
                label="Chain length"
                value={store.necklaceAnchor.dropFactor}
                min={1.4}
                max={3.6}
                step={0.05}
                format={(v) =>
                  v < 1.9 ? "Choker" : v > 2.9 ? "Long" : "Princess"
                }
                onChange={(v) => store.setNecklaceAnchor({ dropFactor: v })}
              />
              <Slider
                label="Piece size"
                value={store.necklaceAnchor.sizeMultiplier}
                min={0.85}
                max={1.2}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.setNecklaceAnchor({ sizeMultiplier: v })}
              />
              <Slider
                label="Sits higher or lower"
                value={store.necklaceAnchor.riseOffset}
                min={-1.4}
                max={1.4}
                step={0.05}
                format={(v) =>
                  Math.abs(v) < 0.1 ? "At the notch" : v > 0 ? "Higher" : "Lower"
                }
                onChange={(v) => store.setNecklaceAnchor({ riseOffset: v })}
              />
            </div>
          ) : (
            <>
              <Field label="Finger">
                <Segmented
                  options={FINGERS.map((f) => ({ value: f, label: FINGER_LABELS[f] }))}
                  value={store.anchor.finger}
                  onChange={(v) => store.setFinger(v as FingerName)}
                />
              </Field>

              <SizePanel />
            </>
          )}

          <div className="rounded-2xl border border-line p-4">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-muted"
            >
              Placement &amp; tracking
              <span className="text-base leading-none">{advanced ? "−" : "+"}</span>
            </button>

            {advanced && (
              <div className="mt-5 space-y-5">
                {!isNecklace && (
                  <>
                    <Slider
                      label="Position along finger"
                      value={store.anchor.positionAlongFinger}
                      min={0.1}
                      max={0.72}
                      step={0.01}
                      format={(v) =>
                        v < 0.3 ? "At the knuckle" : v > 0.56 ? "High" : "Standard"
                      }
                      onChange={(v) => store.setAnchor({ positionAlongFinger: v })}
                    />
                    <Slider
                      label="Ring width"
                      value={store.anchor.widthMultiplier}
                      min={0.85}
                      max={1.2}
                      step={0.01}
                      format={(v) => `${Math.round(v * 100)}% of fit`}
                      onChange={(v) => store.setAnchor({ widthMultiplier: v })}
                    />
                    <Slider
                      label="Turn the setting"
                      value={store.anchor.rotationOffset}
                      min={-Math.PI}
                      max={Math.PI}
                      step={0.02}
                      format={(v) => `${Math.round((v * 180) / Math.PI)}\u00b0`}
                      onChange={(v) => store.setAnchor({ rotationOffset: v })}
                    />
                    <Slider
                      label="Band across finger"
                      value={store.anchor.crossOffset}
                      min={-0.3}
                      max={0.3}
                      step={0.01}
                      format={(v) =>
                        Math.abs(v) < 0.02
                          ? "Centred"
                          : v > 0
                            ? "Toward the back of the hand"
                            : "Toward the palm"
                      }
                      onChange={(v) => store.setAnchor({ crossOffset: v })}
                    />
                  </>
                )}
                <Slider
                  label="Smoothing"
                  value={store.smoothing.minCutoff}
                  min={0.5}
                  max={4}
                  step={0.1}
                  format={(v) => (v < 1.2 ? "Very steady" : v > 2.8 ? "Very quick" : "Balanced")}
                  onChange={(v) => store.setSmoothing({ minCutoff: v })}
                />
                <Toggle
                  label="Mirror preview"
                  hint="Turn off if you're using a rear camera"
                  checked={store.mirrored}
                  onChange={store.toggleMirrored}
                />
                {!isNecklace && (
                  <>
                    <Toggle
                      label="Keep the stone facing me"
                      hint={
                        store.settingFacesCamera
                          ? "The setting stays turned toward you as you rotate your hand"
                          : "The setting rides round with your hand, as a real ring does"
                      }
                      checked={store.settingFacesCamera}
                      onChange={store.toggleSettingFacesCamera}
                    />
                    <Toggle
                      label="Setting facing the wrong way?"
                      hint="Flips the flower or stone to the other side of the finger"
                      checked={store.flipGem}
                      onChange={store.toggleFlipGem}
                    />
                    <Toggle
                      label="Measure my finger from the video"
                      hint="Experimental. More exact when it works, but it can mistake a crease for your finger's edge and undersize the ring."
                      checked={store.usePixelProbe}
                      onChange={store.togglePixelProbe}
                    />
                  </>
                )}
                <Toggle
                  label="Show diagnostics"
                  checked={store.showDiagnostics}
                  onChange={store.toggleDiagnostics}
                />
              </div>
            )}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            {isNecklace
              ? "Sit back far enough that both shoulders are in frame — the chain is sized from your shoulder breadth, so the piece hides until both are visible. Face the camera squarely while it settles."
              : "Hold your hand in the middle of the frame, 30–50 cm from the camera in even light, with the whole hand visible. The view is a fixed crop rather than one that follows you, so nothing moves but your hand. The size is measured from your hand’s real proportions, so keep the palm roughly square to the lens while it settles."}{" "}
            <Link href="/about" className="text-accent underline-offset-4 hover:underline">
              How this works
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
