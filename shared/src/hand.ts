import { isHonorIdx, tileIndex, Tile } from './tiles';

/** One set in a decomposition of concealed tiles. */
export interface DecompSet {
  kind: 'seq' | 'tri';
  /** Tile index; for a sequence, the lowest tile of the run. */
  idx: number;
}

export interface Decomp {
  sets: DecompSet[];
  pairIdx: number;
}

/**
 * All distinct ways to split `counts` (34-slot multiset) into `nSets` sets
 * (sequences/triplets) plus one pair.
 */
export function decompose(counts: number[], nSets: number): Decomp[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== nSets * 3 + 2) return [];
  const results: Decomp[] = [];
  const seen = new Set<string>();
  const c = counts.slice();

  const findSets = (start: number, sets: DecompSet[], pairIdx: number) => {
    let i = start;
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) {
      if (sets.length === nSets) {
        const key = pairIdx + '|' + sets.map((s) => s.kind + s.idx).sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ sets: [...sets], pairIdx });
        }
      }
      return;
    }
    if (sets.length === nSets) return;
    // Triplet at i.
    if (c[i] >= 3) {
      c[i] -= 3;
      sets.push({ kind: 'tri', idx: i });
      findSets(i, sets, pairIdx);
      sets.pop();
      c[i] += 3;
    }
    // Sequence starting at i (number tiles only, rank <= 7 within the suit).
    if (!isHonorIdx(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      sets.push({ kind: 'seq', idx: i });
      findSets(i, sets, pairIdx);
      sets.pop();
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
  };

  for (let p = 0; p < 34; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      findSets(0, [], p);
      c[p] += 2;
    }
  }
  return results;
}

/** Seven Pairs: 14 tiles, seven pairs; two identical pairs are allowed (count 4). */
export function isSevenPairsShape(counts: number[]): boolean {
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] % 2 !== 0) return false;
    pairs += counts[i] / 2;
  }
  return pairs === 7;
}

const THIRTEEN_IDX = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/**
 * Thirteen Terminals: one of EACH of the 13 terminal/honor types, plus one
 * duplicate of any of them (exactly one pair). A hand that stays within the
 * 13 types but is missing some of them (e.g. two pairs) is NOT a winning hand.
 */
export function isThirteenTerminalsShape(counts: number[]): boolean {
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (THIRTEEN_IDX.includes(i)) {
      if (counts[i] < 1 || counts[i] > 2) return false;
      if (counts[i] === 2) pairs++;
    } else if (counts[i] > 0) {
      return false;
    }
  }
  return pairs === 1;
}

/**
 * Can a hand win? `counts` covers the concealed tiles including the winning
 * tile; `meldCount` is the number of exposed/declared melds (kongs count once).
 */
export function canWinShape(counts: number[], meldCount: number): boolean {
  if (meldCount === 0 && (isSevenPairsShape(counts) || isThirteenTerminalsShape(counts))) return true;
  return decompose(counts, 4 - meldCount).length > 0;
}

/**
 * All tile indices that would complete the hand (for claim checks / UI).
 * `counts13` covers concealed tiles without the winning tile.
 */
export function winningTileIndices(counts13: number[], meldCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 34; i++) {
    if (counts13[i] >= 4) continue;
    counts13[i]++;
    if (canWinShape(counts13, meldCount)) out.push(i);
    counts13[i]--;
  }
  return out;
}

/** Chow options for a claimed tile: valid low tile indices of the sequence. */
export function chowOptions(handCounts: number[], claimedTile: Tile): number[] {
  const t = tileIndex(claimedTile);
  if (isHonorIdx(t)) return [];
  const r = t % 9; // 0-based rank
  const opts: number[] = [];
  const has = (i: number) => i >= 0 && Math.floor(i / 9) === Math.floor(t / 9) && handCounts[i] > 0;
  if (r >= 2 && has(t - 2) && has(t - 1)) opts.push(t - 2);
  if (r >= 1 && r <= 7 && has(t - 1) && has(t + 1)) opts.push(t - 1);
  if (r <= 6 && has(t + 1) && has(t + 2)) opts.push(t);
  return opts;
}
