/**
 * Structural checks on the generated ring geometry.
 *
 * A malformed band does not fail loudly — it renders, just with dark faceted
 * patches where the normals went wrong, and those show up worst on the arc
 * furthest from the light, which is the part behind the finger. That is very hard
 * to attribute by eye and trivial to assert here.
 *
 * Run with: npx tsx scripts/verify-geometry.ts
 */
import { Vector3 } from "three";
import { RINGS } from "../src/lib/rings/catalog";
import { createBandGeometry, createGemGeometry } from "../src/lib/rings/geometry";
import { createFloralGeometry, DEFAULT_FLORAL } from "../src/lib/rings/floral";
import type { GemCut } from "../src/lib/rings/types";
import {
  AD_COLLAR,
  buildADCollar,
  collarDropFactor,
} from "../src/lib/jewellery/americanDiamond";

let failures = 0;

function fail(message: string) {
  failures++;
  console.log(`FAIL  ${message}`);
}

function pass(message: string) {
  console.log(`PASS  ${message}`);
}

function check(label: string, actual: number, expected: number, tolerance: number) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} got ${actual.toFixed(3)}  want ${expected.toFixed(3)} ±${tolerance}`,
  );
}

function checkTrue(label: string, value: boolean) {
  if (!value) failures++;
  console.log(`${value ? "PASS" : "FAIL"}  ${label}`);
}

type Stats = {
  triangles: number;
  degenerate: number;
  nonFinite: number;
  /**
   * Volume enclosed by the surface, signed by its winding. Positive means the
   * normals face outward.
   */
  volume: number;
};

/**
 * Walks a piece of geometry and measures how sane its triangles are.
 *
 * Winding is judged by the **signed volume** the surface encloses, summed by the
 * divergence theorem. For any closed mesh that is positive when the normals face
 * outward and negative when the winding is inverted, with no assumption about the
 * shape — which matters because two earlier attempts at this check failed on
 * legitimate geometry. Comparing normals against "outward from the axis"
 * condemned every ring's inner bore, which correctly faces inward; splitting on
 * the band's mid-radius instead then condemned the knife-edge profile, whose
 * outer face sweeps from the bore right out to the rim and so straddles any such
 * boundary. Volume sidesteps the classification entirely.
 */
function analyse(geometry: ReturnType<typeof createBandGeometry>): Stats {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : position.count;

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const normal = new Vector3();
  const cross = new Vector3();

  const stats: Stats = { triangles: 0, degenerate: 0, nonFinite: 0, volume: 0 };

  const at = (i: number, out: Vector3) => {
    const v = index ? index.getX(i) : i;
    return out.fromBufferAttribute(position, v);
  };

  for (let i = 0; i < count; i += 3) {
    at(i, a);
    at(i + 1, b);
    at(i + 2, c);
    stats.triangles++;

    if (
      !Number.isFinite(a.x + a.y + a.z) ||
      !Number.isFinite(b.x + b.y + b.z) ||
      !Number.isFinite(c.x + c.y + c.z)
    ) {
      stats.nonFinite++;
      continue;
    }

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    const area = normal.length() / 2;
    if (area < 1e-12) {
      stats.degenerate++;
      continue;
    }
    normal.divideScalar(area * 2);

    // Divergence theorem, one tetrahedron per face against the origin.
    stats.volume += a.dot(cross.crossVectors(b, c)) / 6;
  }

  return stats;
}

console.log("— Band cross-sections ————————————————————————————");

for (const ring of RINGS) {
  // The floral rings carry their own builder; the shank is checked with it below.
  if (ring.design.setting === "floral") continue;
  // Imported rings render their own mesh, so a generated band for them is never
  // drawn and there is nothing here worth asserting about it.
  if (ring.glb) continue;

  const { profile } = ring.design;
  const geometry = createBandGeometry(ring.design);
  const stats = analyse(geometry);
  const label = `${ring.name} (${profile})`;

  if (stats.nonFinite > 0) {
    fail(`${label}: ${stats.nonFinite} triangles with non-finite vertices`);
  } else if (stats.degenerate > stats.triangles * 0.02) {
    fail(
      `${label}: ${stats.degenerate}/${stats.triangles} degenerate triangles — a clamped or duplicated profile point`,
    );
  } else if (stats.volume <= 0) {
    fail(
      `${label}: encloses ${stats.volume.toFixed(4)} volume — the winding is inverted, so it will render lit from the inside`,
    );
  } else {
    pass(
      `${label}: ${stats.triangles} triangles, ${stats.degenerate} degenerate, volume ${stats.volume.toFixed(4)}`,
    );
  }
}

console.log("\n— Band dimensions are physically plausible ————————");

for (const ring of RINGS) {
  // Authored in finger radii; a US 6.5 finger is about 8.25 mm in radius.
  const mmPerUnit = 8.25;
  const thicknessMm = ring.design.bandThickness * mmPerUnit;
  const widthMm = ring.design.bandWidth * mmPerUnit;

  const ok = thicknessMm >= 1.1 && thicknessMm <= 2.6 && widthMm >= 1.8 && widthMm <= 5;
  if (!ok) {
    fail(
      `${ring.name}: band ${thicknessMm.toFixed(1)} mm thick × ${widthMm.toFixed(1)} mm wide is outside what a jeweller would cut`,
    );
  } else {
    pass(
      `${ring.name}: ${thicknessMm.toFixed(1)} mm thick × ${widthMm.toFixed(1)} mm wide`,
    );
  }
}

console.log("\n— Gem cuts ———————————————————————————————————————");

const CUTS: GemCut[] = ["round", "oval", "pear", "marquise", "princess", "emerald"];
for (const cut of CUTS) {
  const geometry = createGemGeometry(cut);
  const stats = analyse(geometry);
  if (stats.nonFinite > 0) fail(`${cut}: non-finite vertices`);
  else if (stats.degenerate > stats.triangles * 0.25)
    fail(`${cut}: ${stats.degenerate}/${stats.triangles} degenerate triangles`);
  else pass(`${cut}: ${stats.triangles} triangles`);
}

console.log("\n— Floral head ————————————————————————————————————");

for (const ring of RINGS.filter((r) => r.design.setting === "floral")) {
  const spec = ring.design.floral ?? DEFAULT_FLORAL;
  const built = createFloralGeometry(spec, {
    inner: ring.design.bandInnerScale,
    thickness: ring.design.bandThickness,
    width: ring.design.bandWidth,
  });

  const polished = analyse(built.polished);
  const matte = analyse(built.matte);

  if (polished.nonFinite || matte.nonFinite) {
    fail(`${ring.name}: non-finite vertices in the flower`);
  } else {
    pass(
      `${ring.name}: ${polished.triangles} polished + ${matte.triangles} matte triangles`,
    );
  }

  // The petals must clear the band, or the flower grows out of the middle of the
  // shank instead of sitting on top of it.
  built.matte.computeBoundingBox();
  const box = built.matte.boundingBox!;
  const minY = box.min.y;
  const bandOuter = ring.design.bandInnerScale + ring.design.bandThickness;
  if (minY < bandOuter * 0.4) {
    fail(`${ring.name}: petals reach down to y=${minY.toFixed(2)}, inside the band`);
  } else {
    pass(`${ring.name}: petals start at y=${minY.toFixed(2)} (band outer ${bandOuter.toFixed(2)})`);
  }
}

console.log("\n— American diamond collar —————————————————————");

{
  const NECK_MM = 57;
  const spec = AD_COLLAR;
  const built = buildADCollar(spec, NECK_MM);

  const stats = analyse(built.metal);
  if (stats.nonFinite > 0) fail(`collar metal: ${stats.nonFinite} non-finite triangles`);
  else if (stats.volume <= 0) fail(`collar metal: volume ${stats.volume.toFixed(3)}, winding inverted`);
  else pass(`collar metal: ${stats.triangles} triangles, volume ${stats.volume.toFixed(0)} mm³`);

  const total =
    built.mainStones.length +
    built.accentStones.length +
    built.clusterStones.length +
    built.drops.length;
  console.log(
    `       ${total} stones: ${built.mainStones.length} main, ${built.accentStones.length} accent, ${built.clusterStones.length} in clusters, ${built.drops.length} drops`,
  );
  // An American diamond piece is defined by density. A sparse one is a different
  // style of jewellery wearing the same name.
  checkTrue("the collar is densely set", total > 140);
  checkTrue("every cluster was built with its petals", built.clusterStones.length === spec.clusterCount * (spec.clusterPetals + 1));
  checkTrue("all nine drops were built", built.drops.length === spec.dropCount);

  // Stones must sit on the band, not float off it. Each is checked against the
  // nearest point of the metal it should be set into.
  const metalPos = built.metal.attributes.position;
  const nearestMetal = (p: readonly [number, number, number]) => {
    let best = Infinity;
    for (let i = 0; i < metalPos.count; i++) {
      const d = Math.hypot(
        metalPos.getX(i) - p[0],
        metalPos.getY(i) - p[1],
        metalPos.getZ(i) - p[2],
      );
      if (d < best) best = d;
    }
    return best;
  };

  for (const [label, group] of [
    ["main row", built.mainStones],
    ["cluster", built.clusterStones],
  ] as const) {
    let worst = 0;
    for (const stone of group) worst = Math.max(worst, nearestMetal(stone.position));
    console.log(`       worst ${label} stone gap from the metal: ${worst.toFixed(2)} mm`);
    checkTrue(`${label} stones are seated on the metal`, worst < spec.bandWidthMm * 0.6);
  }

  // Graduated: biggest at the front centre, tapering toward the ends.
  const mid = built.mainStones[Math.floor(built.mainStones.length / 2)];
  const end = built.mainStones[0];
  checkTrue("the main row graduates larger toward the front", mid.scale > end.scale * 1.15);
  const midDrop = built.drops[Math.floor(built.drops.length / 2)];
  checkTrue("the drops graduate larger toward the front", midDrop.scale > built.drops[0].scale * 1.1);

  // The collar covers the front and a plain chain closes the circle; without the
  // chain the piece reads as a floating arc.
  console.log(`       ${built.chainAngles.length} chain links close the back`);
  checkTrue("a chain closes the circle behind the neck", built.chainAngles.length > 6);

  // Drops must hang below the band, not into it.
  const bandBottom = -spec.frontDipMm - spec.bandWidthMm / 2;
  console.log(`       band bottom ${bandBottom.toFixed(1)} mm, lowest point ${built.lowestMm.toFixed(1)} mm`);
  checkTrue("the drops hang below the band", built.lowestMm < bandBottom);

  // A collar sits on the neck; it must not reach anywhere near a pendant's length.
  const drop = collarDropFactor(spec, NECK_MM);
  console.log(`       collar drop factor ${drop.toFixed(2)} neck radii (${(drop * NECK_MM).toFixed(0)} mm)`);
  checkTrue("a collar sits at the neckline rather than hanging", drop < 1.2);
  checkTrue("a collar still clears the neck's anchor", drop > 0.3);
}

// Wrapped rather than awaited at the top level: tsx transforms these scripts to CJS,
// where top-level await is not available.
void (async () => {
  await checkImportedRings();

  console.log(
    failures === 0 ? "\nAll geometry checks passed.\n" : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();


/**
 * Checks each imported ring against the numbers the catalogue claims about it.
 *
 * The catalogue's `design` block is not decoration for an imported mesh — the finger
 * occluder and the contact shadow are sized from it, so if it disagrees with the
 * actual geometry the ring is placed against a band that is not there. That is easy
 * to get wrong in a way nothing else catches: the first attempt here recorded the
 * model's full extent along the finger, 1.4 bore radii, as its band width. But that
 * extent belongs to the head, which occupies about 30 degrees of the circumference;
 * the shank is a 0.22-radius wire. The contact shadow would have been five times too
 * wide, on a ring that otherwise rendered perfectly.
 */
async function checkImportedRings() {
  const imported = RINGS.filter((r) => r.glb);
  if (imported.length === 0) return;

  console.log("\n— Imported rings match their declared dimensions ——");

  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { readFile } = await import("node:fs/promises");

  for (const ring of imported) {
    const source = ring.glb!;
    const bytes = await readFile(`public${source.url}`).catch(() => null);
    if (!bytes) {
      fail(`${ring.name}: public${source.url} is missing`);
      continue;
    }

    const gltf = await new Promise<{ scene: import("three").Object3D }>((resolve, reject) => {
      new GLTFLoader().parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        "",
        (g) => resolve(g as never),
        reject,
      );
    });

    gltf.scene.updateMatrixWorld(true);

    // Every vertex, in the normalised frame the renderer will draw it in.
    const pts: Vector3[] = [];
    const v = new Vector3();
    gltf.scene.traverse((object) => {
      const mesh = object as import("three").Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(source.scale);
        pts.push(v.clone());
      }
    });

    // Bore: the closest any geometry comes to the finger axis.
    let bore = Infinity;
    let outer = 0;
    for (const p of pts) {
      const r = Math.hypot(p.x, p.y);
      if (r < bore) bore = r;
      if (r > outer) outer = r;
    }
    console.log(`       ${ring.name}: bore ${bore.toFixed(3)}, outer ${outer.toFixed(3)}`);
    check(`${ring.name}: scaled to bore radius 1`, bore, 1, 0.02);

    // The shank, sampled away from the head. The head is found first rather than
    // assumed to be at any particular angle.
    let headAngle = 0;
    let headOuter = 0;
    for (const p of pts) {
      const r = Math.hypot(p.x, p.y);
      if (r > headOuter) { headOuter = r; headAngle = Math.atan2(p.y, p.x); }
    }
    const cos = Math.cos(headAngle);
    const sin = Math.sin(headAngle);

    let zMin = Infinity;
    let zMax = -Infinity;
    let shankOuter = 0;
    for (const p of pts) {
      const r = Math.hypot(p.x, p.y);
      if (r < 0.9) continue;
      // Only the far side of the band from the head.
      if ((p.x * cos + p.y * sin) / r > -0.5) continue;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
      if (r > shankOuter) shankOuter = r;
    }
    const shankWidth = zMax - zMin;
    const shankThickness = shankOuter - 1;
    console.log(
      `       ${ring.name}: shank ${shankThickness.toFixed(3)} thick x ${shankWidth.toFixed(3)} wide (declared ${ring.design.bandThickness} x ${ring.design.bandWidth})`,
    );
    check(`${ring.name}: declared band thickness matches the mesh`, ring.design.bandThickness, shankThickness, 0.04);
    check(`${ring.name}: declared band width matches the mesh`, ring.design.bandWidth, shankWidth, 0.06);

    // The setting must be on +Y, which is where the placement code puts the back of
    // the hand. A model built the other way up would wear its stone into the palm.
    checkTrue(`${ring.name}: the setting sits on +Y`, Math.sin(headAngle) > 0.8);
  }
}
