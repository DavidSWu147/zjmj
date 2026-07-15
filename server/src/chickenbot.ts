/**
 * ChickenBot (update 0.1.4 #4): a naive but non-trivial bot that rushes the
 * quickest win available — usually a chicken hand, occasionally Seven Pairs
 * or even Thirteen Terminals.
 *
 * Everything here is pure hand analysis; the Game drives the actual actions.
 * Two concepts from the spec underpin every decision:
 *
 * - "Distance from ready": how many perfect draws/claims a pre-draw 13-tile
 *   hand needs before it waits on a winning tile. Computed by filling the
 *   3-3-3-3-2 frame — melds contribute 3, pairs/partial melds 2, singles 1,
 *   and the final slot must hold a pair or a single — then subtracting the
 *   maximum total contribution from 13. The Seven Pairs and Thirteen
 *   Terminals variants apply only while the bot is committed to that shape
 *   (0.1.5 #2): a normal-mode hand is judged by the regular frame alone.
 * - "Distance reducing outs": the number of unseen tiles (copies, not types)
 *   whose draw lets some discard take the hand one step closer; for a ready
 *   hand, the unseen copies of its winning tiles.
 */
import {
  isHonorIdx,
  Tile,
  tileFromIndex,
  tileIndex,
  winningTileIndices,
} from '../../shared/src/index';

export type BotKind = 'dummy' | 'chicken';

/** Hand plan per spec 4.2/4.3: pursue a special shape or play normally. */
export type ChickenMode = 'thirteen' | 'pairs' | 'normal';

const THIRTEEN_IDX = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/**
 * Maximum contribution of the concealed tiles toward `setSlots` set slots
 * plus the pair slot. Sets are enumerated exhaustively (a greedy extraction
 * mishandles shapes like 345567 or 11123), then pairs/partial melds, with
 * leftover singles filling any empty slots.
 */
/**
 * The distance search revisits the same hand shapes constantly (outs try
 * every draw × discard); a memo keeps a bot turn comfortably cheap.
 */
const contributionCache = new Map<string, number>();

