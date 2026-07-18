import { BONUS_TILES, ALL_TILE_TYPES, Tile } from './tiles';

/**
 * Wall seeding & serialization (v0.2 part 2).
 *
 * Every game's wall (tile order + the four break dice) is generated from a
 * 64-bit seed through a fixed, deterministic PRNG, so a game is fully
 * reproducible from its seed. Seeds display as 13 base-36 characters
 * (36^13 > 2^64) plus a "-XX" suffix encoding the two dice rolls — each roll
 * of two dice has 36 outcomes, mapping to exactly one base-36 character
 * (snake eyes = 0, 1-2 = 1, …, 6-5 = Y, boxcars = Z).
 *
 * Independently, a wall's *contents* can be serialized exactly: the tile
 * sequence is ranked within the canonical enumeration of all distinct
 * arrangements (lexicographic by canonical tile order, most significant
 * position first), written in base-36 and zero-padded to 120 characters
 * (136!/24^34 ≈ 4.33e185 < 36^120) — or 131 with bonus tiles in play
 * (144!/(24^34) ≈ 6.56e202 < 36^131). The dice ride in the same "-XX"
 * suffix. serializeWall(wallFromSeed(seed)) therefore encodes the exact
 * wall the seed produces.
 */

export const SEED_CHARS = 13;
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MASK64 = (1n << 64n) - 1n;

// ── 64-bit seeds ──────────────────────────────────────────────────────

/** A uniform 64-bit seed drawn from the given RNG (tests pass a seeded one). */
export function randomWallSeed(rng: () => number = Math.random): bigint {
  const hi = BigInt(Math.floor(rng() * 0x100000000) >>> 0);
  const lo = BigInt(Math.floor(rng() * 0x100000000) >>> 0);
  return ((hi << 32n) | lo) & MASK64;
}

/** 13 base-36 characters, zero-padded, uppercase. */
export function seedToString(seed: bigint): string {
  return (seed & MASK64).toString(36).toUpperCase().padStart(SEED_CHARS, '0');
}

/** Parses a 13-character base-36 seed; null when malformed or out of range. */
export function seedFromString(s: string): bigint | null {
  if (!/^[0-9A-Za-z]{13}$/.test(s)) return null;
  let v = 0n;
  for (const ch of s.toUpperCase()) v = v * 36n + BigInt(B36.indexOf(ch));
  return v > MASK64 ? null : v;
}

/**
 * Deterministic PRNG from a 64-bit seed: a splitmix64 stream expands the
 * seed into four 32-bit words seeding sfc32. Integer-only math, so the
 * stream is identical on every platform.
 */
export function prngFromSeed(seed: bigint): () => number {
  let state = seed & MASK64;
  const next64 = (): bigint => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  };
  const w1 = next64();
  const w2 = next64();
  let a = Number(w1 & 0xffffffffn) >>> 0;
  let b = Number(w1 >> 32n) >>> 0;
  let c = Number(w2 & 0xffffffffn) >>> 0;
  let d = Number(w2 >> 32n) >>> 0;
  // sfc32
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// ── dice suffix ───────────────────────────────────────────────────────

/** One ordered roll of two dice as a base-36 character: (1,1)→0 … (6,6)→Z. */
export function diceRollChar(d1: number, d2: number): string {
  return B36[(d1 - 1) * 6 + (d2 - 1)];
}

/** "-XX" for the two rolls (four dice in roll order). */
export function diceSuffix(dice: readonly number[]): string {
  return `-${diceRollChar(dice[0], dice[1])}${diceRollChar(dice[2], dice[3])}`;
}

/** The display form used in records: "0A1B2C3D4E5F6-XY". */
export function displaySeed(seed: bigint, dice: readonly number[]): string {
  return seedToString(seed) + diceSuffix(dice);
}

/** Parses "SSSSSSSSSSSSS-XY" back into seed and dice; null when malformed. */
export function parseDisplaySeed(
  s: string,
): { seed: bigint; dice: [number, number, number, number] } | null {
  const m = s.match(/^([0-9A-Za-z]{13})-([0-9A-Za-z])([0-9A-Za-z])$/);
  if (!m) return null;
  const seed = seedFromString(m[1]);
  if (seed === null) return null;
  const rolls = [m[2], m[3]].map((ch) => B36.indexOf(ch.toUpperCase()));
  const dice = rolls.flatMap((r) => [Math.floor(r / 6) + 1, (r % 6) + 1]);
  return { seed, dice: dice as [number, number, number, number] };
}

// ── exact wall serialization (rank/unrank) ────────────────────────────

