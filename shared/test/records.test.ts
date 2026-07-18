import { describe, expect, it } from 'vitest';
import { matchFromTxt } from '../src/records';

const HANDS = `East player's starting hand: B1, B2, B3
South player's starting hand: C1, C2, C3
West player's starting hand: D1, D2, D3
North player's starting hand: E, S, W`;

describe('records txt parsing (v0.2)', () => {
  it('parses the v0.2 fields: match type, player types, final scores, seed', () => {
    const txt = `Match ID: 111
Match Type: 1
Match Length: 1
Thinking Time: 30
Chicken Hand: 1
Par Score: 25
Scoring: 0
Bonus Tiles: 0
Starting East Username: Alice
Starting South Username: Bob
Starting West Username: DummyBot1
Starting North Username: Carol
Starting East Player Type: USER
Starting South Player Type: GUEST
Starting West Player Type: BOT
Starting North Player Type: USER ABANDONED
Starting East Final Score: 30
Starting South Final Score: -10
Starting West Final Score: -10
Starting North Final Score: -10

Game Number: E1
Seed: 0123456789ABC-5Z
${HANDS}
EAST: DRAW AND DISCARD B1
SOUTH: DRAW C4, MAHJONG C4
MIXED-ONE-SUIT, VALUE-HONOR-RED-DRAGON
SCORE: 50
ENDGAME
`;
    const rec = matchFromTxt(txt);
    expect(rec.tournamentWeek).toBeDefined();
    expect(rec.players.map((p) => p.isBot)).toEqual([false, false, true, false]);
    expect(rec.players.map((p) => p.registered)).toEqual([true, false, false, true]);
    expect(rec.abandonedBy).toEqual(['uploaded-3']);
    expect(rec.finalScores).toEqual([30, -10, -10, -10]);
    expect(rec.games[0].seed).toBe('0123456789ABC-5Z');
    expect(rec.games[0].result.patterns?.map((p) => p.id)).toEqual(['2.1.1', '3.1R']);
    expect(rec.games[0].result.patterns?.map((p) => p.points)).toEqual([40, 10]);
    // Self-draw payments recomputed: everyone pays 50.
    expect(rec.games[0].result.deltas).toEqual([-50, 150, -50, -50]);
  });

  it('stays backward compatible with the pre-v0.2 format', () => {
    const txt = `Match ID: 222
Match Length: 1
Thinking Time: 30
Chicken Hand: 1
Par Score: 25
Scoring: 1
Bonus Tiles: 2
Starting East Username: Dave
Starting South Username: Eve
Starting West Username: Frank
Starting North Username: Grace

Game Number: E1
${HANDS}
EAST: DRAW AND DISCARD B1
SOUTH: DRAW C4, MAHJONG C4
IMPROPER FLOWER/SEASON ×2, FOUR FLOWERS, PURE ONE-SUIT
SCORE: 24
ENDGAME
`;
    const rec = matchFromTxt(txt);
    expect(rec.tournamentWeek).toBeUndefined();
    expect(rec.abandonedBy).toEqual([]);
    const pats = rec.games[0].result.patterns!;
    expect(pats.map((p) => p.id)).toEqual(['11.1.1', '11.2.1', '2.1.2']);
    expect(pats[0].name).toContain('×2');
    expect(pats[0].points).toBe(4); // 2 per improper tile, full value
    expect(pats[2].points).toBe(90); // Pure One-Suit under adjusted scoring
    // Final scores summed from the recomputed deltas (self-draw, 24 each).
    expect(rec.finalScores).toEqual([-24, 72, -24, -24]);
  });

  it('aggregates repeated v0.2 bonus-tile lines back into ×n hits', () => {
    const txt = `Match ID: 333
Match Length: 1
Thinking Time: 30
Chicken Hand: 1
Par Score: 25
Scoring: 0
Bonus Tiles: 1
Starting East Username: A
Starting South Username: B
Starting West Username: C
Starting North Username: D

Game Number: E1
${HANDS}
SOUTH: DRAW C4, MAHJONG C4
IMPROPER-BONUS-TILE, IMPROPER-BONUS-TILE, IMPROPER-BONUS-TILE, PROPER-BONUS-TILE
SCORE: 5
ENDGAME
`;
    const pats = matchFromTxt(txt).games[0].result.patterns!;
    expect(pats.map((p) => p.id)).toEqual(['11.1.1', '11.1.2']);
    expect(pats[0].name).toContain('×3');
    expect(pats[0].points).toBe(3); // half value: 1 per improper tile
    expect(pats[1].points).toBe(2); // half value: 2 per proper tile
  });

  it('skips unrecognized pattern lines without failing', () => {
    const txt = `Match ID: 444
Match Length: 1
Thinking Time: 30
Chicken Hand: 1
Par Score: 25
Starting East Username: A
Starting South Username: B
Starting West Username: C
Starting North Username: D

Game Number: E1
${HANDS}
SOUTH: DRAW C4, MAHJONG C4
SOME-FUTURE-PATTERN
SCORE: 5
ENDGAME
`;
    const rec = matchFromTxt(txt);
    expect(rec.games[0].result.patterns).toBeUndefined();
    expect(rec.games[0].result.value).toBe(5);
  });
});
