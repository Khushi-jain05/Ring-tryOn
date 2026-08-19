/**
 * A mailbox for what the necklace solver last computed.
 *
 * Same one-slot, no-subscribers arrangement the ring's bus uses, and for the same
 * reason: this is written every frame from inside the render loop, so it must not
 * touch React state.
 *
 * It exists because a necklace that is placed wrongly is very hard to describe.
 * "It is not on my neck" can mean the anchor is low, the neck is measured too wide,
 * the arc is the wrong size, or the piece has been hidden entirely — and those have
 * completely different causes. Drawing what the solver believes turns one unfalsifiable
 * complaint into a specific observation.
 */
import type { NecklacePose } from "./necklacePose";

export type NeckDebugFrame = {
  planar: { x: number; y: number }[];
  /** Where the chain crosses, in anchor-plane units. */
  anchor: { x: number; y: number };
  /** Neck radius, in anchor-plane units. */
  neckRadius: number;
  /** Shoulder span, in anchor-plane units. */
  shoulderSpan: number;
  neckCircumferenceMm: number;
  neckLengthMm: number;
  shoulderWidthMm: number;
  headTurnDeg: number;
  /** Visibility of the least-certain landmark the solve depends on. */
  confidence: number;
  /** Whether the head-breadth cue was folded into the width estimate. */
  twoCues: boolean;
  planeScale: number;
  facing: number;
  /** How far below the anchor the piece reaches, in anchor-plane units. */
  dropUnits: number;
  stamp: number;
};

export const neckDebugBus: { frame: NeckDebugFrame | null } = { frame: null };

export function publishNeckDebug(pose: NecklacePose, dropUnits: number, stamp: number): void {
  neckDebugBus.frame = {
    planar: pose.planar as { x: number; y: number }[],
    anchor: { x: pose.position.x, y: pose.position.y },
    neckRadius: pose.neckRadius,
    shoulderSpan: pose.shoulderSpan,
    neckCircumferenceMm: pose.neckCircumferenceMm,
    neckLengthMm: pose.neckLengthMm,
    shoulderWidthMm: pose.shoulderWidthMm,
    headTurnDeg: pose.headTurnDeg,
    confidence: pose.confidence,
    twoCues: pose.neckFromHead,
    planeScale: pose.planeScale,
    facing: pose.facing,
    dropUnits,
    stamp,
  };
}

export function clearNeckDebug(): void {
  neckDebugBus.frame = null;
}
