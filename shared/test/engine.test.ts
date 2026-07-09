import { describe, expect, it } from 'vitest';
import {
  countsFrom,
  mulberry32,
  sortTiles,
  tileFromIndex,
  tileIndex,
} from '../src/tiles';
import { Wall } from '../src/wall';
import {
  canWinShape,
  chowOptions,
  decompose,
  isSevenPairsShape,
  isThirteenTerminalsShape,
  winningTileIndices,
} from '../src/hand';
import { scoreBonus, scoreWin } from '../src/scoring';
import { computePayments, findResponsible } from '../src/payment';

const T = (s: string) => s; // readability helper

describe('tiles', () => {
  it('round-trips indices', () => {
    for (let i = 0; i < 34; i++) expect(tileIndex(tileFromIndex(i))).toBe(i);
    expect(tileIndex('B1')).toBe(0);
    expect(tileIndex('E ')).toBe(27);
    expect(tileIndex('O ')).toBe(33);
  });
});

describe('wall', () => {
  it('deals 4x13 and serves exactly 70 draws', () => {
    const wall = new Wall(mulberry32(42));
    expect(wall.hands.every((h) => h.length === 13)).toBe(true);
    expect(wall.remaining).toBe(70);
    const seen = new Map<string, number>();
    for (const h of wall.hands) for (const t of h) seen.set(t, (seen.get(t) ?? 0) + 1);
    const drawn: string[] = [];
    // two kong draws mid-game
    for (let i = 0; i < 30; i++) drawn.push(wall.drawLive());
    drawn.push(wall.drawKong());
    drawn.push(wall.drawKong());
    for (let i = 0; i < 38; i++) drawn.push(wall.drawLive());
    expect(wall.remaining).toBe(0);
    expect(() => wall.drawLive()).toThrow();
    expect(() => wall.drawKong()).toThrow();
    for (const t of drawn) seen.set(t, (seen.get(t) ?? 0) + 1);
    // 52 dealt + 70 drawn = 122 tiles, no type over 4 copies
    expect([...seen.values()].reduce((a, b) => a + b, 0)).toBe(122);
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(4);
  });
});

describe('wall with bonus tiles', () => {
  it('uses 144 tiles, a 16-tile dead wall, and 76 live draws', () => {
    const wall = new Wall(mulberry32(11), { bonus: true });
    expect(wall.hands.every((h) => h.length === 13)).toBe(true);
    expect(wall.remaining).toBe(76);
    const seen = new Map<string, number>();
    for (const h of wall.hands) for (const t of h) seen.set(t, (seen.get(t) ?? 0) + 1);
    const drawn: string[] = [];
    for (let i = 0; i < 40; i++) drawn.push(wall.drawLive());
    for (let i = 0; i < 4; i++) drawn.push(wall.drawKong()); // kong/bonus replacements
    for (let i = 0; i < 32; i++) drawn.push(wall.drawLive());
    expect(wall.remaining).toBe(0);
    expect(() => wall.drawLive()).toThrow();
    for (const t of drawn) seen.set(t, (seen.get(t) ?? 0) + 1);
    // 52 dealt + 76 drawn = 128 distinct positions of the 144-tile set.
    expect([...seen.values()].reduce((a, b) => a + b, 0)).toBe(128);
    for (const [t, n] of seen) {
      expect(n).toBeLessThanOrEqual(t[0] === 'F' || t[0] === 'A' ? 1 : 4);
    }
  });
});

describe('bonus tile scoring (category 11)', () => {
  it('scores proper/improper flowers and complete sets cumulatively', () => {
    // East holding its proper flower F1 + improper A2, A3 (seasons).
    const r = scoreBonus(['F1', 'A2', 'A3'], 0, false);
    expect(r.total).toBe(4 + 2 + 2);
    expect(r.patterns.map((p) => p.id).sort()).toEqual(['11.1.1', '11.1.2']);

    // All four flowers for West: 10 + proper F3 (4) + 3 improper (6) = 20.
    const flowers = scoreBonus(['F1', 'F2', 'F3', 'F4'], 2, false);
    expect(flowers.total).toBe(20);
    expect(flowers.patterns.map((p) => p.id)).toContain('11.2.1');

    // All eight bonus tiles: 10 + 10 + proper two (8) + improper six (12) = 40.
    const all = scoreBonus(['F1', 'F2', 'F3', 'F4', 'A1', 'A2', 'A3', 'A4'], 1, false);
    expect(all.total).toBe(40);
  });

  it('halves every value under the half setting', () => {
    const all = scoreBonus(['F1', 'F2', 'F3', 'F4', 'A1', 'A2', 'A3', 'A4'], 1, true);
    expect(all.total).toBe(20);
    const one = scoreBonus(['A2'], 0, true);
    expect(one.total).toBe(1);
  });
});

