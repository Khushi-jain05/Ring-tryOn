import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { WASM_PATH } from "@/lib/hand/tracker";

export const POSE_MODEL_PATH = "/mediapipe/models/pose_landmarker_lite.task";

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

/**
 * Creates the shared PoseLandmarker.
 *
 * The "lite" model is a deliberate choice rather than a compromise. A necklace
 * needs the shoulder line and the direction the head is facing; those are the
 * highest-confidence landmarks the pose model produces, and lite locates them
 * essentially as well as full while being a third of the download. The accuracy
 * that the larger models buy is in wrists, knees and ankles, none of which are
 * read here.
 *
 * Served from our own origin, like the hand model, so the try-on works offline
 * and no third party learns that someone opened the page.
 */
async function create(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  const build = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
      // Per-pixel person mask, used to hide the necklace wherever something that
      // is not the wearer covers their neck. Geometry alone cannot do this: the
      // scene contains stand-ins for the neck and nothing else, so a hand, a mug
      // or a phone held in front has no representation to be occluded by, and the
      // jewellery draws straight over it.
      //
      // It costs an extra output tensor per frame, which is the reason it was left
      // off initially. On the lite model that is a 256x256 byte mask — cheap
      // enough next to the inference itself.
      outputSegmentationMasks: true,
    });

  try {
    return await build("GPU");
  } catch {
    return await build("CPU");
  }
}

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  landmarkerPromise ??= create().catch((err) => {
    // Let a later attempt retry rather than caching the rejection forever.
    landmarkerPromise = null;
    throw err;
  });
  return landmarkerPromise;
}

export function disposePoseLandmarker(): void {
  const pending = landmarkerPromise;
  landmarkerPromise = null;
  void pending?.then((lm) => lm.close()).catch(() => {});
}

export type { PoseLandmarkerResult };
