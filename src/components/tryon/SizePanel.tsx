"use client";

import { useState } from "react";
import { STOCK_SIZES, formatSize, sizeToDiameterMm, usSizeToUk } from "@/lib/rings/sizes";
import { useTryOnStore } from "@/lib/store/tryon";
import { Field, Toggle } from "./controls";

/**
 * The sizing panel.
 *
 * Two different questions are answered here and it matters that they stay
 * separate: *what size am I* (measured from the hand) and *what size am I
 * looking at* (chosen, and drawn to true scale). Conflating them is what makes
 * most virtual try-ons useless for fit — they silently draw every ring at
 * whatever size looks right, so nothing ever appears too big or too small.
 */
export function SizePanel() {
  const reading = useTryOnStore((s) => s.reading);
  const ringSize = useTryOnStore((s) => s.ringSize);
  const autoFit = useTryOnStore((s) => s.autoFit);
  const source = useTryOnStore((s) => s.calibrationSource);
  const status = useTryOnStore((s) => s.status);
  const setRingSize = useTryOnStore((s) => s.setRingSize);
  const setAutoFit = useTryOnStore((s) => s.setAutoFit);
  const startCard = useTryOnStore((s) => s.startCardCalibration);
  const calibrateToKnownSize = useTryOnStore((s) => s.calibrateToKnownSize);
  const resetCalibration = useTryOnStore((s) => s.resetCalibration);

  const [entering, setEntering] = useState(false);
  const [knownSize, setKnownSize] = useState(ringSize);

  const measured = reading?.usSize ?? null;
  const fit = measured === null ? null : ringSize - measured;
  const tracking = status === "tracking";

  return (
    <div className="space-y-5 rounded-2xl border border-line bg-surface-muted/40 p-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Measured from your hand
          </p>
          <Accuracy source={source} />
        </div>

        {reading ? (
          <div className="mt-2">
            <span className="font-display text-4xl">
              US {formatSize(Math.round(reading.usSize * 2) / 2)}
            </span>
            <p className="mt-1 text-xs text-muted">
              {reading.widthMm.toFixed(1)} mm across ·{" "}
              {reading.circumferenceMm.toFixed(1)} mm around
            </p>
            <p className="mt-2 text-xs">
              {reading.settled ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Reading is steady.
                </span>
              ) : (
                <span className="text-muted">
                  Still settling — keep your hand still and fully in frame.
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Hold your hand steady, palm toward the camera, for a couple of seconds.
          </p>
        )}
      </div>

      {source === "none" && (
        <div className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3.5">
          <p className="text-xs leading-relaxed">
            <strong className="font-medium">This reading is an estimate.</strong>{" "}
            A camera alone cannot tell how big your hand is — the tracker assumes
            average proportions, so it can be a size or two out. Hold up a bank
            card and it becomes exact.
          </p>
          <button
            type="button"
            onClick={startCard}
            disabled={!tracking}
            className="mt-3 w-full rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-85 disabled:opacity-40"
          >
            {tracking ? "Calibrate with a bank card" : "Start the camera first"}
          </button>
        </div>
      )}

      <div className="rule" />

      <Field label={`Showing US ${formatSize(ringSize)} · UK ${usSizeToUk(ringSize)}`}>
        <select
          value={ringSize}
          onChange={(e) => setRingSize(Number(e.target.value))}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm"
        >
          {STOCK_SIZES.map((s) => (
            <option key={s} value={s}>
              US {formatSize(s)} — {sizeToDiameterMm(s).toFixed(1)} mm
            </option>
          ))}
        </select>
      </Field>

      <Toggle
        label="Always fit my finger"
        hint={
          autoFit
            ? "The ring is drawn at the size that fits you, so it always looks right."
            : "The ring is drawn at its true size, so you can see how it would fit."
        }
        checked={autoFit}
        onChange={() => setAutoFit(!autoFit)}
      />

      {!autoFit && fit !== null && (
        <p
          className={`text-xs ${
            Math.abs(fit) < 0.4
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {Math.abs(fit) < 0.4
            ? "This size matches your finger."
            : fit > 0
              ? `About ${fit.toFixed(1)} sizes loose — it will spin on your finger.`
              : `About ${Math.abs(fit).toFixed(1)} sizes tight — it may not pass your knuckle.`}
        </p>
      )}

      <div className="rule" />

      {!entering ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {source === "card"
              ? "Calibrated with a card."
              : source === "known-size"
                ? "Calibrated to a size you gave us."
                : "Already know your size?"}
          </p>
          <div className="flex gap-2">
            {source !== "none" && (
              <button
                type="button"
                onClick={resetCalibration}
                className="rounded-full px-2 py-1.5 text-xs text-muted transition hover:text-foreground"
              >
                Reset
              </button>
            )}
            {source !== "card" && (
              <button
                type="button"
                onClick={startCard}
                disabled={!tracking}
                className="rounded-full border border-line px-3 py-1.5 text-xs transition hover:border-muted disabled:opacity-40"
              >
                Use a card
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setKnownSize(ringSize);
                setEntering(true);
              }}
              disabled={!reading}
              className="rounded-full border border-line px-3 py-1.5 text-xs transition hover:border-muted disabled:opacity-40"
            >
              Enter my size
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-xs leading-relaxed text-muted">
            Tell us the size you actually wear on this finger and every
            measurement from here on will be corrected to match.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={knownSize}
              onChange={(e) => setKnownSize(Number(e.target.value))}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              {STOCK_SIZES.map((s) => (
                <option key={s} value={s}>
                  US {formatSize(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                calibrateToKnownSize(knownSize);
                setEntering(false);
              }}
              className="rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEntering(false)}
              className="rounded-full px-2 py-2 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Accuracy({ source }: { source: "none" | "card" | "known-size" }) {
  const label =
    source === "card" ? "Exact" : source === "known-size" ? "Corrected" : "Estimate";
  const tone =
    source === "none"
      ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
      : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>
      {label}
    </span>
  );
}
