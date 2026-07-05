import {
  countsFrom,
  isDragonIdx,
  isHonorIdx,
  isTerminalIdx,
  isWindIdx,
  Tile,
  tileIndex,
} from './tiles';
import { decompose, isSevenPairsShape, isThirteenTerminalsShape } from './hand';

export type KongType = 'concealed' | 'big' | 'small';

export interface Meld {
  kind: 'chow' | 'pung' | 'kong';
  /** For a chow, the lowest tile of the sequence. */
  tile: Tile;
  kongType?: KongType;
  /** Seat the claimed tile came from (display); undefined for concealed kong. */
  claimedFrom?: number;
  /** Which tile of the meld was the claimed one (display). */
  claimedTile?: Tile;
  /** Turn counter when the meld was made (small-kong restriction). */
  turnId?: number;
}

export interface WinInput {
  melds: Meld[];
  /** Concealed tiles excluding the winning tile. */
  concealed: Tile[];
  winTile: Tile;
  winBy: 'discard' | 'self';
  /** Seat wind of the winner: 0=E,1=S,2=W,3=N. */
  seatWind: number;
  seabed?: boolean;
  riverbed?: boolean;
  kongReplacement?: boolean;
  robbingKong?: boolean;
  heaven?: boolean;
  earth?: boolean;
}

export interface PatternHit {
  id: string;
  name: string;
  zh: string;
  points: number;
}

export interface ScoreResult {
  patterns: PatternHit[];
  /** Final value of the hand after limit handling. */
  total: number;
  rawTotal: number;
  limit: 'none' | 'compound' | 'listed';
  chicken: boolean;
}

export const PATTERNS: Record<string, { name: string; zh: string; points: number }> = {
  '1.1': { name: 'All Sequences', zh: '平和', points: 5 },
  '1.2': { name: 'Concealed Hand', zh: '門前清', points: 5 },
  '1.3': { name: 'No Terminals', zh: '斷么九', points: 5 },
  '2.1.1': { name: 'Mixed One-Suit', zh: '混一色', points: 40 },
  '2.1.2': { name: 'Pure One-Suit', zh: '清一色', points: 80 },
  '2.2': { name: 'Nine Gates', zh: '九蓮寶燈', points: 480 },
  '3.1R': { name: 'Value Honor: Red Dragon', zh: '番牌：中', points: 10 },
  '3.1G': { name: 'Value Honor: Green Dragon', zh: '番牌：發', points: 10 },
  '3.1O': { name: 'Value Honor: White Dragon', zh: '番牌：白', points: 10 },
  '3.1S': { name: 'Value Honor: Seat Wind', zh: '番牌：自風', points: 10 },
  '3.2.1': { name: 'Small Three Dragons', zh: '小三元', points: 40 },
  '3.2.2': { name: 'Big Three Dragons', zh: '大三元', points: 130 },
  '3.3.1': { name: 'Small Three Winds', zh: '小三風', points: 30 },
  '3.3.2': { name: 'Big Three Winds', zh: '大三風', points: 120 },
  '3.3.3': { name: 'Small Four Winds', zh: '小四喜', points: 320 },
  '3.3.4': { name: 'Big Four Winds', zh: '大四喜', points: 400 },
  '3.4': { name: 'All Honors', zh: '字一色', points: 320 },
  '4.1': { name: 'All Triplets', zh: '對對和', points: 30 },
  '4.2.1': { name: 'Two Concealed Triplets', zh: '二暗刻', points: 5 },
  '4.2.2': { name: 'Three Concealed Triplets', zh: '三暗刻', points: 30 },
  '4.2.3': { name: 'Four Concealed Triplets', zh: '四暗刻', points: 125 },
  '4.3.1': { name: 'One Kong', zh: '一槓', points: 5 },
  '4.3.2': { name: 'Two Kong', zh: '二槓', points: 20 },
  '4.3.3': { name: 'Three Kong', zh: '三槓', points: 120 },
  '4.3.4': { name: 'Four Kong', zh: '四槓', points: 480 },
  '5.1.1': { name: 'Two Identical Sequences', zh: '一般高', points: 10 },
  '5.1.2': { name: 'Two Identical Sequences Twice', zh: '兩般高', points: 60 },
  '5.1.3': { name: 'Three Identical Sequences', zh: '一色三同順', points: 120 },
  '5.1.4': { name: 'Four Identical Sequences', zh: '一色四同順', points: 480 },
  '6.1': { name: 'Three Similar Sequences', zh: '三色同順', points: 35 },
  '6.2.1': { name: 'Small Three Similar Triplets', zh: '三色小同刻', points: 30 },
  '6.2.2': { name: 'Three Similar Triplets', zh: '三色同刻', points: 120 },
  '7.1': { name: 'Nine-Tile Straight', zh: '一氣通貫', points: 40 },
  '7.2.1': { name: 'Three Consecutive Triplets', zh: '三連刻', points: 100 },
  '7.2.2': { name: 'Four Consecutive Triplets', zh: '四連刻', points: 200 },
  '8.1.1': { name: 'Mixed Lesser Terminals', zh: '混全帶么', points: 40 },
  '8.1.2': { name: 'Pure Lesser Terminals', zh: '純全帶么', points: 50 },
  '8.1.3': { name: 'Mixed Greater Terminals', zh: '混么九', points: 100 },
  '8.1.4': { name: 'Pure Greater Terminals', zh: '清么九', points: 400 },
  '9.1.1': { name: 'Final Draw', zh: '海底撈月', points: 10 },
  '9.1.2': { name: 'Final Discard', zh: '河底撈魚', points: 10 },
  '9.2': { name: 'Win on Kong', zh: '嶺上開花', points: 10 },
  '9.3': { name: 'Robbing a Kong', zh: '搶槓', points: 10 },
  '9.4.1': { name: 'Blessing of Heaven', zh: '天和', points: 155 },
  '9.4.2': { name: 'Blessing of Earth', zh: '地和', points: 155 },
  '10.1': { name: 'Thirteen Terminals', zh: '十三么九', points: 160 },
  '10.2': { name: 'Seven Pairs', zh: '七對子', points: 30 },
  chicken: { name: 'Chicken Hand', zh: '雞和', points: 1 },
};

