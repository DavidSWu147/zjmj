import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/src/protocol';
import { Room, Rooms, ROOM0_IDLE_MS, ROOM_IDLE_MS, RoomsDelegate, SessionLike } from '../src/rooms';

function makeRooms(): { rooms: Rooms; notified: { ids: string[]; message: string }[] } {
  const notified: { ids: string[]; message: string }[] = [];
  const delegate: RoomsDelegate = {
    onLobbyChanged: () => {},
    onMatchFinished: () => {},
    isConnected: () => true,
    notify: (ids, message) => notified.push({ ids, message }),
  };
  return { rooms: new Rooms(delegate), notified };
}

const session = (id: string): SessionLike => ({ playerId: id, name: id, connected: true });

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
