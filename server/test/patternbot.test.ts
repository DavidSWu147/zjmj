import { describe, expect, it } from 'vitest';
import { countsFrom, mulberry32, Tile, tileIndex } from '../../shared/src/tiles';
import { chooseClaim, regularDistance } from '../src/chickenbot';
import {
  ALL_SEQUENCES,
  ALL_TRIPLETS,
  CONCEALED,
  genericFrameDistance,
  LESSER_TERMINALS,
  MeldLite,
  MIXED_ONE_SUIT,
  NINE_STRAIGHT,
  NO_TERMINALS,
  patternClaim,
  patternTurn,
  targetOuts,
  THREE_SIMILAR,
} from '../src/patternbot';

/** "B4 B5 E R" → Tile[] (honors keep their trailing space). */
const h = (s: string): Tile[] =>
  s
    .trim()
    .split(/\s+/)
    .map((t) => (t.length === 1 ? `${t} ` : t));
const counts = (s: string): number[] => countsFrom(h(s));
const idx = (t: string): number => tileIndex(h(t)[0]);
const chow = (low: string): MeldLite => ({ kind: 'chow', idx: idx(low) });
const pung = (t: string): MeldLite => ({ kind: 'pung', idx: idx(t) });

/** Every copy unseen except those in the hand and melds. */
function unseenFor(hand: Tile[], melds: MeldLite[] = []): number[] {
  const u = new Array(34).fill(4) as number[];
  for (const t of hand) u[tileIndex(t)]--;
  for (const m of melds) {
    if (m.kind === 'chow') for (let k = 0; k < 3; k++) u[m.idx + k]--;
    else u[m.idx] -= m.kind === 'pung' ? 3 : 4;
  }
  return u;
}

function ctx(hand: string, melds: MeldLite[] = [], seat = 0) {
  const tiles = h(hand);
  return { hand: tiles, meldCount: melds.length, melds, seat, unseen: unseenFor(tiles, melds) };
}

