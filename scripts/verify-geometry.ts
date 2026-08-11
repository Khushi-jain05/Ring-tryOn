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

let failures = 0;

function fail(message: string) {
  failures++;
  console.log(`FAIL  ${message}`);
}

function pass(message: string) {
  console.log(`PASS  ${message}`);
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

console.log(
  failures === 0 ? "\nAll geometry checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
