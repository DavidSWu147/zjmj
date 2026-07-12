import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMsg, GameView, ServerMsg } from '../../shared/src/protocol';
import { makeApi } from './api';
import { makeAuthApi } from './auth';
import { Db } from './db';
import { loadDotEnv, playFabEnabled } from './playfab';
import { Rooms } from './rooms';

loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.ZJMJ_DB ?? path.join(__dirname, '..', 'zjmj.db');

interface Session {
  playerId: string;
  name: string;
  token: string;
  kind: 'guest' | 'account';
  ws: WebSocket | null;
}

const sessions = new Map<string, Session>();
const db = new Db(DB_PATH);

const rooms = new Rooms({
  onLobbyChanged: () => broadcastLobby(),
  onMatchFinished: (record, aborted) => {
    if (!aborted) db.saveMatch(record);
  },
  isConnected: (playerId) => {
    const s = sessions.get(playerId);
    return !!s && s.ws !== null && s.ws.readyState === WebSocket.OPEN;
  },
  notify: (playerIds, message) => {
    for (const pid of playerIds) {
      const s = sessions.get(pid);
      if (s) send(s, { type: 'toast', message });
    }
  },
});

function send(session: Session, msg: ServerMsg): void {
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(msg));
  }
}

function sendViewTo(playerId: string, view: GameView): void {
  const s = sessions.get(playerId);
  if (s) send(s, { type: 'game', view });
}

function lobbyMsgFor(session: Session): ServerMsg {
  const room = rooms.roomOf(session.playerId);
  const isMember = !!room?.members.some((m) => m.playerId === session.playerId);
  return {
    type: 'lobby',
    rooms: rooms.list(),
    myRoom: room ? room.id : null,
    myRoomCode: isMember ? (room?.code ?? null) : null,
    // Spectators count as "in a match" so lobby refreshes never tear down
    // the board they are watching.
    inMatch:
      (!!room?.match && !room.match.finished) || rooms.spectatingRoomOf(session.playerId) !== null,
  };
}

function broadcastLobby(): void {
  for (const s of sessions.values()) send(s, lobbyMsgFor(s));
}

/** Kicks the sockets of revoked sessions (signed in elsewhere, deletion, …). */
function onSessionsRevoked(tokens: string[], reason: string): void {
  const revoked = new Set(tokens);
  for (const s of sessions.values()) {
    if (!revoked.has(s.token)) continue;
    send(s, { type: 'signedOut', reason });
    s.ws?.close();
    s.ws = null;
  }
}

function handleMsg(session: Session, msg: ClientMsg): void {
  switch (msg.type) {
    case 'hello':
      break; // handled at connection setup
    case 'createRoom': {
      if (msg.isPrivate && session.kind !== 'account') {
        send(session, { type: 'toast', message: 'Sign in to create a private room.' });
        break;
      }
      const r = rooms.create(sessionLike(session), msg.settings, msg.isPrivate === true);
      if (typeof r === 'string') send(session, { type: 'toast', message: r });
      break;
    }
    case 'joinRoom': {
      const r = rooms.join(sessionLike(session), msg.roomId, msg.code);
      if (typeof r === 'string') send(session, { type: 'toast', message: r });
      break;
    }
    case 'leaveRoom':
    case 'leaveMatch':
      rooms.leave(session.playerId);
      broadcastLobby();
      break;
    case 'deleteRoom': {
      const err = rooms.deleteRoom(session.playerId);
      if (err) send(session, { type: 'toast', message: err });
      break;
    }
    case 'startMatch': {
      const err = rooms.startMatch(session.playerId, sendViewTo);
      if (err) send(session, { type: 'toast', message: err });
      break;
    }
    case 'watchMatch': {
      const err = rooms.watch(sessionLike(session), msg.roomId, msg.code);
      if (err) send(session, { type: 'toast', message: err });
      break;
    }
    case 'spectateSeat': {
      rooms.spectatingRoomOf(session.playerId)?.match?.setSpectatorSeat(session.playerId, msg.seat);
      break;
    }
    case 'action': {
      const room = rooms.roomOf(session.playerId);
      if (room?.match && !room.match.finished) {
        room.match.handleAction(session.playerId, msg.action);
      }
      break;
    }
  }
}

function sessionLike(session: Session) {
  return {
    playerId: session.playerId,
    get name() {
      return sessions.get(session.playerId)?.name ?? session.name;
    },
    get connected() {
      const s = sessions.get(session.playerId);
      return !!s?.ws && s.ws.readyState === WebSocket.OPEN;
    },
  };
}

const app = express();
app.use('/api/auth', makeAuthApi(db, { onSessionsRevoked }));
app.use('/api', makeApi(db));

// Serve the built client in production.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let session: Session | null = null;

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!session) {
      if (msg.type !== 'hello' || !msg.token) {
        ws.close();
        return;
      }
      const dbSession = db.getSession(msg.token);
      if (!dbSession) {
        ws.send(JSON.stringify({ type: 'signedOut', reason: 'Session expired.' } satisfies ServerMsg));
        ws.close();
        return;
      }
      const name =
        dbSession.kind === 'account' && dbSession.username
          ? dbSession.username
          : (msg.name || 'Guest').slice(0, 24);
      const existing = sessions.get(dbSession.playerId);
      if (existing) {
        existing.ws?.close();
        existing.ws = ws;
        existing.name = name;
        existing.token = msg.token;
        existing.kind = dbSession.kind;
        session = existing;
      } else {
        session = { playerId: dbSession.playerId, name, token: msg.token, kind: dbSession.kind, ws };
        sessions.set(dbSession.playerId, session);
      }
      send(session, { type: 'welcome', you: { id: session.playerId, name: session.name } });
      send(session, lobbyMsgFor(session));
      // Rejoin a running match after reconnect.
      const room = rooms.roomOf(session.playerId);
      if (room?.match && !room.match.finished) {
        const view = room.match.viewFor(session.playerId);
        if (view) send(session, { type: 'game', view });
      }
      return;
    }
    try {
      handleMsg(session, msg);
    } catch (err) {
      console.error('error handling message', msg, err);
    }
  });

  ws.on('close', () => {
    if (!session) return;
    if (session.ws === ws) session.ws = null;
    // Spectator slots are scarce (cap 4): a disconnect frees one at once.
    // Only when no socket is left — a reconnect closing its old socket
    // must not drop the new session's spectator slot.
    if (session.ws === null && rooms.spectatingRoomOf(session.playerId)) {
      rooms.leave(session.playerId);
    }
    const room = rooms.roomOf(session.playerId);
    if (room) {
      if (room.match && !room.match.finished) {
        // Bots take over while disconnected; the seat is kept for reconnect.
        room.match.broadcast();
        room.match.nudge();
      } else {
        rooms.leave(session.playerId);
      }
    }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(
    `zjmj server listening on http://localhost:${PORT} ` +
      `(PlayFab ${playFabEnabled() ? `title ${process.env.PLAYFAB_TITLE_ID}` : 'NOT configured — guest-only fallback'})`,
  );
});
