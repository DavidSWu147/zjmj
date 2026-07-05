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
}

export class Room {
  readonly id: number;
  settings: RoomSettings;
  /** Members in join order; index 0 acts as host. */
  members: SessionLike[] = [];
  match: Match | null = null;

  constructor(id: number, settings: RoomSettings) {
    this.id = id;
    this.settings = settings;
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
      if (r.match && !r.match.finished && r.match.players.some((p) => p.id === playerId && !p.isBot)) {
        return r;
      }
    }
    return null;
  }

  create(session: SessionLike, settings: RoomSettings): Room | string {
    if (this.roomOf(session.playerId)) return 'Already in a room.';
    for (let id = 1; id <= ROOM_CAP; id++) {
      if (!this.rooms.has(id)) {
        const room = new Room(id, settings);
        room.members.push(session);
        this.rooms.set(id, room);
        this.delegate.onLobbyChanged();
        return room;
      }
    }
    return `Room cap reached (${ROOM_CAP} rooms).`;
  }

  join(session: SessionLike, roomId: number): Room | string {
    const room = this.rooms.get(roomId);
    if (!room) return 'No such room.';
    if (this.roomOf(session.playerId)) return 'Already in a room.';
    if (room.match && !room.match.finished) return 'Match in progress.';
    if (room.members.length >= 4) return 'Room is full.';
    room.members.push(session);
    this.delegate.onLobbyChanged();
    return room;
  }

  /** Leave the room (and the match if one is running). */
  leave(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room) return;
    room.members = room.members.filter((m) => m.playerId !== playerId);
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
        // Clean up: the room returns to lobby state.
        setTimeout(() => {
          if (room.match === match) {
            room.match.dispose();
            room.match = null;
            if (!room.isDefault && room.members.length === 0) this.rooms.delete(room.id);
            this.delegate.onLobbyChanged();
          }
        }, 20000);
        this.delegate.onLobbyChanged();
      },
    });
    room.match = match;
    this.delegate.onLobbyChanged();
    match.start();
    return null;
  }
}
