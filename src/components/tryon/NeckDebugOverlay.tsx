"use client";

import { useEffect, useRef } from "react";
import { PL } from "@/lib/neck/landmarks";
import { neckDebugBus } from "@/lib/neck/debugBus";
import { useTryOnStore } from "@/lib/store/tryon";

/** Upper-body bones, enough to see at a glance whether tracking is sane. */
const BONES: [number, number][] = [
  [PL.LEFT_SHOULDER, PL.RIGHT_SHOULDER],
  [PL.LEFT_SHOULDER, PL.LEFT_HIP],
  [PL.RIGHT_SHOULDER, PL.RIGHT_HIP],
  [PL.LEFT_HIP, PL.RIGHT_HIP],
  [PL.LEFT_EAR, PL.RIGHT_EAR],
  [PL.LEFT_MOUTH, PL.RIGHT_MOUTH],
];

const DOTS = [
  PL.NOSE,
  PL.LEFT_EAR,
  PL.RIGHT_EAR,
  PL.LEFT_MOUTH,
  PL.RIGHT_MOUTH,
  PL.LEFT_SHOULDER,
  PL.RIGHT_SHOULDER,
];

/**
 * Draws what the necklace solver believes, over the video.
 *
 * The point is to separate causes that look identical in the finished render. If the
 * white bar is wider than your neck the size estimate is wrong; if the gold cross
 * sits below your collarbones the anchor is wrong; if the dashed arc misses your
 * neck's sides the radius is wrong; and if nothing appears at all the solve is being
 * refused, which is a different problem again.
 */
export function NeckDebugOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enabled = useTryOnStore((s) => s.showDiagnostics);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      const frame = neckDebugBus.frame;
      if (!frame) {
        // A refused solve is a distinct failure and worth saying so, rather than
        // leaving an empty overlay that looks like a rendering problem.
        ctx.fillStyle = "rgba(255,140,140,0.95)";
        ctx.font = `${12 * dpr}px ui-monospace, monospace`;
        ctx.fillText("no pose — both shoulders must be in frame", 12 * dpr, 24 * dpr);
        return;
      }
      if (performance.now() - frame.stamp > 500) return;

      // Anchor-plane units are normalised by display height with the origin at the
      // centre; undo both to get canvas pixels.
      const toPx = (p: { x: number; y: number }) => ({
        x: p.x * height + width / 2,
        y: height / 2 - p.y * height,
      });

      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = "rgba(120, 220, 255, 0.5)";
      ctx.beginPath();
      for (const [a, b] of BONES) {
        const pa = toPx(frame.planar[a]);
        const pb = toPx(frame.planar[b]);
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(120, 220, 255, 0.9)";
      for (const i of DOTS) {
        const q = toPx(frame.planar[i]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      const anchor = toPx(frame.anchor);
      const neckPx = frame.neckRadius * height;

      // The neck's measured width. If this is wider or narrower than your neck
      // looks, the size estimate is what needs correcting.
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(anchor.x - neckPx, anchor.y);
      ctx.lineTo(anchor.x + neckPx, anchor.y);
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(anchor.x + side * neckPx, anchor.y - 7 * dpr);
        ctx.lineTo(anchor.x + side * neckPx, anchor.y + 7 * dpr);
        ctx.stroke();
      }

      // The arc the collar actually follows, flattened the way a neck is.
      ctx.strokeStyle = "rgba(255, 214, 120, 0.75)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.ellipse(anchor.x, anchor.y, neckPx, neckPx * 0.78, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Anchor cross, and how far the piece hangs below it.
      ctx.strokeStyle = "rgba(255, 214, 120, 1)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(anchor.x - 10 * dpr, anchor.y);
      ctx.lineTo(anchor.x + 10 * dpr, anchor.y);
      ctx.moveTo(anchor.x, anchor.y - 10 * dpr);
      ctx.lineTo(anchor.x, anchor.y + 10 * dpr);
      ctx.stroke();

      const dropPx = frame.dropUnits * height;
      ctx.strokeStyle = "rgba(255, 120, 160, 0.8)";
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(anchor.x, anchor.y + dropPx);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `${10.5 * dpr}px ui-monospace, monospace`;
      const lines = [
        `neck    ${frame.neckCircumferenceMm.toFixed(0)} mm around, ${(frame.neckRadius * 2 * height).toFixed(0)} px across`,
        `length  ${frame.neckLengthMm.toFixed(0)} mm  ${frame.twoCues ? "(two cues)" : "(shoulders only)"}`,
        `shoulders ${frame.shoulderWidthMm.toFixed(0)} mm`,
        `head    turned ${frame.headTurnDeg.toFixed(0)}°`,
        `pose    ${frame.confidence > 0.5 ? "seen" : "part inferred"} (${frame.confidence.toFixed(2)})`,
        `facing  ${frame.facing.toFixed(2)}`,
        `scale   ${frame.planeScale.toFixed(3)} u/m`,
      ];
      lines.forEach((line, i) => {
        ctx.fillText(line, 10 * dpr, height - (lines.length - i) * 14 * dpr);
      });
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
    />
  );
}