describe('conditional distance from ready', () => {
  it('the unconstrained frame agrees with ChickenBot on random hands', () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 2000; n++) {
      const m = Math.floor(rng() * 4);
      const size = 13 - 3 * m + (rng() < 0.3 ? 1 : 0);
      const c = new Array(34).fill(0) as number[];
      const span = [34, 12, 9, 34, 20][Math.floor(rng() * 5)];
      for (let k = 0; k < size; ) {
        const i = Math.floor(rng() * span);
        if (c[i] < 4) {
          c[i]++;
          k++;
        }
      }
      expect(genericFrameDistance(c, m)).toBe(regularDistance(c, m));
    }
  });

  it('All Sequences counts only sequences and dies on an exposed triplet', () => {
    expect(ALL_SEQUENCES.dist(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 B5 B6 E E'), [])).toBe(0);
    // A concealed honor triplet is only a pair here, and the fourth
    // sequence has to be built from nothing.
    expect(ALL_SEQUENCES.dist(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E E R'), [])).toBe(2);
    expect(regularDistance(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E E R'), 0)).toBe(0);
    // Two pairs wait for a triplet, which All Sequences cannot use.
    expect(ALL_SEQUENCES.dist(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 B5 B5 E E'), [])).toBe(1);
    expect(ALL_SEQUENCES.dist(counts('C4 C5 C6 D7 D8 D9 B5 B6 E E'), [chow('B1')])).toBe(0);
    expect(ALL_SEQUENCES.dist(counts('C4 C5 C6 D7 D8 D9 B5 B6 E E'), [pung('B1')])).toBe(Infinity);
  });

  it('No Terminals treats 1s, 9s and honors as dead', () => {
    expect(NO_TERMINALS.dist(counts('B2 B3 B4 C4 C5 C6 D6 D7 D8 B5 B6 C3 C3'), [])).toBe(0);
    // 123 must become 234: one tile away per terminal-bearing block.
    expect(NO_TERMINALS.dist(counts('B1 B2 B3 C4 C5 C6 D6 D7 D8 B5 B6 C3 C3'), [])).toBe(1);
    const rest = counts('C4 C5 C6 D6 D7 D8 B5 B6 C3 C3');
    expect(NO_TERMINALS.dist(rest, [chow('B2')])).toBe(0);
    expect(NO_TERMINALS.dist(rest, [pung('B5')])).toBe(0);
    expect(NO_TERMINALS.dist(rest, [chow('B1')])).toBe(Infinity);
    expect(NO_TERMINALS.dist(rest, [chow('B7')])).toBe(Infinity);
    expect(NO_TERMINALS.dist(rest, [pung('B9')])).toBe(Infinity);
    expect(NO_TERMINALS.dist(rest, [pung('E')])).toBe(Infinity);
  });

  it('Concealed Hand is the regular distance until anything is melded', () => {
    const c = counts('B4 B5 B6 C5 C5 C6 D4 D5 E E E R R');
    expect(CONCEALED.dist(c, [])).toBe(1);
    expect(CONCEALED.dist(counts('C5 C5 C6 D4 D5 E E E R R'), [chow('B4')])).toBe(Infinity);
  });

  it('covers the StandardBot patterns', () => {
    expect(MIXED_ONE_SUIT.dist(counts('B1 B2 B3 B5 B5 B5 B7 B8 E E E R R'), [])).toBe(0);
    expect(MIXED_ONE_SUIT.dist(counts('B1 B2 B3 B5 B5 B5 B7 B8 E E'), [chow('C1')])).toBe(8);
    expect(MIXED_ONE_SUIT.dist(counts('B1 B2 B3 B5 B5 B5 B7'), [chow('C1'), chow('D1')])).toBe(Infinity);
    expect(ALL_TRIPLETS.dist(counts('B1 B1 B1 C2 C2 C2 D3 D3 D3 E E R R'), [])).toBe(0);
    expect(ALL_TRIPLETS.dist(counts('C2 C2 C2 D3 D3 D3 E E R R'), [chow('B1')])).toBe(Infinity);
    expect(THREE_SIMILAR.dist(counts('B2 B3 B4 C2 C3 C4 D2 D3 E E E R R'), [])).toBe(0);
    expect(THREE_SIMILAR.dist(counts('D2 D3 E E E R R'), [chow('B2'), chow('C2')])).toBe(0);
    // Two melds outside the three sequences leave no room for them.
    expect(THREE_SIMILAR.dist(counts('D2 D3 D4 C2 C3 C4 R'), [chow('B2'), pung('E')])).toBe(0);
    expect(THREE_SIMILAR.dist(counts('D2 D3 D4 C2 C3 C4 R'), [pung('B9'), pung('E')])).toBe(Infinity);
    expect(NINE_STRAIGHT.dist(counts('B1 B2 B3 B4 B5 B6 B7 B8 C1 C1 C1 R R'), [])).toBe(0);
    expect(LESSER_TERMINALS.dist(counts('B1 B2 B3 C7 C8 C9 D1 D1 D1 E E E R'), [])).toBe(0);
    expect(LESSER_TERMINALS.dist(counts('C7 C8 C9 D1 D1 D1 E E E R'), [chow('B4')])).toBe(Infinity);
  });

  it('counts outs within the pattern only', () => {
    // Waiting on B4/B7 for All Sequences.
    const c = counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 B5 B6 E E');
    const unseen = c.map((n) => 4 - n);
    expect(targetOuts(c, [], ALL_SEQUENCES, unseen)).toBe(8);
    // For No Terminals the 1, the 9s and the honor pair are all dead weight.
    expect(NO_TERMINALS.dist(c, [])).toBe(4);
  });
});

describe('TrivialBot', () => {
  const far = 'B1 B1 C3 C4 D5 D6 B6 B7 C8 D2 E S W';

  it('never pungs terminals, though ChickenBot would', () => {
    const c = ctx(far, [], 3);
    const avail = { kong: false, pung: true, chows: [] };
    expect(chooseClaim(c, 'B1', avail)?.kind).toBe('pung');
    expect(patternClaim('trivial', c, 'B1', avail)).toBeNull();
  });

  it('never pungs a wind that is not its seat wind', () => {
    const c = ctx('E E C3 C4 D5 D6 B6 B7 C8 D2 B2 S W', [], 1);
    expect(patternClaim('trivial', c, 'E ', { kong: false, pung: true, chows: [] })).toBeNull();
  });

  it('pungs a Value Honor pair (dragon or seat wind)', () => {
    const avail = { kong: false, pung: true, chows: [] };
    expect(patternClaim('trivial', ctx('R R C3 C4 D5 D6 B6 B7 C8 D2 B2 S W'), 'R ', avail)?.kind).toBe('pung');
    expect(
      patternClaim('trivial', ctx('E E C3 C4 D5 D6 B6 B7 C8 D2 B2 S W', [], 0), 'E ', avail)?.kind,
    ).toBe('pung');
  });

  it('does not pung a Value Honor while waiting concealed or on All Sequences', () => {
    const avail = { kong: false, pung: true, chows: [] };
    expect(patternClaim('trivial', ctx('B1 B2 B3 C4 C5 C6 D7 D8 D9 R R S S', [], 1), 'R ', avail)).toBeNull();
    expect(
      patternClaim('trivial', ctx('C4 C5 C6 D7 D8 B5 B6 B7 R R', [chow('B1')], 1), 'R ', avail),
    ).toBeNull();
  });

  it('kongs when it costs no distance', () => {
    const c = ctx('B1 B1 B1 C3 C4 D5 D6 B6 B7 C8 D2 E W');
    expect(patternClaim('trivial', c, 'B1', { kong: true, pung: true, chows: [] })).toEqual({ kind: 'kong' });
  });

  it('chows toward a trivial pattern but not into a dead end', () => {
    // Concealed: chowing 234 keeps No Terminals and All Sequences alive.
    const open = ctx('B2 B3 C3 C4 D5 D6 B6 B7 C8 D2 E S W', [], 2);
    expect(patternClaim('trivial', open, 'B4', { kong: false, pung: false, chows: [idx('B2')] })?.kind).toBe(
      'chow',
    );
    // Beside an exposed triplet of 5s, a 123 chow kills both patterns.
    const melded = ctx('B1 B2 C3 C4 C6 C7 D4 D5 D7 D7', [pung('B5')]);
    const avail = { kong: false, pung: false, chows: [idx('B1')] };
    expect(chooseClaim(melded, 'B3', avail)?.kind).toBe('chow');
    expect(patternClaim('trivial', melded, 'B3', avail)).toBeNull();
  });

  it('plays like ChickenBot once a Value Honor triplet is exposed', () => {
    const c = ctx('B1 B1 C3 C4 D5 D6 B6 C8 D2 D9', [pung('R')]);
    expect(patternClaim('trivial', c, 'B1', { kong: false, pung: true, chows: [] })?.kind).toBe('pung');
  });

  it('keeps a concealed Value Honor triplet intact', () => {
    const c = { ...ctx('R R R B1 B2 B3 C4 C5 C6 D7 D8 E S'), drawn: 'W ' };
    const dec = patternTurn('trivial', c, []);
    expect(dec.kind).toBe('discard');
    expect(dec.tile).not.toBe('R ');
  });

  it('sheds dead honors before useful simples', () => {
    const c = { ...ctx('B2 B3 B4 C4 C5 C6 D6 D7 B5 B6 C3 C3 N', [], 0), drawn: 'D2' };
    const dec = patternTurn('trivial', c, []);
    expect(dec).toMatchObject({ kind: 'discard', tile: 'N ' });
  });

  it('follows the Seven Pairs threshold and passes on claims', () => {
    const c = ctx('R R B1 B1 C3 C3 D5 D5 B6 B6 C8 D2 E');
    expect(patternClaim('trivial', c, 'R ', { kong: false, pung: true, chows: [] })).toBeNull();
  });
});

describe('StandardBot', () => {
  it('claims toward a pattern and ignores a plain improvement', () => {
    // Mostly Bamboo + honors: the East pung helps Mixed One Suit.
    const c = ctx('B1 B2 B3 B5 B5 B7 B8 E E R C4 D6 D9', [], 1);
    expect(patternClaim('standard', c, 'E ', { kong: false, pung: true, chows: [] })?.kind).toBe('pung');
    // An All Triplets shape: ChickenBot chows to get ready, StandardBot will
    // not trade its pattern for a plain hand.
    const s = ctx('B2 B3 C5 C5 C5 D7 D7 D7 E E S S R', [], 2);
    const avail = { kong: false, pung: false, chows: [idx('B2')] };
    expect(chooseClaim(s, 'B4', avail)?.kind).toBe('chow');
    expect(patternClaim('standard', s, 'B4', avail)).toBeNull();
  });

  it('discards the off-suit tile when going for one suit', () => {
    const c = { ...ctx('B1 B2 B3 B5 B5 B5 B7 B8 E E E R C4', [], 1), drawn: 'R ' };
    expect(patternTurn('standard', c, [])).toMatchObject({ kind: 'discard', tile: 'C4' });
  });

  it('refuses a kong that leaves no room for the pattern', () => {
    // Three Similar Sequences 234: B and C are melded, D234 is still needed
    // and the one free set is the O pung — a B7 kong would take D234's slot.
    const melds = [chow('B2'), chow('C2'), pung('O')];
    const c = { ...ctx('B7 B7 B7 D2', melds), drawn: 'B7' };
    const dec = patternTurn('standard', c, [{ tile: 'B7', variant: 'concealed' }]);
    expect(dec).toMatchObject({ kind: 'discard', tile: 'B7' });
  });

  it('rule A: needs 5 tiles and one in every sequence to consider the pattern', () => {
    // B456 C456 but no Dots: no Three Similar Sequences on offer.
    expect(THREE_SIMILAR.dist(counts('B4 B5 B6 C4 C5 C6 E E E R R S W'), [])).toBe(Infinity);
    // 2-1-1 is one tile short; 2-2-1 and 3-1-1 qualify.
    expect(THREE_SIMILAR.dist(counts('B4 B5 C4 D6 E E E R R S W N N'), [])).toBe(Infinity);
    expect(THREE_SIMILAR.dist(counts('B4 B5 C4 C6 D6 E E E R R S W N'), [])).toBe(3);
    expect(THREE_SIMILAR.dist(counts('B4 B5 B6 C5 D6 E E E R R S W N'), [])).toBe(3);
    // Tiles doubling as the pair still count.
    expect(THREE_SIMILAR.dist(counts('B4 B5 C4 C6 D6 D6 E E E R S W N'), [])).toBe(4);
    // A kong of one of the pattern's tiles leaves none for its sequence.
    expect(THREE_SIMILAR.dist(counts('B4 B6 C4 C5 C6 D4 D5 D6 E E'), [{ kind: 'kong', idx: idx('B5') }])).toBe(
      Infinity,
    );
    // Straight: 1-3 and 7-9 held, nothing in 4-6.
    expect(NINE_STRAIGHT.dist(counts('B1 B2 B3 B7 B8 B9 C1 C1 C1 R R S W'), [])).toBe(Infinity);
  });

  it('rule B: a thin start only chows its own two-tile sequence', () => {
    // 3-1-1 on 456: the C123 chow would help the plain shape, but is refused.
    const thin = ctx('B4 B5 B6 B8 B9 C5 D6 C1 C2 D2 D9 E S', [], 2);
    expect(patternClaim('standard', thin, 'C3', { kong: false, pung: false, chows: [idx('C1')] })).toBeNull();
    // 2-2-1 on 456: chowing B6 completes one of the twos.
    const two = ctx('B4 B5 C4 C6 D6 B8 B9 C1 D2 D9 E S W', [], 2);
    expect(patternClaim('standard', two, 'B6', { kong: false, pung: false, chows: [idx('B4')] })).toMatchObject({
      kind: 'chow',
      low: idx('B4'),
    });
    // 3-3-1 is free to claim outside the pattern.
    const strong = ctx('B4 B5 B6 C4 C5 C6 D6 C1 C2 D2 D9 E S', [], 2);
    expect(
      patternClaim('standard', strong, 'C3', { kong: false, pung: false, chows: [idx('C1')] })?.kind,
    ).toBe('chow');
  });

  it('rule B: a thin start may kong an outside triplet when the pair is covered', () => {
    const avail = { kong: true, pung: true, chows: [] };
    // 3-1-1 on 456, B9 triplet outside it, E E as the pair: kong.
    const paired = ctx('B4 B5 B6 C5 D6 B9 B9 B9 E E C1 D2 D9', [], 2);
    expect(patternClaim('standard', paired, 'B9', avail)).toEqual({ kind: 'kong' });
    // A concealed triplet of a pattern tile also covers the pair.
    const triplet = ctx('B4 B5 B6 C5 D6 D6 D6 B9 B9 B9 C1 D2 E', [], 2);
    expect(patternClaim('standard', triplet, 'B9', avail)).toEqual({ kind: 'kong' });
    // No pair anywhere: the kong is refused.
    const bare = ctx('B4 B5 B6 C5 D6 B9 B9 B9 E S C1 D2 D9', [], 2);
    expect(patternClaim('standard', bare, 'B9', avail)).toBeNull();
  });

  it('takes a kong that keeps the pattern distance', () => {
    const c = { ...ctx('B1 B1 B1 C2 C2 C2 D3 D3 D3 E E R R'), drawn: 'B1' };
    const dec = patternTurn('standard', c, [{ tile: 'B1', variant: 'concealed' }]);
    expect(dec).toMatchObject({ kind: 'kong', tile: 'B1' });
  });
});
