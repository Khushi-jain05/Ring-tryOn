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
const MODEL_DEST = "public/mediapipe/models/hand_landmarker.task";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** Roughly the real size, so a truncated download is treated as missing. */
const MODEL_MIN_BYTES = 5_000_000;

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

async function fetchModel() {
  if (await exists(MODEL_DEST, MODEL_MIN_BYTES)) {
    console.log("[mediapipe] hand landmarker model already in place");
    return;
  }
  await mkdir(path.dirname(MODEL_DEST), { recursive: true });
  console.log("[mediapipe] downloading hand landmarker model (~7.5 MB)…");

  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body) {
    throw new Error(`model download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(MODEL_DEST));
  console.log(`[mediapipe] saved ${MODEL_DEST}`);
}

try {
  await copyWasm();
  await fetchModel();
} catch (error) {
  // A missing model breaks the try-on but not the build, and failing the whole
  // install over a network hiccup is worse than a loud warning.
  console.warn(`[mediapipe] setup incomplete: ${error.message}`);
  console.warn("[mediapipe] re-run with: npm run setup:mediapipe");
}
