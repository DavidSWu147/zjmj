import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { MatchRecord } from '../../shared/src/records';

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
    `);
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
    this.db.exec('BEGIN');
    try {
      insMatch.run(record.matchId, Date.now(), record.matchLength, JSON.stringify(record));
      record.players.forEach((p, seat) => {
        const score = record.finalScores[seat];
        const result = score > 0 ? 'WIN' : score < 0 ? 'LOSE' : 'DRAW';
        insPlayer.run(
          record.matchId,
          p.id,
          p.name,
          seat,
          score,
          result,
          record.abandonedBy.includes(p.id) ? 1 : 0,
        );
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
         WHERE mp.player_id = ? AND mp.abandoned = 0
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

  getMatch(matchId: number): MatchRecord | null {
    const row = this.db.prepare('SELECT record FROM matches WHERE id = ?').get(matchId) as
      | { record: string }
      | undefined;
    return row ? (JSON.parse(row.record) as MatchRecord) : null;
  }

  /** All non-abandoned match participations for stats. */
  matchesForStats(playerId: string): { record: MatchRecord; startSeat: number; result: string }[] {
    const rows = this.db
      .prepare(
        `SELECT m.record, mp.start_seat, mp.result
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ? AND mp.abandoned = 0`,
      )
      .all(playerId) as { record: string; start_seat: number; result: string }[];
    return rows.map((r) => ({
      record: JSON.parse(r.record) as MatchRecord,
      startSeat: r.start_seat,
      result: r.result,
    }));
  }

  close(): void {
    this.db.close();
  }
}
