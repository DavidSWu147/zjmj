import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, GameView } from '../../shared/src/protocol';
import { Room, Rooms, ROOM0_IDLE_MS, ROOM_IDLE_MS, RoomsDelegate, SessionLike } from '../src/rooms';

function makeRooms(overrides: Partial<RoomsDelegate> = {}): {
  rooms: Rooms;
  notified: { ids: string[]; message: string }[];
  views: { pid: string; view: GameView }[];
  tournamentStarts: { week: string; matchId: number; players: { id: string; name: string }[] }[];
} {
  const notified: { ids: string[]; message: string }[] = [];
  const views: { pid: string; view: GameView }[] = [];
  const tournamentStarts: {
    week: string;
    matchId: number;
    players: { id: string; name: string }[];
  }[] = [];
  const delegate: RoomsDelegate = {
    onLobbyChanged: () => {},
    onMatchFinished: () => {},
    isConnected: () => true,
    notify: (ids, message) => notified.push({ ids, message }),
    sendView: (pid, view) => views.push({ pid, view }),
    tournamentJoinError: () => null,
    onTournamentMatchStart: (week, matchId, players) =>
      tournamentStarts.push({ week, matchId, players }),
    ...overrides,
  };
  return { rooms: new Rooms(delegate), notified, views, tournamentStarts };
}

const session = (id: string, kind: 'guest' | 'account' = 'account'): SessionLike => ({
  playerId: id,
  name: id,
  connected: true,
  kind,
});

const sweep = (rooms: Rooms, now: number): void => {
  (rooms as unknown as { sweepIdle(now: number): void }).sweepIdle(now);
};

describe('private rooms', () => {
  it('requires the 4-digit code to join', () => {
    const { rooms } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }, true) as Room;
    expect(room.code).toMatch(/^\d{4}$/);
    const wrong = room.code === '9999' ? '0000' : '9999';
    expect(rooms.join(session('p2'), room.id)).toBe('This room needs its 4-digit code.');
    expect(rooms.join(session('p2'), room.id, wrong)).toBe('Wrong room code.');
    expect(rooms.join(session('p2'), room.id, room.code!)).toBeInstanceOf(Room);
  });

  it('public rooms ignore any code supplied', () => {
    const { rooms } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }) as Room;
    expect(room.code).toBeNull();
    expect(rooms.join(session('p2'), room.id, '1234')).toBeInstanceOf(Room);
  });
});

describe('idle room cleanup', () => {
  it('ejects room #0 members after 5 idle minutes but keeps the room', () => {
    const { rooms, notified } = makeRooms();
    rooms.join(session('p1'), 0);
    rooms.join(session('p2'), 0);

    sweep(rooms, Date.now() + ROOM0_IDLE_MS - 1000);
    expect(rooms.get(0)!.members).toHaveLength(2);

    sweep(rooms, Date.now() + ROOM0_IDLE_MS + 1000);
    expect(rooms.get(0)!.members).toHaveLength(0);
    expect(rooms.get(0)).toBeInstanceOf(Room);
    expect(notified).toHaveLength(1);
    expect(notified[0].ids).toEqual(['p1', 'p2']);
  });

  it('deletes an idle user room after 10 minutes', () => {
    const { rooms, notified } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }) as Room;

    sweep(rooms, Date.now() + ROOM_IDLE_MS - 1000);
    expect(rooms.get(room.id)).toBeDefined();

    sweep(rooms, Date.now() + ROOM_IDLE_MS + 1000);
    expect(rooms.get(room.id)).toBeUndefined();
    expect(notified[0].ids).toEqual(['host']);
  });

  it('joining resets the idle clock', () => {
    const { rooms } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }) as Room;
    room.lastActivity = Date.now() - ROOM_IDLE_MS + 5000; // nearly idle
    rooms.join(session('p2'), room.id); // touches

    sweep(rooms, Date.now() + 6000);
    expect(rooms.get(room.id)).toBeDefined();
  });
});

