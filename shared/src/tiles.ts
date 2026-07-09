/**
 * Tile representation per spec:
 *   Bamboo "B1".."B9", Character "C1".."C9", Dots "D1".."D9",
 *   Winds "E ", "S ", "W ", "N ", Dragons "R ", "G ", "O " (White).
 * Honor codes are exactly two characters with a trailing space.
 *
 * Tile type indices 0..33:
 *   0..8 = B1..B9, 9..17 = C1..C9, 18..26 = D1..D9,
 *   27 = E, 28 = S, 29 = W, 30 = N, 31 = R, 32 = G, 33 = O
 */
export type Tile = string;

export const SUITS = ['B', 'C', 'D'] as const;
export type Suit = (typeof SUITS)[number];

export const WIND_TILES: Tile[] = ['E ', 'S ', 'W ', 'N '];
export const DRAGON_TILES: Tile[] = ['R ', 'G ', 'O '];
export const HONOR_TILES: Tile[] = [...WIND_TILES, ...DRAGON_TILES];

export const ALL_TILE_TYPES: Tile[] = (() => {
  const out: Tile[] = [];
  for (const s of SUITS) for (let r = 1; r <= 9; r++) out.push(`${s}${r}`);
  return out.concat(HONOR_TILES);
})();

export function tileIndex(t: Tile): number {
  const i = ALL_TILE_TYPES.indexOf(t);
  if (i < 0) throw new Error(`bad tile: "${t}"`);
  return i;
}

export function tileFromIndex(i: number): Tile {
  if (i < 0 || i > 33) throw new Error(`bad tile index: ${i}`);
  return ALL_TILE_TYPES[i];
}

export function isHonorIdx(i: number): boolean {
  return i >= 27;
}
export function isWindIdx(i: number): boolean {
  return i >= 27 && i <= 30;
}
export function isDragonIdx(i: number): boolean {
  return i >= 31;
}
/** Terminal number tile (1 or 9). */
export function isTerminalIdx(i: number): boolean {
  return i < 27 && (i % 9 === 0 || i % 9 === 8);
}
/** Middle number tile (2..8). */
export function isMiddleIdx(i: number): boolean {
  return i < 27 && i % 9 >= 1 && i % 9 <= 7;
}
export function suitOfIdx(i: number): Suit | null {
  return i < 27 ? SUITS[Math.floor(i / 9)] : null;
}
/** 1..9 for number tiles, null for honors. */
export function rankOfIdx(i: number): number | null {
  return i < 27 ? (i % 9) + 1 : null;
}

export function isHonor(t: Tile): boolean {
  return isHonorIdx(tileIndex(t));
}
export function suitOf(t: Tile): Suit | null {
  return suitOfIdx(tileIndex(t));
}
export function rankOf(t: Tile): number | null {
  return rankOfIdx(tileIndex(t));
}

/** Seat index (0=E,1=S,2=W,3=N) to its wind tile. */
export function windOfSeat(seat: number): Tile {
  return WIND_TILES[seat];
}

/**
 * Bonus tiles (flowers & seasons), used only when the room enables them.
 * "F1".."F4" = Plum, Orchid, Chrysanthemum, Bamboo; "S1".."S4" = Spring,
 * Summer, Autumn, Winter. Number n is proper to seat n-1 (E,S,W,N). Bonus
 * tiles never join a hand: they are revealed and replaced immediately, so
 * the 34-type index machinery (tileIndex, countsFrom) never sees them.
 */
export const FLOWER_TILES: Tile[] = ['F1', 'F2', 'F3', 'F4'];
export const SEASON_TILES: Tile[] = ['S1', 'S2', 'S3', 'S4'];
export const BONUS_TILES: Tile[] = [...FLOWER_TILES, ...SEASON_TILES];

export function isBonusTile(t: Tile): boolean {
  return (t[0] === 'F' || t[0] === 'S') && t[1] !== ' ';
}

/** Sort key that tolerates bonus tiles (they sort after everything else). */
function sortKey(t: Tile): number {
  if (isBonusTile(t)) return 34 + (t[0] === 'F' ? 0 : 4) + (Number(t[1]) - 1);
  return tileIndex(t);
}

export function sortTiles(ts: Tile[]): Tile[] {
  return [...ts].sort((a, b) => sortKey(a) - sortKey(b));
}

/** Multiset of tiles as an array of 34 counts. */
export function countsFrom(ts: Tile[]): number[] {
  const c = new Array(34).fill(0);
  for (const t of ts) c[tileIndex(t)]++;
  return c;
}

export function tilesFromCounts(c: number[]): Tile[] {
  const out: Tile[] = [];
  for (let i = 0; i < 34; i++) for (let k = 0; k < c[i]; k++) out.push(tileFromIndex(i));
  return out;
}

/** A full set of 136 tiles (4 of each type), plus the 8 bonus tiles if asked. */
export function fullTileSet(bonus = false): Tile[] {
  const out: Tile[] = [];
  for (const t of ALL_TILE_TYPES) for (let k = 0; k < 4; k++) out.push(t);
  if (bonus) out.push(...BONUS_TILES);
  return out;
}

/** Seeded PRNG (mulberry32) for reproducible walls in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
