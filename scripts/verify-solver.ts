/**
 * Numeric checks on the ring pose solver, driven by a synthetic hand.
 *
 * The solver's output is hard to eyeball — a ring that is 15% too large or
 * seated 4 mm too low still looks broadly plausible in a video preview, and by
 * the time it looks wrong you cannot tell which of the several stages produced
 * the error. Feeding it a hand whose true dimensions we chose ourselves turns
 * that into an assertion.
 *
 * Run with: npx tsx scripts/verify-solver.ts
 */
import { Vector3 } from "three";
import { RingPoseSolver, type SolverOptions } from "../src/lib/hand/ringPose";
import { DEFAULT_ONE_EURO } from "../src/lib/hand/oneEuro";
import type { FrameGeometry } from "../src/lib/hand/projection";
import { ANCHOR_DISTANCE, CAMERA_FOV } from "../src/lib/hand/projection";
import { LM } from "../src/lib/hand/landmarks";
import { anchorFor } from "../src/lib/hand/anchor";
import { circumferenceMmToSize, sizeToDiameterMm } from "../src/lib/rings/sizes";

/* ------------------------------------------------------------------ */
/* A synthetic adult hand, in metres, palm facing the camera           */
/* ------------------------------------------------------------------ */

/** Ring-finger measurements we are trying to recover. */
const TRUE_RING_WIDTH_M = 0.0168; // 16.8 mm across — a US 6.5-ish finger
const KNUCKLE_PITCH = 0.0185; // centre-to-centre spacing at the MCPs
const PROXIMAL_LEN = 0.0385; // ring-finger proximal phalanx

/**
 * Builds a right hand lying in the z = 0 plane with the fingers pointing +y and
 * the palm toward the camera. Coordinates are MediaPipe world convention:
 * +x right, +y down, +z away from the viewer.
 */
function makeWorldHand(): { x: number; y: number; z: number }[] {
  const p: { x: number; y: number; z: number }[] = Array.from({ length: 21 }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }));

  // MediaPipe world space has +y pointing *down*, so a finger pointing up the
  // image has a negative y. The knuckle line sits above the wrist.
  const set = (i: number, x: number, yUp: number, zToward: number) => {
    p[i] = { x, y: -yUp, z: -zToward };
  };

  set(LM.WRIST, 0, 0, 0);

  // Knuckles, right hand palm-to-camera: index at image left, pinky at right.
  const knuckleY = 0.088;
  set(LM.INDEX_MCP, -1.5 * KNUCKLE_PITCH, knuckleY, 0);
  set(LM.MIDDLE_MCP, -0.5 * KNUCKLE_PITCH, knuckleY + 0.003, 0);
  set(LM.RING_MCP, 0.5 * KNUCKLE_PITCH, knuckleY, 0);
  set(LM.PINKY_MCP, 1.5 * KNUCKLE_PITCH, knuckleY - 0.005, 0);

  // Finger chains straight up from each knuckle.
  const chain = (mcp: number, lengths: number[]) => {
    let y = -p[mcp].y;
    const x = p[mcp].x;
    for (let i = 0; i < lengths.length; i++) {
      y += lengths[i];
      set(mcp + i + 1, x, y, 0);
    }
  };
  chain(LM.INDEX_MCP, [0.039, 0.023, 0.02]);
  chain(LM.MIDDLE_MCP, [0.043, 0.026, 0.021]);
  chain(LM.RING_MCP, [PROXIMAL_LEN, 0.025, 0.02]);
  chain(LM.PINKY_MCP, [0.031, 0.018, 0.018]);

  // The thumb: out to the index side, and displaced toward the palm — that
  // out-of-plane offset is the cue the solver uses to find the back of the hand.
  const palmar = 0.012;
  set(LM.THUMB_CMC, -1.9 * KNUCKLE_PITCH, 0.02, palmar * 0.4);
  set(LM.THUMB_MCP, -2.5 * KNUCKLE_PITCH, 0.042, palmar);
  set(LM.THUMB_IP, -2.9 * KNUCKLE_PITCH, 0.062, palmar * 1.1);
  set(LM.THUMB_TIP, -3.1 * KNUCKLE_PITCH, 0.078, palmar * 1.1);

  return p;
}

/**
 * Projects the metric hand through a pinhole camera to normalized image
 * coordinates, so the solver receives a genuinely consistent pair of landmark
 * sets rather than two independently invented ones.
 */
function projectHand(
  world: { x: number; y: number; z: number }[],
  distance: number,
  aspect: number,
): { x: number; y: number; z: number }[] {
  const f = 1 / Math.tan(((CAMERA_FOV * Math.PI) / 180) / 2);
  return world.map((w) => {
    // World +z is away from the viewer, so depth grows with z.
    const depth = distance + w.z;
    const ndcX = (f / aspect) * (w.x / depth);
    // MediaPipe image y grows downward, matching world y.
    const ndcY = f * (w.y / depth);
    return { x: ndcX / 2 + 0.5, y: ndcY / 2 + 0.5, z: w.z };
  });
}

