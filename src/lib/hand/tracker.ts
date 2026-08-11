import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

export const WASM_PATH = "/mediapipe/wasm";
export const MODEL_PATH = "/mediapipe/models/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;

/**
 * Creates the shared HandLandmarker. The WASM bundle and the 7.5 MB model are
 * served from our own /public rather than a CDN so the studio works offline,
 * behind strict CSP, and without a third-party round trip on first paint.
 *
 * GPU inference is roughly 3–4x faster than CPU here; we fall back automatically
 * because some Linux/VM browsers report WebGL but fail to create the delegate.
 */
async function create(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  const build = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

  try {
    return await build("GPU");
  } catch {
    return await build("CPU");
  }
}

export function getHandLandmarker(): Promise<HandLandmarker> {
  landmarkerPromise ??= create().catch((err) => {
    // Let a later attempt retry instead of caching the rejection forever.
    landmarkerPromise = null;
    throw err;
  });
  return landmarkerPromise;
}

export function disposeHandLandmarker(): void {
  const pending = landmarkerPromise;
  landmarkerPromise = null;
  void pending?.then((lm) => lm.close()).catch(() => {});
}

export type { HandLandmarkerResult };

/** Which physical hand the model believes it is looking at. */
export type Handedness = "Left" | "Right";

/**
 * MediaPipe labels handedness as seen in the *image*. A selfie camera mirrors
 * the world, so an un-mirrored label is the opposite of the user's real hand.
 */
export function realHandedness(label: string, mirrored: boolean): Handedness {
  const asImage: Handedness = label === "Left" ? "Left" : "Right";
  if (!mirrored) return asImage;
  return asImage === "Left" ? "Right" : "Left";
}
