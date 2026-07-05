import { ClientMsg, GameView, RoomSummary, ServerMsg } from '../../shared/src/protocol';
import { playerId, playerName } from './identity';

export interface NetState {
  connected: boolean;
  rooms: RoomSummary[];
  myRoom: number | null;
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
    inMatch: false,
    gameView: null,
    toast: null,
  };
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: number | null = null;
  private toastTimer: number | null = null;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.state.connected = true;
      this.sendRaw({ type: 'hello', playerId: playerId(), name: playerName() });
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
      this.emit();
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1500);
      }
    };
  }

  private handle(msg: ServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        break;
      case 'lobby':
        this.state.rooms = msg.rooms;
        this.state.myRoom = msg.myRoom;
        this.state.inMatch = msg.inMatch;
        if (!msg.inMatch) this.state.gameView = null;
        break;
      case 'game':
        this.state.gameView = msg.view;
        this.state.inMatch = true;
        break;
      case 'toast':
        this.state.toast = msg.message;
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => {
          this.state.toast = null;
          this.toastTimer = null;
          this.emit();
        }, 4000);
        break;
    }
    this.emit();
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