/** All 48 stat-tracked pattern ids, in display order. */
export const PATTERN_IDS: string[] = Object.keys(PATTERNS);

function hit(id: string): PatternHit {
  const p = PATTERNS[id];
  return { id, name: p.name, zh: p.zh, points: p.points };
}

interface ASet {
  kind: 'seq' | 'tri';
  idx: number;
  isKong: boolean;
  /** For triplets: all three tiles from the wall (concealed kong included). */
  concealed: boolean;
}

interface Ctx {
  allCounts: number[]; // logical 14 tiles (kongs counted as 3)
  concealedHand: boolean;
  seatWindIdx: number;
  nineGates: boolean;
  input: WinInput;
}

function addIncidental(hits: PatternHit[], input: WinInput): void {
  if (input.winBy === 'self' && input.seabed) hits.push(hit('9.1.1'));
  if (input.winBy === 'discard' && input.riverbed) hits.push(hit('9.1.2'));
  if (input.winBy === 'self' && input.kongReplacement) hits.push(hit('9.2'));
  if (input.robbingKong) hits.push(hit('9.3'));
  if (input.heaven) hits.push(hit('9.4.1'));
  if (input.earth) hits.push(hit('9.4.2'));
}

function suitsAndHonors(counts: number[]): { suits: number[]; honors: boolean } {
  const suits: number[] = [];
  for (let s = 0; s < 3; s++) {
    for (let r = 0; r < 9; r++) {
      if (counts[s * 9 + r] > 0) {
        suits.push(s);
        break;
      }
    }
  }
  let honors = false;
  for (let i = 27; i < 34; i++) if (counts[i] > 0) honors = true;
  return { suits, honors };
}

