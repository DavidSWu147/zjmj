import { describe, expect, it } from 'vitest';
import {
  deserializeWall,
  diceRollChar,
  diceSuffix,
  displaySeed,
  parseDisplaySeed,
  prngFromSeed,
  randomWallSeed,
  rankWallSequence,
  seedFromString,
  seedToString,
  serializeWall,
  unrankWallSequence,
  WALL_SERIAL_CHARS,
  WALL_SERIAL_CHARS_BONUS,
} from '../src/seed';
import { Wall } from '../src/wall';
import { fullTileSet, mulberry32, sortTiles } from '../src/tiles';

describe('wall seeds (v0.2)', () => {
  it('seed strings are 13 base-36 chars and round-trip', () => {
    for (const seed of [0n, 1n, 123456789n, (1n << 64n) - 1n]) {
      const s = seedToString(seed);
      expect(s).toMatch(/^[0-9A-Z]{13}$/);
      expect(seedFromString(s)).toBe(seed);
    }
    expect(seedFromString('not-a-seed!!!')).toBeNull();
    expect(seedFromString('ZZZZZZZZZZZZZ')).toBeNull(); // 36^13 - 1 > 2^64 - 1
  });

  it('the PRNG is deterministic and uniform-ish in [0,1)', () => {
    const a = prngFromSeed(42n);
    const b = prngFromSeed(42n);
    const c = prngFromSeed(43n);
    const seqA = Array.from({ length: 20 }, a);
    const seqB = Array.from({ length: 20 }, b);
    const seqC = Array.from({ length: 20 }, c);
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('the same seed reproduces the exact same wall and dice', () => {
    const seed = randomWallSeed(mulberry32(7));
    const w1 = new Wall(prngFromSeed(seed));
    const w2 = new Wall(prngFromSeed(seed));
    expect(w1.sequence).toEqual(w2.sequence);
    expect(w1.dice).toEqual(w2.dice);
    expect(w1.hands).toEqual(w2.hands);
  });

  it('dice map to base-36 chars per spec: snake eyes 0, 6-5 Y, boxcars Z', () => {
    expect(diceRollChar(1, 1)).toBe('0');
    expect(diceRollChar(1, 2)).toBe('1');
    expect(diceRollChar(6, 5)).toBe('Y');
    expect(diceRollChar(6, 6)).toBe('Z');
    expect(diceSuffix([6, 6, 6, 6])).toBe('-ZZ');
    expect(diceSuffix([1, 1, 1, 2])).toBe('-01');
  });

  it('display seeds parse back to seed + dice', () => {
    const seed = 0x123456789abcdefn;
    const dice = [3, 4, 2, 6] as const;
    const disp = displaySeed(seed, dice);
    expect(disp).toMatch(/^[0-9A-Z]{13}-[0-9A-Z]{2}$/);
    const parsed = parseDisplaySeed(disp)!;
    expect(parsed.seed).toBe(seed);
    expect(parsed.dice).toEqual([...dice]);
  });
});

describe('wall serialization (v0.2)', () => {
  it('rank 0 is the sorted full set; rank/unrank round-trips', () => {
    const sorted = sortTiles(fullTileSet(false));
    expect(rankWallSequence(sorted)).toBe(0n);
    expect(unrankWallSequence(0n, false)).toEqual(sorted);
    const sortedBonus = sortTiles(fullTileSet(true));
    expect(rankWallSequence(sortedBonus)).toBe(0n);
  });

  it('serializes a seeded wall to 120 chars + dice suffix and back exactly', () => {
    const seed = randomWallSeed(mulberry32(99));
    const w = new Wall(prngFromSeed(seed));
    const s = serializeWall(w.sequence, w.dice);
    expect(s).toMatch(new RegExp(`^[0-9A-Z]{${WALL_SERIAL_CHARS}}-[0-9A-Z]{2}$`));
    const back = deserializeWall(s)!;
    expect(back.seq).toEqual(w.sequence);
    expect(back.dice).toEqual([...w.dice]);
  });

  it('bonus walls use 131 chars and round-trip too', () => {
    const w = new Wall(prngFromSeed(123456789n), { bonus: true });
    const s = serializeWall(w.sequence, w.dice);
    expect(s).toMatch(new RegExp(`^[0-9A-Z]{${WALL_SERIAL_CHARS_BONUS}}-[0-9A-Z]{2}$`));
    expect(deserializeWall(s)!.seq).toEqual(w.sequence);
  });

  it('distinct walls get distinct serializations (injection)', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 10; k++) {
      const w = new Wall(prngFromSeed(BigInt(1000 + k)));
      seen.add(serializeWall(w.sequence, w.dice));
    }
    expect(seen.size).toBe(10);
  });

  it('rejects malformed serializations', () => {
    expect(deserializeWall('ABC-00')).toBeNull();
    expect(deserializeWall('Z'.repeat(WALL_SERIAL_CHARS) + '-00')).toBeNull(); // over max rank
    expect(deserializeWall('0'.repeat(WALL_SERIAL_CHARS))).toBeNull(); // no dice suffix
  });
});
