/**
 * TrivialBot and StandardBot (v0.2.5): bots that play toward scoring
 * patterns instead of the bare quickest win. Neither defends.
 *
 * Both reuse ChickenBot's two metrics — "distance from ready" and "distance
 * reducing outs" — but conditioned on a pattern: a hand's distance toward
 * All Sequences only counts sequences, and becomes infinite once an exposed
 * meld rules the pattern out. Every action is judged by its best pattern
 * (lowest distance, then most outs, then a fixed pattern preference, then
 * ChickenBot's tile order).
 *
 * - TrivialBot plays for Concealed Hand, No Terminals and All Sequences, and
 *   grabs a Value Honor triplet or a Kong when offered; once one of those is
 *   secured the hand can no longer be a chicken hand and it plays exactly
 *   like ChickenBot.
 * - StandardBot plays for Mixed One Suit, All Triplets, Three Similar
 *   Sequences, Nine-Tile Straight and Mixed Lesser Terminals.
 *
 * Seven Pairs and Thirteen Terminals follow ChickenBot's thresholds (5+
 * pairs / 9+ unique terminals and honors, no melds): while committed to one
 * the bot simply is ChickenBot. Winning is never decided here — the Game
 * declares Mahjong for every bot whenever the rules allow it.
 */
import { isHonorIdx, Tile, tileFromIndex, tileIndex } from '../../shared/src/index';
import {
  chickenMode,
  chooseClaim as chickenClaim,
  chooseDiscard as chickenDiscard,
  chowPreference,
  ClaimDecision,
  discardPriority,
  HandContext,
  regularDistance,
  wantsOwnKong as chickenKong,
} from './chickenbot';

export interface MeldLite {
  kind: 'chow' | 'pung' | 'kong';
  /** Tile index; for a chow, its lowest tile. */
  idx: number;
}

export interface PatternContext extends HandContext {
  /** Declared melds (ctx.meldCount must equal melds.length). */
  melds: MeldLite[];
}

export type PatternBotKind = 'trivial' | 'standard';

// ── constrained 3-3-3-3-2 frame ─────────────────────────────────────────────

/**
 * Which blocks a pattern accepts. The frame is filled exactly as in
 * ChickenBot's regular distance (sets 3, pairs/partial sets 2, singles 1,
 * the last slot a pair or single), but only with blocks that can still grow
 * into something the pattern allows.
 */
interface Frame {
  id: string;
  /** Triplet of tile i allowed. */
  trip: boolean[];
  /** Sequence starting at tile i allowed. */
  seq: boolean[];
  /** Tile i may be the pair. */
  pair: boolean[];
  /** i,i+1 can grow into an allowed sequence. */
  part1: boolean[];
  /** i,i+2 can grow into an allowed sequence. */
  part2: boolean[];
  /** Tile i can sit in a set slot at all. */
  setUse: boolean[];
}

function makeFrame(
  id: string,
  trip: (i: number) => boolean,
  seq: (low: number) => boolean,
  pair: (i: number) => boolean,
): Frame {
  const f: Frame = { id, trip: [], seq: [], pair: [], part1: [], part2: [], setUse: [] };
  for (let i = 0; i < 34; i++) {
    f.trip.push(trip(i));
    f.seq.push(i < 27 && i % 9 <= 6 && seq(i));
    f.pair.push(pair(i));
  }
  for (let i = 0; i < 34; i++) {
    const r = i % 9;
    const num = i < 27;
    f.part1.push(num && r <= 7 && ((r >= 1 && f.seq[i - 1]) || (r <= 6 && f.seq[i])));
    f.part2.push(num && r <= 6 && f.seq[i]);
    f.setUse.push(
      f.trip[i] ||
        (num && ((r <= 6 && f.seq[i]) || (r >= 1 && r <= 7 && f.seq[i - 1]) || (r >= 2 && f.seq[i - 2]))),
    );
  }
  return f;
}

const contributionCache = new Map<string, number>();
const groupCache = new Map<string, number[]>();

/** Tile-index ranges searched independently: the three suits, then honors. */
const GROUPS: [number, number][] = [
  [0, 9],
  [9, 18],
  [18, 27],
  [27, 34],
];

/**
 * Every way one group's tiles can be arranged, as packed states:
 * sets (3 bits) | set-slot blocks (3) | pair taken (1) | set-usable
 * leftovers capped at 5 (3) | a leftover fit for either slot kind (1) |
 * a leftover fit for the pair slot only (1).
 */