function compositionHits(
  counts: number[],
  hits: PatternHit[],
): { allTermHonor: boolean; allTerm: boolean } {
  const { suits, honors } = suitsAndHonors(counts);
  // 1.3 No Terminals
  let allMiddle = true;
  let allTermHonor = true;
  let allTerm = true;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    const term = isTerminalIdx(i);
    const honor = isHonorIdx(i);
    if (term || honor) allMiddle = false;
    if (!term && !honor) allTermHonor = false;
    if (!term) allTerm = false;
  }
  if (allMiddle) hits.push(hit('1.3'));
  // 2.1 One-Suit
  if (suits.length === 1) {
    hits.push(hit(honors ? '2.1.1' : '2.1.2'));
  }
  // 3.4 All Honors
  if (suits.length === 0 && honors) hits.push(hit('3.4'));
  return { allTermHonor, allTerm };
}

function evalRegular(sets: ASet[], pairIdx: number, ctx: Ctx): PatternHit[] {
  const hits: PatternHit[] = [];
  const seqs = sets.filter((s) => s.kind === 'seq');
  const tris = sets.filter((s) => s.kind === 'tri');
  const kongs = tris.filter((s) => s.isKong);
  const concealedTris = tris.filter((s) => s.concealed);

  // 1.1 All Sequences
  if (seqs.length === 4) hits.push(hit('1.1'));
  // 1.2 Concealed Hand (regular hands only)
  if (ctx.concealedHand) hits.push(hit('1.2'));
  // 1.3 / 2.1 / 3.4 by composition
  const { allTermHonor, allTerm } = compositionHits(ctx.allCounts, hits);
  // 2.2 Nine Gates
  if (ctx.nineGates) hits.push(hit('2.2'));

  // 3.1 Value Honors
  if (tris.some((s) => s.idx === 31)) hits.push(hit('3.1R'));
  if (tris.some((s) => s.idx === 32)) hits.push(hit('3.1G'));
  if (tris.some((s) => s.idx === 33)) hits.push(hit('3.1O'));
  if (tris.some((s) => s.idx === ctx.seatWindIdx)) hits.push(hit('3.1S'));

  // 3.2 Dragons
  const dragonTris = tris.filter((s) => isDragonIdx(s.idx)).length;
  const dragonPair = isDragonIdx(pairIdx);
  if (dragonTris === 3) hits.push(hit('3.2.2'));
  else if (dragonTris === 2 && dragonPair) hits.push(hit('3.2.1'));

  // 3.3 Winds
  const windTris = tris.filter((s) => isWindIdx(s.idx)).length;
  const windPair = isWindIdx(pairIdx);
  if (windTris === 4) hits.push(hit('3.3.4'));
  else if (windTris === 3 && windPair) hits.push(hit('3.3.3'));
  else if (windTris === 3) hits.push(hit('3.3.2'));
  else if (windTris === 2 && windPair) hits.push(hit('3.3.1'));

  // 4.1 All Triplets
  if (tris.length === 4) hits.push(hit('4.1'));
  // 4.2 Concealed Triplets
  if (concealedTris.length === 4) hits.push(hit('4.2.3'));
  else if (concealedTris.length === 3) hits.push(hit('4.2.2'));
  else if (concealedTris.length === 2) hits.push(hit('4.2.1'));
  // 4.3 Kongs
  if (kongs.length === 4) hits.push(hit('4.3.4'));
  else if (kongs.length === 3) hits.push(hit('4.3.3'));
  else if (kongs.length === 2) hits.push(hit('4.3.2'));
  else if (kongs.length === 1) hits.push(hit('4.3.1'));

  // 5.1 Identical Sequences
  const seqCountByIdx = new Map<number, number>();
  for (const s of seqs) seqCountByIdx.set(s.idx, (seqCountByIdx.get(s.idx) ?? 0) + 1);
  const groupSizes = [...seqCountByIdx.values()];
  if (groupSizes.includes(4)) hits.push(hit('5.1.4'));
  else if (groupSizes.includes(3)) hits.push(hit('5.1.3'));
  else if (groupSizes.filter((n) => n >= 2).length >= 2) hits.push(hit('5.1.2'));
  else if (groupSizes.some((n) => n >= 2)) hits.push(hit('5.1.1'));

  // 6.1 Three Similar Sequences
  for (let r = 0; r <= 6; r++) {
    if ([0, 1, 2].every((su) => seqs.some((s) => s.idx === su * 9 + r))) {
      hits.push(hit('6.1'));
      break;
    }
  }
  // 6.2 Similar Triplets
  let similar: '6.2.1' | '6.2.2' | null = null;
  for (let r = 0; r <= 8; r++) {
    const suitsWithTri = [0, 1, 2].filter((su) => tris.some((s) => s.idx === su * 9 + r));
    if (suitsWithTri.length === 3) {
      similar = '6.2.2';
      break;
    }
    if (suitsWithTri.length === 2) {
      const third = [0, 1, 2].find((su) => !suitsWithTri.includes(su))!;
      if (pairIdx === third * 9 + r) similar = similar ?? '6.2.1';
    }
  }
  if (similar) hits.push(hit(similar));

  // 7.1 Nine-Tile Straight
  for (let su = 0; su < 3; su++) {
    if ([0, 3, 6].every((r) => seqs.some((s) => s.idx === su * 9 + r))) {
      hits.push(hit('7.1'));
      break;
    }
  }
  // 7.2 Consecutive Triplets
  let bestRun = 0;
  for (let su = 0; su < 3; su++) {
    let run = 0;
    for (let r = 0; r <= 8; r++) {
      if (tris.some((s) => s.idx === su * 9 + r)) {
        run++;
        bestRun = Math.max(bestRun, run);
      } else run = 0;
    }
  }
  if (bestRun >= 4) hits.push(hit('7.2.2'));
  else if (bestRun >= 3) hits.push(hit('7.2.1'));

  // 8.1 Terminals
  const seqHasTerminal = (s: ASet) => s.idx % 9 === 0 || s.idx % 9 === 6;
  const everyLesserMixed =
    sets.every((s) => (s.kind === 'seq' ? seqHasTerminal(s) : isTerminalIdx(s.idx) || isHonorIdx(s.idx))) &&
    (isTerminalIdx(pairIdx) || isHonorIdx(pairIdx));
  const everyLesserPure =
    sets.every((s) => (s.kind === 'seq' ? seqHasTerminal(s) : isTerminalIdx(s.idx))) && isTerminalIdx(pairIdx);
  let terminalPts = 0;
  let terminalId = '';
  if (allTerm) {
    terminalPts = 400;
    terminalId = '8.1.4';
  } else if (allTermHonor && tris.length === 4) {
    terminalPts = 100;
    terminalId = '8.1.3';
  } else if (everyLesserPure) {
    terminalPts = 50;
    terminalId = '8.1.2';
  } else if (everyLesserMixed) {
    terminalPts = 40;
    terminalId = '8.1.1';
  }
  if (terminalPts > 0) hits.push(hit(terminalId));

  addIncidental(hits, ctx.input);
  return hits;
}