/* ------------------------------------------------------------------ */

let failures = 0;

function check(label: string, actual: number, expected: number, tolerance: number) {
  const delta = Math.abs(actual - expected);
  const ok = delta <= tolerance;
  if (!ok) failures++;
  const status = ok ? "PASS" : "FAIL";
  console.log(
    `${status}  ${label.padEnd(42)} got ${actual.toFixed(4)}  want ${expected.toFixed(4)} ±${tolerance}`,
  );
}

function checkTrue(label: string, value: boolean) {
  if (!value) failures++;
  console.log(`${value ? "PASS" : "FAIL"}  ${label}`);
}

function fail(message: string) {
  failures++;
  console.log(`FAIL  ${message}`);
}

function pass(message: string) {
  console.log(`PASS  ${message}`);
}

function run() {
  const DISPLAY_W = 1280;
  const DISPLAY_H = 960;
  const aspect = DISPLAY_W / DISPLAY_H;
  const CAMERA_DISTANCE = 0.45; // hand held 45 cm from the lens

  const world = makeWorldHand();
  const image = projectHand(world, CAMERA_DISTANCE, aspect);

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

  const options: SolverOptions = {
    anchor: anchorFor("ring", { positionAlongFinger: 0.42 }),
    ringSize: 6.5,
    metricBias: 1,
    autoFit: true,
    flipGem: false,
    // Anatomical roll, so the tests below assert the physics rather than the
    // shopper-facing presentation mode.
    settingFacesCamera: false,
    mirrored: false,
    // The pixel probe needs a real video frame, so the harness runs without it
    // and exercises the anthropometric path.
    silhouetteHalfWidth: null,
    smoothing: DEFAULT_ONE_EURO,
  };

  const solver = new RingPoseSolver();
  const result = {
    landmarks: [image],
    worldLandmarks: [world],
    handedness: [],
    handednesses: [],
  };

  // The solver reuses one pose object across frames, so anything we want to
  // compare later has to be copied out rather than held by reference.
  const snapshot = (p: NonNullable<ReturnType<RingPoseSolver["solve"]>>) => ({
    position: p.position.clone(),
    quaternion: p.quaternion.clone(),
    ringRadius: p.ringRadius,
    fingerRadius: p.fingerRadius,
    planeScale: p.planeScale,
    trueWidthMm: p.trueWidthMm,
    trueCircumferenceMm: p.trueCircumferenceMm,
    measurement: p.measurement ? { ...p.measurement } : null,
    depthSnapshot: [...p.depth],
  });

  const settle = (
    s: RingPoseSolver,
    geo: FrameGeometry,
    opts: SolverOptions,
    frames: number,
    startFrame = 0,
  ) => {
    let last = null;
    for (let i = 0; i < frames; i++) {
      last = s.solve(result as never, geo, opts, (startFrame + i) * (1000 / 30));
    }
    if (!last) {
      console.log("FAIL  solver returned no pose");
      process.exit(1);
    }
    return snapshot(last);
  };

  // Run enough frames for the One Euro filters and the scale filter to settle.
  const pose = settle(solver, geometry, options, 240);

  console.log("\n— Scale recovery ————————————————————————————————");

  // At the anchor plane one world unit is one display height. A metre of real
  // hand at 45 cm subtends this many display heights:
  const f = 1 / Math.tan(((CAMERA_FOV * Math.PI) / 180) / 2);
  const expectedScale = f / 2 / CAMERA_DISTANCE;
  check("plane units per metre", pose.planeScale, expectedScale, expectedScale * 0.06);

  console.log("\n— Finger measurement ————————————————————————————");
  const m = pose.measurement!;
  check("measured width (mm)", m.widthMm, TRUE_RING_WIDTH_M * 1000, 1.6);
  check("phalanx length (mm)", m.phalanxMm, PROXIMAL_LEN * 1000, 1.0);

  const estimatedSize = circumferenceMmToSize(m.circumferenceMm);
  console.log(`       estimated ring size: US ${estimatedSize.toFixed(2)}`);
  checkTrue("estimated size is a plausible adult size", estimatedSize > 3 && estimatedSize < 13);

  console.log("\n— Placement ——————————————————————————————————————");

  // The seat must land between the knuckle and the middle joint, at the
  // fraction we asked for.
  const mcp = new Vector3(
    (image[LM.RING_MCP].x - 0.5) * aspect,
    (0.5 - image[LM.RING_MCP].y) * 1,
    0,
  );
  const pip = new Vector3(
    (image[LM.RING_PIP].x - 0.5) * aspect,
    (0.5 - image[LM.RING_PIP].y) * 1,
    0,
  );
  const expectedSeat = mcp.clone().lerp(pip, options.anchor.positionAlongFinger);
  check("seat x", pose.position.x, expectedSeat.x, 0.004);
  check("seat y", pose.position.y, expectedSeat.y, 0.004);

  console.log("\n— Orientation ————————————————————————————————————");

  const axis = new Vector3(0, 0, 1).applyQuaternion(pose.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);

  // The band's axis must be the finger's own direction in the camera frame, to
  // within a degree or so — not merely close to it.
  //
  // A loose tolerance here is what let a spurious 13° tilt ship: an "off-axis
  // perspective" correction that rotated the pose toward the viewing ray, on the
  // mistaken belief that the world landmarks were expressed in a hand-facing
  // frame. They are already in the camera's frame, so the correction
  // double-counted and opened the ring's ellipse out. Comparing directly against
  // the finger vector leaves no room for that class of mistake.
  const fingerDirection = new Vector3(
    world[LM.RING_PIP].x - world[LM.RING_MCP].x,
    // World y points down and z away; the solver flips both into three.js space.
    -(world[LM.RING_PIP].y - world[LM.RING_MCP].y),
    -(world[LM.RING_PIP].z - world[LM.RING_MCP].z),
  ).normalize();
  const axisError = (Math.acos(Math.min(1, Math.abs(axis.dot(fingerDirection)))) * 180) / Math.PI;
  console.log(`       band axis is ${axisError.toFixed(2)}° off the finger vector`);
  checkTrue("the band axis is the finger's own direction", axisError < 1.5);

  // Palm faces the camera, so the back of the hand — and the setting — faces
  // away from it. In three.js the viewer is at +z, so the gem should have a
  // negative z component.
  console.log(`       setting direction: (${up.x.toFixed(2)}, ${up.y.toFixed(2)}, ${up.z.toFixed(2)})`);
  checkTrue("setting points away from camera when palm faces it", up.z < -0.7);

  console.log("\n— True-scale sizing ——————————————————————————————");

  const trueScaleOptions: SolverOptions = { ...options, autoFit: false, ringSize: 7 };
  const sized = settle(solver, geometry, trueScaleOptions, 60, 240);
  const expectedRadius = (sizeToDiameterMm(7) / 2 / 1000) * pose.planeScale;
  check("US 7 band radius (plane units)", sized.ringRadius, expectedRadius, expectedRadius * 0.02);

  const bigger = settle(solver, geometry, { ...trueScaleOptions, ringSize: 9 }, 30, 300);
  checkTrue("a larger size renders larger", bigger.ringRadius > sized.ringRadius * 1.05);

  const expectedRatio = sizeToDiameterMm(9) / sizeToDiameterMm(7);
  check(
    "US 9 / US 7 radius ratio matches the size chart",
    bigger.ringRadius / sized.ringRadius,
    expectedRatio,
    0.01,
  );

  console.log("\n— Auto-fit sizing ————————————————————————————————");

  // Auto-fit must draw the ring that *fits* the finger, which is narrower than
  // the finger itself because a finger is oval and ring size is circumference.
  const fittingDiameter = pose.trueCircumferenceMm / Math.PI;
  check(
    "auto-fit band radius (plane units)",
    pose.ringRadius,
    (fittingDiameter / 2 / 1000) * pose.planeScale,
    pose.ringRadius * 0.02,
  );
  checkTrue(
    "auto-fit band sits inside the finger's half-width",
    pose.ringRadius < pose.fingerRadius,
  );

  console.log("\n— Metric bias ————————————————————————————————————");

  // A biased model reports a hand k times too large *and* a pixels-per-metre
  // figure k times too small. The two errors cancel in auto-fit, so the drawn
  // ring must not move when the bias is corrected — only the reported size does.
  const BIAS = 1.18;
  const biased = settle(new RingPoseSolver(), geometry, { ...options, metricBias: BIAS }, 240);

  check(
    "auto-fit radius is unchanged by the bias",
    biased.ringRadius,
    pose.ringRadius,
    pose.ringRadius * 0.01,
  );
  check(
    "reported width scales by 1/bias",
    biased.trueWidthMm,
    pose.trueWidthMm / BIAS,
    0.2,
  );

  // Drawing a specific size to true scale *does* need the bias.
  const biasedTrueScale = settle(
    new RingPoseSolver(),
    geometry,
    { ...options, autoFit: false, ringSize: 7, metricBias: BIAS },
    240,
  );
  check(
    "US 7 radius scales by the bias",
    biasedTrueScale.ringRadius,
    sized.ringRadius * BIAS,
    sized.ringRadius * 0.02,
  );

  console.log("\n— Mirroring ——————————————————————————————————————");

  const mirroredGeometry: FrameGeometry = { ...geometry, mirrored: true };
  const mirroredPose = settle(
    new RingPoseSolver(),
    mirroredGeometry,
    { ...options, mirrored: true },
    240,
  );

  check("mirrored seat x is negated", mirroredPose.position.x, -expectedSeat.x, 0.004);
  check("mirrored seat y is unchanged", mirroredPose.position.y, expectedSeat.y, 0.004);
  check(
    "mirrored radius is unchanged",
    mirroredPose.ringRadius,
    pose.ringRadius,
    pose.ringRadius * 0.02,
  );

  const mAxis = new Vector3(0, 0, 1).applyQuaternion(mirroredPose.quaternion);
  const mUp = new Vector3(0, 1, 0).applyQuaternion(mirroredPose.quaternion);
  const mRight = new Vector3(1, 0, 0).applyQuaternion(mirroredPose.quaternion);
  check("mirrored basis stays right-handed", mRight.clone().cross(mUp).dot(mAxis), 1, 0.02);
  checkTrue("mirrored setting still points away from camera", mUp.z < -0.7);

  console.log("\n— Digital zoom ————————————————————————————————————");

  // The video element and the landmark projection apply the crop independently,
  // so they have to agree. If they drift the ring slides off the finger the
  // moment the auto-zoom moves — a bug that is very hard to read on a live feed.
  const t = options.anchor.positionAlongFinger;
  const seatU = image[LM.RING_MCP].x * (1 - t) + image[LM.RING_PIP].x * t;
  const seatV = image[LM.RING_MCP].y * (1 - t) + image[LM.RING_PIP].y * t;

  for (const zoom of [1.5, 2.4]) {
    const zoomed = settle(
      new RingPoseSolver(),
      { ...geometry, zoom, centerU: seatU, centerV: seatV },
      options,
      240,
    );
    // Centring on the seat must put the ring at the middle of the stage.
    check(`seat is centred at ${zoom}x`, zoomed.position.x, 0, 0.004);
    check(`seat y is centred at ${zoom}x`, zoomed.position.y, 0, 0.004);
    // And the ring must grow with the crop, since the finger does.
    check(
      `band radius scales with ${zoom}x zoom`,
      zoomed.ringRadius,
      pose.ringRadius * zoom,
      pose.ringRadius * zoom * 0.03,
    );
  }

  console.log("\n— Depth ordering —————————————————————————————————");

  // Occlusion by other fingers depends entirely on these depths being signed
  // correctly relative to the band: positive means between the ring and the lens,
  // and so obliged to hide it.
  const depths = pose.depthSnapshot;
  check("the band's own knuckle sits at depth zero", depths[LM.RING_MCP], 0, 0.004);

  // This hand has its palm to the camera, and the thumb leans palmward — so the
  // thumb is nearer the lens than the ring and must occlude it.
  checkTrue("the thumb is in front of the band", depths[LM.THUMB_MCP] > 0);

  // The other fingers are coplanar with the ring finger here, so they should
  // register as neither in front nor behind.
  check("a coplanar finger is level with the band", depths[LM.INDEX_PIP], 0, 0.01);

  // Turning the hand over must reverse the ordering.
  const flipped = makeWorldHand().map((p) => ({ x: p.x, y: p.y, z: -p.z }));
  const flippedResult = {
    landmarks: [projectHand(flipped, CAMERA_DISTANCE, aspect)],
    worldLandmarks: [flipped],
    handedness: [],
    handednesses: [],
  };
  const flippedSolver = new RingPoseSolver();
  let flippedPose = null;
  for (let i = 0; i < 240; i++) {
    flippedPose = flippedSolver.solve(
      flippedResult as never,
      geometry,
      options,
      i * (1000 / 30),
    );
  }
  checkTrue(
    "with the hand turned over, the thumb falls behind the band",
    (flippedPose?.depth[LM.THUMB_MCP] ?? 0) < 0,
  );

  depthPlacement(geometry, options, CAMERA_DISTANCE, aspect);
  chirality(geometry, options, CAMERA_DISTANCE, aspect);
  settingPresentation(geometry, options, CAMERA_DISTANCE, aspect);
  rotationSweep(geometry, options, CAMERA_DISTANCE, aspect);
  poseMatrix(geometry, options, CAMERA_DISTANCE, aspect);

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Spins the hand a full turn about the finger axis and watches the setting.
 *
 * This is the check that matters most for how the try-on *feels*. A ring is
 * worn on the back of the finger, so as the hand rotates the setting must
 * travel smoothly round with it and end up where it started. If the dorsal
 * decision is unstable the stone jumps to the far side of the finger partway
 * through — which looks like the ring detaching, and is invisible to every
 * static test.
 */
function rotationSweep(
  geometry: FrameGeometry,
  options: SolverOptions,
  distance: number,
  aspect: number,
) {
  console.log("\n— Rotation sweep —————————————————————————————————");

  const solver = new RingPoseSolver();
  const base = makeWorldHand();

  const STEPS = 72;
  let flips = 0;
  let maxStep = 0;
  let previous: Vector3 | null = null;
  let frame = 0;
  const radii: number[] = [];
  const scales: number[] = [];

  for (let i = 0; i <= STEPS; i++) {
    const angle = (i / STEPS) * Math.PI * 2;

    // Rotate about the y axis, i.e. turn the hand over as if showing the back.
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const world = base.map((p) => ({
      x: p.x * cos + p.z * sin,
      y: p.y,
      z: -p.x * sin + p.z * cos,
    }));
    const image = projectHand(world, distance, aspect);
    const result = {
      landmarks: [image],
      worldLandmarks: [world],
      handedness: [],
      handednesses: [],
    };

    // Several frames per step so the filters track rather than lag.
    let pose = null;
    for (let k = 0; k < 6; k++) {
      pose = solver.solve(result as never, geometry, options, frame++ * (1000 / 30));
    }
    if (!pose) continue;

    const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);

    // The hand is rigid, so nothing about turning it over changes how big the
    // ring should be. Any variation here is the scale estimator wobbling, which
    // the user sees as the ring swelling and shrinking as they rotate.
    radii.push(pose.ringRadius);
    scales.push(pose.planeScale);

    if (previous) {
      const step = up.angleTo(previous);
      maxStep = Math.max(maxStep, step);
      // A near-reversal between adjacent steps is the dorsal sign flipping.
      if (step > Math.PI / 2) flips++;
    }
    previous = up.clone();
  }

  console.log(`       largest step between frames: ${((maxStep * 180) / Math.PI).toFixed(1)}°`);
  checkTrue("the setting never flips to the other side mid-rotation", flips === 0);
  checkTrue("the setting rotates smoothly", maxStep < Math.PI / 4);

  // Ignore the first few steps: the filters are still converging from cold.
  const settled = radii.slice(8);
  const settledScales = scales.slice(8);
  const spread = (xs: number[]) => {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    return (max - min) / ((max + min) / 2);
  };

  const radiusSpread = spread(settled);
  const scaleSpread = spread(settledScales);
  console.log(`       band radius varies by ${(radiusSpread * 100).toFixed(1)}% over 360°`);
  console.log(`       plane scale varies by ${(scaleSpread * 100).toFixed(1)}% over 360°`);

  checkTrue("the ring holds its size through a full turn", radiusSpread < 0.08);
  checkTrue("the scale estimate holds steady through a full turn", scaleSpread < 0.08);
}


