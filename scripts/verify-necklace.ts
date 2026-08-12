/**
 * Numeric checks on the necklace pose solver, driven by a synthetic upper body.
 *
 * Same reasoning as the ring harness: a necklace that is 20% too large or seated
 * 15 mm too high still looks broadly plausible over a webcam, and by the time it
 * looks wrong you cannot tell which stage produced the error. Feeding the solver a
 * torso whose real dimensions we chose ourselves turns that into an assertion.
 *
 * Run with: npx tsx scripts/verify-necklace.ts
 */
import { Vector3 } from "three";
import {
  NecklacePoseSolver,
  DEFAULT_NECKLACE_ANCHOR,
  type NecklaceSolverOptions,
} from "../src/lib/neck/necklacePose";
import { PL, POSE_LANDMARK_COUNT } from "../src/lib/neck/landmarks";
import { DEFAULT_ONE_EURO } from "../src/lib/hand/oneEuro";
import { ANCHOR_DISTANCE, CAMERA_FOV, type FrameGeometry } from "../src/lib/hand/projection";

/* ------------------------------------------------------------------ */
/* A synthetic adult upper body, in metres, facing the camera          */
/* ------------------------------------------------------------------ */

/** The dimensions the solver is supposed to recover. */
const SHOULDER_WIDTH_M = 0.395;
const NECK_TO_MOUTH_M = 0.155;

/**
 * Builds an upper body squared to the camera, head above shoulders. MediaPipe
 * world convention: +x right, +y down, +z away from the viewer.
 */
function makeBody(): { x: number; y: number; z: number; visibility: number }[] {
  const p = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.99,
  }));

  const set = (i: number, x: number, yUp: number, zToward: number) => {
    p[i] = { x, y: -yUp, z: -zToward, visibility: 0.99 };
  };

  const half = SHOULDER_WIDTH_M / 2;
  // Landmark 11 is the subject's LEFT shoulder, which sits at +x in an
  // unmirrored image of someone facing the camera.
  set(PL.LEFT_SHOULDER, half, 0, 0);
  set(PL.RIGHT_SHOULDER, -half, 0, 0);

  // Head, rising from the neck. The mouth leans slightly forward of the shoulder
  // line, as a head on a neck does.
  set(PL.LEFT_MOUTH, 0.022, NECK_TO_MOUTH_M, 0.05);
  set(PL.RIGHT_MOUTH, -0.022, NECK_TO_MOUTH_M, 0.05);
  set(PL.NOSE, 0, NECK_TO_MOUTH_M + 0.035, 0.075);
  set(PL.LEFT_EAR, 0.075, NECK_TO_MOUTH_M + 0.05, -0.01);
  set(PL.RIGHT_EAR, -0.075, NECK_TO_MOUTH_M + 0.05, -0.01);
  set(PL.LEFT_HIP, half * 0.62, -0.5, 0);
  set(PL.RIGHT_HIP, -half * 0.62, -0.5, 0);

  return p;
}

/** Projects the metric body through a pinhole camera to normalized image coords. */
function project(
  world: ReturnType<typeof makeBody>,
  distance: number,
  aspect: number,
) {
  const f = 1 / Math.tan(((CAMERA_FOV * Math.PI) / 180) / 2);
  return world.map((w) => {
    const depth = distance + w.z;
    return {
      x: (f / aspect) * (w.x / depth) / 2 + 0.5,
      y: (f * (w.y / depth)) / 2 + 0.5,
      z: w.z,
      visibility: w.visibility,
    };
  });
}

let failures = 0;

