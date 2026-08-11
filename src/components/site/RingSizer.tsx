"use client";

import { useState } from "react";
import { useStoredNumber } from "@/lib/useStoredNumber";
import {
  MAX_SIZE,
  MIN_SIZE,
  circumferenceMmToSize,
  diameterMmToSize,
  formatSize,
  sizeToCircumferenceMm,
  sizeToDiameterMm,
  snapToStockSize,
  usSizeToUk,
} from "@/lib/rings/sizes";

/** ISO/IEC 7810 ID-1 — the exact width of every bank card in the world. */
const CARD_WIDTH_MM = 85.6;
const CARD_ASPECT = 53.98 / 85.6;

/** CSS reference: 96 px per inch, so 96 / 25.4 px per mm before calibration. */
const NOMINAL_PX_PER_MM = 96 / 25.4;

type Mode = "ring" | "finger" | "chart";

/**
 * An on-screen ring sizer.
 *
 * Screens lie about their size — CSS pixels are a nominal 96 dpi that almost no
 * real display actually matches, so a circle drawn "16.5 mm wide" can be off by
 * a third. Calibrating against a bank card first fixes that: ID-1 cards are
 * 85.60 mm wide by international standard, which makes one available in every
 * wallet the most reliable ruler most people own.
 */
export function RingSizer() {
  const [mode, setMode] = useState<Mode>("ring");
  const [diameterMm, setDiameterMm] = useState(sizeToDiameterMm(6.5));
  const [circumferenceMm, setCircumferenceMm] = useState(sizeToCircumferenceMm(6.5));

  // The calibration belongs to the screen, not the session, so it is persisted.
  const [pxPerMm, saveCalibration] = useStoredNumber(
    "aurelia-px-per-mm",
    NOMINAL_PX_PER_MM,
  );
  const calibrated = pxPerMm !== NOMINAL_PX_PER_MM;

  const size =
    mode === "finger"
      ? circumferenceMmToSize(circumferenceMm)
      : diameterMmToSize(diameterMm);
  const snapped = snapToStockSize(size);
  const inRange = size >= MIN_SIZE - 0.4 && size <= MAX_SIZE + 0.4;

  return (
    <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["ring", "Measure a ring you own"],
            ["finger", "Measure your finger"],
            ["chart", "Conversion chart"],
          ] as [Mode, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`rounded-full border px-4 py-2 text-xs transition ${
              mode === value
                ? "border-foreground bg-foreground text-background"
                : "border-line text-muted hover:border-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {mode === "ring" && (
          <>
            <Calibration
              pxPerMm={pxPerMm}
              calibrated={calibrated}
              onChange={saveCalibration}
            />
            <div className="mt-8">
              <h3 className="font-display text-xl">Now match the circle</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Place a ring that already fits flat on the screen and adjust
                until the circle sits exactly inside the band.
              </p>

              <div className="mt-7 flex flex-col items-center">
                <div
                  className="rounded-full border-2 border-dashed border-accent bg-accent-soft/40"
                  style={{
                    width: diameterMm * pxPerMm,
                    height: diameterMm * pxPerMm,
                  }}
                />
                <input
                  type="range"
                  aria-label="Inner diameter"
                  min={sizeToDiameterMm(MIN_SIZE)}
                  max={sizeToDiameterMm(MAX_SIZE)}
                  step={0.05}
                  value={diameterMm}
                  onChange={(e) => setDiameterMm(Number(e.target.value))}
                  className="mt-8 h-1 w-full max-w-sm cursor-pointer appearance-none rounded-full bg-line accent-accent"
                />
                <p className="mt-3 text-xs tabular-nums text-muted">
                  {diameterMm.toFixed(1)} mm inner diameter
                </p>
              </div>
            </div>
          </>
        )}

        {mode === "finger" && (
          <>
            <h3 className="font-display text-xl">Wrap and measure</h3>
            <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
              <li>
                <strong className="text-foreground">1.</strong> Cut a strip of
                paper about 6 mm wide, or use a length of string.
              </li>
              <li>
                <strong className="text-foreground">2.</strong> Wrap it snugly
                around the base of the finger — it should slide over the knuckle
                with a little resistance.
              </li>
              <li>
                <strong className="text-foreground">3.</strong> Mark where it
                overlaps, lay it flat against a ruler, and enter the length below.
              </li>
            </ol>

            <div className="mt-7 max-w-xs">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                Circumference
              </label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="number"
                  min={40}
                  max={75}
                  step={0.5}
                  value={circumferenceMm}
                  onChange={(e) => setCircumferenceMm(Number(e.target.value))}
                  className="w-28 rounded-lg border border-line bg-background px-3 py-2.5 text-sm tabular-nums"
                />
                <span className="text-sm text-muted">mm</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Measure at the end of the day, when fingers are at their largest.
                A cold hand can read a full size small.
              </p>
            </div>
          </>
        )}

        {mode === "chart" && <SizeChart />}
      </div>

      {mode !== "chart" && (
        <div className="mt-8 rounded-2xl bg-surface-muted px-5 py-5 text-center">
          {inRange ? (
            <>
              <p className="text-xs uppercase tracking-[0.16em] text-muted">
                Your size
              </p>
              <p className="mt-2 font-display text-4xl">US {formatSize(snapped)}</p>
              <p className="mt-1.5 text-xs text-muted">
                UK {usSizeToUk(snapped)} · {sizeToDiameterMm(snapped).toFixed(1)} mm
                diameter · {sizeToCircumferenceMm(snapped).toFixed(1)} mm around
              </p>
              {!calibrated && mode === "ring" && (
                <p className="mt-3 text-xs text-accent">
                  Calibrate your screen above for an accurate reading.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              That falls outside the sizes we stock (US {MIN_SIZE}–{MAX_SIZE}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Calibration({
  pxPerMm,
  calibrated,
  onChange,
}: {
  pxPerMm: number;
  calibrated: boolean;
  onChange: (value: number) => void;
}) {
  const widthPx = CARD_WIDTH_MM * pxPerMm;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl">First, calibrate your screen</h3>
        {calibrated && <span className="text-xs text-accent">Calibrated</span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Hold any bank card against the screen and resize the rectangle until the
        two match exactly. Every card is the same 85.6 mm wide, so this makes the
        measurements below true to life.
      </p>

      <div className="mt-6 overflow-x-auto">
        <div
          className="relative rounded-xl border border-accent bg-gradient-to-br from-accent-soft to-surface-muted"
          style={{ width: widthPx, height: widthPx * CARD_ASPECT, minWidth: widthPx }}
        >
          <span className="absolute bottom-2 right-3 text-[10px] uppercase tracking-widest text-muted">
            85.6 mm
          </span>
        </div>
      </div>

      <input
        type="range"
        aria-label="Card width calibration"
        min={NOMINAL_PX_PER_MM * 0.55}
        max={NOMINAL_PX_PER_MM * 2.4}
        step={0.01}
        value={pxPerMm}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-5 h-1 w-full max-w-sm cursor-pointer appearance-none rounded-full bg-line accent-accent"
      />
    </div>
  );
}

function SizeChart() {
  const rows = Array.from({ length: MAX_SIZE - MIN_SIZE + 1 }, (_, i) => MIN_SIZE + i);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-md text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-muted">
            <th className="py-3 font-medium">US</th>
            <th className="py-3 font-medium">UK</th>
            <th className="py-3 text-right font-medium">Diameter</th>
            <th className="py-3 text-right font-medium">Circumference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((size) => (
            <tr key={size}>
              <td className="py-3 tabular-nums">{size}</td>
              <td className="py-3">{usSizeToUk(size)}</td>
              <td className="py-3 text-right tabular-nums">
                {sizeToDiameterMm(size).toFixed(1)} mm
              </td>
              <td className="py-3 text-right tabular-nums">
                {sizeToCircumferenceMm(size).toFixed(1)} mm
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