/**
 * The band must have a real depth, and gaining it must not move it on screen.
 *
 * The ring used to be pinned to z = 0 while every occluder around it carried a
 * true depth — so the band alone could not move in Z, and had no parallax or
 * foreshortening from a finger reaching toward the lens. Referencing depth to the
 * palm instead gives it one.
 *
 * The catch is that displacing an object in Z under a perspective camera shifts
 * it on screen and resizes it, and the band's screen position and size were
 * already correct. So the renderer compensates by the perspective divide, and
 * that identity is what is asserted here: project the compensated 3D placement
 * through the camera by hand and confirm it lands exactly where the flat
 * placement did. If that ever drifts, the ring slides off the finger whenever the
 * hand tips — the precise failure this is meant to prevent.
 */
function depthPlacement(
  geometry: FrameGeometry,
  options: SolverOptions,
  distance: number,
  aspect: number,
) {
  console.log("\n— Depth placement ————————————————————————————————");

  const base = makeWorldHand();

  // Pitch the hand so the ring finger reaches toward the lens; that is what
  // gives the band a depth to be placed at in the first place.
  const pitched = base.map((p) => {
    const a = 0.55;
    return {
      x: p.x,
      y: p.y * Math.cos(a) - p.z * Math.sin(a),
      z: p.y * Math.sin(a) + p.z * Math.cos(a),
    };
  });

  for (const [label, world] of [
    ["flat hand", base],
    ["hand pitched toward the lens", pitched],
  ] as const) {
    const image = projectHand(world, distance, aspect);
    const result = {
      landmarks: [image],
      worldLandmarks: [world],
      handedness: [],
      handednesses: [],
    };
    const solver = new RingPoseSolver();
    let pose = null;
    for (let i = 0; i < 220; i++) {
      pose = solver.solve(result as never, geometry, options, i * (1000 / 30));
    }
    if (!pose) {
      fail(`${label}: no pose`);
      continue;
    }

    // Replicate the renderer's compensation, then project by hand.
    const D = ANCHOR_DISTANCE;
    const k = (D - pose.seatDepth) / D;
    const placed = new Vector3(pose.position.x * k, pose.position.y * k, pose.seatDepth);
    // A perspective camera at +D looking down -Z: screen offset scales as
    // 1 / (D - z) relative to the plane's 1 / D.
    const projected = {
      x: (placed.x * D) / (D - placed.z),
      y: (placed.y * D) / (D - placed.z),
    };
    const drift = Math.hypot(projected.x - pose.position.x, projected.y - pose.position.y);

    console.log(
      `       ${label}: seat depth ${pose.seatDepth.toFixed(4)} u, screen drift ${drift.toExponential(1)} u`,
    );
    checkTrue(`${label}: depth compensation preserves the screen position`, drift < 1e-9);

    // The apparent size must be preserved too: scale * k, seen from D - z.
    const apparent = (pose.ringRadius * k * D) / (D - placed.z);
    checkTrue(
      `${label}: depth compensation preserves the apparent size`,
      Math.abs(apparent - pose.ringRadius) < pose.ringRadius * 1e-9,
    );
  }

  // And the depth must actually be non-trivial once the hand is pitched,
  // otherwise the compensation above is vacuously true.
  const flatSolver = new RingPoseSolver();
  const pitchSolver = new RingPoseSolver();
  const run = (world: typeof base, solver: RingPoseSolver) => {
    const image = projectHand(world, distance, aspect);
    const result = { landmarks: [image], worldLandmarks: [world], handedness: [], handednesses: [] };
    let pose = null;
    for (let i = 0; i < 220; i++) pose = solver.solve(result as never, geometry, options, i * (1000 / 30));
    return pose!.seatDepth;
  };
  const flatDepth = run(base, flatSolver);
  const pitchDepth = run(pitched, pitchSolver);
  console.log(`       flat ${flatDepth.toFixed(4)} u vs pitched ${pitchDepth.toFixed(4)} u`);
  checkTrue(
    "pitching the hand forward moves the band in Z",
    Math.abs(pitchDepth - flatDepth) > 0.005,
  );
}

