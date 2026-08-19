/**
 * Works out how to fit an arbitrary GLB ring into the placement convention the
 * procedural rings use, and prints the numbers to paste into the catalogue.
 *
 *   bore radius 1  ·  +Z along the finger  ·  +Y toward the back of the hand
 *   origin at the centre of the bore
 *
 * Run with: npx tsx scripts/fit-glb-ring.mjs <file.glb>
 *
 * The hole is found as the **largest empty circle**: project every vertex onto the
 * plane perpendicular to a candidate axis, then search for the point with the
 * greatest distance to the nearest vertex. That point is the bore's centre and the
 * distance is its radius, and the axis whose empty circle is largest is the one the
 * finger goes through.
 *
 * Two more obvious methods were tried first and both fail on a real ring. The
 * bounding box's smallest extent is not the band's width once a cluster spreads
 * along the finger — here it is 57% of the diameter. And the inertia tensor's
 * largest principal moment is the hole axis only for a *thin* loop; with a
 * substantial head the three moments came out within 20% of each other, which
 * decides nothing. An empty circle is a property of the hole itself, so neither the
 * head's size nor its position can confuse it.
 */
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Box3, Vector2, Vector3 } from "three";

const file = process.argv[2] ?? "Ring.glb";
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

/**
 * Whether a candidate centre is *surrounded* by geometry.
 *
 * Without this the search escapes: outside the silhouette empty space is unbounded,
 * so the largest empty circle is at infinity. On this model that reported bores of
 * 0.277 and 0.224 for the two wrong axes — centred well outside a bounding box only
 * 0.08 across — which beat the real bore of 0.033 and picked the wrong axis. A hole
 * is enclosed by definition, so requiring geometry in every direction is what makes
 * "largest empty circle" mean the hole rather than the void around the object.
 */
function enclosed(points, x, y) {
  const SECTORS = 8;
  const seen = new Array(SECTORS).fill(false);
  let count = 0;
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - x;
    const dy = points[i + 1] - y;
    if (dx === 0 && dy === 0) continue;
    let a = Math.atan2(dy, dx) / (Math.PI * 2);
    if (a < 0) a += 1;
    const s = Math.min(SECTORS - 1, Math.floor(a * SECTORS));
    if (!seen[s]) {
      seen[s] = true;
      if (++count === SECTORS) return true;
    }
  }
  return false;
}

/** Distance from a point to the nearest of a set of 2D points. */
function nearest(points, x, y) {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - x;
    const dy = points[i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Largest empty circle, by coarse grid then local refinement. */
function largestEmptyCircle(points, min, max) {
  let bx = (min.x + max.x) / 2;
  let by = (min.y + max.y) / 2;
  let br = enclosed(points, bx, by) ? nearest(points, bx, by) : 0;

  const COARSE = 48;
  for (let i = 0; i <= COARSE; i++) {
    for (let j = 0; j <= COARSE; j++) {
      const x = min.x + ((max.x - min.x) * i) / COARSE;
      const y = min.y + ((max.y - min.y) * j) / COARSE;
      if (!enclosed(points, x, y)) continue;
      const r = nearest(points, x, y);
      if (r > br) { br = r; bx = x; by = y; }
    }
  }

  // Hill-climb, halving the step each round.
  let step = Math.max(max.x - min.x, max.y - min.y) / COARSE;
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const x = bx + dx * step;
      const y = by + dy * step;
      if (!enclosed(points, x, y)) continue;
      const r = nearest(points, x, y);
      if (r > br) { br = r; bx = x; by = y; moved = true; }
    }
    if (!moved) step /= 2;
  }
  return { x: bx, y: by, radius: br };
}

new GLTFLoader().parse(ab, "", (gltf) => {
  gltf.scene.updateMatrixWorld(true);

  const verts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      verts.push(v.x, v.y, v.z);
    }
  });

  const box = new Box3();
  const v = new Vector3();
  for (let i = 0; i < verts.length; i += 3) box.expandByPoint(v.set(verts[i], verts[i+1], verts[i+2]));

  console.log(`${file}: ${verts.length / 3} vertices`);
  console.log("bbox", box.getSize(new Vector3()).toArray().map((n) => n.toFixed(4)).join(" x "));

  // Try each axis as the finger's.
  const axes = [
    { name: "X", drop: (i) => [verts[i+1], verts[i+2]], along: (i) => verts[i] },
    { name: "Y", drop: (i) => [verts[i], verts[i+2]], along: (i) => verts[i+1] },
    { name: "Z", drop: (i) => [verts[i], verts[i+1]], along: (i) => verts[i+2] },
  ];

  let best = null;
  for (const axis of axes) {
    const flat = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const [a, b] = axis.drop(i);
      flat.push(a, b);
      const t = axis.along(i);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    const min = new Vector2(Infinity, Infinity);
    const max = new Vector2(-Infinity, -Infinity);
    for (let i = 0; i < flat.length; i += 2) {
      min.x = Math.min(min.x, flat[i]); max.x = Math.max(max.x, flat[i]);
      min.y = Math.min(min.y, flat[i+1]); max.y = Math.max(max.y, flat[i+1]);
    }
    const circle = largestEmptyCircle(flat, min, max);
    const span = Math.max(max.x - min.x, max.y - min.y);
    console.log(
      `  axis ${axis.name}: bore radius ${circle.radius.toFixed(5)} at (${circle.x.toFixed(5)}, ${circle.y.toFixed(5)}), ` +
      `extent along axis ${(hi - lo).toFixed(5)}, bore/span ${(circle.radius * 2 / span).toFixed(3)}`,
    );
    if (!best || circle.radius > best.circle.radius) best = { axis, circle, lo, hi };
  }

  console.log(`\nfinger axis: ${best.axis.name}  (largest bore)`);
  const scale = 1 / best.circle.radius;
  console.log(`scale to bore radius 1: ${scale.toFixed(4)}`);
  console.log(
    `bore centre on that axis: (${best.circle.x.toFixed(5)}, ${best.circle.y.toFixed(5)}), ` +
    `band spans ${best.lo.toFixed(5)} .. ${best.hi.toFixed(5)}`,
  );
}, (e) => console.error(e));