describe('room #0 bot difficulty (0.1.5 #4)', () => {
  it('reverts to Dummy when everyone leaves', () => {
    const { rooms } = makeRooms();
    rooms.join(session('p1'), 0);
    expect(rooms.setBotDifficulty('p1', 'chicken')).toBeNull();
    expect(rooms.get(0)!.botDifficulty).toBe('chicken');
    rooms.leave('p1');
    expect(rooms.get(0)!.botDifficulty).toBe('dummy');
  });

  it('reverts to Dummy when the idle sweep ejects everyone', () => {
    const { rooms } = makeRooms();
    rooms.join(session('p1'), 0);
    rooms.setBotDifficulty('p1', 'chicken');
    sweep(rooms, Date.now() + ROOM0_IDLE_MS + 1000);
    expect(rooms.get(0)!.members).toHaveLength(0);
    expect(rooms.get(0)!.botDifficulty).toBe('dummy');
  });

  it('does not persist Chicken past the end of a match', async () => {
    const { rooms } = makeRooms();
    rooms.join(session('p1'), 0);
    rooms.setBotDifficulty('p1', 'chicken');
    expect(rooms.startMatch('p1')).toBeNull();
    rooms.leave('p1'); // the match aborts; room #0 cleanup runs immediately
    await new Promise((r) => setTimeout(r, 10));
    expect(rooms.get(0)!.match).toBeNull();
    expect(rooms.get(0)!.botDifficulty).toBe('dummy');
  });

  it('survives matches in user rooms untouched', () => {
    const { rooms } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }) as Room;
    rooms.setBotDifficulty('host', 'chicken');
    expect(rooms.startMatch('host')).toBeNull();
    expect(room.botDifficulty).toBe('chicken');
    room.match?.dispose();
  });
});

describe('spectating', () => {
  it('watch joins a running match only, from outside any room', () => {
    const { rooms } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }) as Room;

    // No match yet.
    expect(rooms.watch(session('s1'), room.id)).toBe('No match in progress.');

    expect(rooms.startMatch('host')).toBeNull();
    expect(rooms.watch(session('s1'), room.id)).toBeNull();
    expect(rooms.spectatingRoomOf('s1')?.id).toBe(room.id);
    expect(room.summary().spectators).toBe(1);

    // Watching twice / from inside a room / players themselves.
    expect(rooms.watch(session('s1'), room.id)).toBe('Already watching a match.');
    rooms.join(session('p2'), 0);
    expect(rooms.watch(session('p2'), room.id)).toBe('Leave your room first.');
    expect(rooms.watch(session('host'), room.id)).toBe('Leave your room first.');

    // Leave stops spectating and frees the slot.
    rooms.leave('s1');
    expect(rooms.spectatingRoomOf('s1')).toBeNull();
    expect(room.summary().spectators).toBe(0);
    room.match?.dispose();
  });

  it('watching a private room needs its code, and views carry the room', () => {
    const { rooms, views } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }, true) as Room;
    expect(rooms.startMatch('host')).toBeNull();

    const wrong = room.code === '9999' ? '0000' : '9999';
    expect(rooms.watch(session('s1'), room.id)).toBe('This room needs its 4-digit code.');
    expect(rooms.watch(session('s1'), room.id, wrong)).toBe('Wrong room code.');
    expect(rooms.watch(session('s1'), room.id, room.code!)).toBeNull();

    // Every view — player's and spectator's — is stamped with the hosting
    // room so the match screen can show "Room #N · Code XXXX".
    room.match!.broadcast();
    const lastViewOf = (pid: string): GameView | undefined =>
      [...views].reverse().find((v) => v.pid === pid)?.view;
    expect(lastViewOf('host')?.room).toEqual({ id: room.id, code: room.code });
    expect(lastViewOf('s1')?.room).toEqual({ id: room.id, code: room.code });
    room.match?.dispose();
  });

  it('an abandoned match drops its spectators back to the lobby at once', () => {
    const { rooms, notified, views } = makeRooms();
    const room = rooms.create(session('host'), { ...DEFAULT_SETTINGS }) as Room;
    expect(rooms.startMatch('host')).toBeNull();
    expect(rooms.watch(session('s1'), room.id)).toBeNull();

    views.length = 0;
    rooms.leave('host'); // last human leaves: the match aborts
    // The spectator was dropped BEFORE the final broadcast: no match-over
    // screen reaches them, and they are told why.
    expect(views.map((v) => v.pid)).not.toContain('s1');
    expect(rooms.spectatingRoomOf('s1')).toBeNull();
    expect(
      notified.some((n) => n.ids.includes('s1') && n.message.includes('abandoned')),
    ).toBe(true);
  });
});