/**
 * Both hands, held flat, must put the stone on the back of the hand.
 *
 * This is the case that matters most and was silently broken. The palm plane alone
 * cannot say which side of itself is dorsal — a hand and its mirror image give the
 * same plane — so the sign has to come from somewhere else. The finger-bend cue
 * settles it, but only when a finger is actually curled, and the pose people hold
 * up to a camera is a flat, open hand.
 *
 * With no cue firing the sign kept whatever it was initialised to, which is right
 * for one chirality and wrong for the other: the stone ends up on the palm. So the
 * test is specifically a *flat* hand — no curl anywhere — in both chiralities,
 * with the palm to the camera, where the stone must be hidden behind the finger.
 */
function chirality(
  geometry: FrameGeometry,
  options: SolverOptions,
  distance: number,
  aspect: number,
) {
  console.log("\n— Chirality on a flat hand ————————————————————————");

  for (const hand of ["right", "left"] as const) {
    // Mirroring x turns the right hand into a left one; the palm still faces the
    // camera, so the answer must not change.
    const flip = hand === "left" ? -1 : 1;
    const world = makeWorldHand().map((p) => ({ x: p.x * flip, y: p.y, z: p.z }));
    const image = projectHand(world, distance, aspect);
    const result = {
      landmarks: [image],
      worldLandmarks: [world],
      handedness: [],
      handednesses: [],
    };

    const solver = new RingPoseSolver();
    let pose = null;
    for (let i = 0; i < 200; i++) {
      pose = solver.solve(result as never, geometry, options, i * (1000 / 30));
    }
    if (!pose) {
      fail(`${hand} hand: no pose`);
      continue;
    }

    const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
    console.log(`       ${hand} hand, palm to camera: setting z = ${up.z.toFixed(2)}`);
    checkTrue(`${hand} hand puts the stone on the back, not the palm`, up.z < -0.8);
  }
}

