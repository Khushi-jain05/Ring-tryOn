"use client";

import { useEffect, useRef } from "react";
import { FINGER_CHAINS, FINGER_LABELS, FINGER_NAMES, LM } from "@/lib/hand/landmarks";
import { debugBus } from "@/lib/hand/debugBus";
import { useTryOnStore } from "@/lib/store/tryon";

/** Bones drawn as a skeleton, so a mis-tracked hand is obvious at a glance. */
const BONES: [number, number][] = [
  [LM.WRIST, LM.THUMB_CMC],
  [LM.THUMB_CMC, LM.THUMB_MCP],
  [LM.THUMB_MCP, LM.THUMB_IP],
  [LM.THUMB_IP, LM.THUMB_TIP],
  [LM.WRIST, LM.INDEX_MCP],
  [LM.INDEX_MCP, LM.INDEX_PIP],
  [LM.INDEX_PIP, LM.INDEX_DIP],
  [LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP],
  [LM.MIDDLE_PIP, LM.MIDDLE_DIP],
  [LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP],
  [LM.RING_PIP, LM.RING_DIP],
  [LM.RING_DIP, LM.RING_TIP],
  [LM.WRIST, LM.PINKY_MCP],
  [LM.PINKY_MCP, LM.PINKY_PIP],
  [LM.PINKY_PIP, LM.PINKY_DIP],
  [LM.PINKY_DIP, LM.PINKY_TIP],
  [LM.INDEX_MCP, LM.MIDDLE_MCP],
  [LM.MIDDLE_MCP, LM.RING_MCP],
  [LM.RING_MCP, LM.PINKY_MCP],
];

/**
 * Draws what the solver is actually seeing, on top of the video.
 *
 * The ring can look wrong for several unrelated reasons — the hand is tracked
 * badly, the mirroring is inverted, the width estimate is off, the seat is in
 * the wrong place — and from the rendered result alone they are hard to tell
 * apart. Overlaying the skeleton, the measured width and the seat point makes
 * each failure look different.
 */
export function DebugOverlay() {
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

      const frame = debugBus.frame;
      if (!frame || performance.now() - frame.stamp > 400) return;

      // Anchor-plane units are normalised by display height, with the origin at
      // the centre — undo both to get back to canvas pixels.
      const toPx = (p: { x: number; y: number }) => ({
        x: p.x * height + width / 2,
        y: height / 2 - p.y * height,
      });

      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeStyle = "rgba(120, 220, 255, 0.55)";
      ctx.beginPath();
      for (const [a, b] of BONES) {
        const pa = toPx(frame.planar[a]);
        const pb = toPx(frame.planar[b]);
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(120, 220, 255, 0.85)";
      for (const p of frame.planar) {
        const q = toPx(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Name each finger at its tip, so the selected one is unambiguous.
      ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      for (const name of FINGER_NAMES) {
        const tip = toPx(frame.planar[FINGER_CHAINS[name].tip]);
        ctx.fillStyle =
          name === frame.finger ? "rgba(255, 214, 120, 0.95)" : "rgba(160, 200, 220, 0.7)";
        ctx.fillText(FINGER_LABELS[name], tip.x, tip.y - 9 * dpr);
      }
      ctx.textAlign = "left";

      // Highlight the targeted phalanx.
      const chain = FINGER_CHAINS[frame.finger];
      const mcp = toPx(frame.planar[chain.mcp]);
      const pip = toPx(frame.planar[chain.pip]);
      ctx.strokeStyle = "rgba(255, 214, 120, 0.95)";
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(mcp.x, mcp.y);
      ctx.lineTo(pip.x, pip.y);
      ctx.stroke();

      // Seat point and the width the ring is drawn at.
      const seat = toPx(frame.seat);
      const ringPx = frame.ringRadius * height;
      const fingerPx = frame.fingerRadius * height;

      const dx = pip.x - mcp.x;
      const dy = pip.y - mcp.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      ctx.strokeStyle = "rgba(255, 120, 160, 0.95)";
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(seat.x - nx * ringPx, seat.y - ny * ringPx);
      ctx.lineTo(seat.x + nx * ringPx, seat.y + ny * ringPx);
      ctx.stroke();

      ctx.strokeStyle = "rgba(140, 255, 180, 0.8)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(seat.x - nx * fingerPx, seat.y - ny * fingerPx - 8 * dpr);
      ctx.lineTo(seat.x + nx * fingerPx, seat.y + ny * fingerPx - 8 * dpr);
      ctx.stroke();
      ctx.setLineDash([]);

      // The finger axis, extended, with an arrowhead: this is the vector every
      // rotation in the system is derived from.
      const axisLen = Math.hypot(dx, dy) * 1.5;
      const tipX = mcp.x + (dx / len) * axisLen;
      const tipY = mcp.y + (dy / len) * axisLen;
      ctx.strokeStyle = "rgba(255, 214, 120, 0.5)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(mcp.x, mcp.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ring bounding box, aligned to the finger rather than to the screen —
      // a screen-aligned box would say nothing about the rotation.
      const bx = (dx / len) * ringPx * 0.6;
      const by = (dy / len) * ringPx * 0.6;
      const cx2 = nx * ringPx;
      const cy2 = ny * ringPx;
      ctx.strokeStyle = "rgba(255, 120, 160, 0.5)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(seat.x - bx - cx2, seat.y - by - cy2);
      ctx.lineTo(seat.x + bx - cx2, seat.y + by - cy2);
      ctx.lineTo(seat.x + bx + cx2, seat.y + by + cy2);
      ctx.lineTo(seat.x - bx + cx2, seat.y - by + cy2);
      ctx.closePath();
      ctx.stroke();

      // What the pixel probe found. If this does not land on your finger's edges,
      // the probe is locking onto something else and the sizing will be wrong.
      if (frame.silhouetteHalfWidth > 0) {
        const probePx = frame.silhouetteHalfWidth * height;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 2 * dpr;
        for (const side of [-1, 1]) {
          const ex = seat.x + nx * probePx * side;
          const ey = seat.y + ny * probePx * side;
          ctx.beginPath();
          ctx.moveTo(ex - dx / len * 7 * dpr, ey - dy / len * 7 * dpr);
          ctx.lineTo(ex + dx / len * 7 * dpr, ey + dy / len * 7 * dpr);
          ctx.stroke();
        }
      }

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `${10.5 * dpr}px ui-monospace, monospace`;
      const lines = [
        `finger  ${FINGER_LABELS[frame.finger]}`,
        `width   ${frame.widthMm.toFixed(1)} mm  ≈ US ${frame.usSize.toFixed(1)}`,
        `probe   ${frame.silhouetteHalfWidth > 0 ? `${(frame.silhouetteHalfWidth * 2 * height).toFixed(0)} px` : "no edges"}`,
        `band    ${(frame.ringRadius * 2 * height).toFixed(0)} px = ${frame.ringDiameterMm.toFixed(1)} mm`,
        `axis    ${frame.axisAngleDeg.toFixed(0)}° on screen, ${frame.tiltDeg.toFixed(0)}° out of plane`,
        `spin    ${frame.rotationOffsetDeg.toFixed(0)}° about the finger`,
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
