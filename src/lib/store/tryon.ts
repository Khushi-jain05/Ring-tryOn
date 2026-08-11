"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_ONE_EURO, type OneEuroConfig } from "@/lib/hand/oneEuro";
import type { FingerName } from "@/lib/hand/landmarks";
import { anchorFor, type RingAnchor } from "@/lib/hand/anchor";
import { RINGS } from "@/lib/rings/catalog";
import { DEFAULT_SIZE, sizeToDiameterMm, snapToStockSize } from "@/lib/rings/sizes";
import type { MetalId } from "@/lib/rings/types";

export type TrackingStatus =
  | "idle"
  | "loading-model"
  | "requesting-camera"
  | "searching"
  | "tracking"
  | "denied"
  | "error";

/** What the camera currently believes about the finger, in real millimetres. */
export type SizeReading = {
  widthMm: number;
  circumferenceMm: number;
  usSize: number;
  /** Interquartile spread as a fraction of the median; lower is steadier. */
  spread: number;
  settled: boolean;
};

export type CalibrationSource = "none" | "card" | "known-size";

type Persisted = {
  metricBias: number;
  calibrationSource: CalibrationSource;
};

type TryOnState = Persisted & {
  ringId: string;
  metal: MetalId;
  finger: FingerName;

  /** US size the ring is drawn at when auto-fit is off. */
  ringSize: number;
  /** Draw at the measured finger width rather than the chosen size. */
  autoFit: boolean;
  /** Live measurement from the camera, or null before one settles. */
  reading: SizeReading | null;
  /** True once we have auto-selected a size from the first settled reading. */
  sizeAdopted: boolean;
  /** True while the card-alignment overlay is up. */
  calibratingWithCard: boolean;

  /** Where the ring sits, in finger-relative terms. Never screen coordinates. */
  anchor: RingAnchor;
  mirrored: boolean;
  flipGem: boolean;
  /** Fixed magnification of the centre of the frame, 1 being uncropped. */
  zoom: number;
  /**
   * Keep the setting turned toward the viewer instead of riding round with the
   * hand.
   *
   * Off by default, because a ring's stone belongs on the back of the finger: it
   * should be on show when the back of the hand faces the camera and hidden behind
   * the finger when the palm does. Turning it on trades that for always being able
   * to see the stone, which is occasionally useful and never realistic.
   */
  settingFacesCamera: boolean;
  /**
   * Measure the finger's width from the video pixels rather than from hand
   * proportions. Off by default: it is unbiased when it works and badly wrong
   * when it locks onto a crease instead of the finger's edge.
   */
  usePixelProbe: boolean;
  showDiagnostics: boolean;
  smoothing: OneEuroConfig;
  status: TrackingStatus;
  errorMessage: string | null;
  fps: number;

  setRing: (ringId: string) => void;
  setMetal: (metal: MetalId) => void;
  setFinger: (finger: FingerName) => void;
  setRingSize: (size: number) => void;
  setAutoFit: (autoFit: boolean) => void;
  setReading: (reading: SizeReading | null) => void;
  startCardCalibration: () => void;
  cancelCardCalibration: () => void;
  applyCardCalibration: (bias: number) => void;
  calibrateToKnownSize: (knownSize: number) => void;
  resetCalibration: () => void;
  setAnchor: (patch: Partial<RingAnchor>) => void;
  toggleMirrored: () => void;
  toggleFlipGem: () => void;
  setZoom: (zoom: number) => void;
  toggleSettingFacesCamera: () => void;
  togglePixelProbe: () => void;
  toggleDiagnostics: () => void;
  setSmoothing: (smoothing: Partial<OneEuroConfig>) => void;
  setStatus: (status: TrackingStatus, errorMessage?: string | null) => void;
  setFps: (fps: number) => void;
};