/**
 * Checks the two roll behaviours through a full turn of the wrist.
 *
 * Anatomically the stone rides round with the hand and spends half the turn out
 * of sight, which is correct and useless for shopping. In presentation mode it
 * must stay pointed at the viewer at *every* angle — while the band's axis still
 * follows the finger exactly, since that is what keeps the wrap and the occlusion
 * honest. Both halves need asserting: a roll override that also disturbed the axis
 * would break placement everywhere.
 */
function settingPresentation(
  geometry: FrameGeometry,
  options: SolverOptions,
  distance: number,
  aspect: number,
) {
  console.log("\n— Setting presentation ————————————————————————————");

  const base = makeWorldHand();
  const STEPS = 24;

  for (const facing of [false, true]) {
    const solver = new RingPoseSolver();
    let worstDot = 1;
    let worstAxisError = 0;
    let frame = 0;

    for (let i = 0; i <= STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const world = base.map((p) => ({
        x: p.x * cos + p.z * sin,
        y: p.y,
        z: -p.x * sin + p.z * cos,
      }));
      const image = projectHand(world, distance, aspect);
      const result = {
        landmarks: [image],
        worldLandmarks: [world],
        handedness: [],
        handednesses: [],
      };

      let pose = null;
      for (let k = 0; k < 8; k++) {
        pose = solver.solve(
          result as never,
          geometry,
          { ...options, settingFacesCamera: facing },
          frame++ * (1000 / 30),
        );
      }
      if (!pose || i < 4) continue;

      const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
      const axis = new Vector3(0, 0, 1).applyQuaternion(pose.quaternion);

      // How much of the setting's direction points out of the screen.
      worstDot = Math.min(worstDot, up.z);

      const finger = new Vector3(
        world[LM.RING_PIP].x - world[LM.RING_MCP].x,
        -(world[LM.RING_PIP].y - world[LM.RING_MCP].y),
        -(world[LM.RING_PIP].z - world[LM.RING_MCP].z),
      ).normalize();
      worstAxisError = Math.max(
        worstAxisError,
        (Math.acos(Math.min(1, Math.abs(axis.dot(finger)))) * 180) / Math.PI,
      );
    }

    const label = facing ? "presentation" : "anatomical";
    console.log(
      `       ${label}: setting's worst forward component ${worstDot.toFixed(2)}, axis within ${worstAxisError.toFixed(2)}°`,
    );

    if (facing) {
      checkTrue("presentation mode keeps the stone facing the viewer", worstDot > 0.85);
    } else {
      checkTrue("anatomical mode lets the stone turn away", worstDot < -0.5);
    }
    checkTrue(`${label} mode leaves the band axis on the finger`, worstAxisError < 1.5);
  }
}

