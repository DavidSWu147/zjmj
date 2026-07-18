import {
  BotDifficulty,
  DEFAULT_SETTINGS,
  GameView,
  isTournamentRoomId,
  ROOM_CAP,
  RoomSettings,
  RoomSummary,
  TOURNAMENT_ROOM_COUNT,
  TOURNAMENT_ROOM_FIRST,
} from '../../shared/src/protocol';
import { MatchRecord } from '../../shared/src/records';
import { Match, MatchPlayer } from './match';
import { currentWeekId, tournamentWindowOpen } from './tourney';

export interface SessionLike {
  playerId: string;
  name: string;
  connected: boolean;
  /** Guest or registered account (tournaments are registered-only, v0.2). */
  kind: 'guest' | 'account';
}

export interface RoomsDelegate {
  onLobbyChanged(): void;
  onMatchFinished(
    record: MatchRecord,
    aborted: boolean,
    roomId: number,
  ): void | { newlyAchieved?: { playerId: string; achievementId: string }[] };
  isConnected(playerId: string): boolean;
  /** Toast a message to these players (idle-room ejections). */
  notify(playerIds: string[], message: string): void;
  /** Push a view to a (human) player — system-started tournament matches. */
  sendView(playerId: string, view: GameView): void;
  /** Weekly-tournament eligibility beyond registration; null = allowed. */
  tournamentJoinError(playerId: string): string | null;
  /** A tournament match started: commit its players to this week. */
  onTournamentMatchStart(week: string, matchId: number, players: { id: string; name: string }[]): void;
}

/** A user room with no status change for this long is deleted. */
export const ROOM_IDLE_MS = 10 * 60 * 1000;
/** Room #0 ejects its members after this long without a status change. */
export const ROOM0_IDLE_MS = 5 * 60 * 1000;
/** Tournament rooms: the system starts a full room after this countdown. */
export const TOURNAMENT_START_MS = 10 * 1000;

export class Room {
  readonly id: number;
  settings: RoomSettings;
  /** Members in join order; index 0 acts as host. */
  members: SessionLike[] = [];
  match: Match | null = null;
  /** Last join/leave/start; idle rooms are cleaned up (anti-squatting). */
  lastActivity = Date.now();
  /** 4-digit join code for private rooms; null for public ones. */
  code: string | null = null;
  /** Brain for the bots filling empty seats; the host toggles it (0.1.4 #5). */
  botDifficulty: BotDifficulty = 'dummy';
  /** Tournament auto-start: epoch ms of the pending system start (v0.2). */
  startingAt: number | null = null;
  startTimer: ReturnType<typeof setTimeout> | null = null;
  startTicker: ReturnType<typeof setInterval> | null = null;

  constructor(id: number, settings: RoomSettings, code: string | null = null) {
    this.id = id;
    this.settings = settings;
    this.code = code;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  get isDefault(): boolean {
    return this.id === 0;
  }

  get isTournament(): boolean {
    return isTournamentRoomId(this.id);
  }

  get host(): SessionLike | null {
    return this.members[0] ?? null;
  }

  summary(viewerId?: string): RoomSummary {
    // Tournament rooms hide member names from everyone outside the room
    // (watchers included) until they have actually joined it (v0.2).
    const hideNames =
      this.isTournament && !this.members.some((m) => m.playerId === viewerId);
    return {
      id: this.id,
      settings: this.settings,
      players: this.members.map((m) => ({ name: hideNames ? '???' : m.name, isBot: false })),
      hostName: this.isTournament ? null : (this.host?.name ?? null),
      // A finished match still counts: the standings screen is up and the
      // post-match cleanup (which disbands user rooms) hasn't run yet, so
      // anyone joining now would be ejected moments later.
      inGame: this.match !== null,
      isPrivate: this.code !== null,
      spectators: this.match && !this.match.finished ? this.match.spectatorCount : 0,
      botDifficulty: this.botDifficulty,
      ...(this.isTournament ? { tournament: true } : {}),
      ...(this.startingAt !== null
        ? { startsIn: Math.max(0, Math.ceil((this.startingAt - Date.now()) / 1000)) }
        : {}),
    };
  }
}

export class Rooms {
  private rooms = new Map<number, Room>();
  private delegate: RoomsDelegate;