/** Canonical tile kinds in order: the 34 hand tiles, then F1..F4, A1..A4. */
const KINDS: Tile[] = [...ALL_TILE_TYPES, ...BONUS_TILES];
const KIND_ORD = new Map(KINDS.map((t, i) => [t, i]));

export const WALL_SERIAL_CHARS = 120;
export const WALL_SERIAL_CHARS_BONUS = 131;

/** counts[kind] for a full wall: 4 of each hand tile, 1 of each bonus tile. */
function fullCounts(bonus: boolean): number[] {
  const c: number[] = KINDS.map((t, i) => (i < 34 ? 4 : 0));
  if (bonus) for (let i = 34; i < KINDS.length; i++) c[i] = 1;
  return c;
}

const factCache: bigint[] = [1n];
function fact(n: number): bigint {
  for (let i = factCache.length; i <= n; i++) factCache.push(factCache[i - 1] * BigInt(i));
  return factCache[n];
}

/**
 * Rank of a full wall sequence (136 or 144 tiles) among all distinct
 * arrangements of the tile multiset, lexicographic by canonical tile order
 * with the first-dealt tile most significant.
 */
export function rankWallSequence(seq: Tile[]): bigint {
  const bonus = seq.length === 144;
  if (!bonus && seq.length !== 136) throw new Error(`bad wall length ${seq.length}`);
  const counts = fullCounts(bonus);
  // denom = Π counts[k]! — updated incrementally as tiles are consumed.
  let denom = 1n;
  for (const c of counts) denom *= fact(c);
  let rank = 0n;
  for (let i = 0; i < seq.length; i++) {
    const ord = KIND_ORD.get(seq[i]);
    if (ord === undefined || counts[ord] === 0) throw new Error(`bad wall tile ${seq[i]} at ${i}`);
    const rem = seq.length - i - 1;
    for (let t = 0; t < ord; t++) {
      if (counts[t] === 0) continue;
      // Arrangements of the remainder if tile t were placed here.
      rank += (fact(rem) * BigInt(counts[t])) / denom;
    }
    denom /= BigInt(counts[ord]);
    counts[ord]--;
  }
  return rank;
}

/** Inverse of rankWallSequence. */
export function unrankWallSequence(rank: bigint, bonus: boolean): Tile[] {
  const counts = fullCounts(bonus);
  const n = bonus ? 144 : 136;
  let denom = 1n;
  for (const c of counts) denom *= fact(c);
  let r = rank;
  const out: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const rem = n - i - 1;
    let placed = false;
    for (let t = 0; t < KINDS.length; t++) {
      if (counts[t] === 0) continue;
      const below = (fact(rem) * BigInt(counts[t])) / denom;
      if (r < below) {
        out.push(KINDS[t]);
        denom /= BigInt(counts[t]);
        counts[t]--;
        placed = true;
        break;
      }
      r -= below;
    }
    if (!placed) throw new Error('wall rank out of range');
  }
  if (r !== 0n) throw new Error('wall rank out of range');
  return out;
}

/**
 * Serializes a wall's exact contents: base-36 rank zero-padded to 120 (131
 * with bonus tiles) characters, plus the "-XX" dice suffix.
 */
export function serializeWall(seq: Tile[], dice: readonly number[]): string {
  const chars = seq.length === 144 ? WALL_SERIAL_CHARS_BONUS : WALL_SERIAL_CHARS;
  const body = rankWallSequence(seq).toString(36).toUpperCase().padStart(chars, '0');
  return body + diceSuffix(dice);
}

/** Parses a wall serialization back into its tile sequence and dice. */
export function deserializeWall(
  s: string,
): { seq: Tile[]; dice: [number, number, number, number] } | null {
  const m = s.match(/^([0-9A-Za-z]+)-([0-9A-Za-z])([0-9A-Za-z])$/);
  if (!m) return null;
  const body = m[1].toUpperCase();
  const bonus = body.length === WALL_SERIAL_CHARS_BONUS;
  if (!bonus && body.length !== WALL_SERIAL_CHARS) return null;
  let rank = 0n;
  for (const ch of body) rank = rank * 36n + BigInt(B36.indexOf(ch));
  let seq: Tile[];
  try {
    seq = unrankWallSequence(rank, bonus);
  } catch {
    return null;
  }
  const rolls = [m[2], m[3]].map((ch) => B36.indexOf(ch.toUpperCase()));
  const dice = rolls.flatMap((r) => [Math.floor(r / 6) + 1, (r % 6) + 1]);
  return { seq, dice: dice as [number, number, number, number] };
}
