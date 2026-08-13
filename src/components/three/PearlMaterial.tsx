"use client";

/**
 * A pearl is not a gemstone and must not be rendered as one.
 *
 * A cut stone's whole look is hard facets throwing sharp, high-contrast
 * reflections. A pearl is the opposite: a smooth sphere with light scattering
 * *inside* a stack of thin nacre layers, which gives it a soft broad highlight, a
 * faint colour shift across the surface, and a glow rather than a sparkle. Giving
 * a pearl a gem material makes it read as a glass bead — which is exactly how the
 * fake ones look, and immediately wrong.
 *
 * So: moderate roughness for the soft highlight, a clearcoat for the wet-looking
 * outer layer, `iridescence` to stand in for thin-film interference in the nacre,
 * and `sheen` for the pale halo around the edge of the sphere.
 */
export function PearlMaterial({ tint = "#f7f2e9" }: { tint?: string }) {
  return (
    <meshPhysicalMaterial
      color={tint}
      metalness={0}
      // Not mirror-smooth: a pearl's highlight is a soft patch, not a point.
      roughness={0.22}
      clearcoat={1}
      clearcoatRoughness={0.07}
      // Thin-film interference in the nacre — the shifting pink and green cast.
      iridescence={0.55}
      iridescenceIOR={1.38}
      iridescenceThicknessRange={[120, 420]}
      // The pale halo at the sphere's rim.
      sheen={0.6}
      sheenColor="#ffe9ef"
      sheenRoughness={0.45}
      envMapIntensity={1.15}
    />
  );
}
