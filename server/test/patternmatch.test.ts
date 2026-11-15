import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../shared/src/tiles';
import { MatchRecord } from '../../shared/src/records';
import { BotDifficulty, RoomSettings } from '../../shared/src/protocol';
import { Match } from '../src/match';

const FAST = { dealMs: 1, botDelayMs: 0, claimGapMs: 1, resultMs: 1, matchEndMs: 1 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runMatch(
  kind: BotDifficulty,
  chickenHand: RoomSettings['chickenHand'],
  seed: number,
): Promise<MatchRecord> {
  const settings: RoomSettings = { rounds: 1, thinkingTime: 15, chickenHand, par: 25 };
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
    kind,
  );
  match.start();
  for (let i = 0; i < 16000 && !record; i++) await sleep(5);
  match.dispose();
  expect(record).not.toBeNull();
  return record!;
}

function wins(rec: MatchRecord) {
  return rec.games.filter((g) => g.result.winnerSeat !== null).map((g) => g.result);
}

describe('pattern bot match simulation', () => {
  it('TrivialBots finish a match and win with Chicken Hand not allowed', async () => {
    const rec = await runMatch('trivial', 'notAllowed', 42);
    expect(rec.players.map((p) => p.name).sort()).toEqual([
      'TrivialBot1',
      'TrivialBot2',
      'TrivialBot3',
      'TrivialBot4',
    ]);
    expect(rec.games).toHaveLength(4);
    expect(rec.finalScores.reduce((a, b) => a + b, 0)).toBe(0);
    const w = wins(rec);
    expect(w.length).toBeGreaterThanOrEqual(3);
    for (const r of w) expect((r.patterns ?? []).some((p) => p.id !== 'chicken')).toBe(true);
  }, 90_000);

  it('TrivialBots avoid chicken hands even when they are allowed', async () => {
    const rec = await runMatch('trivial', 'one', 7);
    const w = wins(rec);
    expect(w.length).toBeGreaterThanOrEqual(3);
    for (const r of w) expect((r.patterns ?? []).some((p) => p.id !== 'chicken')).toBe(true);
  }, 90_000);

  it('StandardBots finish a match with claims and wins', async () => {
    const rec = await runMatch('standard', 'one', 42);
    expect(rec.players.map((p) => p.name).sort()).toEqual([
      'StandardBot1',
      'StandardBot2',
      'StandardBot3',
      'StandardBot4',
    ]);
    expect(rec.games).toHaveLength(4);
    expect(rec.finalScores.reduce((a, b) => a + b, 0)).toBe(0);
    expect(wins(rec).length).toBeGreaterThanOrEqual(2);
  }, 90_000);
});

describe('BotMedley seating', () => {
  const seat = (humans: number, seed: number): string[] => {
    const match = new Match(
      { rounds: 1, thinkingTime: 15, chickenHand: 'one', par: 25 },
      Array.from({ length: humans }, (_, i) => ({ id: `h${i}`, name: `H${i}`, isBot: false })),
      { sendView: () => {}, isConnected: () => true, onMatchEnd: () => {}, rng: mulberry32(seed), timing: FAST },
      null,
      'medley',
    );
    const bots = match.players.filter((p) => p.isBot).map((p) => p.name).sort();
    match.dispose();
    return bots;
  };

  it('fills seats strongest first', () => {
    expect(seat(2, 1)).toEqual(['StandardBot1', 'TrivialBot1']);
    expect(seat(1, 1)).toEqual(['ChickenBot1', 'StandardBot1', 'TrivialBot1']);
    expect(seat(0, 1)).toEqual(['ChickenBot1', 'DummyBot1', 'StandardBot1', 'TrivialBot1']);
  });

  it('draws Trivial or Standard for a single empty seat', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const bots = seat(3, seed);
      expect(bots).toHaveLength(1);
      seen.add(bots[0]);
    }
    expect([...seen].sort()).toEqual(['StandardBot1', 'TrivialBot1']);
  });
});