function groupOptions(c: number[], lo: number, hi: number, f: Frame): number[] {
  let key = f.id + lo + ':';
  for (let i = lo; i < hi; i++) key += c[i];
  const cached = groupCache.get(key);
  if (cached) return cached;
  const seen = new Set<number>();

  const record = (sets: number, setBlocks: number, pair: number): void => {
    let usable = 0;
    let both = 0;
    let pairOnly = 0;
    for (let i = lo; i < hi; i++) {
      if (c[i] === 0) continue;
      if (f.setUse[i]) {
        usable += c[i];
        if (f.pair[i]) both = 1;
      } else {
        pairOnly = 1;
      }
    }
    seen.add(
      sets | (setBlocks << 3) | (pair << 6) | (Math.min(usable, 5) << 7) | (both << 10) | (pairOnly << 11),
    );
  };

  // Phase 2: the pair, and pairs/partial runs (worth 2) in set slots.
  const blocks = (start: number, sets: number, setBlocks: number, pair: number): void => {
    record(sets, setBlocks, pair);
    let i = start;
    while (i < hi && c[i] === 0) i++;
    if (i >= hi) return;
    blocks(i + 1, sets, setBlocks, pair);
    const room = sets + setBlocks < 4;
    if (c[i] >= 2) {
      if (pair === 0 && f.pair[i]) {
        c[i] -= 2;
        blocks(i, sets, setBlocks, 1);
        c[i] += 2;
      }
      if (room && f.trip[i]) {
        c[i] -= 2;
        blocks(i, sets, setBlocks + 1, pair);
        c[i] += 2;
      }
    }
    if (room && f.part1[i] && c[i + 1] > 0) {
      c[i]--;
      c[i + 1]--;
      blocks(i, sets, setBlocks + 1, pair);
      c[i]++;
      c[i + 1]++;
    }
    if (room && f.part2[i] && c[i + 2] > 0) {
      c[i]--;
      c[i + 2]--;
      blocks(i, sets, setBlocks + 1, pair);
      c[i]++;
      c[i + 2]++;
    }
  };

  // Phase 1: complete sets worth 3.
  const rec = (start: number, sets: number): void => {
    blocks(lo, sets, 0, 0);
    if (sets >= 4) return;
    let i = start;
    while (i < hi && c[i] === 0) i++;
    if (i >= hi) return;
    rec(i + 1, sets);
    if (c[i] >= 3 && f.trip[i]) {
      c[i] -= 3;
      rec(i, sets + 1);
      c[i] += 3;
    }
    if (f.seq[i] && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      rec(i, sets + 1);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
  };
  rec(lo, 0);
  const out = [...seen];
  if (groupCache.size > 200_000) groupCache.clear();
  groupCache.set(key, out);
  return out;
}

/**
 * Maximum contribution of the concealed tiles toward `setSlots` + the pair.
 * Suits and honors never share a block, so each group is enumerated on its
 * own (and cached) and the groups are then combined slot by slot.
 */
function frameContribution(countsIn: number[], setSlots: number, f: Frame): number {
  // Tiles the pattern has no use for contribute nothing: drop them up front.
  const c = countsIn.map((n, i) => (f.setUse[i] || f.pair[i] ? n : 0));
  const key = f.id + setSlots + c.join('');
  const cached = contributionCache.get(key);
  if (cached !== undefined) return cached;

  let states = new Set<number>([0]);
  for (const [lo, hi] of GROUPS) {
    let any = false;
    for (let i = lo; i < hi && !any; i++) any = c[i] > 0;
    if (!any) continue;
    const opts = groupOptions(c, lo, hi, f);
    const next = new Set<number>();
    for (const st of states) {
      for (const o of opts) {
        const sets = (st & 7) + (o & 7);
        const setBlocks = ((st >> 3) & 7) + ((o >> 3) & 7);
        if (sets + setBlocks > setSlots) continue;
        const pair = ((st >> 6) & 1) + ((o >> 6) & 1);
        if (pair > 1) continue;
        const usable = Math.min(5, ((st >> 7) & 7) + ((o >> 7) & 7));
        next.add(sets | (setBlocks << 3) | (pair << 6) | (usable << 7) | ((st | o) & 0xc00));
      }
    }
    states = next;
  }

  let best = 0;
  for (const st of states) {
    const sets = st & 7;
    const setBlocks = (st >> 3) & 7;
    const pairFilled = ((st >> 6) & 1) === 1;
    const usable = (st >> 7) & 7;
    const empty = setSlots - sets - setBlocks;
    // Leftover singles fill the empty slots; the pair slot needs a tile
    // allowed as the pair, which may cost the set slots one candidate.
    let singles: number;
    if (pairFilled) singles = Math.min(empty, usable);
    else if (st & 0x800) singles = 1 + Math.min(empty, usable);
    else if (st & 0x400) singles = 1 + Math.min(empty, usable - 1);
    else singles = Math.min(empty, usable);
    const contrib = 3 * sets + 2 * setBlocks + (pairFilled ? 2 : 0) + singles;
    if (contrib > best) best = contrib;
  }
  if (contributionCache.size > 300_000) contributionCache.clear();
  contributionCache.set(key, best);
  return best;
}

// ── targets ─────────────────────────────────────────────────────────────────

/**
 * A pattern the bot can play toward. `dist` is the conditional distance
 * from ready of the concealed tiles beside the given melds: Infinity when
 * the melds rule the pattern out, and -1 for a complete 14-tile hand.
 */
export interface Target {
  id: string;
  /** Tie preference: lower wins. */
  rank: number;
  /** Tile order for the final discard tie-break. */
  order: 'normal' | 'thirteen';
  dist(counts: number[], melds: MeldLite[]): number;
  /**
   * The target as it applies to the hand left by a claim: given the hand
   * and melds before the claim and the meld it would make, a pattern may
   * refuse to count that claim toward itself (StandardBot's rule B).
   */
  forClaim?(countsBefore: number[], meldsBefore: MeldLite[], claimed: MeldLite): Target;
}

const always = (): boolean => true;
const never = (): boolean => false;
const isSimple = (i: number): boolean => i < 27 && i % 9 >= 1 && i % 9 <= 7;
const isTermOrHonor = (i: number): boolean => i >= 27 || i % 9 === 0 || i % 9 === 8;

function frameDist(
  counts: number[],
  melds: MeldLite[],
  f: Frame,
  meldOk: (m: MeldLite) => boolean,
): number {
  for (const m of melds) if (!meldOk(m)) return Infinity;
  return 13 - 3 * melds.length - frameContribution(counts, 4 - melds.length, f);
}

const GENERIC = makeFrame('gen', always, always, always);

const ALL_SEQ_FRAME = makeFrame('seq', never, always, always);
const NO_TERM_FRAME = makeFrame('simple', isSimple, (low) => low % 9 >= 1 && low % 9 <= 5, isSimple);
const ALL_TRIP_FRAME = makeFrame('trip', always, never, always);
const LESSER_TERM_FRAME = makeFrame(
  'lesser',
  isTermOrHonor,
  (low) => low % 9 === 0 || low % 9 === 6,
  isTermOrHonor,
);
const ONE_SUIT_FRAMES = [0, 1, 2].map((s) => {
  const inSuit = (i: number): boolean => i >= 27 || Math.floor(i / 9) === s;
  return { frame: makeFrame(`suit${s}`, inSuit, inSuit, inSuit), inSuit };
});

/** 1.2 Concealed Hand: the plain regular distance, while nothing is melded. */
export const CONCEALED: Target = {
  id: 'concealed',
  rank: 0,
  order: 'normal',
  dist: (counts, melds) => (melds.length === 0 ? frameDist(counts, melds, GENERIC, always) : Infinity),
};

/** 1.3 No Terminals: 1s, 9s and honors are dead tiles. */
export const NO_TERMINALS: Target = {
  id: 'noTerminals',
  rank: 1,
  order: 'normal',
  dist: (counts, melds) =>
    frameDist(counts, melds, NO_TERM_FRAME, (m) =>
      m.kind === 'chow' ? m.idx % 9 >= 1 && m.idx % 9 <= 5 : isSimple(m.idx),
    ),
};

/** 1.1 All Sequences: four sequences and any pair. */
export const ALL_SEQUENCES: Target = {
  id: 'allSequences',
  rank: 2,
  order: 'normal',
  dist: (counts, melds) => frameDist(counts, melds, ALL_SEQ_FRAME, (m) => m.kind === 'chow'),
};

/** 2.1.1 Mixed One Suit (covers Pure One Suit and All Honors). */
export const MIXED_ONE_SUIT: Target = {
  id: 'mixedOneSuit',
  rank: 0,
  order: 'thirteen',
  dist: (counts, melds) => {
    let best = Infinity;
    for (const { frame, inSuit } of ONE_SUIT_FRAMES) {
      best = Math.min(best, frameDist(counts, melds, frame, (m) => inSuit(m.idx)));
    }
    return best;
  },
};

/** 4.1 All Triplets. */
export const ALL_TRIPLETS: Target = {
  id: 'allTriplets',
  rank: 1,
  order: 'normal',
  dist: (counts, melds) => frameDist(counts, melds, ALL_TRIP_FRAME, (m) => m.kind !== 'chow'),
};

/**
 * How far a hand has come on one set of three fixed sequences: per
 * sequence, the distinct tiles held toward it (3 when it is an exposed
 * chow), counted even if the hand also uses those tiles elsewhere. `other`
 * counts the melds that are not one of the three sequences.
 */
function progress(
  counts: number[],
  melds: MeldLite[],
  lows: number[],
): { groups: number[]; other: number } {
  const melded = new Set<number>();
  let other = 0;
  for (const m of melds) {
    if (m.kind === 'chow' && lows.includes(m.idx) && !melded.has(m.idx)) melded.add(m.idx);
    else other++;
  }
  const groups = lows.map((low) => {
    if (melded.has(low)) return 3;
    let n = 0;
    for (let k = 0; k < 3; k++) if (counts[low + k] > 0) n++;
    return n;
  });
  return { groups, other };
}

/** Rule A: at least 5 of the 9 tiles, and at least one in every sequence. */
function inPlay(groups: number[]): boolean {
  return groups[0] + groups[1] + groups[2] >= 5 && Math.min(groups[0], groups[1], groups[2]) >= 1;
}

/**
 * Patterns built on three fixed sequences plus one free set and the pair.
 * A required sequence's slot is worth one per distinct tile held, so taking
 * every available tile for it is always optimal (it gains exactly one and
 * costs the rest of the hand at most one). A variant the hand has not
 * really started (rule A) is not considered at all.
 */
function requiredSeqDist(counts: number[], melds: MeldLite[], variants: number[][]): number {
  let best = Infinity;
  for (const lows of variants) {
    const { groups, other } = progress(counts, melds, lows);
    if (other > 1 || !inPlay(groups)) continue;
    // A kong of one of the pattern's tiles uses all four copies of it.
    if (melds.some((m) => m.kind === 'kong' && lows.some((low) => m.idx >= low && m.idx <= low + 2))) {
      continue;
    }
    const c = counts.slice();
    let got = 0;
    lows.forEach((low, g) => {
      if (groups[g] === 3 && melds.some((m) => m.kind === 'chow' && m.idx === low)) return;
      for (let k = 0; k < 3; k++) {
        if (c[low + k] > 0) {
          c[low + k]--;
          got++;
        }
      }
    });
    const d = 13 - 3 * melds.length - got - frameContribution(c, 1 - other, GENERIC);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Rule B's exception: a thin start may still take a big exposed kong on a
 * concealed triplet outside the pattern, provided the pair is already
 * accounted for — by a pair of some other tile outside the pattern, or by
 * a concealed triplet of one of the pattern's own tiles.
 */
function kongAllowed(countsBefore: number[], lows: number[], claimed: MeldLite): boolean {
  if (claimed.kind !== 'kong') return false;
  const inPattern = (i: number): boolean => lows.some((low) => i >= low && i <= low + 2);
  if (inPattern(claimed.idx)) return false;
  for (let i = 0; i < 34; i++) {
    if (i === claimed.idx) continue;
    if (inPattern(i) ? countsBefore[i] >= 3 : countsBefore[i] >= 2) return true;
  }
  return false;
}

/**
 * A three-fixed-sequences target. Rule B: while a variant stands at only
 * 2-2-1, 3-1-1 or 3-2-1, a claim counts toward it only if it is a chow
 * completing one of its two-tile sequences (or a kong under kongAllowed);
 * any other claim is judged as if that variant did not exist. Stronger starts (2-2-2, 3-3-1, …) claim freely.
 */
function requiredSeqTarget(id: string, rank: number, variants: number[][]): Target {
  const full = (1 << variants.length) - 1;
  const built = new Map<number, Target>();
  const build = (mask: number): Target => {
    let t = built.get(mask);
    if (!t) {
      const subset = variants.filter((_, i) => (mask >> i) & 1);
      t = {
        id: mask === full ? id : `${id}#${mask}`,
        rank,
        order: 'normal',
        dist: (counts, melds) => requiredSeqDist(counts, melds, subset),
        forClaim,
      };
      built.set(mask, t);
    }
    return t;
  };
  const forClaim = (countsBefore: number[], meldsBefore: MeldLite[], claimed: MeldLite): Target => {
    let mask = 0;
    variants.forEach((lows, i) => {
      const { groups } = progress(countsBefore, meldsBefore, lows);
      if (!inPlay(groups)) return;
      const total = groups[0] + groups[1] + groups[2];
      const restricted = total <= 6 && Math.min(...groups) === 1;
      const g = claimed.kind === 'chow' ? lows.indexOf(claimed.idx) : -1;
      if (!restricted || (g >= 0 && groups[g] === 2) || kongAllowed(countsBefore, lows, claimed)) {
        mask |= 1 << i;
      }
    });
    return build(mask);
  };
  return build(full);
}

const SIMILAR_VARIANTS = [0, 1, 2, 3, 4, 5, 6].map((r) => [r, 9 + r, 18 + r]);
const STRAIGHT_VARIANTS = [0, 1, 2].map((s) => [s * 9, s * 9 + 3, s * 9 + 6]);

/** 6.1 Three Similar Sequences. */
export const THREE_SIMILAR: Target = requiredSeqTarget('threeSimilar', 2, SIMILAR_VARIANTS);

/** 7.1 Nine-Tile Straight. */
export const NINE_STRAIGHT: Target = requiredSeqTarget('nineStraight', 3, STRAIGHT_VARIANTS);

/** 8.1 Mixed Lesser Terminals (covers the rest of category 8). */
export const LESSER_TERMINALS: Target = {
  id: 'lesserTerminals',
  rank: 4,
  order: 'thirteen',
  dist: (counts, melds) =>
    frameDist(counts, melds, LESSER_TERM_FRAME, (m) =>
      m.kind === 'chow' ? m.idx % 9 === 0 || m.idx % 9 === 6 : isTermOrHonor(m.idx),
    ),
};

export const TRIVIAL_TARGETS: Target[] = [CONCEALED, NO_TERMINALS, ALL_SEQUENCES];
export const STANDARD_TARGETS: Target[] = [
  MIXED_ONE_SUIT,
  ALL_TRIPLETS,
  THREE_SIMILAR,
  NINE_STRAIGHT,
  LESSER_TERMINALS,
];

// ── minimax over targets ────────────────────────────────────────────────────

const distCache = new Map<string, number>();

function tdist(t: Target, counts: number[], melds: MeldLite[]): number {
  let key = t.id + '|';
  for (const m of melds) key += m.kind[0] + m.idx + ',';
  key += '|' + counts.join('');
  const cached = distCache.get(key);
  if (cached !== undefined) return cached;
  const v = t.dist(counts, melds);
  if (distCache.size > 300_000) distCache.clear();
  distCache.set(key, v);
  return v;
}

/** Lowest conditional distance over the targets (Infinity if all are dead). */
export function minDistance(counts: number[], melds: MeldLite[], targets: Target[]): number {
  let best = Infinity;
  for (const t of targets) best = Math.min(best, tdist(t, counts, melds));
  return best;
}

/**
 * Distance reducing outs conditioned on one target: unseen copies of every
 * tile whose draw lets some discard bring that target one step closer — or,
 * when ready, of every tile that completes the hand within the pattern.
 */
export function targetOuts(
  counts13: number[],
  melds: MeldLite[],
  target: Target,
  unseen: number[],
): number {
  const n = tdist(target, counts13, melds);
  if (n === Infinity) return 0;
  let outs = 0;
  for (let t = 0; t < 34; t++) {
    if (unseen[t] <= 0 || counts13[t] >= 4) continue;
    counts13[t]++;
    let hit = false;
    if (n === 0) {
      hit = tdist(target, counts13, melds) === -1;
    } else {
      for (let d = 0; d < 34 && !hit; d++) {
        if (counts13[d] === 0) continue;
        counts13[d]--;
        if (tdist(target, counts13, melds) < n) hit = true;
        counts13[d]++;
      }
    }
    counts13[t]--;
    if (hit) outs += unseen[t];
  }
  return outs;
}

interface DiscardPick {
  discard: number;
  dist: number;
  outs: number;
  target: Target;
}

/**
 * The discard whose best target is closest: lowest distance, then most
 * outs, then the preferred target, then that target's tile order. Null when
 * the melds have ruled out every target.
 */
export function pickDiscard(
  counts: number[],
  melds: MeldLite[],
  targets: Target[],
  unseen: number[],
  seat: number,
): DiscardPick | null {
  const entries: { d: number; t: Target; v: number }[] = [];
  let bestDist = Infinity;
  for (let d = 0; d < 34; d++) {
    if (counts[d] === 0) continue;
    counts[d]--;
    for (const t of targets) {
      const v = tdist(t, counts, melds);
      if (v < bestDist) bestDist = v;
      entries.push({ d, t, v });
    }
    counts[d]++;
  }
  if (bestDist === Infinity) return null;
  let best: DiscardPick | null = null;
  for (const e of entries) {
    if (e.v !== bestDist) continue;
    counts[e.d]--;
    const outs = targetOuts(counts, melds, e.t, unseen);
    counts[e.d]++;
    if (
      best === null ||
      outs > best.outs ||
      (outs === best.outs &&
        (e.t.rank < best.target.rank ||
          (e.t.rank === best.target.rank &&
            discardPriority(e.d, seat, e.t.order) <
              discardPriority(best.discard, seat, best.target.order))))
    ) {
      best = { discard: e.d, dist: bestDist, outs, target: e.t };
    }
  }
  return best;
}

/**
 * Pung/chow by minimax: claim only when the best reachable hand is strictly
 * closer than the current one; ties by outs, target preference, pung over
 * chow, then ChickenBot's chow preference. Returns undefined when every
 * target is already dead (the caller falls back to ChickenBot).
 */
function minimaxClaim(
  ctx: PatternContext,
  counts: number[],
  tile: Tile,
  avail: { pung: boolean; chows: number[] },
  targets: Target[],
): ClaimDecision | undefined {
  const n = minDistance(counts, ctx.melds, targets);
  if (n === Infinity) return undefined;
  const ti = tileIndex(tile);
  const options: { kind: 'pung' | 'chow'; low: number; pick: DiscardPick }[] = [];
  const evalOption = (kind: 'pung' | 'chow', low: number, fromHand: number[]): void => {
    const meld: MeldLite = { kind, idx: low };
    const after = targets.map((t) => (t.forClaim ? t.forClaim(counts, ctx.melds, meld) : t));
    for (const u of fromHand) counts[u]--;
    const pick = pickDiscard(counts, [...ctx.melds, meld], after, ctx.unseen, ctx.seat);
    for (const u of fromHand) counts[u]++;
    if (pick && pick.dist < n) options.push({ kind, low, pick });
  };
  if (avail.pung) evalOption('pung', ti, [ti, ti]);
  for (const low of avail.chows) {
    evalOption('chow', low, [low, low + 1, low + 2].filter((x) => x !== ti));
  }
  if (options.length === 0) return null;
  options.sort(
    (a, b) =>
      a.pick.dist - b.pick.dist ||
      b.pick.outs - a.pick.outs ||
      a.pick.target.rank - b.pick.target.rank ||
      (a.kind === b.kind ? chowPreference(a.low) - chowPreference(b.low) : a.kind === 'pung' ? -1 : 1),
  );
  const o = options[0];
  const discard = tileFromIndex(o.pick.discard);
  return o.kind === 'pung' ? { kind: 'pung', discard } : { kind: 'chow', low: o.low, discard };
}

// ── shared turn plumbing ────────────────────────────────────────────────────

export type KongOption = { tile: Tile; variant: 'concealed' | 'small' };
export type TurnDecision =
  | { kind: 'kong'; tile: Tile; variant: 'concealed' | 'small' }
  | { kind: 'discard'; tile: Tile; fromDrawn: boolean };

type TurnContext = PatternContext & { drawn: Tile | null };

function countsOf(tiles: Tile[]): number[] {
  const counts = new Array(34).fill(0) as number[];
  for (const t of tiles) counts[tileIndex(t)]++;
  return counts;
}

/** ChickenBot's own-turn play (spec 4.4/4.6), optionally with a discard veto. */
function chickenTurn(ctx: TurnContext, kongOptions: KongOption[]): TurnDecision {
  for (const opt of kongOptions) {
    if (chickenKong(ctx, opt)) return { kind: 'kong', tile: opt.tile, variant: opt.variant };
  }
  return { kind: 'discard', ...chickenDiscard(ctx) };
}

// ── TrivialBot ──────────────────────────────────────────────────────────────

/** Dragons and the seat wind. */
function isValueHonor(idx: number, seat: number): boolean {
  return idx >= 31 || idx === 27 + (seat % 4);
}

/**
 * Has the hand secured a non-chicken pattern? `byMeld`: a declared kong or
 * an exposed Value Honor triplet. `concealedTriplet`: a Value Honor triplet
 * still in the concealed tiles.
 */
function secured(
  counts: number[],
  melds: MeldLite[],
  seat: number,
): { byMeld: boolean; concealedTriplet: boolean } {
  const byMeld = melds.some((m) => m.kind === 'kong' || (m.kind === 'pung' && isValueHonor(m.idx, seat)));
  let concealedTriplet = false;
  for (let i = 27; i < 34; i++) {
    if (counts[i] >= 3 && isValueHonor(i, seat)) concealedTriplet = true;
  }
  return { byMeld, concealedTriplet };
}

/**
 * Spec 2 exception: a concealed Value Honor triplet that is the hand's only
 * guarantee is not broken up, unless the discard leaves the hand waiting
 * with All Sequences or Concealed Hand.
 */
function protectTriplet(ctx: PatternContext): NonNullable<HandContext['allow']> {
  return (d, countsAfter, claimed) => {
    if (!isValueHonor(d, ctx.seat) || countsAfter[d] !== 2) return true;
    const melds = claimed ? [...ctx.melds, claimed] : ctx.melds;
    return (
      tdist(CONCEALED, countsAfter, melds) === 0 || tdist(ALL_SEQUENCES, countsAfter, melds) === 0
    );
  };
}

function trivialTurn(ctx: TurnContext, kongOptions: KongOption[]): TurnDecision {
  const counts = countsOf(ctx.drawn !== null ? [...ctx.hand, ctx.drawn] : ctx.hand);
  if (chickenMode(counts, ctx.meldCount) !== 'normal') return chickenTurn(ctx, kongOptions);
  const sec = secured(counts, ctx.melds, ctx.seat);
  if (sec.byMeld) return chickenTurn(ctx, kongOptions);
  if (sec.concealedTriplet) return chickenTurn({ ...ctx, allow: protectTriplet(ctx) }, kongOptions);
  // Spec 3: any kong secures One Kong — take it unless it costs distance.
  for (const opt of kongOptions) {
    if (chickenKong(ctx, opt)) return { kind: 'kong', tile: opt.tile, variant: opt.variant };
  }
  const pick = pickDiscard(counts, ctx.melds, TRIVIAL_TARGETS, ctx.unseen, ctx.seat);
  // Every trivial pattern is dead (a seat inherited from a human): ChickenBot.
  if (!pick) return chickenTurn(ctx, kongOptions);
  const tile = tileFromIndex(pick.discard);
  return { kind: 'discard', tile, fromDrawn: ctx.drawn === tile };
}

function trivialClaim(
  ctx: PatternContext,
  tile: Tile,
  avail: { kong: boolean; pung: boolean; chows: number[] },
): ClaimDecision {
  const counts = countsOf(ctx.hand);
  if (chickenMode(counts, ctx.meldCount) !== 'normal') return null;
  const sec = secured(counts, ctx.melds, ctx.seat);
  if (sec.byMeld) return chickenClaim(ctx, tile, avail);
  if (sec.concealedTriplet) return chickenClaim({ ...ctx, allow: protectTriplet(ctx) }, tile, avail);

  const ti = tileIndex(tile);
  const n = regularDistance(counts, ctx.meldCount);
  // Spec 3: kong unless it increases the distance from ready.
  if (avail.kong) {
    counts[ti] -= 3;
    const after = regularDistance(counts, ctx.meldCount + 1);
    counts[ti] += 3;
    if (after <= n) return { kind: 'kong' };
  }
  const valueHonor = isValueHonor(ti, ctx.seat);
  if (avail.pung && valueHonor) {
    // Spec 3 exception 2: not when already waiting on a trivial pattern.
    const waiting =
      tdist(CONCEALED, counts, ctx.melds) === 0 || tdist(ALL_SEQUENCES, counts, ctx.melds) === 0;
    if (waiting) return null;
    const rest = [...ctx.hand];
    for (let k = 0; k < 2; k++) rest.splice(rest.indexOf(tile), 1);
    // The triplet is now secured, so the follow-up discard is ChickenBot's.
    const d = chickenDiscard({
      hand: rest,
      drawn: null,
      meldCount: ctx.meldCount + 1,
      seat: ctx.seat,
      unseen: ctx.unseen,
    });
    return { kind: 'pung', discard: d.tile };
  }
  const dec = minimaxClaim(ctx, counts, tile, avail, TRIVIAL_TARGETS);
  return dec === undefined ? chickenClaim(ctx, tile, avail) : dec;
}

// ── StandardBot ─────────────────────────────────────────────────────────────

function standardTurn(ctx: TurnContext, kongOptions: KongOption[]): TurnDecision {
  const counts = countsOf(ctx.drawn !== null ? [...ctx.hand, ctx.drawn] : ctx.hand);
  if (chickenMode(counts, ctx.meldCount) !== 'normal') return chickenTurn(ctx, kongOptions);
  const n = minDistance(countsOf(ctx.hand), ctx.melds, STANDARD_TARGETS);
  // Every pattern is dead (a seat inherited from a human): ChickenBot.
  if (n === Infinity) return chickenTurn(ctx, kongOptions);
  // Kong only if the minimax distance does not grow (it becomes infinite
  // when the kong leaves no room for a pattern's sets).
  for (const opt of kongOptions) {
    const ti = tileIndex(opt.tile);
    let after: number;
    if (opt.variant === 'concealed') {
      counts[ti] -= 4;
      after = minDistance(counts, [...ctx.melds, { kind: 'kong', idx: ti }], STANDARD_TARGETS);
      counts[ti] += 4;
    } else {
      const melds = ctx.melds.slice();
      const at = melds.findIndex((m) => m.kind === 'pung' && m.idx === ti);
      if (at >= 0) melds[at] = { kind: 'kong', idx: ti };
      counts[ti] -= 1;
      after = minDistance(counts, melds, STANDARD_TARGETS);
      counts[ti] += 1;
    }
    if (after <= n) return { kind: 'kong', tile: opt.tile, variant: opt.variant };
  }
  const pick = pickDiscard(counts, ctx.melds, STANDARD_TARGETS, ctx.unseen, ctx.seat);
  if (!pick) return chickenTurn(ctx, kongOptions);
  const tile = tileFromIndex(pick.discard);
  return { kind: 'discard', tile, fromDrawn: ctx.drawn === tile };
}

function standardClaim(
  ctx: PatternContext,
  tile: Tile,
  avail: { kong: boolean; pung: boolean; chows: number[] },
): ClaimDecision {
  const counts = countsOf(ctx.hand);
  if (chickenMode(counts, ctx.meldCount) !== 'normal') return null;
  const dec = minimaxClaim(ctx, counts, tile, avail, STANDARD_TARGETS);
  if (dec === undefined) return chickenClaim(ctx, tile, avail);
  if (dec) return dec;
  if (avail.kong) {
    const ti = tileIndex(tile);
    const n = minDistance(counts, ctx.melds, STANDARD_TARGETS);
    const meld: MeldLite = { kind: 'kong', idx: ti };
    const targets = STANDARD_TARGETS.map((t) => (t.forClaim ? t.forClaim(counts, ctx.melds, meld) : t));
    counts[ti] -= 3;
    const after = minDistance(counts, [...ctx.melds, meld], targets);
    counts[ti] += 3;
    if (after <= n) return { kind: 'kong' };
  }
  return null;
}

// ── entry points ────────────────────────────────────────────────────────────

/** Own turn (after the draw, or after a kong replacement): kong or discard. */
export function patternTurn(
  kind: PatternBotKind,
  ctx: TurnContext,
  kongOptions: KongOption[],
): TurnDecision {
  return kind === 'trivial' ? trivialTurn(ctx, kongOptions) : standardTurn(ctx, kongOptions);
}

/** Another player's discard (Mahjong is decided by the caller). */
export function patternClaim(
  kind: PatternBotKind,
  ctx: PatternContext,
  tile: Tile,
  avail: { kong: boolean; pung: boolean; chows: number[] },
): ClaimDecision {
  return kind === 'trivial' ? trivialClaim(ctx, tile, avail) : standardClaim(ctx, tile, avail);
}

/** Test hook: the unconstrained frame must agree with ChickenBot's distance. */
export function genericFrameDistance(counts: number[], meldCount: number): number {
  return 13 - 3 * meldCount - frameContribution(counts, 4 - meldCount, GENERIC);
}
