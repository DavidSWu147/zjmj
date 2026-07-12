import express from 'express';
import { isStandardSettings } from '../../shared/src/protocol';
import { matchToTxt } from '../../shared/src/records';
import { PATTERN_IDS } from '../../shared/src/scoring';
import { sessionFromRequest } from './auth';
import { Db } from './db';

export interface StatsResponse {
  patternCounts: Record<string, number>;
  matches: {
    played: Record<'1' | '2' | '4', number>;
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
    winValuesSelf: number[];
    winValuesDiscard: number[];
    dealInValues: number[];
  };
}

/**
 * Statistics over the player's matches; 'standard' counts only matches whose
 * settings match Room #0's defaults (length/thinking time aside), 'custom'
 * counts everything else (0.1.4 #7).
 */
export function computeStats(
  db: Db,
  playerId: string,
  scope: 'standard' | 'custom' = 'standard',
): StatsResponse {
  const patternCounts: Record<string, number> = {};
  for (const id of PATTERN_IDS) patternCounts[id] = 0;
  const played = { '1': 0, '2': 0, '4': 0 };
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
    winValuesSelf: [] as number[],
    winValuesDiscard: [] as number[],
    dealInValues: [] as number[],
  };

  for (const { record, startSeat, result } of db.matchesForStats(playerId)) {
    if (isStandardSettings(record.settings) !== (scope === 'standard')) continue;
    const key = String(record.matchLength) as '1' | '2' | '4';
    played[key]++;
    if (result === 'WIN') won[key]++;
    if (result === 'DRAW') drawn[key]++;

    record.games.forEach((game, gi) => {
      const mySeat = (startSeat - gi + 4 * record.games.length) % 4;
      g.total++;
      const delta = game.result.deltas[mySeat] ?? 0;
      if (delta > 0) g.pointsWon += delta;
      if (delta < 0) g.pointsLost += -delta;
      if (game.result.winnerSeat === null) {
        g.draws++;
        return;
      }
      if (game.result.winnerSeat === mySeat) {
        g.wins++;
        if (game.result.winBy === 'self') {
          g.selfDrawWins++;
          g.winValuesSelf.push(game.result.value ?? 0);
        } else {
          g.winValuesDiscard.push(game.result.value ?? 0);
        }
        for (const p of game.result.patterns ?? []) {
          if (patternCounts[p.id] !== undefined) patternCounts[p.id]++;
        }
      } else if (game.result.responsibleSeat === mySeat) {
        g.discarderCount++;
        g.dealInValues.push(game.result.value ?? 0);
      }
    });
  }

  return { patternCounts, matches: { played, won, drawn }, games: g };
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
    res.json(
      computeStats(db, session.playerId, req.query.scope === 'custom' ? 'custom' : 'standard'),
    );
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
