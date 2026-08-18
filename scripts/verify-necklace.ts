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
import {
  ANCHOR_DISTANCE,
  CAMERA_FOV,
  maskUvTransform,
  projectToAnchorPlane,
  type FrameGeometry,
} from "../src/lib/hand/projection";
import { NECK_OCCLUDER, occluderExtent } from "../src/lib/jewellery/fit";
import { NECKLACES, dropFactorFor } from "../src/lib/jewellery/catalog";

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
function makeBody(
  frame = 1,
  neckLengthScale = 1,
  /** Head yaw in radians, about the neck's axis. The torso does not move. */
  headYaw = 0,
): { x: number; y: number; z: number; visibility: number }[] {
  const p = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.99,
  }));

  /**
   * Everything is offset off the optical axis, deliberately.
   *
   * A body centred in frame puts the shoulder midpoint at the origin in *both* the
   * metric world space and the anchor-plane space, which makes those two spaces
   * numerically indistinguishable there — so a bug that confuses one for the other
   * is invisible. Exactly that happened: a refactor reused one scratch vector for
   * both midpoints, the necklace was drawn at the centre of the frame instead of on
   * the neck, and the whole suite still passed.
   *
   * Sitting the body low and a little to one side is also how someone actually
   * appears in a head-and-shoulders shot.
   */
  const set = (i: number, x: number, yUp: number, zToward: number) => {
    p[i] = { x, y: -yUp, z: -zToward, visibility: 0.99 };
  };

  const half = (SHOULDER_WIDTH_M * frame) / 2;
  const neck = NECK_TO_MOUTH_M * frame * neckLengthScale;
  // Landmark 11 is the subject's LEFT shoulder, which sits at +x in an
  // unmirrored image of someone facing the camera.
  set(PL.LEFT_SHOULDER, half, 0, 0);
  set(PL.RIGHT_SHOULDER, -half, 0, 0);

  // Head, rising from the neck. The mouth leans slightly forward of the shoulder
  // line, as a head on a neck does.
  set(PL.LEFT_MOUTH, 0.022 * frame, neck, 0.05 * frame);
  set(PL.RIGHT_MOUTH, -0.022 * frame, neck, 0.05 * frame);
  set(PL.NOSE, 0, neck + 0.035 * frame, 0.075 * frame);
  // Head breadth: the second, independent cue for how wide the neck is.
  set(PL.LEFT_EAR, 0.075 * frame, neck + 0.05 * frame, -0.01 * frame);
  set(PL.RIGHT_EAR, -0.075 * frame, neck + 0.05 * frame, -0.01 * frame);
  set(PL.LEFT_HIP, half * 0.62, -0.5, 0);
  set(PL.RIGHT_HIP, -half * 0.62, -0.5, 0);

  // Turn the head on its own, about the neck's axis, leaving the shoulders where
  // they are. The head's landmarks all sit forward of that axis, so they swing a
  // long way — which is exactly why deriving the necklace's frame from them was
  // wrong.
  if (headYaw !== 0) {
    const pivotY = -neck * 0.55; // roughly the top of the neck, in world y-down
    const c = Math.cos(headYaw);
    const s2 = Math.sin(headYaw);
    for (const i of [
      PL.NOSE,
      PL.LEFT_EYE,
      PL.RIGHT_EYE,
      PL.LEFT_EAR,
      PL.RIGHT_EAR,
      PL.LEFT_MOUTH,
      PL.RIGHT_MOUTH,
    ]) {
      const q = p[i];
      const dy = q.y - pivotY;
      p[i] = {
        x: q.x * c + q.z * s2,
        y: pivotY + dy,
        z: -q.x * s2 + q.z * c,
        visibility: q.visibility,
      };
    }
  }

  // Offset applied last, so every rotation above happens about the body's own axis
  // rather than about the frame's centre.
  return offsetBody(p);
}

/**
 * Shifts a body off the optical axis.
 *
 * Applied to every fixture, deliberately. A body centred in frame puts the shoulder
 * midpoint at the origin in *both* the metric world space and the anchor-plane
 * space, which makes those two spaces numerically indistinguishable there — so a bug
 * that confuses one for the other is invisible. Exactly that happened: a refactor
 * reused one scratch vector for both midpoints, the necklace was drawn at the centre
 * of the frame instead of on the neck, and the whole suite still passed.
 *
 * Sitting low and a little to one side is also how someone actually appears in a
 * head-and-shoulders shot.
 */