describe('hand decomposition', () => {
  it('decomposes a regular hand', () => {
    // 123B 456B 789B 111C 22D
    const tiles = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'C1', 'C1', 'C1', 'D2', 'D2'];
    const ds = decompose(countsFrom(tiles), 4);
    expect(ds.length).toBeGreaterThan(0);
    expect(canWinShape(countsFrom(tiles), 0)).toBe(true);
  });

  it('finds both triplet and sequence readings of 111222333', () => {
    const tiles = ['B1', 'B1', 'B1', 'B2', 'B2', 'B2', 'B3', 'B3', 'B3', 'B9', 'B9', 'B9', 'C5', 'C5'];
    const ds = decompose(countsFrom(tiles), 4);
    const kinds = ds.map((d) => d.sets.map((s) => s.kind).join(''));
    expect(kinds.some((k) => k === 'tritritritri')).toBe(true);
    expect(kinds.some((k) => k.includes('seq'))).toBe(true);
  });

  it('recognizes seven pairs including duplicate pairs', () => {
    const tiles = ['B1', 'B1', 'B1', 'B1', 'C2', 'C2', 'D3', 'D3', 'E ', 'E ', 'R ', 'R ', 'O ', 'O '];
    expect(isSevenPairsShape(countsFrom(tiles))).toBe(true);
    expect(canWinShape(countsFrom(tiles), 0)).toBe(true);
  });

  it('recognizes thirteen terminals', () => {
    const tiles = ['B1', 'B9', 'C1', 'C9', 'D1', 'D9', 'E ', 'S ', 'W ', 'N ', 'R ', 'G ', 'O ', 'O '];
    expect(isThirteenTerminalsShape(countsFrom(tiles))).toBe(true);
  });

  it('rejects terminal/honor hands missing some of the 13 types', () => {
    // Within the 13 types and 14 tiles, but missing B1 and C9 (three pairs).
    const missing = ['B9', 'B9', 'C1', 'D1', 'D9', 'E ', 'E ', 'S ', 'W ', 'N ', 'R ', 'G ', 'O ', 'O '];
    expect(isThirteenTerminalsShape(countsFrom(missing))).toBe(false);
    expect(canWinShape(countsFrom(missing), 0)).toBe(false);
    // Two pairs, twelve types (the exact bug found in playtesting).
    const twoPair = ['B9', 'B9', 'C1', 'C9', 'D1', 'D9', 'E ', 'S ', 'W ', 'N ', 'R ', 'G ', 'O ', 'O '];
    expect(isThirteenTerminalsShape(countsFrom(twoPair))).toBe(false);
    expect(canWinShape(countsFrom(twoPair), 0)).toBe(false);
  });

  it('one-of-each thirteen terminals is a thirteen-way wait', () => {
    const tiles = ['B1', 'B9', 'C1', 'C9', 'D1', 'D9', 'E ', 'S ', 'W ', 'N ', 'R ', 'G ', 'O '];
    const waits = winningTileIndices(countsFrom(tiles), 0);
    expect(waits.length).toBe(13);
  });

  it('computes ambiguous chow options per spec examples', () => {
    // B-124 + discard B3 -> 123 or 234
    let opts = chowOptions(countsFrom(['B1', 'B2', 'B4']), 'B3');
    expect(opts.map(tileFromIndex)).toEqual(['B1', 'B2']);
    // D-5689 + discard D7 -> 567, 678, 789
    opts = chowOptions(countsFrom(['D5', 'D6', 'D8', 'D9']), 'D7');
    expect(opts.map(tileFromIndex)).toEqual(['D5', 'D6', 'D7']);
    // honors cannot be chowed
    expect(chowOptions(countsFrom(['E ', 'E ']), 'E ')).toEqual([]);
  });
});