function maxContribution(counts: number[], setSlots: number): number {
  const key = counts.join('') + setSlots;
  const cached = contributionCache.get(key);
  if (cached !== undefined) return cached;
  const total = counts.reduce((a, b) => a + b, 0);
  // Nothing can beat filling every set slot plus the pair (bounded by the
  // tiles actually available); reaching it ends the search.
  const maxPossible = Math.min(3 * setSlots + 2, total);
  let best = 0;
  const c = counts.slice();

  // Phase 2: pairs (any slot) and partial runs (set slots only) worth 2.
  const blocks = (start: number, sets: number, pairs: number, runs: number): void => {
    const filled = sets + pairs + runs;
    const leftover = total - 3 * sets - 2 * (pairs + runs);
    const contrib =
      3 * sets + 2 * (pairs + runs) + Math.min(leftover, Math.max(0, setSlots + 1 - filled));
    if (contrib > best) best = contrib;
    if (best >= maxPossible) return;
    if (pairs + runs >= setSlots - sets + 1) return; // every block slot used
    let i = start;
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return;
    blocks(i + 1, sets, pairs, runs);
    if (c[i] >= 2) {
      c[i] -= 2;
      blocks(i, sets, pairs + 1, runs);
      c[i] += 2;
    }
    // Partial runs (23/13-style, incl. gaps of one) only fill set slots.
    if (runs < setSlots - sets && !isHonorIdx(i)) {
      const r = i % 9;
      for (const step of [1, 2]) {
        if (r <= 8 - step && c[i + step] > 0) {
          c[i]--;
          c[i + step]--;
          blocks(i, sets, pairs, runs + 1);
          c[i]++;
          c[i + step]++;
        }
      }
    }
  };

  // Phase 1: sequences and triplets worth 3.
  const rec = (start: number, sets: number): void => {
    blocks(0, sets, 0, 0);
    if (best >= maxPossible || sets >= setSlots) return;
    let i = start;
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return;
    rec(i + 1, sets);
    if (c[i] >= 3) {
      c[i] -= 3;
      rec(i, sets + 1);
      c[i] += 3;
    }
    if (!isHonorIdx(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      rec(i, sets + 1);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
  };
  rec(0, 0);
  if (contributionCache.size > 200_000) contributionCache.clear();
  contributionCache.set(key, best);
  return best;
}

/** Distance toward the regular 4-melds-and-a-pair hand. */
export function regularDistance(counts: number[], meldCount: number): number {
  return 13 - 3 * meldCount - maxContribution(counts, 4 - meldCount);
}

/** Distance toward Seven Pairs (duplicate pairs count; unmelded hands only). */
export function sevenPairsDistance(counts: number[]): number {
  let pairs = 0;
  for (let i = 0; i < 34; i++) pairs += Math.floor(counts[i] / 2);
  return Math.max(0, 6 - pairs);
}

/** Distance toward Thirteen Terminals (unmelded hands only). */
export function thirteenDistance(counts: number[]): number {
  let unique = 0;
  let paired = false;
  for (const i of THIRTEEN_IDX) {
    if (counts[i] >= 1) unique++;
    if (counts[i] >= 2) paired = true;
  }
  return Math.max(0, 13 - unique - (paired ? 1 : 0));
}

/**
 * Spec 4.2/4.3: which shape the bot commits to for this decision. Seven
 * Pairs is checked first (0.1.5 #1): a hand qualifying for both (5+ pairs of
 * terminals/honors) goes for the far easier Seven Pairs.
 */
export function chickenMode(counts: number[], meldCount: number): ChickenMode {
  if (meldCount > 0) return 'normal';
  let pairs = 0;
  for (let i = 0; i < 34; i++) pairs += Math.floor(counts[i] / 2);
  if (pairs >= 5) return 'pairs';
  let unique = 0;
  for (const i of THIRTEEN_IDX) if (counts[i] >= 1) unique++;
  if (unique >= 9) return 'thirteen';
  return 'normal';
}

function modalDistance(counts: number[], meldCount: number, mode: ChickenMode): number {
  if (mode === 'thirteen') return thirteenDistance(counts);
  if (mode === 'pairs') return sevenPairsDistance(counts);
  return regularDistance(counts, meldCount);
}

/**
 * Best distance reachable from a 14-tile hand by one discard. A draw never
 * gains more than one step, so callers pass the value they are probing for
 * (`stopAt`) to end the scan as soon as it is reached.
 */
function bestAfterDiscard(
  counts14: number[],
  meldCount: number,
  mode: ChickenMode,
  stopAt = 0,
): number {
  let best = Infinity;
  for (let d = 0; d < 34 && best > stopAt; d++) {
    if (counts14[d] === 0) continue;
    counts14[d]--;
    const v = modalDistance(counts14, meldCount, mode);
    counts14[d]++;
    if (v < best) best = v;
  }
  return best;
}

/**
 * Distance reducing outs of a pre-draw hand (spec): unseen copies of every
 * tile type whose draw can take the hand from N to N-1 — or, when already
 * ready, unseen copies of the winning tiles.
 */
export function distanceReducingOuts(
  counts13: number[],
  meldCount: number,
  mode: ChickenMode,
  unseen: number[],
): number {
  const n = modalDistance(counts13, meldCount, mode);
  let outs = 0;
  if (n === 0) {
    for (const w of winningTileIndices(counts13, meldCount)) outs += unseen[w];
    return outs;
  }
  for (let t = 0; t < 34; t++) {
    if (unseen[t] <= 0 || counts13[t] >= 4) continue;
    counts13[t]++;
    if (bestAfterDiscard(counts13, meldCount, mode, n - 1) === n - 1) outs += unseen[t];
    counts13[t]--;
  }
  return outs;
}

/**
 * Spec 4.4.1 (Seven Pairs mode): number tiles go before honors, middle ranks
 * first — B5,C5,D5, B4,C4,D4, B6,C6,D6, … B9,C9,D9. Lower = discard sooner.
 */
const NUM_ORDER: number[] = (() => {
  const out: number[] = [];
  for (const r of [5, 4, 6, 3, 7, 2, 8, 1, 9]) {
    for (let s = 0; s < 3; s++) out.push(s * 9 + r - 1);
  }
  return out;
})();

/**
 * 0.1.5 #3 (normal / Thirteen Terminals mode): honors go first, then the
 * numbers in the exact reverse — 9D,9C,9B, 1D,1C,1B, … 4D,4C,4B, 5D,5C,5B —
 * shedding terminals early and hoarding the middle ranks.
 */
const NUM_ORDER_REV: number[] = [...NUM_ORDER].reverse();

/** Spec 4.4.2: honor discard order per own seat wind (E/S/W/N). */
const HONOR_ORDER: number[][] = [
  [28, 29, 30, 31, 32, 33, 27], // East:  S W N R G O E
  [29, 30, 27, 33, 31, 32, 28], // South: W N E O R G S
  [30, 27, 28, 32, 31, 33, 29], // West:  N E S G R O W
  [27, 28, 29, 33, 32, 31, 30], // North: E S W O G R N
];

/**
 * Position in the seat's discard preference order for the current hand plan;
 * lower discards first. Seven Pairs keeps the middle-out order with honors
 * last; normal and Thirteen Terminals shed honors first, then terminals
 * inward (0.1.5 #3). The honor order itself always follows the seat wind.
 */
export function discardPriority(tileIdx: number, seat: number, mode: ChickenMode): number {
  const honorPos = HONOR_ORDER[seat % 4].indexOf(tileIdx);
  if (mode === 'pairs') {
    return isHonorIdx(tileIdx) ? 27 + honorPos : NUM_ORDER.indexOf(tileIdx);
  }
  return isHonorIdx(tileIdx) ? honorPos : 7 + NUM_ORDER_REV.indexOf(tileIdx);
}

export interface HandContext {
  /** Concealed tiles, excluding the drawn tile. */
  hand: Tile[];
  meldCount: number;
  /** Current seat (0=E..3=N) — drives the honor discard order. */
  seat: number;
  /** Unseen copies of each tile type from this player's perspective. */
  unseen: number[];
}

/**
 * Spec 4.4: pick a discard minimizing distance from ready, then maximizing
 * distance reducing outs, then by the fixed tile order; prefer the drawn
 * copy over an identical tile from hand (4.4.3).
 */
export function chooseDiscard(ctx: HandContext & { drawn: Tile | null }): {
  tile: Tile;
  fromDrawn: boolean;
} {
  const all = ctx.drawn !== null ? [...ctx.hand, ctx.drawn] : [...ctx.hand];
  const counts = new Array(34).fill(0);
  for (const t of all) counts[tileIndex(t)]++;
  const mode = chickenMode(counts, ctx.meldCount);

  let pool: number[] = [];
  let bestDist = Infinity;
  for (let d = 0; d < 34; d++) {
    if (counts[d] === 0) continue;
    counts[d]--;
    const v = modalDistance(counts, ctx.meldCount, mode);
    counts[d]++;
    if (v < bestDist) {
      bestDist = v;
      pool = [d];
    } else if (v === bestDist) {
      pool.push(d);
    }
  }
  if (pool.length > 1) {
    let bestOuts = -1;
    let outsPool: number[] = [];
    for (const d of pool) {
      counts[d]--;
      const o = distanceReducingOuts(counts, ctx.meldCount, mode, ctx.unseen);
      counts[d]++;
      if (o > bestOuts) {
        bestOuts = o;
        outsPool = [d];
      } else if (o === bestOuts) {
        outsPool.push(d);
      }
    }
    pool = outsPool;
  }
  pool.sort((a, b) => discardPriority(a, ctx.seat, mode) - discardPriority(b, ctx.seat, mode));
  const tile = tileFromIndex(pool[0]);
  return { tile, fromDrawn: ctx.drawn === tile };
}

/**
 * Spec 4.6 (own turn): declare a concealed/small kong only if the resulting
 * hand's distance from ready does not grow.
 */
export function wantsOwnKong(
  ctx: HandContext & { drawn: Tile | null },
  option: { tile: Tile; variant: 'concealed' | 'small' },
): boolean {
  const all = ctx.drawn !== null ? [...ctx.hand, ctx.drawn] : [...ctx.hand];
  const counts = new Array(34).fill(0);
  for (const t of all) counts[tileIndex(t)]++;
  const mode = chickenMode(counts, ctx.meldCount);
  const n = modalDistance(
    (() => {
      const c13 = new Array(34).fill(0);
      for (const t of ctx.hand) c13[tileIndex(t)]++;
      return c13;
    })(),
    ctx.meldCount,
    mode,
  );
  const ti = tileIndex(option.tile);
  if (option.variant === 'concealed') {
    counts[ti] -= 4;
    const after = regularDistance(counts, ctx.meldCount + 1);
    counts[ti] += 4;
    return after <= n;
  }
  // Small kong: the pung meld keeps its contribution of 3, so only the
  // pocketed 4th copy leaves the concealed tiles.
  counts[ti] -= 1;
  const after = regularDistance(counts, ctx.meldCount);
  counts[ti] += 1;
  return after <= n;
}

export type ClaimDecision =
  | { kind: 'kong' }
  | { kind: 'pung'; discard: Tile }
  | { kind: 'chow'; low: number; discard: Tile }
  | null;

/**
 * Spec 4.5/4.6 (another player's discard; mahjong is decided by the caller):
 * chow/pung only if it strictly improves distance from ready — ties broken by
 * outs, then pung over chow, then the highest-numbered chow — and big kong
 * only if distance is preserved, never over an improving pung/chow.
 * While committed to Seven Pairs or Thirteen Terminals (4.2/4.3), pass.
 */
export function chooseClaim(
  ctx: HandContext,
  tile: Tile,
  avail: { kong: boolean; pung: boolean; chows: number[] },
): ClaimDecision {
  const counts = new Array(34).fill(0);
  for (const t of ctx.hand) counts[tileIndex(t)]++;
  if (chickenMode(counts, ctx.meldCount) !== 'normal') return null;
  const n = regularDistance(counts, ctx.meldCount);
  const ti = tileIndex(tile);

  interface Option {
    kind: 'pung' | 'chow';
    low: number;
    dist: number;
    outs: number;
    discard: number;
  }
  const options: Option[] = [];
  const evalOption = (kind: 'pung' | 'chow', low: number, fromHand: number[]): void => {
    for (const u of fromHand) counts[u]--;
    // The claimant must follow with a discard: judge the best reachable hand,
    // picking that discard by the same distance → outs → tile-order rule.
    let dist = Infinity;
    let pool: number[] = [];
    for (let d = 0; d < 34; d++) {
      if (counts[d] === 0) continue;
      counts[d]--;
      const v = regularDistance(counts, ctx.meldCount + 1);
      counts[d]++;
      if (v < dist) {
        dist = v;
        pool = [d];
      } else if (v === dist) {
        pool.push(d);
      }
    }
    let outs = -1;
    let discard = -1;
    for (const d of pool) {
      counts[d]--;
      const o = distanceReducingOuts(counts, ctx.meldCount + 1, 'normal', ctx.unseen);
      counts[d]++;
      if (
        o > outs ||
        (o === outs && discardPriority(d, ctx.seat, 'normal') < discardPriority(discard, ctx.seat, 'normal'))
      ) {
        outs = o;
        discard = d;
      }
    }
    for (const u of fromHand) counts[u]++;
    if (discard >= 0) options.push({ kind, low, dist, outs, discard });
  };

  if (avail.pung) evalOption('pung', ti, [ti, ti]);
  for (const low of avail.chows) {
    // A chow uses the two run tiles that are not the claimed one.
    evalOption('chow', low, [low, low + 1, low + 2].filter((x) => x !== ti));
  }

  const improving = options.filter((o) => o.dist < n);
  if (improving.length > 0) {
    improving.sort(
      (a, b) =>
        a.dist - b.dist ||
        b.outs - a.outs ||
        (a.kind === b.kind ? b.low - a.low : a.kind === 'pung' ? -1 : 1),
    );
    const pick = improving[0];
    return pick.kind === 'pung'
      ? { kind: 'pung', discard: tileFromIndex(pick.discard) }
      : { kind: 'chow', low: pick.low, discard: tileFromIndex(pick.discard) };
  }

  if (avail.kong) {
    counts[ti] -= 3;
    const after = regularDistance(counts, ctx.meldCount + 1);
    counts[ti] += 3;
    if (after <= n) return { kind: 'kong' };
  }
  return null;
}