  constructor(delegate: RoomsDelegate) {
    this.delegate = delegate;
    // Room #0 is always open and locked to the default settings.
    this.rooms.set(0, new Room(0, { ...DEFAULT_SETTINGS }));
    // Idle sweep; unref'd so it never keeps a test process alive.
    setInterval(() => this.sweepIdle(), 30_000).unref();
    // Weekly Tournament rooms exist only while the window is open (v0.2).
    this.manageTournamentRooms();
    setInterval(() => this.manageTournamentRooms(), 5_000).unref();
  }

  /**
   * Keeps the tournament rooms (#25..#28) in sync with the weekly window:
   * created at Saturday midnight, closed at Sunday midnight (UTC-7). A room
   * whose match is running stays until the match finishes — the match itself
   * is allowed to run past the window.
   */
  private manageTournamentRooms(): void {
    const open = tournamentWindowOpen();
    let changed = false;
    for (let i = 0; i < TOURNAMENT_ROOM_COUNT; i++) {
      const id = TOURNAMENT_ROOM_FIRST + i;
      const room = this.rooms.get(id);
      if (open && !room) {
        this.rooms.set(id, new Room(id, { ...DEFAULT_SETTINGS }));
        changed = true;
      } else if (!open && room && !room.match) {
        // Sunday midnight: close every tournament room that is not IN GAME,
        // even one about to start.
        this.cancelTournamentCountdown(room);
        const memberIds = room.members.map((m) => m.playerId);
        this.rooms.delete(id);
        if (memberIds.length > 0) {
          this.delegate.notify(memberIds, 'The Weekly Tournament has closed for this week.');
        }
        changed = true;
      }
    }
    if (changed) this.delegate.onLobbyChanged();
  }

  /** The one tournament room whose Join button is live (lowest open one). */
  private firstOpenTournamentId(): number | null {
    for (let i = 0; i < TOURNAMENT_ROOM_COUNT; i++) {
      const room = this.rooms.get(TOURNAMENT_ROOM_FIRST + i);
      if (room && !room.match && room.members.length < 4) return room.id;
    }
    return null;
  }

  private cancelTournamentCountdown(room: Room): void {
    if (room.startTimer) clearTimeout(room.startTimer);
    if (room.startTicker) clearInterval(room.startTicker);
    room.startTimer = null;
    room.startTicker = null;
    room.startingAt = null;
  }

  /** All four seats taken: the system starts the match in 10 seconds. */
  private beginTournamentCountdown(room: Room): void {
    this.cancelTournamentCountdown(room);
    room.startingAt = Date.now() + TOURNAMENT_START_MS;
    room.touch();
    // Re-broadcast each second so every lobby ticks the countdown down.
    room.startTicker = setInterval(() => this.delegate.onLobbyChanged(), 1_000);
    room.startTimer = setTimeout(() => {
      this.cancelTournamentCountdown(room);
      if (room.members.length === 4 && !room.match && this.rooms.get(room.id) === room) {
        this.launchMatch(room);
      }
      this.delegate.onLobbyChanged();
    }, TOURNAMENT_START_MS);
  }

  /**
   * Deletes user rooms idle for 10 minutes and ejects everyone from room #0
   * after 5, so nobody can squat on a room without playing. A running match
   * counts as activity.
   */
  private sweepIdle(now = Date.now()): void {
    let changed = false;
    for (const room of [...this.rooms.values()]) {
      if (room.match && !room.match.finished) {
        room.touch();
        continue;
      }
      const idle = now - room.lastActivity;
      const memberIds = room.members.map((m) => m.playerId);
      if (room.isDefault || room.isTournament) {
        // System rooms persist; squatters are ejected instead.
        if (memberIds.length > 0 && idle > ROOM0_IDLE_MS && room.startingAt === null) {
          room.members = [];
          room.botDifficulty = 'dummy'; // room #0 always reverts (0.1.5 #4)
          room.touch();
          this.delegate.notify(
            memberIds,
            `Removed from Room #${room.id} after 5 minutes of inactivity.`,
          );
          changed = true;
        }
      } else if (idle > ROOM_IDLE_MS) {
        room.match?.dispose();
        this.rooms.delete(room.id);
        this.delegate.notify(memberIds, `Room #${room.id} was deleted after 10 minutes of inactivity.`);
        changed = true;
      }
    }
    if (changed) this.delegate.onLobbyChanged();
  }

