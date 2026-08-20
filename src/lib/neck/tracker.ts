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

  const build = (delegate: "GPU" | "CPU", segmentation: boolean) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
      /**
       * Per-pixel person mask, used to hide the necklace wherever something that is
       * not the wearer covers their neck. Geometry alone cannot do that: the scene
       * holds stand-ins for the neck and nothing else, so a hand or a mug in front
       * has nothing to be occluded by and the jewellery draws straight over it.
       */
      outputSegmentationMasks: segmentation,
    });

  /**
   * Four attempts, and the order matters.
   *
   * The segmentation head is an *optional* output — whether a given model file and
   * WASM build support it is not something this code can know in advance. Asking for
   * it when it is unavailable does not return a landmarker without masks: it throws,
   * and the whole tracker then fails to load. So the necklace does not lose its
   * object occlusion, it stops being tracked at all, which presents as the necklace
   * simply never appearing.
   *
   * Occlusion is a refinement and tracking is the feature, so tracking wins: both
   * delegates are tried with masks first, then both again without. `hasSegmentation`
   * records which way it went so the renderer can tell the difference between "no
   * obstruction in front of you" and "this build cannot see obstructions".
   */
  const attempts: [delegate: "GPU" | "CPU", segmentation: boolean][] = [
    ["GPU", true],
    ["CPU", true],
    ["GPU", false],
    ["CPU", false],
  ];

  let lastError: unknown;
  for (const [delegate, segmentation] of attempts) {
    try {
      const landmarker = await build(delegate, segmentation);
      hasSegmentation = segmentation;
      if (!segmentation) {
        console.warn(
          "[pose] this build cannot produce segmentation masks; the necklace will " +
            "track but will not hide behind objects held in front of it.",
        );
      }
      return landmarker;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("pose landmarker unavailable");
}

/**
 * Whether the loaded landmarker actually produces segmentation masks.
 *
 * Read by the renderer so a build without them degrades to landmark-only occlusion
 * rather than waiting for masks that will never arrive.
 */
let hasSegmentation = false;

export function poseHasSegmentation(): boolean {
  return hasSegmentation;
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
