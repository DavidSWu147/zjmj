import { ClientMsg, GameView, RoomSummary, ServerMsg } from '../../shared/src/protocol';
import { ensureAuth, handleSignedOut, isAccount } from './account';
import { syncSettingsFromServer } from './settings';
import { playerName } from './identity';

export interface NetState {
  connected: boolean;
  rooms: RoomSummary[];
  myRoom: number | null;
  /** My private room's 4-digit join code (to share with friends). */
  myRoomCode: string | null;
  inMatch: boolean;
  gameView: GameView | null;
  toast: string | null;
}

type Listener = () => void;

class Net {
  state: NetState = {
    connected: false,
    rooms: [],
    myRoom: null,
    myRoomCode: null,
    inMatch: false,
    gameView: null,
    toast: null,
  };
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: number | null = null;
  private toastTimer: number | null = null;
  private pingTimer: number | null = null;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    // A session token must exist before the socket says hello.
    ensureAuth().then(
      (auth) => this.open(auth.token),
      () => this.scheduleReconnect(),
    );
  }

  private open(token: string): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.state.connected = true;
      this.sendRaw({ type: 'hello', token, name: playerName() });
      // Keepalive (v0.2.3 #3): the tutorial's clockless waits produce zero
      // traffic, and idle sockets get dropped after ~a minute — which used
      // to abort the tutorial out from under the player.
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.sendRaw({ type: 'ping' }), 25_000);
      this.emit();
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      this.state.connected = false;
      if (this.pingTimer !== null) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.emit();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private handle(msg: ServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        break;
      case 'lobby':
        this.state.rooms = msg.rooms;
        this.state.myRoom = msg.myRoom;
        this.state.myRoomCode = msg.myRoomCode;
        this.state.inMatch = msg.inMatch;
        // The match-end standings screen outlives the match on the server, so
        // a lobby update saying "not in a match" must not tear it down; the
        // overlay dismisses itself and clears the view.
        if (!msg.inMatch && this.state.gameView?.phase !== 'matchEnd') {
          // A tutorial dying under the player (disconnect abort) returns
          // them to the Help screen, not the lobby (v0.2.3 #3).
          const wasTutorial = this.state.gameView?.tutorial === true;
          this.state.gameView = null;
          if (wasTutorial && location.hash.includes('play')) location.hash = '#/help';
        }
        break;
      case 'game':
        this.state.gameView = msg.view;
        this.state.inMatch = true;
        break;
      case 'toast':
        this.showToast(msg.message);
        break;
      case 'signedOut':
        // Only surface the reason when an account session was dropped;
        // routine token churn for guests should be invisible.
        if (isAccount()) this.showToast(msg.reason);
        void handleSignedOut().then(() => {
          void syncSettingsFromServer();
          this.rehello();
        });
        break;
    }
    this.emit();
  }

  /** Client-originated toast (auth flows, etc.). */
  toast(message: string): void {
    this.showToast(message);
    this.emit();
  }

  private showToast(message: string): void {
    this.state.toast = message;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.state.toast = null;
      this.toastTimer = null;
      this.emit();
    }, 4000);
  }

  send(msg: ClientMsg): void {
    this.sendRaw(msg);
  }

  private sendRaw(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Reconnect with a fresh hello (e.g. after a rename). */
  rehello(): void {
    this.ws?.close();
  }

  onUpdate(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const net = new Net();