describe('weekly tournaments (v0.2)', () => {
  // 2026-07-18 is a Saturday; noon UTC-7 = 19:00 UTC.
  const SATURDAY_NOON = Date.parse('2026-07-18T19:00:00Z');
  const WEDNESDAY = Date.parse('2026-07-15T19:00:00Z');

  const withTime = async (
    epochMs: number,
    fn: () => void | Promise<void>,
  ): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(epochMs);
    try {
      await fn();
    } finally {
      vi.useRealTimers();
    }
  };

  it('tournament rooms #25..#28 exist only on Saturdays and list above room #0', async () => {
    await withTime(WEDNESDAY, () => {
      const { rooms } = makeRooms();
      expect(rooms.get(25)).toBeUndefined();
    });
    await withTime(SATURDAY_NOON, () => {
      const { rooms } = makeRooms();
      const list = rooms.list();
      expect(list.slice(0, 4).map((r) => r.id)).toEqual([25, 26, 27, 28]);
      expect(list[4].id).toBe(0);
      expect(list[0].tournament).toBe(true);
      // Only the first open tournament room accepts joins.
      expect(list[0].joinable).toBe(true);
      expect(list[1].joinable).toBe(false);
    });
  });

  it('gates joins: registered only, first open room only, eligibility hook', async () => {
    await withTime(SATURDAY_NOON, () => {
      const { rooms } = makeRooms({
        tournamentJoinError: (pid) => (pid === 'banned' ? 'You are barred this week.' : null),
      });
      expect(rooms.join(session('g1', 'guest'), 25)).toBe(
        'Only registered users can play in Weekly Tournaments.',
      );
      expect(rooms.join(session('p1'), 26)).toBe('Please join the first open tournament room.');
      expect(rooms.join(session('banned'), 25)).toBe('You are barred this week.');
      expect(rooms.join(session('p1'), 25)).toBeInstanceOf(Room);
    });
  });

  it('masks member names from everyone outside the room', async () => {
    await withTime(SATURDAY_NOON, () => {
      const { rooms } = makeRooms();
      rooms.join(session('alice'), 25);
      const room = rooms.get(25)!;
      expect(room.summary('bob').players[0].name).toBe('???');
      expect(room.summary('alice').players[0].name).toBe('alice');
      expect(room.summary('bob').hostName).toBeNull();
    });
  });

  it('auto-starts 10s after the 4th join, and a leave cancels the countdown', async () => {
    await withTime(SATURDAY_NOON, () => {
      const { rooms, tournamentStarts } = makeRooms();
      for (const p of ['p1', 'p2', 'p3']) rooms.join(session(p), 25);
      expect(rooms.get(25)!.startingAt).toBeNull();
      rooms.join(session('p4'), 25);
      expect(rooms.get(25)!.startingAt).not.toBeNull();
      expect(rooms.get(25)!.summary('p1').startsIn).toBe(10);

      // A leave during the window cancels the start.
      rooms.leave('p4');
      expect(rooms.get(25)!.startingAt).toBeNull();
      vi.advanceTimersByTime(11_000);
      expect(rooms.get(25)!.match).toBeNull();

      // Refill: the system starts the match with no host involved.
      rooms.join(session('p4'), 25);
      vi.advanceTimersByTime(10_000);
      const room = rooms.get(25)!;
      expect(room.match).not.toBeNull();
      expect(tournamentStarts).toHaveLength(1);
      expect(tournamentStarts[0].week).toBe('2026-07-18');
      expect(tournamentStarts[0].players.map((p) => p.id).sort()).toEqual([
        'p1',
        'p2',
        'p3',
        'p4',
      ]);
      expect(room.match!.players.every((p) => !p.isBot)).toBe(true);
      // Manual starts are refused in tournament rooms.
      expect(rooms.startMatch('p1')).toBe('The system starts tournament matches automatically.');
      room.match?.dispose();
    });
  });

  it('closes rooms that are not in game when the window ends', async () => {
    await withTime(SATURDAY_NOON, () => {
      const { rooms, notified } = makeRooms();
      rooms.join(session('p1'), 25);
      vi.setSystemTime(SATURDAY_NOON + 13 * 3600 * 1000); // past Sunday midnight UTC-7
      vi.advanceTimersByTime(5_000); // the management interval fires
      expect(rooms.get(25)).toBeUndefined();
      expect(rooms.get(26)).toBeUndefined();
      expect(notified.some((n) => n.ids.includes('p1') && n.message.includes('closed'))).toBe(
        true,
      );
    });
  });
});