function check(label: string, actual: number, expected: number, tolerance: number) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${actual.toFixed(4)}  want ${expected.toFixed(4)} ±${tolerance}`,
  );
}

function checkTrue(label: string, value: boolean) {
  if (!value) failures++;
  console.log(`${value ? "PASS" : "FAIL"}  ${label}`);
}

const DISPLAY_W = 900;
const DISPLAY_H = 1125; // the studio's 4:5 portrait stage
const ASPECT = DISPLAY_W / DISPLAY_H;
const DISTANCE = 0.8; // sitting back far enough for both shoulders to be in frame

const geometry: FrameGeometry = {
  videoWidth: DISPLAY_W,
  videoHeight: DISPLAY_H,
  displayWidth: DISPLAY_W,
  displayHeight: DISPLAY_H,
  mirrored: false,
  zoom: 1,
  centerU: 0.5,
  centerV: 0.5,
};

const options: NecklaceSolverOptions = {
  anchor: DEFAULT_NECKLACE_ANCHOR,
  mirrored: false,
  smoothing: DEFAULT_ONE_EURO,
};

function settle(
  world: ReturnType<typeof makeBody>,
  opts: NecklaceSolverOptions = options,
  geo: FrameGeometry = geometry,
  frames = 200,
) {
  const solver = new NecklacePoseSolver();
  const result = {
    landmarks: [project(world, DISTANCE, ASPECT)],
    worldLandmarks: [world],
    segmentationMasks: undefined,
  };
  let pose = null;
  for (let i = 0; i < frames; i++) {
    pose = solver.solve(result as never, geo, opts, i * (1000 / 30));
  }
  return pose;
}

const body = makeBody();

console.log("— Scale and measurement ——————————————————————————");

const pose = settle(body);
if (!pose) {
  console.log("FAIL  solver returned no pose");
  process.exit(1);
}

const f = 1 / Math.tan(((CAMERA_FOV * Math.PI) / 180) / 2);
const expectedScale = f / 2 / DISTANCE;
check("plane units per metre", pose.planeScale, expectedScale, expectedScale * 0.05);
check("shoulder breadth (mm)", pose.shoulderWidthMm, SHOULDER_WIDTH_M * 1000, 8);

console.log("\n— The neck anchor ————————————————————————————————");

// The chain must cross the neck ABOVE the shoulder line — that is where a chain
// sits, at the sternal notch — and below the mouth. Getting this wrong by even a
// couple of centimetres puts the pendant on the collarbone or under the chin.
const image = project(body, DISTANCE, ASPECT);
const toPlane = (i: number) =>
  new Vector3((image[i].x - 0.5) * ASPECT, 0.5 - image[i].y, 0);
const shoulderMid = toPlane(PL.LEFT_SHOULDER)
  .add(toPlane(PL.RIGHT_SHOULDER))
  .multiplyScalar(0.5);
const mouthMid = toPlane(PL.LEFT_MOUTH).add(toPlane(PL.RIGHT_MOUTH)).multiplyScalar(0.5);

console.log(
  `       shoulders y=${shoulderMid.y.toFixed(3)}, anchor y=${pose.position.y.toFixed(3)}, mouth y=${mouthMid.y.toFixed(3)}`,
);
checkTrue("the anchor sits above the shoulder line", pose.position.y > shoulderMid.y);
checkTrue("the anchor sits below the mouth", pose.position.y < mouthMid.y);
check("the anchor is centred between the shoulders", pose.position.x, shoulderMid.x, 0.004);

// Neck radius against the anthropometric expectation. A 395 mm shoulder breadth
// implies a neck a little under 60 mm in radius.
console.log(`       neck radius ${(pose.neckRadius / pose.planeScale * 1000).toFixed(1)} mm`);
const neckMm = (pose.neckRadius / pose.planeScale) * 1000;
checkTrue("the neck radius is anatomically plausible", neckMm > 45 && neckMm < 75);

console.log("\n— Orientation ————————————————————————————————————");

const across = new Vector3(1, 0, 0).applyQuaternion(pose.quaternion);
const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
const forward = new Vector3(0, 0, 1).applyQuaternion(pose.quaternion);

check("the shoulder axis is horizontal", Math.abs(across.y), 0, 0.06);
check("the neck axis points up the screen", up.y, 1, 0.06);
// Facing the camera, the pendant's face must point out of the screen at the viewer.
console.log(`       chest normal (${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)})`);
checkTrue("the pendant faces the viewer when the chest does", forward.z > 0.9);

// A basis that is not right-handed is not a rotation, and would mirror the piece.
const handedness = across.clone().cross(up).dot(forward);
check("the basis stays right-handed", handedness, 1, 0.02);

console.log("\n— Mirroring ——————————————————————————————————————");

const mirrored = settle(
  body,
  { ...options, mirrored: true },
  { ...geometry, mirrored: true },
);
check("mirrored anchor x is negated", mirrored!.position.x, -pose.position.x, 0.004);
check("mirrored anchor y is unchanged", mirrored!.position.y, pose.position.y, 0.004);
check(
  "mirrored neck radius is unchanged",
  mirrored!.neckRadius,
  pose.neckRadius,
  pose.neckRadius * 0.02,
);
const mAcross = new Vector3(1, 0, 0).applyQuaternion(mirrored!.quaternion);
const mUp = new Vector3(0, 1, 0).applyQuaternion(mirrored!.quaternion);
const mForward = new Vector3(0, 0, 1).applyQuaternion(mirrored!.quaternion);
check("mirrored basis stays right-handed", mAcross.clone().cross(mUp).dot(mForward), 1, 0.02);
checkTrue("the mirrored pendant still faces the viewer", mForward.z > 0.9);

console.log("\n— Distance invariance ————————————————————————————");

// Moving closer or further must not change the measured *body*, only its pixels.
for (const distance of [0.55, 1.2]) {
  const solver = new NecklacePoseSolver();
  const result = {
    landmarks: [project(body, distance, ASPECT)],
    worldLandmarks: [body],
    segmentationMasks: undefined,
  };
  let p = null;
  for (let i = 0; i < 200; i++) p = solver.solve(result as never, geometry, options, i * (1000 / 30));

  check(
    `shoulder breadth at ${distance} m`,
    p!.shoulderWidthMm,
    SHOULDER_WIDTH_M * 1000,
    8,
  );
  // The on-screen size must scale as 1/distance, which is what the plane scale is.
  check(
    `plane scale at ${distance} m`,
    p!.planeScale,
    f / 2 / distance,
    (f / 2 / distance) * 0.05,
  );
}

console.log("\n— Turning and leaning ————————————————————————————");

const rotY = (a: number) => (p: { x: number; y: number; z: number; visibility: number }) => ({
  x: p.x * Math.cos(a) + p.z * Math.sin(a),
  y: p.y,
  z: -p.x * Math.sin(a) + p.z * Math.cos(a),
  visibility: p.visibility,
});
const rotZ = (a: number) => (p: { x: number; y: number; z: number; visibility: number }) => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
  z: p.z,
  visibility: p.visibility,
});

for (const [label, transform] of [
  ["turned 35° to one side", rotY(0.61)],
  ["turned 35° to the other", rotY(-0.61)],
  ["leaning 20°", rotZ(0.35)],
] as const) {
  const turned = body.map(transform);
  const p = settle(turned);
  if (!p) {
    failures++;
    console.log(`FAIL  ${label}: no pose`);
    continue;
  }
  // The body is rigid, so its measured breadth must not change with pose.
  const breadthOk = Math.abs(p.shoulderWidthMm - SHOULDER_WIDTH_M * 1000) < 12;
  // And the piece must stay on the neck, between shoulders and mouth.
  const turnedImage = project(turned, DISTANCE, ASPECT);
  const sMid =
    ((0.5 - turnedImage[PL.LEFT_SHOULDER].y) + (0.5 - turnedImage[PL.RIGHT_SHOULDER].y)) / 2;
  const mMid =
    ((0.5 - turnedImage[PL.LEFT_MOUTH].y) + (0.5 - turnedImage[PL.RIGHT_MOUTH].y)) / 2;
  const seatOk = p.position.y > sMid - 0.01 && p.position.y < mMid;

  if (breadthOk && seatOk) {
    console.log(
      `PASS  ${label}: breadth ${p.shoulderWidthMm.toFixed(0)} mm, facing ${p.facing.toFixed(2)}`,
    );
  } else {
    failures++;
    console.log(
      `FAIL  ${label}: breadth ${p.shoulderWidthMm.toFixed(0)} mm, seat ${seatOk ? "ok" : "off the neck"}`,
    );
  }
}

console.log("\n— Depth placement ————————————————————————————————");

// Same identity the ring relies on: displacing the piece in Z under a perspective
// camera must not move it on screen, because the solver already reported the right
// screen position.
const D = ANCHOR_DISTANCE;
const k = (D - pose.anchorDepth) / D;
const projected = {
  x: (pose.position.x * k * D) / (D - pose.anchorDepth),
  y: (pose.position.y * k * D) / (D - pose.anchorDepth),
};
const drift = Math.hypot(projected.x - pose.position.x, projected.y - pose.position.y);
console.log(`       anchor depth ${pose.anchorDepth.toFixed(4)} u, drift ${drift.toExponential(1)} u`);
checkTrue("depth compensation preserves the screen position", drift < 1e-9);

console.log("\n— Missing shoulders ——————————————————————————————");

// A necklace hangs off the shoulder girdle. Cropped at the chin there is nothing
// to hang it from, and guessing would put a chain across someone's face.
const cropped = makeBody().map((p, i) =>
  i === PL.LEFT_SHOULDER || i === PL.RIGHT_SHOULDER ? { ...p, visibility: 0.1 } : p,
);
checkTrue("no pose is produced without both shoulders", settle(cropped) === null);

console.log(
  failures === 0 ? "\nAll necklace checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