export const useTryOnStore = create<TryOnState>()(
  persist(
    (set, get) => ({
      ringId: RINGS[0].id,
      metal: RINGS[0].metals[0],
      finger: "ring",

      ringSize: DEFAULT_SIZE,
      autoFit: true,
      metricBias: 1,
      calibrationSource: "none",
      reading: null,
      sizeAdopted: false,
      calibratingWithCard: false,

      anchor: anchorFor("ring"),
      mirrored: true,
      flipGem: false,
      zoom: 1.7,
      settingFacesCamera: false,
      usePixelProbe: false,
      showDiagnostics: false,
      smoothing: DEFAULT_ONE_EURO,
      status: "idle",
      errorMessage: null,
      fps: 0,

      setRing: (ringId) =>
        set((state) => {
          const ring = RINGS.find((r) => r.id === ringId);
          if (!ring) return state;
          // Carry the current metal over when the new ring offers it, so switching
          // designs does not silently change what the shopper is looking at.
          const metal = ring.metals.includes(state.metal) ? state.metal : ring.metals[0];
          return { ringId, metal };
        }),
      setMetal: (metal) => set({ metal }),
      setFinger: (finger) =>
        // A different finger is a different measurement, and a different anchor:
        // a ring rides higher on a pinky than on an index finger.
        set((s) => ({
          finger,
          anchor: anchorFor(finger, {
            widthMultiplier: s.anchor.widthMultiplier,
            rotationOffset: s.anchor.rotationOffset,
          }),
          reading: null,
          sizeAdopted: false,
        })),

      setRingSize: (ringSize) => set({ ringSize, autoFit: false }),
      setAutoFit: (autoFit) => set({ autoFit }),

      setReading: (reading) =>
        set((state) => {
          if (!reading) return { reading };
          // The first steady reading picks the size for the user, so the ring they
          // see is the one that would actually fit. After that it is theirs.
          if (!state.sizeAdopted && reading.settled) {
            return {
              reading,
              ringSize: snapToStockSize(reading.usSize),
              sizeAdopted: true,
            };
          }
          return { reading };
        }),

      startCardCalibration: () => set({ calibratingWithCard: true }),
      cancelCardCalibration: () => set({ calibratingWithCard: false }),

      applyCardCalibration: (bias) =>
        set({
          metricBias: bias,
          calibrationSource: "card",
          calibratingWithCard: false,
          // The previous reading was computed with the old bias.
          reading: null,
          sizeAdopted: false,
        }),

      calibrateToKnownSize: (knownSize) => {
        const { reading, metricBias } = get();
        if (!reading) return;
        const measured = reading.usSize;
        if (!(measured > 0)) return;
        // Reported diameter scales as 1/bias, so to make the reading read
        // `knownSize` the bias moves by the ratio of the two diameters.
        const next =
          metricBias * (sizeToDiameterMm(measured) / sizeToDiameterMm(knownSize));
        if (!Number.isFinite(next) || next < 0.5 || next > 2) return;
        set({
          metricBias: next,
          calibrationSource: "known-size",
          ringSize: snapToStockSize(knownSize),
          sizeAdopted: true,
          reading: null,
        });
      },

      resetCalibration: () =>
        set({
          metricBias: 1,
          calibrationSource: "none",
          sizeAdopted: false,
          reading: null,
        }),

      setAnchor: (patch) => set((s) => ({ anchor: { ...s.anchor, ...patch } })),
      toggleMirrored: () => set((s) => ({ mirrored: !s.mirrored })),
      toggleFlipGem: () => set((s) => ({ flipGem: !s.flipGem })),
      setZoom: (zoom) => set({ zoom }),
      toggleSettingFacesCamera: () =>
        set((s) => ({ settingFacesCamera: !s.settingFacesCamera })),
      togglePixelProbe: () =>
        set((s) => ({ usePixelProbe: !s.usePixelProbe, reading: null, sizeAdopted: false })),
      toggleDiagnostics: () => set((s) => ({ showDiagnostics: !s.showDiagnostics })),
      setSmoothing: (smoothing) =>
        set((s) => ({ smoothing: { ...s.smoothing, ...smoothing } })),
      setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
      setFps: (fps) => set({ fps }),
    }),
    {
      name: "aurelia-tryon",
      // A hand does not change size between visits, so the calibration is worth
      // keeping. Nothing else here is; a stale ring or status would be confusing.
      partialize: (state): Persisted => ({
        metricBias: state.metricBias,
        calibrationSource: state.calibrationSource,
      }),
    },
  ),
);
