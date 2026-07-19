import { describe, expect, it } from 'vitest';
import { GameAction, GameView } from '../../shared/src/protocol';
import { MatchRecord, MoveRecord } from '../../shared/src/records';
import { Match } from '../src/match';
import { TUTORIAL_SETTINGS, tutorialWallFor } from '../src/tutorial';

const FAST = { dealMs: 1, botDelayMs: 1, claimGapMs: 1, resultMs: 1, matchEndMs: 1 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One scripted player step: fires once when its condition first holds. */
interface Step {
  when: (v: GameView) => boolean;
  action: (v: GameView) => GameAction;
}

const discard = (tile: string, fromDrawn = false): GameAction => ({
  kind: 'discard',
  tile,
  fromDrawn,
});

/** The tutorial's forced player actions, per game, in order. */
function stepsForGame(game: number): Step[] {
  const pre = (v: GameView) =>
    v.phase === 'preDiscard' && v.turnSeat === v.mySeat && !!v.myOptions.discard;
  if (game === 0) {
    return [
      { when: (v) => pre(v) && v.myDrawn === 'B7', action: () => discard('S ') },
      {
        when: (v) => !!v.myOptions.claim?.pung && v.lastDiscard?.tile === 'D1',
        action: () => ({ kind: 'claim', claim: 'pung' }),
      },
      { when: (v) => v.pendingClaim?.kind === 'pung', action: () => discard('D2') },
      {
        when: (v) => (v.myOptions.claim?.chows ?? []).includes('B1'),
        action: () => ({ kind: 'claim', claim: 'chow', chowLow: 'B1' }),
      },
      { when: (v) => v.pendingClaim?.kind === 'chow', action: () => discard('B7') },
      {
        when: (v) => !!v.myOptions.claim?.mahjong,
        action: () => ({ kind: 'claim', claim: 'mahjong' }),
      },
    ];
  }
  if (game === 1) {
    return [
      {
        when: (v) => !!v.myOptions.claim?.pung && v.lastDiscard?.tile === 'B9',
        action: () => ({ kind: 'claim', claim: 'pung' }),
      },
      { when: (v) => v.pendingClaim?.kind === 'pung', action: () => discard('R ') },
      { when: (v) => pre(v) && v.myDrawn === 'R ', action: () => discard('R ', true) },
      {
        when: (v) => (v.myOptions.claim?.chows ?? []).includes('D4'),
        action: () => ({ kind: 'claim', claim: 'chow', chowLow: 'D4' }),
      },
      { when: (v) => v.pendingClaim?.kind === 'chow', action: () => discard('B5') },
      {
        when: (v) => pre(v) && v.myDrawn === 'C4',
        action: () => ({ kind: 'kong', tile: 'C4', variant: 'concealed' }),
      },
      { when: (v) => pre(v) && v.myDrawn === 'S ', action: () => discard('D3') },
      {
        when: (v) => !!v.myOptions.claim?.kong && v.lastDiscard?.tile === 'S ',
        action: () => ({ kind: 'claim', claim: 'kong' }),
      },
      {
        when: (v) =>
          pre(v) && (v.myOptions.kongs ?? []).some((k) => k.tile === 'B9' && k.variant === 'small'),
        action: () => ({ kind: 'kong', tile: 'B9', variant: 'small' }),
      },
      {
        when: (v) => pre(v) && v.myDrawn === 'D1' && !!v.myOptions.mahjong,
        action: () => ({ kind: 'mahjong' }),
      },
    ];
  }
  if (game === 2) {
    return [
      { when: (v) => pre(v) && v.myDrawn === 'B9', action: () => discard('C5') },
      { when: (v) => pre(v) && v.myDrawn === 'B9', action: () => discard('D3') },
      {
        when: (v) => !!v.myOptions.claim?.pung && v.lastDiscard?.tile === 'E ',
        action: () => ({ kind: 'claim', claim: 'pung' }),
      },
      { when: (v) => v.pendingClaim?.kind === 'pung', action: () => discard('D8') },
      {
        when: (v) => !!v.myOptions.claim?.mahjong && v.lastDiscard?.tile === 'B6',
        action: () => ({ kind: 'claim', claim: 'mahjong' }),
      },
    ];
  }
  return [
    { when: (v) => pre(v) && v.myDrawn === 'C9', action: () => discard('C4') },
    { when: (v) => pre(v) && v.myDrawn === 'E ', action: () => discard('C7') },
    {
      when: (v) => pre(v) && v.myDrawn === 'C1' && !!v.myOptions.mahjong,
      action: () => ({ kind: 'mahjong' }),
    },
  ];
}

const findMove = (
  moves: MoveRecord[],
  pred: (m: MoveRecord) => boolean,
): MoveRecord | undefined => moves.find(pred);

describe('tutorial (v0.3)', () => {
  it('plays the scripted match: the player wins all four games as designed', async () => {
    let record: MatchRecord | null = null;
    let view = null as GameView | null;
    const match = new Match(
      TUTORIAL_SETTINGS,
      [{ id: 'learner', name: 'Learner', isBot: false, registered: true }],
      {
        sendView: (pid, v) => {
          if (pid === 'learner') view = v;
        },
        isConnected: () => true,
        onMatchEnd: (r) => {
          record = r;
        },
        timing: FAST,
      },
      null,
      'chicken',
      null,
      tutorialWallFor,
    );
    match.start();

    let game = -1;
    let steps: Step[] = [];
    const deadline = Date.now() + 60000;
    while (!record && Date.now() < deadline) {
      await sleep(2);
      const v: GameView | null = view;
      if (!v) continue;
      if (v.gameResult || v.matchResult) {
        // v0.2.1 #12: tutorial scoring screens wait for the player's Next.
        match.tutorialAdvance();
        continue;
      }
      const g = 'ESWN'.indexOf(v.gameNumber[0]) === 0 ? Number(v.gameNumber[1]) - 1 : -1;
      if (g !== game) {
        game = g;
        steps = stepsForGame(game);
      }
      if (steps.length > 0 && steps[0].when(v)) {
        const step = steps.shift()!;
        match.handleAction('learner', step.action(v));
      }
    }
    match.dispose();
    expect(record).not.toBeNull();
    const rec = record! as MatchRecord;
    expect(rec.games).toHaveLength(4);

    // The tutorial player (start seat 0) wins every game; rigged walls carry
    // no seed.
    const playerSeats = [0, 3, 2, 1]; // current seat of start-East per game
    const values = [1, 130, 40, 160];
    rec.games.forEach((g, gi) => {
      expect(g.seed).toBeUndefined();
      expect(g.result.winnerSeat).toBe(playerSeats[gi]);
      expect(g.result.value).toBe(values[gi]);
    });

    // Game 1: chicken hand on ChickenBot1's C8, after the taught Pung + Chow.
    const g0 = rec.games[0];
    expect(g0.result.patterns?.map((p) => p.id)).toEqual(['chicken']);
    expect(findMove(g0.moves, (m) => m.seat === 1 && m.part1.t === 'drawAndDiscard' && m.part1.tile === 'D1')).toBeDefined();
    expect(findMove(g0.moves, (m) => m.seat === 0 && m.part1.t === 'pung' && m.part1.tile === 'D1')).toBeDefined();
    expect(findMove(g0.moves, (m) => m.seat === 3 && m.part1.t === 'drawAndDiscard' && m.part1.tile === 'B2')).toBeDefined();
    expect(findMove(g0.moves, (m) => m.seat === 0 && m.part1.t === 'chow' && m.part1.tile === 'B2')).toBeDefined();
    expect(findMove(g0.moves, (m) => m.seat === 0 && m.part1.t === 'mahjongDiscard' && m.part1.tile === 'C8')).toBeDefined();
    // All three opponents paid the 1-point hand equally.
    expect(g0.result.deltas).toEqual([3, -1, -1, -1]);

    // Game 2: Pung over ChickenBot3's Chow, three Kongs, win on the kong
    // replacement (130 self-drawn).
    const g1 = rec.games[1];
    const ids1 = g1.result.patterns?.map((p) => p.id) ?? [];
    expect(ids1).toContain('4.3.3'); // Three Kong
    expect(ids1).toContain('9.2'); // Win on Kong
    expect(findMove(g1.moves, (m) => m.seat === 3 && m.part1.t === 'pung' && m.part1.tile === 'B9')).toBeDefined();
    expect(findMove(g1.moves, (m) => m.seat === 2 && m.part1.t === 'draw' && m.part1.tile === 'B8' && m.part2?.t === 'discard' && m.part2.tile === 'E ')).toBeDefined();
    expect(findMove(g1.moves, (m) => m.seat === 2 && m.part1.t === 'draw' && m.part1.tile === 'B7' && m.part2?.t === 'discard' && m.part2.tile === 'D5')).toBeDefined();
    expect(findMove(g1.moves, (m) => m.seat === 3 && m.part2?.t === 'kong' && m.part2.tile === 'C4')).toBeDefined();
    expect(findMove(g1.moves, (m) => m.seat === 3 && m.part1.t === 'bigKong' && m.part1.tile === 'S ')).toBeDefined();
    expect(findMove(g1.moves, (m) => m.seat === 3 && m.part2?.t === 'kong' && m.part2.tile === 'B9')).toBeDefined();
    expect(findMove(g1.moves, (m) => m.seat === 3 && m.part2?.t === 'mahjong' && m.part2.tile === 'D1')).toBeDefined();
    expect(g1.result.deltas).toEqual([-130, -130, -130, 390]);

    // Game 3: exactly Mixed One-Suit (40), won on ChickenBot3's B6 discard;
    // the discarder shoulders the above-par balance (25/25/70).
    const g2 = rec.games[2];
    expect(g2.result.patterns?.map((p) => p.id)).toEqual(['2.1.1']);
    expect(findMove(g2.moves, (m) => m.seat === 2 && m.part1.t === 'pung' && m.part1.tile === 'E ')).toBeDefined();
    expect(g2.result.responsibleSeat).toBe(1);
    expect(g2.result.deltas).toEqual([-25, -70, 120, -25]);

    // Game 4: Thirteen Terminals, self-drawn C1 (160 × 3).
    const g3 = rec.games[3];
    expect(g3.result.patterns?.map((p) => p.id)).toEqual(['10.1']);
    expect(findMove(g3.moves, (m) => m.seat === 1 && m.part2?.t === 'mahjong' && m.part2.tile === 'C1')).toBeDefined();
    expect(g3.result.deltas).toEqual([-160, 480, -160, -160]);

    // Final score: 3 + 390 + 120 + 480 = 993 for the player.
    expect(rec.finalScores[0]).toBe(993);
  }, 90000);
});