/* ------------------------------------------------------------------ */
/* The pose matrix                                                     */
/* ------------------------------------------------------------------ */

type Transform = (p: Vector3) => Vector3;

const rotX = (a: number): Transform => (p) =>
  new Vector3(p.x, p.y * Math.cos(a) - p.z * Math.sin(a), p.y * Math.sin(a) + p.z * Math.cos(a));
const rotY = (a: number): Transform => (p) =>
  new Vector3(p.x * Math.cos(a) + p.z * Math.sin(a), p.y, -p.x * Math.sin(a) + p.z * Math.cos(a));
const rotZ = (a: number): Transform => (p) =>
  new Vector3(p.x * Math.cos(a) - p.y * Math.sin(a), p.x * Math.sin(a) + p.y * Math.cos(a), p.z);
const shift = (dx: number, dy: number): Transform => (p) =>
  new Vector3(p.x + dx, p.y + dy, p.z);
const compose =
  (...fs: Transform[]): Transform =>
  (p) =>
    fs.reduce((acc, f) => f(acc), p);

/** Bends the ring finger at the PIP, leaving its proximal phalanx alone. */
function bendRingFinger(world: { x: number; y: number; z: number }[], angle: number) {
  const pivot = new Vector3(world[LM.RING_PIP].x, world[LM.RING_PIP].y, world[LM.RING_PIP].z);
  for (const i of [LM.RING_DIP, LM.RING_TIP]) {
    const v = new Vector3(world[i].x, world[i].y, world[i].z).sub(pivot);
    // Fingers curl toward the palm, which is -z in MediaPipe world space here.
    const rotated = rotX(angle)(v).add(pivot);
    world[i] = { x: rotated.x, y: rotated.y, z: rotated.z };
  }
}

