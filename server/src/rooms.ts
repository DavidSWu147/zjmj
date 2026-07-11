import { DEFAULT_SETTINGS, ROOM_CAP, RoomSettings, RoomSummary } from '../../shared/src/protocol';
import { MatchRecord } from '../../shared/src/records';
import { Match, MatchPlayer } from './match';

export interface SessionLike {
  playerId: string;
  name: string;
  connected: boolean;
}

export interface RoomsDelegate {
  onLobbyChanged(): void;
  onMatchFinished(record: MatchRecord, aborted: boolean): void;
  isConnected(playerId: string): boolean;
  /** Toast a message to these players (idle-room ejections). */
  notify(playerIds: string[], message: string): void;
}

/** A user room with no status change for this long is deleted. */
export const ROOM_IDLE_MS = 10 * 60 * 1000;
/** Room #0 ejects its members after this long without a status change. */
export const ROOM0_IDLE_MS = 5 * 60 * 1000;

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

  get host(): SessionLike | null {
    return this.members[0] ?? null;
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      settings: this.settings,
      players: this.members.map((m) => ({ name: m.name, isBot: false })),
      hostName: this.host?.name ?? null,
      inGame: this.match !== null && !this.match.finished,
      isPrivate: this.code !== null,
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
      if (room.isDefault) {
        if (memberIds.length > 0 && idle > ROOM0_IDLE_MS) {
          room.members = [];
          room.touch();
          this.delegate.notify(memberIds, 'Removed from Room #0 after 5 minutes of inactivity.');
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

  list(): RoomSummary[] {
    return [...this.rooms.values()].sort((a, b) => a.id - b.id).map((r) => r.summary());
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
    if (room.match && !room.match.finished) return 'Match in progress.';
    if (room.members.length >= 4) return 'Room is full.';
    if (room.code !== null && code !== room.code) {
      return code ? 'Wrong room code.' : 'This room needs its 4-digit code.';
    }
    room.members.push(session);
    room.touch();
    this.delegate.onLobbyChanged();
    return room;
  }

  /** Leave the room (and the match if one is running). */
  leave(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room) return;
    room.members = room.members.filter((m) => m.playerId !== playerId);
    room.touch();
    if (room.match && !room.match.finished) {
      room.match.leave(playerId);
    }
    if (!room.isDefault && room.members.length === 0) {
      room.match?.dispose();
      this.rooms.delete(room.id);
    }
    this.delegate.onLobbyChanged();
  }

  deleteRoom(playerId: string): string | null {
    const room = this.roomOf(playerId);
    if (!room) return 'Not in a room.';
    if (room.isDefault) return 'Room #0 cannot be deleted.';
    if (room.host?.playerId !== playerId) return 'Only the host can delete the room.';
    if (room.match && !room.match.finished) return 'Match in progress.';
    this.rooms.delete(room.id);
    this.delegate.onLobbyChanged();
    return null;
  }

  startMatch(
    playerId: string,
    sendView: ConstructorParameters<typeof Match>[2]['sendView'],
  ): string | null {
    const room = this.roomOf(playerId);
    if (!room) return 'Not in a room.';
    if (room.host?.playerId !== playerId) return 'Only the host can start the match.';
    if (room.match && !room.match.finished) return 'Match already running.';
    if (room.members.length === 0) return 'Room is empty.';

    const humans: MatchPlayer[] = room.members.map((m) => ({
      id: m.playerId,
      name: m.name,
      isBot: false,
    }));
    const match = new Match(room.settings, humans, {
      sendView,
      isConnected: (pid) => this.delegate.isConnected(pid),
      onMatchEnd: (record, aborted) => {
        this.delegate.onMatchFinished(record, aborted);
        // Clean up after the standings screen has run its course: user rooms
        // are disbanded outright; room #0 just returns to lobby state.
        setTimeout(() => {
          if (room.match !== match) return;
          room.match.dispose();
          room.match = null;
          if (room.isDefault) {
            room.touch();
          } else {
            this.rooms.delete(room.id);
            const stragglers = room.members.map((m) => m.playerId);
            if (stragglers.length > 0) {
              this.delegate.notify(stragglers, `Room #${room.id} was disbanded after the match.`);
            }
          }
          this.delegate.onLobbyChanged();
        }, 20000);
        this.delegate.onLobbyChanged();
      },
    });
    room.match = match;
    room.touch();
    this.delegate.onLobbyChanged();
    match.start();
    return null;
  }
}
