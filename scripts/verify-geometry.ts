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
import {
  INFINITY_HEART,
  INFINITY_HEART_SLENDER,
  buildChainLink,
  buildNecklaceGeometry,
  chainLinkPlacements,
} from "../src/lib/jewellery/necklace";

let failures = 0;

function fail(message: string) {
  failures++;
  console.log(`FAIL  ${message}`);
}

function pass(message: string) {
  console.log(`PASS  ${message}`);
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

console.log("\n— Necklace ———————————————————————————————————————");

for (const [weight, spec] of [
  ["heavy", INFINITY_HEART],
  ["slender", INFINITY_HEART_SLENDER],
] as const) {
  const built = buildNecklaceGeometry(spec);

  for (const [part, geo] of [
    ["polished ribbon + bail", built.polished],
    ["pavé strand", built.paveRail],
    ["heart stone", built.heart.geometry],
  ] as const) {
    const name = `${weight} ${part}`;
    const stats = analyse(geo);
    if (stats.nonFinite > 0) fail(`${name}: ${stats.nonFinite} non-finite triangles`);
    else if (stats.degenerate > 0)
      fail(`${name}: ${stats.degenerate}/${stats.triangles} degenerate triangles`);
    else if (stats.volume <= 0)
      fail(`${name}: encloses ${stats.volume.toFixed(4)} volume — winding is inverted`);
    else
      pass(`${name}: ${stats.triangles} triangles, volume ${stats.volume.toFixed(3)}`);
  }

  // The two strands are one helix half a turn apart, so they must genuinely pass
  // on opposite sides in depth where they cross. If they meet at the same Z the
  // twist reads as two lines touching, and the depth buffer picks a winner
  // arbitrarily as the view changes.
  const plain = built.polished;
  plain.computeBoundingBox();
  const pave = built.paveRail;
  pave.computeBoundingBox();
  const plainZ = plain.boundingBox!;
  const paveZ = pave.boundingBox!;
  const zSpread = Math.min(plainZ.max.z - plainZ.min.z, paveZ.max.z - paveZ.min.z);
  console.log(`       strand depth range: ${zSpread.toFixed(2)} mm`);
  checkTrue(
    "the twist's strands separate in depth, so the crossing is a real over-under",
    zSpread > spec.ribbonRadiusMm * 2,
  );

  // The heart has to sit inside the frame the strands sweep, not outside it.
  const heartY = built.heart.position[1];
  checkTrue(
    "the heart hangs within the pendant's drop",
    heartY < 0 && heartY > -spec.dropMm,
  );

  // Pavé stones must sit on the strand, not float off it. Every stone is checked
  // against the nearest point on its own rail.
  const rail = pave.attributes.position;
  let worstGap = 0;
  for (const stone of built.pave) {
    let nearest = Infinity;
    for (let i = 0; i < rail.count; i++) {
      const dx = rail.getX(i) - stone.position[0];
      const dy = rail.getY(i) - stone.position[1];
      const dz = rail.getZ(i) - stone.position[2];
      nearest = Math.min(nearest, Math.hypot(dx, dy, dz));
    }
    worstGap = Math.max(worstGap, nearest);
  }
  console.log(`       worst pavé stone gap from its rail: ${worstGap.toFixed(3)} mm`);
  checkTrue("every pavé stone is seated on the strand", worstGap < spec.paveRadiusMm * 2.5);

  // Chain: links have to overlap, or the chain reads as loose beads.
  const links = chainLinkPlacements(57, 122, spec.chainLinkMm, 1);
  let maxStep = 0;
  for (let i = 1; i < links.length; i++) {
    const a = links[i - 1].position;
    const b = links[i].position;
    maxStep = Math.max(maxStep, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  console.log(`       ${weight}: ${links.length} links, widest gap ${maxStep.toFixed(2)} mm`);
  checkTrue(`${weight} chain links overlap`, maxStep < spec.chainLinkMm);

  // A chain link has to be a closed ring, or the chain reads as a row of dashes.
  const linkStats = analyse(buildChainLink(spec));
  if (linkStats.nonFinite > 0 || linkStats.volume <= 0) {
    fail(`${weight} chain link: volume ${linkStats.volume.toFixed(4)}`);
  } else {
    pass(`${weight} chain link: ${linkStats.triangles} triangles, volume ${linkStats.volume.toFixed(3)}`);
  }

  // The chain must dip at the front and hug the neck at the nape, or the pendant
  // ends up under the chin.
  const front = links.reduce((lo, l) => Math.min(lo, l.position[1]), 0);
  const nape = links[0].position[1];
  console.log(`       ${weight}: chain dips ${front.toFixed(0)} mm at the front, ${nape.toFixed(0)} mm at the nape`);
  checkTrue(`${weight} chain hangs at the front, not the nape`, front < -80 && nape > -6);

  // "Heavy" has to actually be heavier, or the label is decorative. Compared by
  // the volume of metal in the ribbon, which is what weight means for a pendant.
  if (weight === "heavy") {
    const slender = buildNecklaceGeometry(INFINITY_HEART_SLENDER);
    const heavyVol = analyse(built.polished).volume + analyse(built.paveRail).volume;
    const slenderVol = analyse(slender.polished).volume + analyse(slender.paveRail).volume;
    console.log(`       metal volume: heavy ${heavyVol.toFixed(0)} mm³ vs slender ${slenderVol.toFixed(0)} mm³`);
    checkTrue("the heavy cut carries substantially more metal", heavyVol > slenderVol * 2.5);
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

console.log(
  failures === 0 ? "\nAll geometry checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