/**
 * Runs the placement through the poses a hand actually gets held in.
 *
 * A single front-on pose proves almost nothing: the whole difficulty of ring
 * try-on is that the finger is rarely square to the lens. Each case below asserts
 * the same three invariants — the band lands between the knuckle and the middle
 * joint, its size does not depend on the pose, and the setting stays on the back
 * of the hand — which together are what "attached to the finger" means.
 */
function poseMatrix(
  geometry: FrameGeometry,
  options: SolverOptions,
  distance: number,
  aspect: number,
) {
  console.log("\n— Pose matrix ————————————————————————————————————");

  const base = makeWorldHand();
  const reference = { radius: 0, width: 0 };

  const cases: { label: string; world: () => { x: number; y: number; z: number }[]; mirrored?: boolean; distance?: number }[] = [
    { label: "A straight finger", world: () => base.map((p) => ({ ...p })) },
    {
      label: "B tilted left 35°",
      world: () => base.map((p) => rotZ(0.61)(new Vector3(p.x, p.y, p.z))),
    },
    {
      label: "C tilted right 35°",
      world: () => base.map((p) => rotZ(-0.61)(new Vector3(p.x, p.y, p.z))),
    },
    {
      label: "D hand rolled 55° clockwise",
      world: () => base.map((p) => rotY(0.96)(new Vector3(p.x, p.y, p.z))),
    },
    {
      label: "E hand rolled 55° counter-clockwise",
      world: () => base.map((p) => rotY(-0.96)(new Vector3(p.x, p.y, p.z))),
    },
    {
      label: "F pitched 40° toward the lens",
      world: () => base.map((p) => rotX(0.7)(new Vector3(p.x, p.y, p.z))),
    },
    { label: "G hand close (25 cm)", world: () => base.map((p) => ({ ...p })), distance: 0.25 },
    { label: "H hand far (70 cm)", world: () => base.map((p) => ({ ...p })), distance: 0.7 },
    {
      label: "I finger bent 50° at the middle joint",
      world: () => {
        const w = base.map((p) => ({ ...p }));
        bendRingFinger(w, 0.87);
        return w;
      },
    },
    {
      label: "J near the frame edge",
      world: () => base.map((p) => compose(shift(0.1, -0.05))(new Vector3(p.x, p.y, p.z))),
    },
    { label: "K mirrored selfie view", world: () => base.map((p) => ({ ...p })), mirrored: true },
  ];

  for (const c of cases) {
    const world = c.world();
    const dist = c.distance ?? distance;
    const image = projectHand(world, dist, aspect);
    const result = {
      landmarks: [image],
      worldLandmarks: [world],
      handedness: [],
      handednesses: [],
    };

    const geo: FrameGeometry = { ...geometry, mirrored: c.mirrored ?? false };
    const opts: SolverOptions = { ...options, mirrored: c.mirrored ?? false };
    const solver = new RingPoseSolver();
    let pose = null;
    for (let i = 0; i < 200; i++) {
      pose = solver.solve(result as never, geo, opts, i * (1000 / 30));
    }
    if (!pose) {
      fail(`${c.label}: no pose produced`);
      continue;
    }

    const t = opts.anchor.positionAlongFinger;
    const toPlane = (i: number) =>
      new Vector3(
        (image[i].x - 0.5) * (c.mirrored ? -1 : 1) * aspect,
        0.5 - image[i].y,
        0,
      );
    const mcp = toPlane(LM.RING_MCP);
    const pip = toPlane(LM.RING_PIP);
    const expected = mcp.clone().lerp(pip, t);

    const placement = Math.hypot(pose.position.x - expected.x, pose.position.y - expected.y);
    // Tolerance as a fraction of the band, not an absolute: a distant hand has a
    // smaller everything, and the same absolute slop would be a huge relative error.
    const tolerance = pose.ringRadius * 0.5;

    // Distance changes apparent size legitimately; express size in millimetres,
    // which must not move at all.
    const widthMm = pose.trueWidthMm;
    if (reference.radius === 0) {
      reference.radius = pose.ringRadius;
      reference.width = widthMm;
    }
    const widthDrift = reference.width > 0 ? Math.abs(widthMm - reference.width) / reference.width : 1;

    const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
    const axis = new Vector3(0, 0, 1).applyQuaternion(pose.quaternion);
    const axisScreen = pip.clone().sub(mcp).setZ(0).normalize();
    // The band's axis, projected to the screen, must lie along the finger.
    const axisAlignment = Math.abs(
      axis.x * axisScreen.x + axis.y * axisScreen.y,
    ) / Math.max(1e-6, Math.hypot(axis.x, axis.y));

    const problems: string[] = [];
    if (!(placement <= tolerance)) {
      problems.push(`off the seat by ${(placement / pose.ringRadius).toFixed(2)} band radii`);
    }
    if (widthDrift > 0.1) {
      problems.push(`finger reads ${widthMm.toFixed(1)} mm vs ${reference.width.toFixed(1)} mm`);
    }
    if (Math.hypot(axis.x, axis.y) > 0.15 && axisAlignment < 0.9) {
      problems.push(`band axis ${(Math.acos(Math.min(1, axisAlignment)) * 180 / Math.PI).toFixed(0)}° off the finger`);
    }
    if (up.lengthSq() < 0.9) problems.push("setting direction degenerate");

    if (problems.length) fail(`${c.label}: ${problems.join("; ")}`);
    else
      pass(
        `${c.label}: seat within ${(placement / pose.ringRadius).toFixed(2)} radii, finger ${widthMm.toFixed(1)} mm`,
      );
  }
}

run();
