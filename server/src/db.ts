import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { broadAbandoned, MatchRecord } from '../../shared/src/records';

// node:sqlite is a prefix-only builtin that some bundlers fail to recognize;
// loading it via createRequire keeps vitest/vite/esbuild all happy.
const require = createRequire(import.meta.url);
const { DatabaseSync: SqliteDatabase } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSync;
};

export interface Session {
  token: string;
  playerId: string;
  kind: 'guest' | 'account';
  username: string | null;
  deviceId: string | null;
}

interface SessionRow {
  token: string;
  player_id: string;
  kind: string;
  username: string | null;
  device_id: string | null;
}

export interface MatchListEntry {
  matchId: number;
  createdAt: number;
  matchLength: number;
  players: { name: string; isBot: boolean }[];
  finalScores: number[];
  mySeat: number;
  myScore: number;
  myResult: 'WIN' | 'LOSE' | 'DRAW';
}

export class Db {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new SqliteDatabase(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        match_length INTEGER NOT NULL,
        record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL REFERENCES matches(id),
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        start_seat INTEGER NOT NULL,
        final_score INTEGER NOT NULL,
        result TEXT NOT NULL,
        abandoned INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, start_seat)
      );
      CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        username TEXT,
        device_id TEXT,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
      CREATE TABLE IF NOT EXISTS player_meta (
        player_id TEXT PRIMARY KEY,
        stats_reset_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tournament_results (
        week TEXT NOT NULL,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rank_points INTEGER NOT NULL DEFAULT 0,
        left_early INTEGER NOT NULL DEFAULT 0,
        match_id INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (week, player_id)
      );
      CREATE TABLE IF NOT EXISTS achievements (
        player_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        earned_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, achievement_id)
      );
    `);
    // v0.1.3: per-player record deletion hides the row from that player's
    // Records list (the match itself stays for the other participants).
    const mpCols = this.db.prepare('PRAGMA table_info(match_players)').all() as { name: string }[];
    if (!mpCols.some((c) => c.name === 'hidden')) {
      this.db.exec('ALTER TABLE match_players ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
    }
    // v0.2.1 #14: registered users may set a display name distinct from
    // their username.
    const pmCols = this.db.prepare('PRAGMA table_info(player_meta)').all() as { name: string }[];
    if (!pmCols.some((c) => c.name === 'display_name')) {
      this.db.exec('ALTER TABLE player_meta ADD COLUMN display_name TEXT');
    }
    // v0.2 part 2 (spec): records and statistics start fresh — the record
    // format changed too much (seeds, player types, broad-abandoned flags).
    // One-time wipe; achievements and tournament rank points are untouched.
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version < 1) {
      this.db.exec('DELETE FROM match_players; DELETE FROM matches;');
      this.db.exec('PRAGMA user_version = 1');
    }
    // Prune sessions idle for half a year so the table cannot grow forever.
    this.db
      .prepare('DELETE FROM sessions WHERE last_seen < ?')
      .run(Date.now() - 180 * 24 * 3600 * 1000);
  }

  createSession(s: {
    token: string;
    playerId: string;
    kind: 'guest' | 'account';
    username: string | null;
    deviceId: string | null;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (token, player_id, kind, username, device_id, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.token, s.playerId, s.kind, s.username, s.deviceId, now, now);
  }

  getSession(token: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as
      | SessionRow
      | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
    return {
      token: row.token,
      playerId: row.player_id,
      kind: row.kind as 'guest' | 'account',
      username: row.username,
      deviceId: row.device_id,
    };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  /** Deletes every session of a player except `keepToken`; returns their tokens. */
  deleteSessionsFor(playerId: string, keepToken: string | null = null): string[] {
    const rows = this.db
      .prepare('SELECT token FROM sessions WHERE player_id = ?')
      .all(playerId) as { token: string }[];
    const dropped = rows.map((r) => r.token).filter((t) => t !== keepToken);
    for (const t of dropped) this.deleteSession(t);
    return dropped;
  }

  /**
   * Re-keys a player's data (guest→account carry-over, password-change
   * recreation, and v0.0 guest ids meeting their PlayFab id). Idempotent.
   */
  migratePlayerId(from: string, to: string): void {
    if (from === to) return;
    this.db.prepare('UPDATE match_players SET player_id = ? WHERE player_id = ?').run(to, from);
    this.db.prepare('UPDATE sessions SET player_id = ? WHERE player_id = ?').run(to, from);
    this.db
      .prepare('UPDATE OR REPLACE player_meta SET player_id = ? WHERE player_id = ?')
      .run(to, from);
    this.db
      .prepare('UPDATE OR REPLACE tournament_results SET player_id = ? WHERE player_id = ?')
      .run(to, from);
    this.db
      .prepare('UPDATE OR REPLACE achievements SET player_id = ? WHERE player_id = ?')
      .run(to, from);
  }

  /** Statistics count only matches finished after this epoch (0 = everything). */
  statsResetAt(playerId: string): number {
    const row = this.db
      .prepare('SELECT stats_reset_at FROM player_meta WHERE player_id = ?')
      .get(playerId) as { stats_reset_at: number } | undefined;
    return row?.stats_reset_at ?? 0;
  }

  /** The stored display name, or null (fall back to the username). */
  getDisplayName(playerId: string): string | null {
    const row = this.db
      .prepare('SELECT display_name FROM player_meta WHERE player_id = ?')
      .get(playerId) as { display_name: string | null } | undefined;
    return row?.display_name ?? null;
  }

  setDisplayName(playerId: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO player_meta (player_id, display_name) VALUES (?, ?)
         ON CONFLICT(player_id) DO UPDATE SET display_name = excluded.display_name`,
      )
      .run(playerId, name);
  }

  resetStats(playerId: string): void {
    this.db
      .prepare(
        `INSERT INTO player_meta (player_id, stats_reset_at) VALUES (?, ?)
         ON CONFLICT(player_id) DO UPDATE SET stats_reset_at = excluded.stats_reset_at`,
      )
      .run(playerId, Date.now());
  }

  saveMatch(record: MatchRecord): void {
    const insMatch = this.db.prepare(
      'INSERT OR REPLACE INTO matches (id, created_at, match_length, record) VALUES (?, ?, ?, ?)',
    );
    const insPlayer = this.db.prepare(
      `INSERT OR REPLACE INTO match_players
       (match_id, player_id, name, start_seat, final_score, result, abandoned)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // v0.2: "abandoned" is the broad definition — explicit leavers plus
    // players on system-set Auto Mode or disconnected when the match ended.
    const abandoned = broadAbandoned(record);
    this.db.exec('BEGIN');
    try {
      insMatch.run(record.matchId, Date.now(), record.matchLength, JSON.stringify(record));
      record.players.forEach((p, seat) => {
        const score = record.finalScores[seat];
        const result = score > 0 ? 'WIN' : score < 0 ? 'LOSE' : 'DRAW';
        insPlayer.run(record.matchId, p.id, p.name, seat, score, result, abandoned.has(p.id) ? 1 : 0);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Matches this player finished (not abandoned), newest first. */
  listMatches(playerId: string): MatchListEntry[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.created_at, m.match_length, m.record, mp.start_seat, mp.final_score, mp.result
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ? AND mp.abandoned = 0 AND mp.hidden = 0
         ORDER BY m.created_at DESC LIMIT 200`,
      )
      .all(playerId) as {
      id: number;
      created_at: number;
      match_length: number;
      record: string;
      start_seat: number;
      final_score: number;
      result: string;
    }[];
    return rows.map((r) => {
      const rec = JSON.parse(r.record) as MatchRecord;
      return {
        matchId: r.id,
        createdAt: r.created_at,
        matchLength: r.match_length,
        players: rec.players.map((p) => ({ name: p.name, isBot: p.isBot })),
        finalScores: rec.finalScores,
        mySeat: r.start_seat,
        myScore: r.final_score,
        myResult: r.result as MatchListEntry['myResult'],
      };
    });
  }

  /**
   * Removes a match from this player's Records list. The match itself (and
   * the other participants' views of it, and Statistics) are untouched.
   * Returns false if the player did not take part in the match.
   */
  deleteMatchFor(playerId: string, matchId: number): boolean {
    const res = this.db
      .prepare('UPDATE match_players SET hidden = 1 WHERE match_id = ? AND player_id = ?')
      .run(matchId, playerId);
    return res.changes > 0;
  }

  getMatch(matchId: number): MatchRecord | null {
    const row = this.db.prepare('SELECT record FROM matches WHERE id = ?').get(matchId) as
      | { record: string }
      | undefined;
    return row ? (JSON.parse(row.record) as MatchRecord) : null;
  }

  /**
   * All match participations since the player's last stats reset — including
   * abandoned ones (v0.2: "Matches Played" counts them; "Matches Finished"
   * does not).
   */
  matchesForStats(
    playerId: string,
  ): { record: MatchRecord; startSeat: number; result: string; abandoned: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT m.record, mp.start_seat, mp.result, mp.abandoned
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ? AND m.created_at >= ?`,
      )
      .all(playerId, this.statsResetAt(playerId)) as {
      record: string;
      start_seat: number;
      result: string;
      abandoned: number;
    }[];
    return rows.map((r) => ({
      record: JSON.parse(r.record) as MatchRecord,
      startSeat: r.start_seat,
      result: r.result,
      abandoned: r.abandoned !== 0,
    }));
  }

  // ── Weekly Tournaments (v0.2) ─────────────────────────────────────────

  /** Has this player entered (started) a tournament match this week? */
  hasPlayedTournament(playerId: string, week: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM tournament_results WHERE week = ? AND player_id = ?')
        .get(week, playerId) !== undefined
    );
  }

  /** Did this player leave a tournament match early in the given week? */
  leftTournamentEarly(playerId: string, week: string): boolean {
    const row = this.db
      .prepare('SELECT left_early FROM tournament_results WHERE week = ? AND player_id = ?')
      .get(week, playerId) as { left_early: number } | undefined;
    return !!row && row.left_early !== 0;
  }

  /**
   * A tournament match started: each player is committed to this week (a row
   * exists from the moment of the deal, so leaving mid-match cannot free up
   * another entry).
   */
  recordTournamentStart(
    week: string,
    matchId: number,
    players: { id: string; name: string }[],
  ): void {
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO tournament_results
       (week, player_id, name, rank_points, left_early, match_id, updated_at)
       VALUES (?, ?, ?, 0, 0, ?, ?)`,
    );
    const now = Date.now();
    for (const p of players) ins.run(week, p.id, p.name, matchId, now);
  }

  recordTournamentResult(
    week: string,
    playerId: string,
    rankPoints: number,
    leftEarly: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE tournament_results SET rank_points = ?, left_early = ?, updated_at = ?
         WHERE week = ? AND player_id = ?`,
      )
      .run(rankPoints, leftEarly ? 1 : 0, Date.now(), week, playerId);
  }

  /** Top Rank Points holders; scope is a week id, a 'YYYY-MM' month, or all. */
  leaderboard(scope: { week?: string; monthPrefix?: string }, limit = 100): {
    name: string;
    points: number;
  }[] {
    const where = scope.week
      ? 'WHERE week = ?'
      : scope.monthPrefix
        ? "WHERE week LIKE ? || '%'"
        : '';
    const args: (string | number)[] = scope.week
      ? [scope.week, limit]
      : scope.monthPrefix
        ? [scope.monthPrefix, limit]
        : [limit];
    const rows = this.db
      .prepare(
        `SELECT MAX(name) AS name, SUM(rank_points) AS points
         FROM tournament_results ${where}
         GROUP BY player_id ORDER BY points DESC, name ASC LIMIT ?`,
      )
      .all(...args) as { name: string; points: number }[];
    return rows;
  }

  // ── Achievements (v0.2) ───────────────────────────────────────────────

  /** Awards an achievement; returns true only if it was newly earned. */
  awardAchievement(playerId: string, achievementId: string): boolean {
    const res = this.db
      .prepare(
        'INSERT OR IGNORE INTO achievements (player_id, achievement_id, earned_at) VALUES (?, ?, ?)',
      )
      .run(playerId, achievementId, Date.now());
    return res.changes > 0;
  }

  achievementsFor(playerId: string): { achievementId: string; earnedAt: number }[] {
    const rows = this.db
      .prepare('SELECT achievement_id, earned_at FROM achievements WHERE player_id = ?')
      .all(playerId) as { achievement_id: string; earned_at: number }[];
    return rows.map((r) => ({ achievementId: r.achievement_id, earnedAt: r.earned_at }));
  }

  close(): void {
    this.db.close();
  }
}
