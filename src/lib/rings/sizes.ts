/**
 * US ring sizing. Inner diameter grows linearly with size at 0.8128 mm per
 * whole size, anchored so size 6 is 16.51 mm — the ISO/US standard relation.
 */
const MM_PER_SIZE = 0.8128;
const SIZE_ZERO_DIAMETER_MM = 11.63;

export const MIN_SIZE = 3;
export const MAX_SIZE = 13;

export function sizeToDiameterMm(size: number): number {
  return SIZE_ZERO_DIAMETER_MM + MM_PER_SIZE * size;
}

export function diameterMmToSize(diameterMm: number): number {
  return (diameterMm - SIZE_ZERO_DIAMETER_MM) / MM_PER_SIZE;
}

export function sizeToCircumferenceMm(size: number): number {
  return Math.PI * sizeToDiameterMm(size);
}

export function circumferenceMmToSize(circumferenceMm: number): number {
  return diameterMmToSize(circumferenceMm / Math.PI);
}

/** Half sizes are the finest increment jewellers cut. */
export function snapToStockSize(size: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size * 2) / 2));
}

export const STOCK_SIZES: number[] = Array.from(
  { length: (MAX_SIZE - MIN_SIZE) * 2 + 1 },
  (_, i) => MIN_SIZE + i / 2,
);

export function formatSize(size: number): string {
  return Number.isInteger(size) ? `${size}` : size.toFixed(1);
}

/** Rough UK/AU letter equivalents, for shoppers who know their size that way. */
const UK_LETTERS = [
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
];

export function usSizeToUk(size: number): string {
  const index = Math.round((size - MIN_SIZE) * 2);
  return UK_LETTERS[Math.min(UK_LETTERS.length - 1, Math.max(0, index))];
}

/**
 * The average adult ring-finger size, used as the starting point in the studio
 * before the user has measured anything.
 */
export const DEFAULT_SIZE = 6.5;
