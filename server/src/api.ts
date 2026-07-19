import express from 'express';
import { RoomSettings } from '../../shared/src/protocol';
import { MatchRecord, matchToTxt } from '../../shared/src/records';
import { PATTERN_IDS } from '../../shared/src/scoring';
import { ACHIEVEMENTS } from '../../shared/src/achievements';
import { containsProfanity, validateDisplayName } from '../../shared/src/names';
import { sessionFromRequest } from './auth';
import { Db } from './db';
import { currentMonthPrefix, currentWeekId } from './tourney';

/** v0.2 statistics filters: 'all' or one option per gameplay setting. */
export interface StatsFilter {
  len: 'all' | '1' | '2' | '4';
  /** bot = with bots; normal = four humans, non-tournament; tournament. */
  type: 'all' | 'bot' | 'normal' | 'tournament';
  chicken: 'all' | RoomSettings['chickenHand'];
  par: 'all' | '25' | '30/25' | '30';
  scoring: 'all' | 'original' | 'adjusted' | 'adjustedExtra';
  bonus: 'all' | 'none' | 'half' | 'full';
}

export const DEFAULT_STATS_FILTER: StatsFilter = {
  len: 'all',
  type: 'all',
  chicken: 'all',
  par: 'all',
  scoring: 'all',
  bonus: 'all',
};

export interface StatsResponse {
  patternCounts: Record<string, number>;
  matches: {
    played: Record<'1' | '2' | '4', number>;
    finished: Record<'1' | '2' | '4', number>;
    won: Record<'1' | '2' | '4', number>;
    drawn: Record<'1' | '2' | '4', number>;
  };
  games: {
    total: number;
    pointsWon: number;
    pointsLost: number;
    draws: number;
    selfDrawWins: number;
    wins: number;
    discarderCount: number;
    /** Games an opponent won by (effective) self-draw (v0.2). */
    lostBySelfDraw: number;
    winValuesSelf: number[];
    winValuesDiscard: number[];
    dealInValues: number[];
    /** Live-wall tiles left at game end, summed over games / my wins (v0.2). */
    remainingSum: number;
    remainingCount: number;
    remainingWinsSum: number;
    remainingWinsCount: number;
  };
}

function matchesFilter(record: MatchRecord, f: StatsFilter): boolean {
  const s = record.settings;
  if (f.len !== 'all' && String(s.rounds) !== f.len) return false;
  if (f.chicken !== 'all' && s.chickenHand !== f.chicken) return false;
  if (f.par !== 'all' && String(s.par) !== f.par) return false;
  if (f.scoring !== 'all' && (s.scoring ?? 'original') !== f.scoring) return false;
  if (f.bonus !== 'all' && (s.bonusTiles ?? 'none') !== f.bonus) return false;
  if (f.type !== 'all') {
    const tournament = !!record.tournamentWeek;
    const hasBots = record.players.some((p) => p.isBot);
    const type = tournament ? 'tournament' : hasBots ? 'bot' : 'normal';
    if (type !== f.type) return false;
  }
  return true;
}

/**
 * Statistics over the player's matches, restricted to those matching the
 * filter (v0.2). Abandoned participations count toward Matches Played only;
 * game-level statistics come from finished participations. The responsible
 * discarder is the responsible party; wins with no responsible party
 * (same-round immunity, Blessing of Earth) count as self-drawn wins and as
 * nobody dealing in.
 */
export function computeStats(
  db: Db,
  playerId: string,
  filter: StatsFilter = DEFAULT_STATS_FILTER,
): StatsResponse {
  const patternCounts: Record<string, number> = {};
  for (const id of PATTERN_IDS) patternCounts[id] = 0;
  const played = { '1': 0, '2': 0, '4': 0 };
  const finished = { '1': 0, '2': 0, '4': 0 };
  const won = { '1': 0, '2': 0, '4': 0 };
  const drawn = { '1': 0, '2': 0, '4': 0 };
  const g = {
    total: 0,
    pointsWon: 0,
    pointsLost: 0,
    draws: 0,
    selfDrawWins: 0,
    wins: 0,
    discarderCount: 0,
    lostBySelfDraw: 0,
    winValuesSelf: [] as number[],
    winValuesDiscard: [] as number[],
    dealInValues: [] as number[],
    remainingSum: 0,
    remainingCount: 0,
    remainingWinsSum: 0,
    remainingWinsCount: 0,
  };

  for (const { record, startSeat, result, abandoned } of db.matchesForStats(playerId)) {
    if (!matchesFilter(record, filter)) continue;
    const key = String(record.matchLength) as '1' | '2' | '4';
    played[key]++;
    if (abandoned) continue; // played, but not finished: no further stats
    finished[key]++;
    if (result === 'WIN') won[key]++;
    if (result === 'DRAW') drawn[key]++;

    record.games.forEach((game, gi) => {
      const mySeat = (startSeat - gi + 4 * record.games.length) % 4;
      g.total++;
      const delta = game.result.deltas[mySeat] ?? 0;
      if (delta > 0) g.pointsWon += delta;
      if (delta < 0) g.pointsLost += -delta;
      if (game.remaining !== undefined) {
        g.remainingSum += game.remaining;
        g.remainingCount++;
      }
      if (game.result.winnerSeat === null) {
        g.draws++;
        return;
      }
      // No responsible party (same-round immunity, Blessing of Earth):
      // treated as a self-drawn win, with nobody having dealt in (v0.2).
      const effSelf = game.result.winBy === 'self' || game.result.responsibleSeat == null;
      if (game.result.winnerSeat === mySeat) {
        g.wins++;
        if (game.remaining !== undefined) {
          g.remainingWinsSum += game.remaining;
          g.remainingWinsCount++;
        }
        if (effSelf) {
          g.selfDrawWins++;
          g.winValuesSelf.push(game.result.value ?? 0);
        } else {
          g.winValuesDiscard.push(game.result.value ?? 0);
        }
        for (const p of game.result.patterns ?? []) {
          if (patternCounts[p.id] !== undefined) patternCounts[p.id]++;
        }
      } else {
        if (effSelf) g.lostBySelfDraw++;
        if (game.result.responsibleSeat === mySeat) {
          g.discarderCount++;
          g.dealInValues.push(game.result.value ?? 0);
        }
      }
    });
  }

  return { patternCounts, matches: { played, finished, won, drawn }, games: g };
}