function evalSevenPairs(ctx: Ctx): PatternHit[] {
  const hits: PatternHit[] = [hit('10.2')];
  const { allTermHonor, allTerm } = compositionHits(ctx.allCounts, hits);
  if (allTerm) hits.push(hit('8.1.4'));
  else if (allTermHonor) hits.push(hit('8.1.3'));
  addIncidental(hits, ctx.input);
  return hits;
}

function evalThirteen(ctx: Ctx): PatternHit[] {
  const hits: PatternHit[] = [hit('10.1')];
  addIncidental(hits, ctx.input);
  return hits;
}

function applyLimit(hits: PatternHit[], chickenPoints: number): ScoreResult {
  if (hits.length === 0) {
    const c = { ...hit('chicken'), points: chickenPoints };
    return { patterns: [c], total: chickenPoints, rawTotal: chickenPoints, limit: 'none', chicken: true };
  }
  const listed = hits.filter((h) => h.points >= 320);
  if (listed.length > 0) {
    const top = listed.reduce((a, b) => (b.points > a.points ? b : a));
    return { patterns: [top], total: top.points, rawTotal: top.points, limit: 'listed', chicken: false };
  }
  const raw = hits.reduce((a, h) => a + h.points, 0);
  return {
    patterns: hits,
    total: Math.min(raw, 320),
    rawTotal: raw,
    limit: raw >= 320 ? 'compound' : 'none',
    chicken: false,
  };
}

