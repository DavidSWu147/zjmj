import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../shared/src/tiles';
import { MatchRecord, replayGame } from '../../shared/src/records';
import { RoomSettings } from '../../shared/src/protocol';
import { Match } from '../src/match';

const FAST = { dealMs: 1, botDelayMs: 0, claimGapMs: 1, resultMs: 1, matchEndMs: 1 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const settings: RoomSettings = {
  rounds: 2,
  thinkingTime: 15,
  chickenHand: 'one',
  par: 25,
};

async function runChickenMatch(seed: number): Promise<MatchRecord> {
  let record: MatchRecord | null = null;
  const match = new Match(
    settings,
    [],
    {
      sendView: () => {},
      isConnected: () => true,
      onMatchEnd: (r) => {
        record = r;
      },
      rng: mulberry32(seed),
      timing: FAST,
    },
    null,
    'chicken',
  );
  match.start();
  for (let i = 0; i < 8000 && !record; i++) await sleep(5);
  match.dispose();
  expect(record).not.toBeNull();
  return record!;
}

describe('ChickenBot match simulation', () => {
  it('plays a full ChickenBots-only match with claims and wins', async () => {
    const rec = await runChickenMatch(42);
    expect(rec.players.map((p) => p.name).sort()).toEqual([
      'ChickenBot1',
      'ChickenBot2',
      'ChickenBot3',
      'ChickenBot4',
    ]);
    expect(rec.games).toHaveLength(8);
    expect(rec.finalScores.reduce((a, b) => a + b, 0)).toBe(0);

    let wins = 0;
    let claims = 0;
    for (const g of rec.games) {
      if (g.result.winnerSeat !== null) {
        wins++;
        expect(g.result.deltas.reduce((a, b) => a + b, 0)).toBe(0);
      }
      claims += g.moves.filter((m) =>
        ['pung', 'chow', 'bigKong'].includes(m.part1.t),
      ).length;
      // Every recorded game replays cleanly, claims and kongs included.
      expect(replayGame(g)).toHaveLength(g.moves.length + 1);
    }
    // Rushing bots must convert some games — a full match of draws would
    // mean the policy never advances a hand.
    expect(wins).toBeGreaterThan(0);
    expect(claims).toBeGreaterThan(0);
  }, 90000);
});