export function makeApi(db: Db): express.Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Stats and record lists belong to the session owner; no more per-id URLs.
  router.get('/stats', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    // v0.2 filters: each query param must be one of its known options;
    // anything else falls back to 'all'.
    const pick = <K extends keyof StatsFilter>(key: K, options: string[]): StatsFilter[K] => {
      const v = req.query[key];
      return (typeof v === 'string' && options.includes(v) ? v : 'all') as StatsFilter[K];
    };
    const filter: StatsFilter = {
      len: pick('len', ['1', '2', '4']),
      type: pick('type', ['bot', 'normal', 'tournament']),
      chicken: pick('chicken', ['notAllowed', 'zero', 'one']),
      par: pick('par', ['25', '30/25', '30']),
      scoring: pick('scoring', ['original', 'adjusted', 'adjustedExtra']),
      bonus: pick('bonus', ['none', 'half', 'full']),
    };
    res.json(computeStats(db, session.playerId, filter));
  });

  /**
   * Starts a fresh statistics epoch. Matches stay in the archive (Records is
   * unaffected); the Statistics page simply counts from this moment on.
   */
  router.post('/stats/reset', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    db.resetStats(session.playerId);
    res.json({ ok: true });
  });

  /**
   * Weekly Tournament leaderboards (v0.2): Rank Points totals for the
   * current week (starts Saturday midnight UTC-7), the current calendar
   * month, and all time. Guests may view; only registered users appear.
   */
  router.get('/leaderboards', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json({
      week: currentWeekId(),
      month: currentMonthPrefix(),
      weekly: db.leaderboard({ week: currentWeekId() }),
      monthly: db.leaderboard({ monthPrefix: currentMonthPrefix() }),
      allTime: db.leaderboard({}),
    });
  });

  /**
   * A past week's or month's leaderboard (v0.2.2 #9). `week` is a Saturday
   * 'YYYY-MM-DD' week id, `month` a 'YYYY-MM' prefix; exactly one is given.
   */
  router.get('/leaderboards/past', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    const week = typeof req.query.week === 'string' ? req.query.week : null;
    const month = typeof req.query.month === 'string' ? req.query.month : null;
    if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
      res.json({ rows: db.leaderboard({ week }) });
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      res.json({ rows: db.leaderboard({ monthPrefix: month }) });
    } else {
      res.status(400).json({ error: 'Pass week=YYYY-MM-DD or month=YYYY-MM.' });
    }
  });

  /** The achievement catalogue with this player's earned timestamps (v0.2). */
  router.get('/achievements', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    const earned = new Map(
      db.achievementsFor(session.playerId).map((a) => [a.achievementId, a.earnedAt]),
    );
    res.json({
      registered: session.kind === 'account',
      achievements: ACHIEVEMENTS.map((a) => ({
        ...a,
        earnedAt: earned.get(a.id) ?? null,
      })),
    });
  });

  /**
   * Registered users set a display name distinct from the username
   * (v0.2.1 #14). Charset/length violations are rejected; profanity is
   * silently replaced with "---" (#16). The client re-hellos to adopt it.
   */
  router.post('/profile/name', express.json(), (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (session.kind !== 'account') {
      res.status(400).json({ error: 'Guests set their display name from the sign-in dialog.' });
      return;
    }
    const raw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const bad = validateDisplayName(raw);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
    const name = containsProfanity(raw) ? '---' : raw;
    db.setDisplayName(session.playerId, name);
    res.json({ name });
  });

  router.get('/records', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json(db.listMatches(session.playerId));
  });

  /** Removes the match from the session owner's Records list only. */
  router.delete('/record/:matchId', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (!db.deleteMatchFor(session.playerId, Number(req.params.matchId))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.get('/record/:matchId', (req, res) => {
    const rec = db.getMatch(Number(req.params.matchId));
    if (!rec) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(rec);
  });

  router.get('/record/:matchId/txt', (req, res) => {
    const rec = db.getMatch(Number(req.params.matchId));
    if (!rec) {
      res.status(404).send('not found');
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="zjmj-match-${rec.matchId}.txt"`,
    );
    res.send(matchToTxt(rec));
  });

  return router;
}
