export type MetalId = "yellow-gold" | "rose-gold" | "white-gold" | "platinum";

export type GemId =
  | "diamond"
  | "ruby"
  | "sapphire"
  | "emerald"
  | "amethyst"
  | "aquamarine"
  | "onyx";

export type GemCut = "round" | "princess" | "emerald" | "oval" | "pear" | "marquise";

export type BandProfile = "comfort" | "flat" | "knife" | "twist";

export type SettingStyle =
  | "plain"
  | "solitaire"
  | "halo"
  | "three-stone"
  | "pave"
  | "eternity"
  | "floral";

/** Shape parameters for a cast flower head. Only used by the floral setting. */
export type FloralSpec = {
  petals: number;
  headRadius: number;
  gemRadius: number;
  scallop: number;
  cup: number;
};

export type Metal = {
  id: MetalId;
  label: string;
  /** Base reflectance colour. Metals tint their reflections, not their diffuse. */
  color: string;
  roughness: number;
  /** Swatch gradient for the UI. */
  swatch: [string, string];
};

export type Gem = {
  id: GemId;
  label: string;
  color: string;
  /** Index of refraction. Diamond 2.42, corundum 1.77, quartz 1.54. */
  ior: number;
  /** How much light survives the stone; opaque stones sit at 0. */
  transmission: number;
  /** Chromatic dispersion — diamond's "fire". */
  dispersion: number;
  roughness: number;
};

export type RingDesign = {
  /** Inner radius as a multiple of the finger radius. 1 = skin tight. */
  bandInnerScale: number;
  /** Radial thickness of the band, relative to finger radius. */
  bandThickness: number;
  /** Width of the band along the finger, relative to finger radius. */
  bandWidth: number;
  profile: BandProfile;
  setting: SettingStyle;
  /** Centre stone size relative to finger radius. 0 for plain bands. */
  gemSize: number;
  gemCut: GemCut;
  /** Number of accent stones, meaning depends on the setting. */
  accentCount: number;
  /** Required when `setting` is "floral". */
  floral?: FloralSpec;
};

/**
 * A ring supplied as a GLB rather than generated.
 *
 * The transform is measured once, offline, by `scripts/fit-glb-ring.mjs` and stored
 * here — not derived at runtime. Finding a bore means searching for the largest
 * enclosed empty circle over every vertex, which is far too slow for a frame loop and
 * gives the same answer every time, so it belongs in the build rather than the render.
 */
export type GlbSource = {
  url: string;
  /**
   * Uniform scale that brings the model's bore radius to exactly 1, which is the
   * unit everything downstream is expressed in.
   */
  scale: number;
  /** Applied after scaling, to bring the bore's centre to the origin. */
  offset?: [number, number, number];
  /** Applied to put the finger axis on +Z and the setting on +Y. */
  rotation?: [number, number, number];
  /** Lifts an imported material into this scene's lighting. */
  envMapIntensity?: number;
};

export type Ring = {
  id: string;
  name: string;
  collection: string;
  description: string;
  metals: MetalId[];
  gem: GemId;
  design: RingDesign;
  /**
   * Present when the ring is an imported mesh. `design` is still required — the band
   * dimensions in it are what the occluder and the contact shadow are sized from, so
   * they must describe the imported model rather than being left at defaults.
   */
  glb?: GlbSource;
  tags: string[];
  /** Carat weight of the centre stone, for the spec sheet. */
  carat?: number;
  bestseller?: boolean;
};
