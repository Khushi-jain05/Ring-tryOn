/**
 * MediaPipe hand landmark index reference.
 *
 * The model emits 21 points per hand. We only name the ones the ring solver
 * actually reads, plus the palm quad used to derive the hand plane.
 *
 *        8   12  16  20      <- finger tips
 *        7   11  15  19
 *        6   10  14  18
 *    4   5    9  13  17      <- MCP knuckles
 *     3
 *      2
 *       1
 *        0                   <- wrist
 */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export type Landmark = { x: number; y: number; z: number; visibility?: number };

/** The four fingers a ring can be worn on, with the joints that bound each phalanx. */
export const FINGER_CHAINS = {
  index: { mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, dip: LM.INDEX_DIP, tip: LM.INDEX_TIP },
  middle: { mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, dip: LM.MIDDLE_DIP, tip: LM.MIDDLE_TIP },
  ring: { mcp: LM.RING_MCP, pip: LM.RING_PIP, dip: LM.RING_DIP, tip: LM.RING_TIP },
  pinky: { mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, dip: LM.PINKY_DIP, tip: LM.PINKY_TIP },
} as const;

export type FingerName = keyof typeof FINGER_CHAINS;

export const FINGER_NAMES: FingerName[] = ["index", "middle", "ring", "pinky"];

/** The thumb has its own joint names and only reaches three segments. */
export const THUMB_CHAIN = {
  cmc: LM.THUMB_CMC,
  mcp: LM.THUMB_MCP,
  ip: LM.THUMB_IP,
  tip: LM.THUMB_TIP,
} as const;

export const FINGER_LABELS: Record<FingerName, string> = {
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky",
};

/**
 * Neighbouring knuckles used to estimate a finger's width. A finger is roughly
 * as wide as the gap to its neighbour at the knuckle line, so the span between
 * the two adjacent MCPs is a stable, rotation-invariant width proxy.
 */
export const WIDTH_NEIGHBOURS: Record<FingerName, [number, number]> = {
  index: [LM.INDEX_MCP, LM.MIDDLE_MCP],
  middle: [LM.INDEX_MCP, LM.RING_MCP],
  ring: [LM.MIDDLE_MCP, LM.PINKY_MCP],
  pinky: [LM.RING_MCP, LM.PINKY_MCP],
};

/**
 * Fraction of the MCP→neighbour-MCP span that the finger itself occupies.
 * Derived from anthropometric hand proportions: the middle and ring fingers sit
 * shoulder to shoulder so their share of a two-gap span is near half, while the
 * pinky measures against a single gap and is proportionally narrower.
 */
export const WIDTH_RATIO: Record<FingerName, number> = {
  index: 0.86,
  middle: 0.47,
  ring: 0.45,
  pinky: 0.78,
};
