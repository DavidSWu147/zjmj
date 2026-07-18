import { describe, expect, it } from 'vitest';
import { countsFrom, Tile } from '../../shared/src/tiles';
import {
  chickenMode,
  chooseClaim,
  chooseDiscard,
  discardPriority,
  distanceReducingOuts,
  regularDistance,
  sevenPairsDistance,
  thirteenDistance,
  wantsOwnKong,
} from '../src/chickenbot';

/** "B4 B5 B6 C5 C5 C6 D4 D5 E E E R R" → Tile[] (honors keep their space). */
const h = (s: string): Tile[] =>
  s
    .trim()
    .split(/\s+/)
    .map((t) => (t.length === 1 ? `${t} ` : t));

const counts = (s: string): number[] => countsFrom(h(s));

/** Every copy unseen except the ones in this hand. */
const unseenAfter = (hand: number[]): number[] => hand.map((n) => 4 - n);

describe('distance from ready', () => {
  it('scores ready hands as 0', () => {
    // 3-3-3-3-1: four sets waiting on the pair.
    expect(regularDistance(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E E R'), 0)).toBe(0);
    // 3-3-3-2-2 with a pair.
    expect(regularDistance(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E S S'), 0)).toBe(0);
  });

  it('matches the spec example: B456 C556 D45 EEE RR is 1 away', () => {
    expect(regularDistance(counts('B4 B5 B6 C5 C5 C6 D4 D5 E E E R R'), 0)).toBe(1);
  });

  it('caps at 8 for a fully isolated hand', () => {
    expect(regularDistance(counts('B1 B4 B7 C2 C5 C8 D3 D6 D9 E S W R'), 0)).toBe(8);
  });

  it('extracts 345 + 567 from 345567 (no greedy 456 trap)', () => {
    expect(regularDistance(counts('B3 B4 B5 B5 B6 B7 E E E R R G G'), 0)).toBe(0);
  });

  it('keeps the pair when 111 could swallow it (11123)', () => {
    // B11123 C456 D789 + EE: both readings reach ready.
    expect(regularDistance(counts('B1 B1 B1 B2 B3 C4 C5 C6 D7 D8 D9 E E'), 0)).toBe(0);
  });

  it('accounts for declared melds', () => {
    // Two melds declared; concealed B45 C22 D78 E: one perfect step from ready.
    expect(regularDistance(counts('B4 B5 C2 C2 D7 D8 E'), 2)).toBe(1);
  });

  it('handles Seven Pairs, duplicates included', () => {
    expect(sevenPairsDistance(counts('B1 B1 C2 C2 D3 D3 E E R R B5 B5 C7'))).toBe(0);
    expect(sevenPairsDistance(counts('B1 B1 B1 B1 C2 C2 D3 D3 E E R R G'))).toBe(0);
    expect(sevenPairsDistance(counts('B1 B1 C2 C2 D3 D3 E E R G C7 C8 C9'))).toBe(2);
  });

  it('handles Thirteen Terminals', () => {
    // One of each of the 13 types: ready, waiting on the pair.
    expect(thirteenDistance(counts('B1 B9 C1 C9 D1 D9 E S W N R G O'))).toBe(0);
    // 11 unique types with one pair + junk: 13 - 11 - 1 = 1.
    expect(thirteenDistance(counts('B1 B1 B9 C1 C9 D1 D9 E S W N R B5'))).toBe(1);
  });

  it('never credits Seven Pairs/Thirteen Terminals to a regular hand (0.1.5 #2)', () => {
    // Six pairs + odd tile: Seven Pairs would be ready, but the regular
    // frame reads it as three pairs short of 4 sets + a pair.
    expect(regularDistance(counts('B1 B1 C2 C2 D3 D3 E E R R B5 B5 C7'), 0)).toBe(3);
  });
});

describe('chicken mode (spec 4.2/4.3)', () => {
  it('commits to Thirteen Terminals at 9+ unique terminals/honors', () => {
    expect(chickenMode(counts('B1 B9 C1 C9 D1 D9 E S W B4 B5 C6 D7'), 0)).toBe('thirteen');
  });
  it('commits to Seven Pairs at 5+ pairs', () => {
    expect(chickenMode(counts('B2 B2 C3 C3 D4 D4 E E G G B7 C8 D6'), 0)).toBe('pairs');
  });
  it('prefers Seven Pairs when a hand also qualifies for Thirteen Terminals (0.1.5 #1)', () => {
    // 5 terminal/honor pairs + 4 loose terminals/honors (14 tiles, post-draw):
    // 9 unique types reach the Thirteen Terminals threshold too.
    expect(chickenMode(counts('B1 B1 B9 B9 C1 C1 C9 C9 D1 D1 D9 E S W'), 0)).toBe('pairs');
  });
  it('plays normally otherwise, and always once melded', () => {
    expect(chickenMode(counts('B2 B3 B4 C3 C3 D4 D5 E E G B7 C8 D9'), 0)).toBe('normal');
    expect(chickenMode(counts('B2 B2 C3 C3 D4 D4 E E G G'), 1)).toBe('normal');
  });
});

describe('distance reducing outs', () => {
  it('counts winning tiles for a ready hand', () => {
    const c = counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E S S');
    // Shanpon wait on E/S: 2 unseen copies of each.
    expect(distanceReducingOuts(c, 0, 'normal', unseenAfter(c))).toBe(4);
  });

  it('counts tiles that advance a 1-away hand', () => {
    const c = counts('B4 B5 B6 C5 C5 C6 D4 D5 E E E R R');
    // Spec example: C4/C7 (finishing C556's run), D3/D6 (finishing D45),
    // C5/R/C6... every draw that lets a discard reach ready.
    const outs = distanceReducingOuts(c, 0, 'normal', unseenAfter(c));
    expect(outs).toBeGreaterThan(0);
    // D3 completes D345 → ready; verify it is included by removing it from
    // the unseen pool and seeing the count drop.
    const unseen = unseenAfter(c);
    const d3 = 18 + 2; // D3
    const without = [...unseen];
    without[d3] = 0;
    expect(distanceReducingOuts(c, 0, 'normal', without)).toBe(outs - unseen[d3]);
  });
});

describe('discard choice (spec 4.4)', () => {
  it('minimizes distance from ready first', () => {
    // Drawing E completes EEE; the junk single S or W goes, not a set tile.
    const pick = chooseDiscard({
      hand: h('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E S W'),
      drawn: 'E ',
      meldCount: 0,
      seat: 0,
      unseen: unseenAfter(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E E S W')),
    });
    expect(['S ', 'W ']).toContain(pick.tile);
  });

  it('breaks honor ties by the seat wind order (4.4.2)', () => {
    // East discards S before W; West discards W last of the winds.
    const ctx = {
      hand: h('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E S W'),
      drawn: 'E ' as Tile,
      meldCount: 0,
      unseen: unseenAfter(counts('B1 B2 B3 C4 C5 C6 D7 D8 D9 E E E S W')),
    };
    expect(chooseDiscard({ ...ctx, seat: 0 }).tile).toBe('S ');
    // North's order starts E,S,W — S still precedes W.
    expect(chooseDiscard({ ...ctx, seat: 3 }).tile).toBe('S ');
    // West's order is N,E,S,G,R,O,W: S precedes W there too; use South
    // (W,N,E,O,R,G,S) to see W go before S.
    expect(chooseDiscard({ ...ctx, seat: 1 }).tile).toBe('W ');
  });

  it('follows the middle-first number order in Seven Pairs mode (4.4.1)', () => {
    // Priority list starts B5, C5, D5, B4 … numbers always before honors.
    expect(discardPriority(4, 0, 'pairs')).toBe(0); // B5
    expect(discardPriority(13, 0, 'pairs')).toBe(1); // C5
    expect(discardPriority(22, 0, 'pairs')).toBe(2); // D5
    expect(discardPriority(3, 0, 'pairs')).toBe(3); // B4
    expect(discardPriority(8, 0, 'pairs')).toBeLessThan(discardPriority(27, 0, 'pairs')); // B9 < honors
  });

  it('sheds honors first, then terminals inward, in normal mode (0.1.5 #3)', () => {
    // Honors take positions 0–6 (seat-wind order), then 9D,9C,9B, 1D,1C,1B,
    // … down to 5D,5C,5B.
    expect(discardPriority(28, 0, 'normal')).toBe(0); // East sheds S first
    expect(discardPriority(27, 0, 'normal')).toBe(6); // own wind E last honor
    expect(discardPriority(26, 0, 'normal')).toBe(7); // D9 heads the numbers
    expect(discardPriority(17, 0, 'normal')).toBe(8); // C9
    expect(discardPriority(8, 0, 'normal')).toBe(9); // B9
    expect(discardPriority(18, 0, 'normal')).toBe(10); // D1
    expect(discardPriority(4, 0, 'normal')).toBe(33); // B5 goes very last
  });

  it('Thirteen Terminals mode: Seven Pairs order, but 1s/9s go very last (v0.2)', () => {
    // Middle-out numbers first (B5 leads), then honors, then B1,C1,D1,B9,C9,D9.
    expect(discardPriority(4, 0, 'thirteen')).toBe(0); // B5 first out
    expect(discardPriority(13, 0, 'thirteen')).toBe(1); // C5
    // Honors sit after all the non-terminal numbers…
    expect(discardPriority(28, 0, 'thirteen')).toBeGreaterThan(discardPriority(1, 0, 'thirteen')); // S after B2
    // …and every honor goes before any 1 or 9.
    expect(discardPriority(27, 0, 'thirteen')).toBeLessThan(discardPriority(0, 0, 'thirteen')); // E < B1
    expect(discardPriority(0, 0, 'thirteen')).toBeLessThan(discardPriority(9, 0, 'thirteen')); // B1 < C1
    expect(discardPriority(18, 0, 'thirteen')).toBeLessThan(discardPriority(8, 0, 'thirteen')); // D1 < B9
    expect(discardPriority(26, 0, 'thirteen')).toBeGreaterThan(discardPriority(17, 0, 'thirteen')); // D9 dead last
  });

  it('prefers the drawn copy of the chosen type (4.4.3)', () => {
    // Thirteen Terminals mode: the freshly drawn third B5 is pure junk.
    const pick = chooseDiscard({
      hand: h('B1 B9 C1 C9 D1 D9 E S W N R B5 B5'),
      drawn: 'B5',
      meldCount: 0,
      seat: 0,
      unseen: unseenAfter(counts('B1 B9 C1 C9 D1 D9 E S W N R B5 B5 B5')),
    });
    expect(pick.tile).toBe('B5');
    expect(pick.fromDrawn).toBe(true);
  });
});

describe('own-turn kong (spec 4.6)', () => {
  it('declares a kong that preserves distance', () => {
    // Ready hand; the 4th B5 arrives: konging keeps distance at 0.
    expect(
      wantsOwnKong(
        {
          hand: h('B5 B5 B5 B1 B2 B3 C4 C5 C6 D7 D8 D9 E'),
          drawn: 'B5',
          meldCount: 0,
          seat: 0,
          unseen: new Array(34).fill(4),
        },
        { tile: 'B5', variant: 'concealed' },
      ),
    ).toBe(true);
  });

  it('refuses a kong that would grow the distance', () => {
    // Seven Pairs plan (6 pairs incl. B5B5): konging B5 wrecks it.
    expect(
      wantsOwnKong(
        {
          hand: h('B5 B5 B5 C2 C2 D3 D3 E E R R G G'),
          drawn: 'B5',
          meldCount: 0,
          seat: 0,
          unseen: new Array(34).fill(4),
        },
        { tile: 'B5', variant: 'concealed' },
      ),
    ).toBe(false);
  });
});

describe('claim choice (spec 4.5/4.6)', () => {
  it('claims a chow that strictly improves distance, with its discard', () => {
    // Two melds declared; concealed B45 C22 D78 E, discard is B3:
    // chow B3B4B5 then discard E → ready.
    const dec = chooseClaim(
      {
        hand: h('B4 B5 C2 C2 D7 D8 E'),
        meldCount: 2,
        seat: 0,
        unseen: unseenAfter(counts('B4 B5 C2 C2 D7 D8 E B3')),
      },
      'B3',
      { kong: false, pung: false, chows: [2] }, // low = B3
    );
    expect(dec).toEqual({ kind: 'chow', low: 2, discard: 'E ' });
  });

  it('prefers an improving pung over a worse chow', () => {
    const dec = chooseClaim(
      {
        hand: h('B5 B5 B3 B4 C2 C2 E'),
        meldCount: 2,
        seat: 0,
        unseen: unseenAfter(counts('B5 B5 B3 B4 C2 C2 E B5')),
      },
      'B5',
      { kong: false, pung: true, chows: [2] }, // chow B3B4B5 also possible
    );
    expect(dec).toEqual({ kind: 'pung', discard: 'E ' });
  });

  it('passes when no claim improves the hand', () => {
    // Isolated junk: a pung of B5 melds a set but the rest stays hopeless —
    // distance is unchanged, so pass (kong unavailable).
    const dec = chooseClaim(
      {
        hand: h('B5 B5 B1 C1 D1 E S W N R G O C5'),
        meldCount: 0,
        seat: 0,
        unseen: new Array(34).fill(4),
      },
      'B5',
      { kong: false, pung: true, chows: [] },
    );
    expect(dec).toBeNull();
  });

  it('takes a big kong only when distance is preserved', () => {
    // B555 already reads as a triplet: konging it keeps distance at 2,
    // while a pung (discarding into 11 tiles) improves nothing.
    const dec = chooseClaim(
      {
        hand: h('B5 B5 B5 C1 C2 C3 D4 D5 E E B8 C8 D2'),
        meldCount: 0,
        seat: 0,
        unseen: new Array(34).fill(4),
      },
      'B5',
      { kong: true, pung: true, chows: [] },
    );
    expect(dec).toEqual({ kind: 'kong' });
  });

  it('passes all non-mahjong calls while committed to Seven Pairs (4.3)', () => {
    const dec = chooseClaim(
      {
        hand: h('B2 B2 C3 C3 D4 D4 E E G G B7 C8 D6'),
        meldCount: 0,
        seat: 0,
        unseen: new Array(34).fill(4),
      },
      'B2',
      { kong: false, pung: true, chows: [] },
    );
    expect(dec).toBeNull();
  });
});
