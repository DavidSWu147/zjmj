import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mulberry32 } from '../../shared/src/tiles';
import { GameView, RoomSettings } from '../../shared/src/protocol';
import { MatchRecord, matchFromTxt, matchToTxt, replayGame } from '../../shared/src/records';
import { Match } from '../src/match';
import { Db } from '../src/db';
import { computeStats } from '../src/api';

const FAST = { dealMs: 1, botDelayMs: 0, claimGapMs: 1, resultMs: 1, matchEndMs: 1 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function settings(rounds: 1 | 2 | 4, extra: Partial<RoomSettings> = {}): RoomSettings {
  return { rounds, thinkingTime: 15, chickenHand: 'one', par: 25, ...extra };
}

/**
 * Drives a match with four greedy players (kongs, claims, wins) until it
 * finishes; the strategy only reads each player's own GameView.
 */
async function runGreedyMatch(
  s: RoomSettings,
  wallSeed: number,
  choiceSeed: number,
): Promise<MatchRecord> {
  const rng = mulberry32(choiceSeed);
  let record: MatchRecord | null = null;
  const views = new Map<string, GameView>();
  const ids = ['a', 'b', 'c', 'd'];

  const match = new Match(
    s,
    ids.map((id) => ({ id, name: `P-${id}`, isBot: false })),
    {
      sendView: (pid, view) => views.set(pid, view),
      isConnected: () => true,
      onMatchEnd: (r) => {
        record = r;
      },
      rng: mulberry32(wallSeed),
      timing: FAST,
    },
  );
  match.start();

  const acted = new Set<string>();
  const deadlineAt = Date.now() + 60000;
  while (!record && Date.now() < deadlineAt) {
    await sleep(2);
    for (const pid of ids) {
      const v = views.get(pid);
      if (!v) continue;
      const key = `${pid}:${v.gameNumber}:${JSON.stringify([v.phase, v.turnSeat, v.remaining, v.myOptions, v.pendingClaim, v.myHand, v.myDrawn])}`;
      if (acted.has(key)) continue;
      const o = v.myOptions;
      if (v.phase === 'preDiscard' && o.discard && !v.pendingClaim) {
        acted.add(key);
        if (o.mahjong) {
          match.handleAction(pid, { kind: 'mahjong' });
        } else if (o.kongs && o.kongs.length > 0 && rng() < 0.8) {
          match.handleAction(pid, { kind: 'kong', ...o.kongs[0] });
        } else {
          const tile = pickDiscard(v.myHand, v.myDrawn);
          match.handleAction(pid, {
            kind: 'discard',
            tile,
            fromDrawn: tile === v.myDrawn,
          });
        }
      } else if ((v.phase === 'postDiscard' || v.phase === 'robbing') && o.claim && !v.pendingClaim) {
        acted.add(key);
        const c = o.claim;
        if (c.mahjong) match.handleAction(pid, { kind: 'claim', claim: 'mahjong' });
        else if (c.kong && rng() < 0.7) match.handleAction(pid, { kind: 'claim', claim: 'kong' });
        else if (c.pung && rng() < 0.7) match.handleAction(pid, { kind: 'claim', claim: 'pung' });
        else if (c.chows && c.chows.length > 0 && rng() < 0.7) {
          match.handleAction(pid, { kind: 'claim', claim: 'chow', chowLow: c.chows[0] });
        } else if (Object.keys(c).length > 0) {
          match.handleAction(pid, { kind: 'claim', claim: 'pass' });
        }
      } else if (v.phase === 'postDiscard' && v.pendingClaim && o.discard) {
        acted.add(key);
        if (o.kongs && o.kongs.length > 0 && rng() < 0.5) {
          match.handleAction(pid, { kind: 'kong', ...o.kongs[0] });
        } else {
          const tile = pickDiscard(v.myHand, null);
          match.handleAction(pid, { kind: 'discard', tile, fromDrawn: false });
        }
      }
    }
  }
  match.dispose();
  expect(record).not.toBeNull();
  return record!;
}

/** Discard the loneliest tile: keeps pairs/triplets and near-sequences. */
function pickDiscard(hand: string[], drawn: string | null): string {
  const pool = drawn !== null ? [...hand, drawn] : [...hand];
  const idx = (t: string) => {
    const suits: Record<string, number> = { B: 0, C: 1, D: 2 };
    if (t[1] !== ' ') return suits[t[0]] * 9 + Number(t[1]) - 1;
    return 27 + ['E ', 'S ', 'W ', 'N ', 'R ', 'G ', 'O '].indexOf(t);
  };
  let worst = pool[0];
  let worstScore = Infinity;
  for (const t of pool) {
    const ti = idx(t);
    let score = 0;
    for (const u of pool) {
      if (u === t) score += 3;
      else if (ti < 27 && Math.floor(idx(u) / 9) === Math.floor(ti / 9)) {
        const d = Math.abs(idx(u) - ti);
        if (d === 1) score += 2;
        else if (d === 2) score += 1;
      }
    }
    if (score < worstScore) {
      worstScore = score;
      worst = t;
    }
  }
  return worst;
}

describe('match simulation', () => {
  it('plays a full bots-only match to completion (all draws)', async () => {
    let record: MatchRecord | null = null;
    const match = new Match(
      settings(1),
      [{ id: 'p1', name: 'Solo', isBot: false }],
      {
        sendView: () => {},
        isConnected: () => false, // the lone human is gone: bots drive everything
        onMatchEnd: (r) => {
          record = r;
        },
        rng: mulberry32(7),
        timing: FAST,
      },
    );
    match.start();
    for (let i = 0; i < 4000 && !record; i++) await sleep(5);
    expect(record).not.toBeNull();
    const rec = record! as MatchRecord;
    expect(rec.games).toHaveLength(4);
    // Dummy bots never claim or win: every game is a draw with 70 draws.
    for (const g of rec.games) {
      expect(g.result.winnerSeat).toBeNull();
      expect(g.moves.filter((m) => m.part1.t === 'draw' || m.part1.t === 'drawAndDiscard')).toHaveLength(70);
      const steps = replayGame(g);
      expect(steps).toHaveLength(g.moves.length + 1);
    }
    expect(rec.finalScores).toEqual([0, 0, 0, 0]);
    const txt = matchToTxt(rec);
    expect(txt).toContain('Match ID:');
    expect(txt).toContain('Thinking Time: 15');
    expect(txt).toContain('Chicken Hand: 1');
    expect(txt).toContain('Par Score: 25');
    expect(txt.match(/ENDGAME/g)).toHaveLength(4);
    match.dispose();
  }, 30000);

  it('plays a match with four greedy players (claims, kongs, wins)', async () => {
    const rec = await runGreedyMatch(settings(2), 99, 2024);
    expect(rec.games).toHaveLength(8);
    expect(rec.finalScores.reduce((a, b) => a + b, 0)).toBe(0);

    let wins = 0;
    for (const g of rec.games) {
      if (g.result.winnerSeat !== null) {
        wins++;
        expect(g.result.deltas.reduce((a, b) => a + b, 0)).toBe(0);
        expect((g.result.value ?? 0)).toBeGreaterThanOrEqual(1);
        expect(g.result.patterns!.length).toBeGreaterThan(0);
      }
      // Every recorded game must replay cleanly.
      const steps = replayGame(g);
      expect(steps).toHaveLength(g.moves.length + 1);
    }
    // Greedy players should win at least one game across 8.
    expect(wins).toBeGreaterThan(0);

    const txt = matchToTxt(rec);
    expect(txt.match(/ENDGAME/g)).toHaveLength(8);
    // Winning games list their patterns and score before ENDGAME.
    expect(txt.match(/^SCORE: \d+$/gm)?.length).toBe(wins);

    // The .txt round-trips through the upload parser: same games, moves,
    // hands and results, and every parsed game still replays cleanly.
    const parsed = matchFromTxt(txt);
    expect(parsed.matchId).toBe(rec.matchId);
    // The parser makes the optional settings explicit ('original'/'none').
    expect(parsed.settings).toEqual({ scoring: 'original', bonusTiles: 'none', ...rec.settings });
    expect(parsed.players.map((p) => p.name)).toEqual(rec.players.map((p) => p.name));
    expect(parsed.games).toHaveLength(rec.games.length);
    parsed.games.forEach((g, gi) => {
      const orig = rec.games[gi];
      expect(g.gameNumber).toBe(orig.gameNumber);
      expect(g.startingHands).toEqual(orig.startingHands);
      expect(g.moves).toEqual(orig.moves);
      expect(g.result.winnerSeat).toBe(orig.result.winnerSeat);
      if (orig.result.winnerSeat !== null) {
        expect(g.result.winBy).toBe(orig.result.winBy);
        expect(g.result.value).toBe(orig.result.value);
        expect(g.result.responsibleSeat).toBe(orig.result.responsibleSeat ?? null);
      }
      expect(replayGame(g)).toHaveLength(g.moves.length + 1);
    });

    // Persistence + stats round-trip on the finished match.
    const db = new Db(path.join(mkdtempSync(path.join(tmpdir(), 'zjmj-')), 'test.db'));
    db.saveMatch(rec);
    const list = db.listMatches('a');
    expect(list).toHaveLength(1);
    expect(list[0].matchId).toBe(rec.matchId);
    expect(db.getMatch(rec.matchId)?.games).toHaveLength(8);

    // Per-player deletion hides the record for that player only.
    expect(db.deleteMatchFor('a', rec.matchId)).toBe(true);
    expect(db.listMatches('a')).toHaveLength(0);
    expect(db.listMatches('b')).toHaveLength(1);
    expect(db.getMatch(rec.matchId)).not.toBeNull();
    expect(db.deleteMatchFor('nobody', rec.matchId)).toBe(false);

    const stats = computeStats(db, 'a');
    expect(stats.games.total).toBe(8);
    const totalWins = rec.games.filter(
      (g, gi) => g.result.winnerSeat !== null && rec.players[(g.result.winnerSeat + gi) % 4].id === 'a',
    ).length;
    expect(stats.games.wins).toBe(totalWins);
    const played = stats.matches.played['1'] + stats.matches.played['2'] + stats.matches.played['4'];
    expect(played).toBe(1);
    db.close();
  }, 90000);

  it('plays a bonus-tile match (flowers revealed, replaced, and scored)', async () => {
    const rec = await runGreedyMatch(
      settings(1, { bonusTiles: 'full', scoring: 'adjustedExtra' }),
      7,
      31,
    );
    expect(rec.games).toHaveLength(4);
    expect(rec.finalScores.reduce((a, b) => a + b, 0)).toBe(0);

    // Starting-hand bonus: "BONUS F1, DRAW x" (part1); drawn mid-turn:
    // "DRAW F1, BONUS F1" (part2), replacement on the next line.
    const bonusCount = (g: (typeof rec.games)[number]) =>
      g.moves.filter((m) => m.part1.t === 'bonus' || m.part2?.t === 'bonus').length;
    let bonusMoves = 0;
    for (const g of rec.games) {
      bonusMoves += bonusCount(g);
      // Every recorded game must replay cleanly, bonus moves included.
      const steps = replayGame(g);
      expect(steps).toHaveLength(g.moves.length + 1);
      const last = steps[steps.length - 1];
      // Replay accumulates exactly the revealed bonus tiles, all distinct.
      const replayedBonus = last.bonus.flat();
      expect(replayedBonus).toHaveLength(bonusCount(g));
      expect(new Set(replayedBonus).size).toBe(replayedBonus.length);
      expect(replayedBonus.every((t) => t[0] === 'F' || t[0] === 'A')).toBe(true);
      // Bonus tiles never end up in a replayed hand.
      for (const hand of last.hands) {
        expect(hand.some((t) => t[0] === 'F' || t[0] === 'A')).toBe(false);
      }
    }
    // 8 bonus tiles among 128 visible positions: some games must reveal them.
    expect(bonusMoves).toBeGreaterThan(0);

    const txt = matchToTxt(rec);
    expect(txt).toContain('Bonus Tiles: 2');
    expect(txt).toContain('Scoring: 2');
    if (bonusMoves > 0) expect(txt).toContain('BONUS ');

    // Bonus moves (both the part1 and part2 forms) round-trip through the
    // upload parser.
    const parsed = matchFromTxt(txt);
    expect(parsed.settings).toEqual(rec.settings);
    parsed.games.forEach((g, gi) => {
      expect(g.moves).toEqual(rec.games[gi].moves);
      expect(replayGame(g)).toHaveLength(g.moves.length + 1);
    });
  }, 90000);

  it('supports spectators: censored views, seat switching, cap of 4', async () => {
    const views = new Map<string, GameView>();
    const match = new Match(
      settings(1),
      [{ id: 'p1', name: 'Solo', isBot: false }],
      {
        sendView: (pid, view) => views.set(pid, view),
        isConnected: (pid) => pid === 'p1',
        onMatchEnd: () => {},
        rng: mulberry32(11),
        timing: FAST,
      },
    );
    match.start();
    await sleep(20); // past dealMs: game E1 is under way

    // Players cannot watch their own match; watchers join up to the cap.
    expect(match.addSpectator('p1')).toBe('You are playing in this match.');
    expect(match.addSpectator('s1')).toBeNull();
    expect(match.addSpectator('s2')).toBeNull();
    expect(match.addSpectator('s3')).toBeNull();
    expect(match.addSpectator('s4')).toBeNull();
    expect(match.addSpectator('s5')).toBe('Spectator limit reached (4).');
    expect(match.addSpectator('s1')).toBeNull(); // re-watching is idempotent
    expect(match.spectatorCount).toBe(4);
    expect(match.hasSpectator('s1')).toBe(true);

    // The spectator view carries only public information.
    const v = views.get('s1')!;
    expect(v.spectator).toBe(true);
    expect(v.mySeat).toBe(0); // default perspective: starting East (game E1)
    expect(v.myHand).toEqual([]);
    expect(v.myDrawn).toBeNull();
    expect(v.myOptions).toEqual({});
    expect(v.pendingClaim).toBeNull();
    expect(v.selected).toBeNull();
    // Public counts are intact (13 concealed + possibly a drawn flag).
    expect(v.seats[v.mySeat].handCount).toBe(13);

    // Broadcasts reach spectators too.
    views.delete('s1');
    match.broadcast();
    expect(views.get('s1')!.spectator).toBe(true);

    // Perspective switch by current seat.
    match.setSpectatorSeat('s1', 2);
    expect(views.get('s1')!.mySeat).toBe(2);

    match.removeSpectator('s1');
    expect(match.spectatorCount).toBe(3);
    views.delete('s1');
    match.broadcast();
    expect(views.has('s1')).toBe(false);

    match.dispose();
  });

  it('ends in an immediate draw when the seabed tile is a bonus tile', async () => {
    // Wall seed 2 makes game E1's final live draw a bonus tile for dummy
    // bots (found by simulating the wall consumption, including the match's
    // 3-draw seat shuffle).
    let record: MatchRecord | null = null;
    const match = new Match(
      settings(1, { bonusTiles: 'full' }),
      [{ id: 'p1', name: 'Solo', isBot: false }],
      {
        sendView: () => {},
        isConnected: () => false, // all seats bot-driven
        onMatchEnd: (r) => {
          record = r;
        },
        rng: mulberry32(2),
        timing: FAST,
      },
    );
    match.start();
    for (let i = 0; i < 4000 && !record; i++) await sleep(5);
    match.dispose();
    expect(record).not.toBeNull();

    const g = (record! as MatchRecord).games[0];
    expect(g.result.winnerSeat).toBeNull();
    // The game ends ON the bonus reveal: "DRAW Fx, BONUS Fx" is the final
    // move, with no replacement draw and no chance for the drawer to act.
    const last = g.moves[g.moves.length - 1];
    expect(last.part2?.t).toBe('bonus');
    // Every wall tile is accounted for: 76 live-counter consumptions across
    // draws, starting-hand replacements, and mid-turn bonus reveals.
    const consumptions = g.moves.filter(
      (m) =>
        m.part1.t === 'draw' ||
        m.part1.t === 'drawAndDiscard' ||
        m.part1.t === 'bonus',
    ).length;
    expect(consumptions).toBe(76);
    expect(replayGame(g)).toHaveLength(g.moves.length + 1);
  }, 30000);
});