/**
 * Score a winning hand under the Freedom of Count rule: every arrangement of
 * the concealed tiles is evaluated and the highest final total wins.
 */
export function scoreWin(input: WinInput, chickenPoints: number = 1): ScoreResult {
  const winIdx = tileIndex(input.winTile);
  const concealedCounts = countsFrom(input.concealed);
  const full = concealedCounts.slice();
  full[winIdx]++;

  // Logical 14-tile composition (kongs count as 3 of the tile).
  const allCounts = full.slice();
  for (const m of input.melds) {
    const i = tileIndex(m.tile);
    if (m.kind === 'chow') {
      allCounts[i]++;
      allCounts[i + 1]++;
      allCounts[i + 2]++;
    } else {
      allCounts[i] += 3;
    }
  }

  const concealedHand = input.melds.every((m) => m.kind === 'kong' && m.kongType === 'concealed');
  const fullyConcealed = input.melds.length === 0;

  // Nine Gates: concealed 1112345678999 in one suit before the winning tile.
  let nineGates = false;
  if (fullyConcealed && !isHonorIdx(winIdx)) {
    const suit = Math.floor(winIdx / 9);
    nineGates = true;
    for (let i = 0; i < 34; i++) {
      const want =
        Math.floor(i / 9) === suit && i < 27 ? (i % 9 === 0 || i % 9 === 8 ? 3 : 1) : 0;
      if (concealedCounts[i] !== want) {
        nineGates = false;
        break;
      }
    }
  }

  const ctx: Ctx = { allCounts, concealedHand, seatWindIdx: 27 + input.seatWind, nineGates, input };

  const meldSets: ASet[] = input.melds.map((m) => {
    if (m.kind === 'chow') return { kind: 'seq', idx: tileIndex(m.tile), isKong: false, concealed: false };
    if (m.kind === 'pung') return { kind: 'tri', idx: tileIndex(m.tile), isKong: false, concealed: false };
    return { kind: 'tri', idx: tileIndex(m.tile), isKong: true, concealed: m.kongType === 'concealed' };
  });

  const candidates: PatternHit[][] = [];

  for (const d of decompose(full, 4 - input.melds.length)) {
    // Choices for which set the winning tile completes (affects concealed
    // triplet status on a discard win).
    const winChoices: (number | 'pair')[] = [];
    d.sets.forEach((s, i) => {
      const inSeq = s.kind === 'seq' && winIdx >= s.idx && winIdx <= s.idx + 2 && !isHonorIdx(winIdx);
      const inTri = s.kind === 'tri' && s.idx === winIdx;
      if (inSeq || inTri) winChoices.push(i);
    });
    if (d.pairIdx === winIdx) winChoices.push('pair');

    const choices = input.winBy === 'discard' ? winChoices : winChoices.slice(0, 1);
    for (const choice of choices.length > 0 ? choices : ['pair' as const]) {
      const sets: ASet[] = [
        ...meldSets,
        ...d.sets.map((s, i) => ({
          kind: s.kind,
          idx: s.idx,
          isKong: false,
          concealed:
            s.kind === 'tri' && !(input.winBy === 'discard' && choice === i),
        })),
      ];
      candidates.push(evalRegular(sets, d.pairIdx, ctx));
    }
  }

  if (fullyConcealed && isSevenPairsShape(full)) candidates.push(evalSevenPairs(ctx));
  if (fullyConcealed && isThirteenTerminalsShape(full)) candidates.push(evalThirteen(ctx));

  if (candidates.length === 0) {
    throw new Error('scoreWin called on a non-winning hand');
  }

  let best: ScoreResult | null = null;
  for (const hits of candidates) {
    const r = applyLimit(hits, chickenPoints);
    if (!best || r.total > best.total) best = r;
  }
  return best!;
}