const BODY_OFFSET = { x: 0.045, yUp: -0.085 };

function offsetBody<T extends { x: number; y: number; z: number }>(body: T[]): T[] {
  return body.map((q) => ({ ...q, x: q.x + BODY_OFFSET.x, y: q.y - BODY_OFFSET.yUp }));
}

/** Undoes the offset, so a fixture can be rotated about the body's own axis. */
function centreBody<T extends { x: number; y: number; z: number }>(body: T[]): T[] {
  return body.map((q) => ({ ...q, x: q.x - BODY_OFFSET.x, y: q.y + BODY_OFFSET.yUp }));
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

// Pinned exactly, not merely bracketed.
//
// The three checks above are all satisfiable by accident, and were: a refactor
// reused one scratch vector for both the plane-space and metric shoulder midpoints,
// so the anchor came out in metres and landed near the frame's origin — with the
// necklace nowhere near the wearer's neck. The numbers still happened to fall
// between the shoulder line and the mouth, so every assertion passed. Anchoring the
// expected value to the *plane* shoulder midpoint is what makes that impossible:
// a position computed in the wrong space cannot agree with it.
const expectedRise = (pose.neckLengthMm / 1000) * pose.planeScale * 0.2;
check(
  "the anchor is exactly one notch-height above the plane shoulder midpoint",
  pose.position.y,
  shoulderMid.y + expectedRise,
  0.003,
);
// And it has to be near the shoulders at all — a couple of neck radii, not a
// fraction of the frame away.
console.log(
  `       anchor is ${Math.hypot(pose.position.x - shoulderMid.x, pose.position.y - shoulderMid.y).toFixed(4)} from the shoulder midpoint (neck radius ${pose.neckRadius.toFixed(4)})`,
);
checkTrue(
  "the anchor is within a neck's reach of the shoulders",
  Math.hypot(pose.position.x - shoulderMid.x, pose.position.y - shoulderMid.y) <
    pose.neckRadius * 3,
);

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

console.log("\n— Mask sampling follows the preview's crop ————————");

/**
 * The per-pixel wearer mask is computed in *video* space and consumed by a shader
 * drawing in *screen* space, so it has to be sampled through the same cover fit,
 * crop and mirror the preview applies. Get that wrong and the occlusion lands
 * somewhere other than the obstruction it is meant to hide — which is worse than no
 * occlusion, because the piece then disappears over the wearer instead.
 *
 * Checked by round-tripping: project a landmark to the screen, convert that screen
 * position to the quad's UV, run the mask transform, and confirm it arrives back at
 * the landmark's own position in the frame.
 */
{
  const cases: { label: string; geo: FrameGeometry }[] = [
    { label: "unmirrored, 1x", geo: { ...geometry, mirrored: false, zoom: 1 } },
    { label: "mirrored, 1x", geo: { ...geometry, mirrored: true, zoom: 1 } },
    { label: "mirrored, 1.9x", geo: { ...geometry, mirrored: true, zoom: 1.9 } },
    {
      label: "wide video into a tall stage",
      geo: { ...geometry, videoWidth: 1280, videoHeight: 720, mirrored: true, zoom: 1.4 },
    },
  ];

  for (const { label, geo } of cases) {
    const uv = maskUvTransform(geo);
    let worst = 0;

    for (const index of [PL.LEFT_SHOULDER, PL.RIGHT_SHOULDER, PL.NOSE, PL.LEFT_EAR]) {
      const lm = image[index];
      // Where the preview puts this landmark, in anchor-plane units...
      const plane = projectToAnchorPlane(lm.x, lm.y, geo, { x: 0, y: 0 });
      // ...converted to the quad's UV, which runs 0..1 across the display with V up.
      const quadU = plane.x / (geo.displayWidth / geo.displayHeight) + 0.5;
      const quadV = plane.y + 0.5;
      // ...and back to the frame through the mask transform.
      const backU = quadU * uv.scaleX + uv.offsetX;
      const backV = quadV * uv.scaleY + uv.offsetY;

      worst = Math.max(worst, Math.abs(backU - lm.x), Math.abs(backV - lm.y));
    }

    console.log(`       ${label}: worst round-trip error ${worst.toExponential(1)}`);
    checkTrue(`mask UV round-trips under ${label}`, worst < 1e-9);
  }
}

console.log("\n— Turning the head only ——————————————————————————");

/**
 * A necklace must not move when only the head turns.
 *
 * It sits on the base of the neck, which is part of the torso, and looking over your
 * shoulder does not move your collarbones. But every head landmark sits well
 * forward of the neck's axis, so all of them swing a long way — and the frame used
 * to take its up-axis, its neck length and its depth from the midpoint of the mouth
 * corners. The whole collar therefore tilted, rose and shifted with the head, which
 * is the fault being fixed here.
 */
{
  // Settle facing forward first, so the neck length has been measured from a square
  // frame and latched, exactly as it would be in use.
  const solver = new NecklacePoseSolver();
  const forwardResult = {
    landmarks: [project(makeBody(), DISTANCE, ASPECT)],
    worldLandmarks: [makeBody()],
    segmentationMasks: undefined,
  };
  let frame = 0;
  let base = null;
  for (let i = 0; i < 200; i++) {
    base = solver.solve(forwardResult as never, geometry, options, frame++ * (1000 / 30));
  }

  const reference = {
    x: base!.position.x,
    y: base!.position.y,
    neck: base!.neckRadiusMm,
    length: base!.neckLengthMm,
    up: new Vector3(0, 1, 0).applyQuaternion(base!.quaternion),
  };

  let worstShift = 0;
  let worstTilt = 0;
  let worstNeck = 0;
  let worstLength = 0;

  for (const deg of [-90, -60, -30, 30, 60, 90]) {
    const world = makeBody(1, 1, (deg * Math.PI) / 180);
    const result = {
      landmarks: [project(world, DISTANCE, ASPECT)],
      worldLandmarks: [world],
      segmentationMasks: undefined,
    };
    let p = null;
    for (let i = 0; i < 90; i++) {
      p = solver.solve(result as never, geometry, options, frame++ * (1000 / 30));
    }

    const shift = Math.hypot(p!.position.x - reference.x, p!.position.y - reference.y);
    const up = new Vector3(0, 1, 0).applyQuaternion(p!.quaternion);
    const tilt = (up.angleTo(reference.up) * 180) / Math.PI;

    worstShift = Math.max(worstShift, shift);
    worstTilt = Math.max(worstTilt, tilt);
    worstNeck = Math.max(worstNeck, Math.abs(p!.neckRadiusMm - reference.neck));
    worstLength = Math.max(worstLength, Math.abs(p!.neckLengthMm - reference.length));
  }

  // Tolerances as a fraction of the neck, which is what "visibly moved" means here.
  const shiftLimit = base!.neckRadius * 0.12;
  console.log(
    `       worst over ±90° of head yaw: shift ${worstShift.toFixed(5)} (limit ${shiftLimit.toFixed(5)}), tilt ${worstTilt.toFixed(2)}°`,
  );
  console.log(
    `       neck width moved ${worstNeck.toFixed(2)} mm, neck length moved ${worstLength.toFixed(2)} mm`,
  );

  checkTrue("the collar does not move when the head turns", worstShift < shiftLimit);
  checkTrue("the collar does not tilt when the head turns", worstTilt < 3);
  checkTrue("the measured neck width holds when the head turns", worstNeck < 3);
  checkTrue("the latched neck length holds when the head turns", worstLength < 4);
}

console.log("\n— Hips out of frame ——————————————————————————————");

/**
 * The framing a necklace try-on actually gets: head and shoulders, no hips.
 *
 * The torso's up-axis comes from the hips when they are visible, and Pose Landmarker
 * reports all 33 landmarks on every frame whether or not it can see them — filling
 * the rest in by inference. So the hips arrive as a plausible-looking guess, and
 * trusting it would mean building the frame on invented data. This checks the
 * visibility gate catches that and the gravity fallback holds up, including through
 * a head turn.
 */
{
  const cropped = (headYaw = 0) =>
    makeBody(1, 1, headYaw).map((p, i) =>
      i === PL.LEFT_HIP || i === PL.RIGHT_HIP ? { ...p, visibility: 0.2 } : p,
    );

  const square = settle(cropped());
  if (!square) {
    failures++;
    console.log("FAIL  no pose with the hips cropped out");
  } else {
    const up = new Vector3(0, 1, 0).applyQuaternion(square.quaternion);
    const across = new Vector3(1, 0, 0).applyQuaternion(square.quaternion);
    const forward = new Vector3(0, 0, 1).applyQuaternion(square.quaternion);

    console.log(
      `       fallback frame: up (${up.x.toFixed(2)}, ${up.y.toFixed(2)}, ${up.z.toFixed(2)})`,
    );
    check("the fallback up-axis still points up the screen", up.y, 1, 0.06);
    checkTrue("the fallback still faces the viewer", forward.z > 0.9);
    check(
      "the fallback basis is still right-handed",
      across.clone().cross(up).dot(forward),
      1,
      0.02,
    );

    // And it must still be head-independent, which is the whole point.
    let worst = 0;
    for (const deg of [-90, 90]) {
      const turned = settle(cropped((deg * Math.PI) / 180));
      worst = Math.max(
        worst,
        Math.hypot(
          turned!.position.x - square.position.x,
          turned!.position.y - square.position.y,
        ),
      );
    }
    console.log(`       worst shift with hips cropped and head at ±90°: ${worst.toFixed(5)}`);
    checkTrue(
      "the fallback frame is head-independent too",
      worst < square.neckRadius * 0.12,
    );
  }
}

console.log("\n— Changing the zoom mid-session ———————————————————");

/**
 * Adjusting the preview's zoom must not disturb where the piece sits.
 *
 * Plane coordinates scale linearly with the crop, so a zoom change silently changes
 * the units the smoothing filters' history is in. Left alone the filters read that
 * as a real, sudden movement and spend the next second or so chasing a step that
 * never physically happened — on screen the necklace drifts off the neck after every
 * zoom adjustment and then creeps back. The fix converts the history into the new
 * units instead, and this is the check that it lands immediately rather than
 * settling.
 */
{
  const solver = new NecklacePoseSolver();
  const result = {
    landmarks: [project(body, DISTANCE, ASPECT)],
    worldLandmarks: [body],
    segmentationMasks: undefined,
  };

  // Settle at 1x.
  let frame = 0;
  let settled = null;
  for (let i = 0; i < 200; i++) {
    settled = solver.solve(result as never, geometry, options, frame++ * (1000 / 30));
  }
  const before = {
    y: settled!.position.y,
    scale: settled!.planeScale,
    neck: settled!.neckRadiusMm,
  };

  // Now crop in. Landmarks are unchanged in video space; only the crop moves.
  const ZOOM = 1.8;
  const zoomed: FrameGeometry = { ...geometry, zoom: ZOOM };
  const zoomedResult = {
    landmarks: [project(body, DISTANCE, ASPECT)],
    worldLandmarks: [body],
    segmentationMasks: undefined,
  };

  // One single frame after the change — no time to settle.
  const first = solver.solve(zoomedResult as never, zoomed, options, frame++ * (1000 / 30));

  // Everything in plane units should have scaled by exactly the zoom ratio, and
  // the millimetre measurement should not have moved at all.
  console.log(
    `       one frame after 1x → ${ZOOM}x: scale ${before.scale.toFixed(3)} → ${first!.planeScale.toFixed(3)} (expected ${(before.scale * ZOOM).toFixed(3)})`,
  );
  check(
    "the scale follows the crop immediately",
    first!.planeScale,
    before.scale * ZOOM,
    before.scale * ZOOM * 0.02,
  );
  check(
    "the anchor follows the crop immediately",
    first!.position.y,
    before.y * ZOOM,
    Math.abs(before.y * ZOOM) * 0.03,
  );
  // The neck is measured in real millimetres from the metric landmarks, so a crop
  // must not change it by even a fraction.
  check("the measured neck is unaffected by the crop", first!.neckRadiusMm, before.neck, 0.5);

  // And it must be stable, not merely correct on the first frame — no creep as the
  // filters catch up, because there is nothing left to catch up on.
  let later = first;
  for (let i = 0; i < 40; i++) {
    later = solver.solve(zoomedResult as never, zoomed, options, frame++ * (1000 / 30));
  }
  const creep = Math.abs(later!.position.y - first!.position.y);
  console.log(`       drift over the next 40 frames: ${creep.toExponential(1)} plane units`);
  checkTrue("the piece does not creep after the crop settles", creep < 0.002);
}

console.log("\n— A full turn ————————————————————————————————————");

/**
 * The collar has to be right at *every* rotation, not just front-on.
 *
 * This is the check the old scale estimator would have failed outright. It divided
 * the shoulders' screen span by their full 3D span — two different quantities that
 * agree only when the torso faces the camera. Turning pulls them apart, so the
 * estimate collapsed toward zero and the necklace shrank away as the wearer rotated.
 * The sweep makes that visible as a percentage rather than as something you notice
 * on a webcam and cannot attribute.
 */
{
  const STEPS = 48;
  const scales: number[] = [];
  const necks: number[] = [];
  const handedness: number[] = [];
  let worstSeat = 0;
  let previousForward: Vector3 | null = null;
  let maxForwardStep = 0;
  let sweptAngle = 0;

  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const turned = offsetBody(
      centreBody(makeBody()).map((p) => ({
        x: p.x * Math.cos(a) + p.z * Math.sin(a),
        y: p.y,
        z: -p.x * Math.sin(a) + p.z * Math.cos(a),
        visibility: p.visibility,
      })),
    );

    const p = settle(turned, options, geometry, 120);
    if (!p) {
      failures++;
      console.log(`FAIL  no pose at ${((a * 180) / Math.PI).toFixed(0)}°`);
      continue;
    }

    scales.push(p.planeScale);
    necks.push(p.neckRadiusMm);

    // The frame must stay a rotation the whole way round; a basis that loses its
    // handedness mirrors the piece.
    const across = new Vector3(1, 0, 0).applyQuaternion(p.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(p.quaternion);
    const forward = new Vector3(0, 0, 1).applyQuaternion(p.quaternion);
    handedness.push(across.clone().cross(up).dot(forward));

    // The anchor must stay on the neck at every angle.
    const img = project(turned, DISTANCE, ASPECT);
    const sY = ((0.5 - img[PL.LEFT_SHOULDER].y) + (0.5 - img[PL.RIGHT_SHOULDER].y)) / 2;
    const mY = ((0.5 - img[PL.LEFT_MOUTH].y) + (0.5 - img[PL.RIGHT_MOUTH].y)) / 2;
    if (p.position.y < sY - 0.01 || p.position.y > mY) worstSeat++;

    // The chest normal must sweep smoothly through the full turn and come back.
    if (previousForward) {
      const step = forward.angleTo(previousForward);
      maxForwardStep = Math.max(maxForwardStep, step);
      sweptAngle += step;
    }
    previousForward = forward.clone();
  }

  const spread = (xs: number[]) => {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    return (max - min) / ((max + min) / 2);
  };

  const scaleSpread = spread(scales);
  const neckSpread = spread(necks);
  console.log(`       plane scale varies by ${(scaleSpread * 100).toFixed(1)}% over 360°`);
  console.log(`       measured neck varies by ${(neckSpread * 100).toFixed(1)}% over 360°`);
  console.log(`       chest normal swept ${((sweptAngle * 180) / Math.PI).toFixed(0)}°, largest step ${((maxForwardStep * 180) / Math.PI).toFixed(0)}°`);

  // A rigid body does not change size when it rotates.
  checkTrue("the piece holds its scale through a full turn", scaleSpread < 0.12);
  checkTrue("the measured neck holds through a full turn", neckSpread < 0.15);
  checkTrue("the anchor stays on the neck at every angle", worstSeat === 0);
  checkTrue(
    "the frame stays right-handed at every angle",
    handedness.every((h) => Math.abs(h - 1) < 0.05),
  );
  // A full revolution and no jumps: the piece follows the body round rather than
  // snapping at some pose.
  checkTrue("the chest normal completes one revolution", Math.abs(sweptAngle - Math.PI * 2) < 0.5);
  checkTrue("the piece rotates smoothly, without snapping", maxForwardStep < Math.PI / 5);
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

console.log("\n— Placement adapts to the wearer ——————————————————");

// The point of measuring rather than assuming. Every quantity below has to track
// the individual: a fixed anthropometric ratio would put the collar at the base of
// an average neck and wrong on everyone else.
{
  const small = settle(makeBody(0.82));
  const large = settle(makeBody(1.18));

  console.log(
    `       neck radius: small ${small!.neckRadiusMm.toFixed(1)} mm, average ${pose.neckRadiusMm.toFixed(1)} mm, large ${large!.neckRadiusMm.toFixed(1)} mm`,
  );
  checkTrue(
    "a smaller frame measures a smaller neck",
    small!.neckRadiusMm < pose.neckRadiusMm * 0.92,
  );
  checkTrue(
    "a larger frame measures a larger neck",
    large!.neckRadiusMm > pose.neckRadiusMm * 1.08,
  );
  // And it must scale in proportion, not merely in the right direction.
  check(
    "neck size scales with the frame",
    large!.neckRadiusMm / small!.neckRadiusMm,
    1.18 / 0.82,
    0.06,
  );

  console.log(
    `       neck circumference: small ${small!.neckCircumferenceMm.toFixed(0)} mm, large ${large!.neckCircumferenceMm.toFixed(0)} mm`,
  );
  // A neck is oval, not round, so 2πr would over-report by ~6% — most of a size.
  checkTrue(
    "circumference is computed for an oval section, not a circle",
    pose.neckCircumferenceMm < 2 * Math.PI * pose.neckRadiusMm * 0.98,
  );

  // The head cue must actually be contributing, or this is still one ratio.
  checkTrue("the head-breadth cue was folded in", pose.neckFromHead);

  // Neck LENGTH is the one shoulder breadth cannot speak to. Two bodies of the
  // same width with different neck lengths must seat the collar differently.
  const shortNeck = settle(makeBody(1, 0.7));
  const longNeck = settle(makeBody(1, 1.3));
  const shoulderY = shoulderMid.y;
  const shortRise = shortNeck!.position.y - shoulderY;
  const longRise = longNeck!.position.y - shoulderY;
  console.log(
    `       rise above the shoulders: short neck ${shortRise.toFixed(4)}, long neck ${longRise.toFixed(4)}`,
  );
  checkTrue(
    "a longer neck seats the collar higher",
    longRise > shortRise * 1.3,
  );
  // Same frame, so the neck's WIDTH must not move with its length.
  check(
    "neck width is independent of neck length",
    longNeck!.neckRadiusMm,
    shortNeck!.neckRadiusMm,
    2,
  );

  // With one ear hidden the head cue collapses and must be rejected, falling back
  // to shoulders rather than reporting a tiny neck.
  const turned = makeBody().map((p, i) =>
    i === PL.LEFT_EAR ? { ...p, x: p.x * 0.05, visibility: 0.99 } : p,
  );
  const oneEar = settle(turned);
  console.log(
    `       one ear hidden: neck ${oneEar!.neckRadiusMm.toFixed(1)} mm, head cue used: ${oneEar!.neckFromHead}`,
  );
  checkTrue("an implausible ear span is rejected", !oneEar!.neckFromHead);
  checkTrue(
    "rejecting it still leaves a sane neck",
    Math.abs(oneEar!.neckRadiusMm - pose.neckRadiusMm) < 8,
  );
}

console.log("\n— The occluder must not eat the jewellery —————————");

// An occluder writes depth and no colour, so one that is too long does not draw a
// block over the pendant — the pendant simply never appears, with nothing in the
// console to say why. This is the check for that, and it is the reason the
// occluder's dimensions live in a module the test can read.
{
  const { bottom, top } = occluderExtent();
  const neckMmMeasured = (pose.neckRadius / pose.planeScale) * 1000;

  // Both lengths in the range, because they fail differently. A pendant hangs
  // well clear of the occluder; a choker sits right at its lower rim, which is the
  // tight case — too long an occluder deletes the strands entirely.
  for (const necklace of NECKLACES) {
    const drop = dropFactorFor(necklace, neckMmMeasured);
    const lowest = -drop;
    console.log(
      `       ${necklace.id}: occluder rim at ${bottom.toFixed(2)} radii, piece reaches ${lowest.toFixed(2)}`,
    );
    checkTrue(
      `${necklace.id} hangs below the occluder's lower rim`,
      lowest < bottom,
    );
  }

  checkTrue("the occluder covers the neck above the anchor", top > 1.5);
  // It still has to reach just below the anchor, or the chain's back run shows
  // across the throat where it passes the notch.
  checkTrue("the occluder reaches just below the anchor", bottom < 0);

  // And the occluder must be inside the chain's path, not on it, or the two
  // z-fight and the whole chain flickers.
  checkTrue("the occluder sits inside the chain's path", NECK_OCCLUDER.press < 1);
}

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