  /** Lobby listing for one viewer: tournament rooms first, above Room #0. */
  list(viewerId?: string): RoomSummary[] {
    const firstOpen = this.firstOpenTournamentId();
    return [...this.rooms.values()]
      .sort((a, b) =>
        a.isTournament !== b.isTournament ? (a.isTournament ? -1 : 1) : a.id - b.id,
      )
      .map((r) => {
        const s = r.summary(viewerId);
        if (r.isTournament) s.joinable = r.id === firstOpen;
        return s;
      });
  }

  get(id: number): Room | undefined {
    return this.rooms.get(id);
  }

  roomOf(playerId: string): Room | null {
    for (const r of this.rooms.values()) {
      if (r.members.some((m) => m.playerId === playerId)) return r;
      // A running match still binds its ACTIVE humans to the room (so a
      // reconnect rejoins the game) — but not players who left the match:
      // dragging them back in produced a zombie board where a bot discarded
      // their tiles while their own input was rejected, and it also blocked
      // them from joining any other room until the match ended.
      if (
        r.match &&
        !r.match.finished &&
        r.match.players.some((p) => p.id === playerId && !p.isBot) &&
        !r.match.hasLeft(playerId)
      ) {
        return r;
      }
    }
    return null;
  }

  create(session: SessionLike, settings: RoomSettings, isPrivate = false): Room | string {
    if (this.roomOf(session.playerId)) return 'Already in a room.';
    for (let id = 1; id <= ROOM_CAP; id++) {
      if (!this.rooms.has(id)) {
        const code = isPrivate
          ? String(Math.floor(Math.random() * 10000)).padStart(4, '0')
          : null;
        const room = new Room(id, settings, code);
        room.members.push(session);
        this.rooms.set(id, room);
        this.delegate.onLobbyChanged();
        return room;
      }
    }
    return `Room cap reached (${ROOM_CAP} rooms).`;
  }

  join(session: SessionLike, roomId: number, code?: string): Room | string {
    const room = this.rooms.get(roomId);
    if (!room) return 'No such room.';
    if (this.roomOf(session.playerId)) return 'Already in a room.';
    // Also blocked while a FINISHED match awaits cleanup: user rooms are
    // about to be disbanded, so a join would be yanked away immediately.
    if (room.match) return 'Match in progress.';
    if (room.members.length >= 4) return 'Room is full.';
    if (room.code !== null && code !== room.code) {
      return code ? 'Wrong room code.' : 'This room needs its 4-digit code.';
    }
    if (room.isTournament) {
      if (session.kind !== 'account') {
        return 'Only registered users can play in Weekly Tournaments.';
      }
      if (room.id !== this.firstOpenTournamentId()) {
        return 'Please join the first open tournament room.';
      }
      const err = this.delegate.tournamentJoinError(session.playerId);
      if (err) return err;
    }
    room.members.push(session);
    room.touch();
    if (room.isTournament && room.members.length === 4) {
      this.beginTournamentCountdown(room);
    }
    this.delegate.onLobbyChanged();
    return room;
  }

  /** The room whose running match this player is watching, if any. */
  spectatingRoomOf(playerId: string): Room | null {
    for (const r of this.rooms.values()) {
      if (r.match && !r.match.finished && r.match.hasSpectator(playerId)) return r;
    }
    return null;
  }