describe('scoring', () => {
  const base = { seatWind: 1 }; // South seat unless overridden

  it('scores a chicken hand as 1 (or configured 0) points', () => {
    // 234B 567B 345C 666D 99D, won by discard completing the D6 triplet -> no patterns
    const input = {
      melds: [{ kind: 'chow' as const, tile: 'B2' }],
      concealed: ['B5', 'B6', 'B7', 'C3', 'C4', 'C5', 'D6', 'D6', 'D9', 'D9'],
      winTile: 'D6',
      winBy: 'discard' as const,
      ...base,
    };
    const r = scoreWin(input, 1);
    expect(r.chicken).toBe(true);
    expect(r.total).toBe(1);
    expect(scoreWin(input, 0).total).toBe(0);
  });

  it('scores concealed all-sequences no-terminals', () => {
    const r = scoreWin({
      melds: [],
      concealed: ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C3', 'C4', 'C5', 'D4', 'D5', 'D6', 'D8'],
      winTile: 'D8',
      winBy: 'discard',
      ...base,
    });
    const ids = r.patterns.map((p) => p.id).sort();
    expect(ids).toEqual(['1.1', '1.2', '1.3']);
    expect(r.total).toBe(15);
  });

  it('four concealed triplets always scores at least 160 (spec example)', () => {
    const r = scoreWin({
      melds: [],
      concealed: ['B2', 'B2', 'B2', 'C4', 'C4', 'C4', 'D6', 'D6', 'D6', 'D8', 'D8', 'D8', 'W '],
      winTile: 'W ',
      winBy: 'self',
      ...base,
    });
    const ids = r.patterns.map((p) => p.id);
    expect(ids).toContain('4.2.3');
    expect(ids).toContain('1.2');
    expect(ids).toContain('4.1');
    expect(r.total).toBe(160); // 125 + 5 + 30 (W pair is an honor: no No Terminals)
  });

  it('big three dragons scores 130 + three value honors (spec: at least 160)', () => {
    const r = scoreWin({
      melds: [
        { kind: 'pung', tile: 'R ' },
        { kind: 'pung', tile: 'G ' },
      ],
      concealed: ['O ', 'O ', 'O ', 'B2', 'B3', 'C5', 'C5'],
      winTile: 'B4',
      winBy: 'discard',
      ...base,
    });
    const ids = r.patterns.map((p) => p.id);
    expect(ids).toContain('3.2.2');
    expect(ids).toContain('3.1R');
    expect(ids).toContain('3.1G');
    expect(ids).toContain('3.1O');
    expect(r.rawTotal).toBe(160);
  });

  it('freedom of count picks identical sequences over consecutive triplets (spec example)', () => {
    const input = {
      melds: [{ kind: 'pung', tile: 'R ' } as const],
      concealed: ['D1', 'D1', 'D1', 'D2', 'D2', 'D2', 'D3', 'D3', 'C9', 'C9'],
      winTile: 'D3',
      seatWind: 1,
    };
    const onDiscard = scoreWin({ ...input, winBy: 'discard' });
    expect(onDiscard.total).toBe(170); // 120 + 40 + 10
    expect(onDiscard.patterns.map((p) => p.id)).toContain('5.1.3');
    const onSelf = scoreWin({ ...input, winBy: 'self' });
    expect(onSelf.total).toBe(170); // 100+30+10+30 ties 120+40+10
  });

  it('nine gates is a listed limit hand scoring exactly 480', () => {
    const r = scoreWin({
      melds: [],
      concealed: ['B1', 'B1', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B9', 'B9'],
      winTile: 'B5',
      winBy: 'self',
      ...base,
    });
    expect(r.limit).toBe('listed');
    expect(r.total).toBe(480);
    expect(r.patterns).toHaveLength(1);
    expect(r.patterns[0].id).toBe('2.2');
  });

  it('all honors seven pairs is a listed limit of 320', () => {
    const r = scoreWin({
      melds: [],
      concealed: ['E ', 'E ', 'S ', 'S ', 'W ', 'W ', 'N ', 'N ', 'R ', 'R ', 'G ', 'G ', 'O '],
      winTile: 'O ',
      winBy: 'discard',
      ...base,
    });
    expect(r.limit).toBe('listed');
    expect(r.total).toBe(320);
    expect(r.patterns[0].id).toBe('3.4');
  });

  it('sums exposed kong hands additively', () => {
    const r = scoreWin({
      melds: [
        { kind: 'kong', tile: 'B1', kongType: 'concealed' },
        { kind: 'kong', tile: 'B3', kongType: 'big' },
        { kind: 'kong', tile: 'B5', kongType: 'small' },
      ],
      concealed: ['B7', 'B7', 'B7', 'B9'],
      winTile: 'B9',
      winBy: 'self',
      ...base,
    });
    // 80 pure one-suit + 30 all triplets + 120 three kong + 5 two concealed (B1 kong + B7) = 235
    expect(r.rawTotal).toBe(235);
    expect(r.total).toBe(235);
  });

  it('caps compound hands at 320 without a listed limit pattern', () => {
    const r = scoreWin({
      melds: [
        { kind: 'kong', tile: 'B1', kongType: 'concealed' },
        { kind: 'kong', tile: 'B2', kongType: 'concealed' },
      ],
      concealed: ['B3', 'B3', 'B3', 'B5', 'B5', 'B5', 'B7'],
      winTile: 'B7',
      winBy: 'self',
      ...base,
    });
    // 80 pure + 30 all triplets + 125 four concealed + 20 two kong + 100 consecutive (123) + 5 concealed hand = 360
    expect(r.limit).toBe('compound');
    expect(r.total).toBe(320);
  });

  it('value honor counts seat wind but not other winds', () => {
    const south = scoreWin({
      melds: [{ kind: 'pung', tile: 'S ' }],
      concealed: ['B1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'D8', 'D9', 'E '],
      winTile: 'E ',
      winBy: 'discard',
      seatWind: 1, // South seat: S triplet is seat wind
    });
    expect(south.patterns.map((p) => p.id)).toContain('3.1S');
    const west = scoreWin({
      melds: [{ kind: 'pung', tile: 'S ' }],
      concealed: ['B1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'D8', 'D9', 'E '],
      winTile: 'E ',
      winBy: 'discard',
      seatWind: 2, // West seat: S triplet is nothing
    });
    expect(west.chicken).toBe(true);
  });

  it('win-on-discard triplet is exposed for concealed-triplet counting', () => {
    const input = {
      melds: [],
      concealed: ['B2', 'B2', 'B2', 'C4', 'C4', 'C4', 'D6', 'D6', 'C7', 'C8', 'C9', 'D9', 'D9'],
      winTile: 'D6',
      seatWind: 0,
    };
    const self = scoreWin({ ...input, winBy: 'self' });
    expect(self.patterns.map((p) => p.id)).toContain('4.2.2'); // three concealed
    const disc = scoreWin({ ...input, winBy: 'discard' });
    // D6 triplet completed by discard is exposed -> only two concealed
    expect(disc.patterns.map((p) => p.id)).toContain('4.2.1');
    expect(disc.patterns.map((p) => p.id)).not.toContain('4.2.2');
  });

  it('scores mixed greater terminals with all triplets', () => {
    const r = scoreWin({
      melds: [
        { kind: 'pung', tile: 'B1' },
        { kind: 'pung', tile: 'C9' },
      ],
      concealed: ['D1', 'D1', 'D1', 'R ', 'R ', 'E ', 'E '],
      winTile: 'R ',
      winBy: 'discard',
      seatWind: 0,
    });
    const ids = r.patterns.map((p) => p.id);
    expect(ids).toContain('8.1.3');
    expect(ids).toContain('4.1');
    expect(ids).toContain('3.1R'); // R triplet completed by the discard
  });
});

describe('adjusted scoring and optional patterns', () => {
  const base = { seatWind: 1 }; // South

  // 234B 456B 678B 111B 99B — pure one-suit
  const pureOneSuit = {
    melds: [{ kind: 'chow' as const, tile: 'B2' }],
    concealed: ['B4', 'B5', 'B6', 'B6', 'B7', 'B8', 'B1', 'B1', 'B1', 'B9'],
    winTile: 'B9',
    winBy: 'discard' as const,
    ...base,
  };

  it('re-values Pure One-Suit 80 -> 90 under adjusted scoring', () => {
    expect(scoreWin(pureOneSuit).patterns.find((p) => p.id === '2.1.2')!.points).toBe(80);
    const adj = scoreWin(pureOneSuit, 1, 'adjusted');
    expect(adj.patterns.find((p) => p.id === '2.1.2')!.points).toBe(90);
    expect(adj.total).toBe(90);
  });

  it('re-values Blessing of Earth 155 -> 160', () => {
    const input = {
      melds: [],
      concealed: ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C3', 'C4', 'C5', 'D4', 'D5', 'D6', 'D8'],
      winTile: 'D8',
      winBy: 'discard' as const,
      earth: true,
      ...base,
    };
    expect(scoreWin(input).patterns.find((p) => p.id === '9.4.2')!.points).toBe(155);
    expect(scoreWin(input, 1, 'adjusted').patterns.find((p) => p.id === '9.4.2')!.points).toBe(160);
  });

  it('1.4 Two Suits Only: two number suits, no honors, extras mode only', () => {
    // 234B 567B 345C 666C 99C
    const input = {
      melds: [],
      concealed: ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C3', 'C4', 'C5', 'C6', 'C6', 'C6', 'C9'],
      winTile: 'C9',
      winBy: 'discard' as const,
      ...base,
    };
    const extra = scoreWin(input, 1, 'adjustedExtra');
    expect(extra.patterns.map((p) => p.id)).toContain('1.4');
    expect(scoreWin(input, 1, 'adjusted').patterns.map((p) => p.id)).not.toContain('1.4');
    expect(scoreWin(input).patterns.map((p) => p.id)).not.toContain('1.4');
  });

  it('2.3 Five Suits: three suits + winds + dragons across the five groups', () => {
    // 123B 456C 777D EEE RR
    const input = {
      melds: [
        { kind: 'chow' as const, tile: 'B1' },
        { kind: 'pung' as const, tile: 'E ' },
      ],
      concealed: ['C4', 'C5', 'C6', 'D7', 'D7', 'D7', 'R '],
      winTile: 'R ',
      winBy: 'discard' as const,
      ...base,
    };
    const extra = scoreWin(input, 1, 'adjustedExtra');
    expect(extra.patterns.map((p) => p.id)).toContain('2.3');
    expect(extra.total).toBe(20);
    // Without extras this hand has no pattern at all: a chicken hand.
    expect(scoreWin(input, 1, 'adjusted').chicken).toBe(true);
  });

  it('8.2 All Edge Tiles works with Seven Pairs', () => {
    const input = {
      melds: [],
      concealed: ['B1', 'B1', 'B2', 'B2', 'C8', 'C8', 'C9', 'C9', 'D1', 'D1', 'D2', 'D2', 'D8'],
      winTile: 'D8',
      winBy: 'discard' as const,
      ...base,
    };
    const extra = scoreWin(input, 1, 'adjustedExtra');
    const ids = extra.patterns.map((p) => p.id);
    expect(ids).toContain('10.2');
    expect(ids).toContain('8.2');
    expect(extra.total).toBe(155); // 30 + 125
    expect(scoreWin(input).patterns.map((p) => p.id)).not.toContain('8.2');
  });

  it('8.3 Four Unlike: 1-meld, 9-meld, middle meld, wind meld, free pair', () => {
    // 123B 789C 456D EEE RR — also Five Suits
    const input = {
      melds: [{ kind: 'pung' as const, tile: 'E ' }],
      concealed: ['B1', 'B2', 'B3', 'C7', 'C8', 'C9', 'D4', 'D5', 'D6', 'R '],
      winTile: 'R ',
      winBy: 'discard' as const,
      ...base,
    };
    const ids = scoreWin(input, 1, 'adjustedExtra').patterns.map((p) => p.id);
    expect(ids).toContain('8.3');
    expect(ids).toContain('2.3');
  });

  it('8.3 rejects a pair already used by a sequence meld', () => {
    // 123B 789C 456D EEE + 22B pair: B2 sits inside 123B
    const input = {
      melds: [{ kind: 'pung' as const, tile: 'E ' }],
      concealed: ['B1', 'B2', 'B3', 'C7', 'C8', 'C9', 'D4', 'D5', 'D6', 'B2'],
      winTile: 'B2',
      winBy: 'discard' as const,
      ...base,
    };
    expect(scoreWin(input, 1, 'adjustedExtra').patterns.map((p) => p.id)).not.toContain('8.3');
  });

  it('8.3 rejects a wind pair and a missing middle meld', () => {
    // wind pair: 123B 789C 456D RRR + EE
    const windPair = {
      melds: [{ kind: 'pung' as const, tile: 'R ' }],
      concealed: ['B1', 'B2', 'B3', 'C7', 'C8', 'C9', 'D4', 'D5', 'D6', 'E '],
      winTile: 'E ',
      winBy: 'discard' as const,
      ...base,
    };
    // no wind meld at all -> not four unlike
    expect(scoreWin(windPair, 1, 'adjustedExtra').patterns.map((p) => p.id)).not.toContain('8.3');
    // two 1-melds, no middle: 123B 111C 789D EEE RR
    const noMiddle = {
      melds: [{ kind: 'pung' as const, tile: 'E ' }],
      concealed: ['B1', 'B2', 'B3', 'C1', 'C1', 'C1', 'D7', 'D8', 'D9', 'R '],
      winTile: 'R ',
      winBy: 'discard' as const,
      ...base,
    };
    expect(scoreWin(noMiddle, 1, 'adjustedExtra').patterns.map((p) => p.id)).not.toContain('8.3');
  });
});

describe('payments', () => {
  it('spec example: 70-point hand on discard pays 25/25/160', () => {
    const d = computePayments({
      value: 70,
      winnerSeat: 0,
      winBy: 'discard',
      responsibleSeat: 2,
      par: 25,
    });
    expect(d).toEqual([210, -25, -160, -25]);
  });

  it('small hands split equally even on discard', () => {
    const d = computePayments({
      value: 20,
      winnerSeat: 1,
      winBy: 'discard',
      responsibleSeat: 0,
      par: 25,
    });
    expect(d).toEqual([-20, 60, -20, -20]);
  });

  it('self-draw always splits equally', () => {
    const d = computePayments({
      value: 100,
      winnerSeat: 3,
      winBy: 'self',
      responsibleSeat: null,
      par: 25,
    });
    expect(d).toEqual([-100, -100, -100, 300]);
  });

  it('par 30-unless-exact-then-25 pays 40/25/25 on an exact 30', () => {
    const d = computePayments({
      value: 30,
      winnerSeat: 0,
      winBy: 'discard',
      responsibleSeat: 1,
      par: '30/25',
    });
    expect(d).toEqual([90, -40, -25, -25]);
    // 28 points under the same setting: at or below par 30 -> equal split
    const e = computePayments({
      value: 28,
      winnerSeat: 0,
      winBy: 'discard',
      responsibleSeat: 1,
      par: '30/25',
    });
    expect(e).toEqual([84, -28, -28, -28]);
    // 40 points: above par -> 25? no: par 30 -> others pay 30, responsible pays 60
    const f = computePayments({
      value: 40,
      winnerSeat: 0,
      winBy: 'discard',
      responsibleSeat: 1,
      par: '30/25',
    });
    expect(f).toEqual([120, -60, -30, -30]);
  });

  it('payments are always zero-sum', () => {
    for (const par of [25, 30, '30/25'] as const) {
      for (const value of [1, 5, 25, 30, 70, 320]) {
        for (const winBy of ['self', 'discard'] as const) {
          const d = computePayments({
            value,
            winnerSeat: 2,
            winBy,
            responsibleSeat: winBy === 'discard' ? 0 : null,
            par,
          });
          expect(d.reduce((a, b) => a + b, 0)).toBe(0);
          expect(d[2]).toBe(3 * value);
        }
      }
    }
  });
});

describe('same-round immunity', () => {
  it('blames the final discarder normally', () => {
    const log = [
      { seat: 0, tile: 'B1' },
      { seat: 1, tile: 'C2' },
      { seat: 2, tile: 'D3' },
    ];
    expect(findResponsible(log, 3, 'D3')).toBe(2);
  });

  it('blames the first same-round discarder of the winning tile', () => {
    const log = [
      { seat: 3, tile: 'B5' }, // winner's own previous discard (window start)
      { seat: 0, tile: 'D3' }, // first to drop the winning tile after that
      { seat: 1, tile: 'C2' },
      { seat: 2, tile: 'D3' }, // followed suit -> immune
    ];
    expect(findResponsible(log, 3, 'D3')).toBe(0);
  });

  it('no one is responsible if the winner discarded the tile last round', () => {
    const log = [
      { seat: 3, tile: 'D3' }, // winner's own previous discard was the winning tile
      { seat: 1, tile: 'C2' },
      { seat: 2, tile: 'D3' },
    ];
    expect(findResponsible(log, 3, 'D3')).toBe(null);
  });
});

describe('misc', () => {
  it('sorts tiles into suit order', () => {
    expect(sortTiles(['O ', 'B9', 'E ', 'B1', 'D5', 'C3'])).toEqual([
      'B1',
      'B9',
      'C3',
      'D5',
      'E ',
      'O ',
    ]);
    expect(T('B1')).toBe('B1');
  });
});
