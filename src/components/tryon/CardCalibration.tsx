"use client";

import { useState } from "react";
import {
  CARD_ASPECT,
  GUIDE_WIDTH_FRACTION,
  computeMetricBias,
  guideWidthToPlaneUnits,
} from "@/lib/hand/cardCalibration";
import { debugBus } from "@/lib/hand/debugBus";
import { useTryOnStore } from "@/lib/store/tryon";

/**
 * The card-alignment step.
 *
 * No computer vision here on purpose. Detecting a card reliably across every
 * lighting condition, background and card design is a real problem; asking the
 * person holding it to line it up with an outline is not, and it is more accurate
 * because they can see both at once. All we need at the moment of capture is the
 * solver's own scale estimate from the same frame.
 */
export function CardCalibration({
  stageWidth,
  stageHeight,
}: {
  stageWidth: number;
  stageHeight: number;
}) {
  const active = useTryOnStore((s) => s.calibratingWithCard);
  const cancel = useTryOnStore((s) => s.cancelCardCalibration);
  const apply = useTryOnStore((s) => s.applyCardCalibration);
  const [error, setError] = useState<string | null>(null);

  if (!active) return null;

  const guideWidthPx = stageWidth * GUIDE_WIDTH_FRACTION;

  const capture = () => {
    const frame = debugBus.frame;
    if (!frame || performance.now() - frame.stamp > 500) {
      setError("Your hand needs to be tracked at the same time as the card. Keep both in frame.");
      return;
    }

    const guideUnits = guideWidthToPlaneUnits(
      GUIDE_WIDTH_FRACTION,
      stageWidth,
      stageHeight,
    );
    const bias = computeMetricBias(frame.planeScale, guideUnits);

    if (bias === null) {
      setError(
        "That did not look right. Hold the card flat, in the same plane as your fingers, and fill the outline exactly.",
      );
      return;
    }

    setError(null);
    apply(bias);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-between bg-neutral-950/55 p-5 backdrop-blur-[2px]">
      <p className="max-w-xs rounded-2xl bg-neutral-950/80 px-4 py-3 text-center text-xs leading-relaxed text-neutral-200">
        Hold a bank card flat against your fingers, at the same distance from the
        camera, and line it up with the outline. Keep your hand in frame.
      </p>

      <div
        className="relative rounded-xl border-2 border-dashed border-amber-200"
        style={{ width: guideWidthPx, height: guideWidthPx * CARD_ASPECT }}
      >
        <span className="absolute -top-6 left-0 text-[10px] uppercase tracking-widest text-amber-200">
          85.6 mm
        </span>
        {/* Corner ticks make small misalignments much easier to see than a
            plain rectangle does. */}
        {(
          [
            "left-0 top-0 border-l-2 border-t-2",
            "right-0 top-0 border-r-2 border-t-2",
            "left-0 bottom-0 border-b-2 border-l-2",
            "right-0 bottom-0 border-b-2 border-r-2",
          ] as const
        ).map((cls) => (
          <span key={cls} className={`absolute size-4 border-amber-200 ${cls}`} />
        ))}
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        {error && (
          <p className="max-w-xs rounded-xl bg-red-950/80 px-3 py-2 text-center text-xs text-red-200">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={capture}
            className="rounded-full bg-amber-200 px-6 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-amber-100"
          >
            It&rsquo;s lined up
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded-full bg-neutral-950/70 px-5 py-2.5 text-sm text-neutral-200 transition hover:bg-neutral-950"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