  /** Join a running match as a spectator (private rooms need their code). */
  watch(session: SessionLike, roomId: number, code?: string): string | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.match || room.match.finished) return 'No match in progress.';
    if (this.roomOf(session.playerId)) return 'Leave your room first.';
    if (this.spectatingRoomOf(session.playerId)) return 'Already watching a match.';
    if (room.code !== null && code !== room.code) {
      return code ? 'Wrong room code.' : 'This room needs its 4-digit code.';
    }
    const err = room.match.addSpectator(session.playerId);
    if (err) return err;
    this.delegate.onLobbyChanged();
    return null;
  }

  /** Leave the room (and the match if one is running), or stop spectating. */
  leave(playerId: string): void {
    const specRoom = this.spectatingRoomOf(playerId);
    if (specRoom) {
      specRoom.match!.removeSpectator(playerId);
      this.delegate.onLobbyChanged();
    }
    const room = this.roomOf(playerId);
    if (!room) return;
    room.members = room.members.filter((m) => m.playerId !== playerId);
    room.touch();
    // A leave during the tournament auto-start countdown cancels the start.
    if (room.isTournament && room.startingAt !== null && !room.match) {
      this.cancelTournamentCountdown(room);
    }
    if (room.match && !room.match.finished) {
      room.match.leave(playerId);
    }
    if (room.members.length === 0) {
      if (room.isDefault) {
        // Room #0 never persists a Chicken setting once deserted (0.1.5 #4).
        room.botDifficulty = 'dummy';
      } else if (!room.isTournament) {
        room.match?.dispose();
        this.rooms.delete(room.id);
      }
    }
    this.delegate.onLobbyChanged();
  }

  /** Host only: pick the brain for the bots that fill empty seats. */
  setBotDifficulty(playerId: string, difficulty: BotDifficulty): string | null {
    const room = this.roomOf(playerId);
    if (!room) return 'Not in a room.';
    if (room.isTournament) return 'Tournament matches never use bots.';
    if (room.host?.playerId !== playerId) return 'Only the host can change the bot difficulty.';
    if (room.match) return 'Match in progress.';
    room.botDifficulty = difficulty;
    room.touch();
    this.delegate.onLobbyChanged();
    return null;
  }

  deleteRoom(playerId: string): string | null {
    const room = this.roomOf(playerId);
    if (!room) return 'Not in a room.';
    if (room.isDefault) return 'Room #0 cannot be deleted.';
    if (room.isTournament) return 'Tournament rooms cannot be deleted.';
    if (room.host?.playerId !== playerId) return 'Only the host can delete the room.';
    if (room.match && !room.match.finished) return 'Match in progress.';
    this.rooms.delete(room.id);
    this.delegate.onLobbyChanged();
    return null;
  }

  startMatch(playerId: string): string | null {
    const room = this.roomOf(playerId);
    if (!room) return 'Not in a room.';
    if (room.isTournament) return 'The system starts tournament matches automatically.';
    if (room.host?.playerId !== playerId) return 'Only the host can start the match.';
    if (room.match) return 'Match already running.';
    if (room.members.length === 0) return 'Room is empty.';
    this.launchMatch(room);
    return null;
  }

  private launchMatch(room: Room): void {
    const humans: MatchPlayer[] = room.members.map((m) => ({
      id: m.playerId,
      name: m.name,
      isBot: false,
      registered: m.kind === 'account',
    }));
    const tournamentWeek = room.isTournament ? currentWeekId() : null;
    const match = new Match(room.settings, humans, {
      sendView: (pid, view) => this.delegate.sendView(pid, view),
      isConnected: (pid) => this.delegate.isConnected(pid),
      onMatchEnd: (record, aborted) => {
        const res = this.delegate.onMatchFinished(record, aborted, room.id);
        if (aborted && match.abortedWatchers.length > 0) {
          this.delegate.notify(match.abortedWatchers, 'The match was abandoned by its players.');
        }
        // Clean up after the standings screen has run its course: user rooms
        // (and tournament rooms — a fresh one reappears while the window is
        // open) are disbanded outright; room #0 just returns to lobby state.
        // An aborted match (every human left) has no standings watchers, so
        // it is cleaned up at once — the room is playable again immediately.
        setTimeout(() => {
          if (room.match !== match) return;
          room.match.dispose();
          room.match = null;
          if (room.isDefault) {
            // A Chicken setting never outlives the match in room #0 (0.1.5 #4).
            room.botDifficulty = 'dummy';
            room.touch();
          } else {
            this.rooms.delete(room.id);
            const stragglers = room.members.map((m) => m.playerId);
            if (stragglers.length > 0) {
              this.delegate.notify(stragglers, `Room #${room.id} was disbanded after the match.`);
            }
            if (room.isTournament) this.manageTournamentRooms();
          }
          this.delegate.onLobbyChanged();
        }, aborted ? 0 : 20000);
        this.delegate.onLobbyChanged();
        return res;
      },
    }, { id: room.id, code: room.code }, room.botDifficulty, tournamentWeek);
    room.match = match;
    room.touch();
    if (tournamentWeek) {
      // Players are committed to this week from the moment the match starts.
      this.delegate.onTournamentMatchStart(
        tournamentWeek,
        match.matchId,
        humans.map((h) => ({ id: h.id, name: h.name })),
      );
    }
    this.delegate.onLobbyChanged();
    match.start();
  }
}
