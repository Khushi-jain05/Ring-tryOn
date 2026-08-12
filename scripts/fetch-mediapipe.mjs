/**
 * Puts the MediaPipe runtime and hand-landmarker model into public/mediapipe.
 *
 * These are served from our own origin rather than a CDN so the try-on works
 * offline, under a strict CSP, and without a third-party learning that someone
 * opened the page. But they are 41 MB of binaries that are entirely reproducible
 * — the WASM is copied out of the installed package, and the model is a versioned
 * Google artifact — so they are fetched here instead of committed.
 *
 * Runs automatically after `npm install`; safe to re-run.
 */
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

const WASM_SRC = "node_modules/@mediapipe/tasks-vision/wasm";
const WASM_DEST = "public/mediapipe/wasm";
const MODELS = [
  {
    name: "hand landmarker",
    dest: "public/mediapipe/models/hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    // Roughly the real size, so a truncated download is treated as missing.
    minBytes: 5_000_000,
    approx: "7.5 MB",
  },
  {
    // Necklaces sit on the neck and chest, which the hand model cannot see. The
    // "lite" pose model is used deliberately: a necklace only needs the shoulder
    // line and the head's direction, and lite is a third the size of full for
    // no loss on those particular landmarks.
    name: "pose landmarker",
    dest: "public/mediapipe/models/pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    minBytes: 3_000_000,
    approx: "5.5 MB",
  },
];

async function exists(target, minBytes = 1) {
  try {
    const info = await stat(target);
    return info.size >= minBytes;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    console.warn(
      `[mediapipe] ${WASM_SRC} not found — run npm install first. Skipping.`,
    );
    return;
  }
  await mkdir(WASM_DEST, { recursive: true });
  const files = await readdir(WASM_SRC);
  let copied = 0;
  for (const file of files) {
    const dest = path.join(WASM_DEST, file);
    if (await exists(dest)) continue;
    await copyFile(path.join(WASM_SRC, file), dest);
    copied++;
  }
  console.log(
    copied > 0
      ? `[mediapipe] copied ${copied} runtime file(s) into ${WASM_DEST}`
      : "[mediapipe] runtime already in place",
  );
}

async function fetchModel(model) {
  if (await exists(model.dest, model.minBytes)) {
    console.log(`[mediapipe] ${model.name} model already in place`);
    return;
  }
  await mkdir(path.dirname(model.dest), { recursive: true });
  console.log(`[mediapipe] downloading ${model.name} model (~${model.approx})…`);

  const response = await fetch(model.url);
  if (!response.ok || !response.body) {
    throw new Error(`${model.name} download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(model.dest));
  console.log(`[mediapipe] saved ${model.dest}`);
}

try {
  await copyWasm();
  for (const model of MODELS) await fetchModel(model);
} catch (error) {
  // A missing model breaks the try-on but not the build, and failing the whole
  // install over a network hiccup is worse than a loud warning.
  console.warn(`[mediapipe] setup incomplete: ${error.message}`);
  console.warn("[mediapipe] re-run with: npm run setup:mediapipe");
}
