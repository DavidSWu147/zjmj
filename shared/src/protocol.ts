import { Tile } from './tiles';
import { KongType, PatternHit } from './scoring';
import { ParSetting } from './payment';

export interface RoomSettings {
  /** Match length in rounds: 1 (東風戰), 2 (半莊戰), 4 (一莊戰). */
  rounds: 1 | 2 | 4;
  /** Pre-discard thinking time in seconds. */
  thinkingTime: 7.5 | 10 | 15;
  chickenHand: 'notAllowed' | 'zero' | 'one';
  par: ParSetting;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 4,
  thinkingTime: 15,
  chickenHand: 'one',
  par: 25,
};

export const ROOM_CAP = 4; // user-created rooms #1..#4, not counting room #0

export interface RoomSummary {
  id: number;
  settings: RoomSettings;
  players: { name: string; isBot: boolean }[];
  hostName: string | null;
  inGame: boolean;
}

export interface MeldView {
  kind: 'chow' | 'pung' | 'kong';
  tiles: Tile[];
  /** Index of the tile shown rotated 90°; -1 for none (concealed kong). */
  rotated: number;
  kongType?: KongType;
  /** Tile indices shown face-down (concealed kong outer tiles). */
  faceDown: number[];
  /** For a small exposed kong, the added tile stacks on the rotated tile. */
  stacked?: boolean;
}

export interface SeatView {
  name: string;
  isBot: boolean;
  connected: boolean;
  score: number;
  handCount: number;
  hasDrawn: boolean;
  melds: MeldView[];
  discards: { tile: Tile; fromDraw: boolean }[];
}

export type GamePhase =
  | 'dealing'
  | 'preDiscard'
  | 'postDiscard'
  | 'robbing'
  | 'gameEnd'
  | 'matchEnd';

export interface ClaimOptions {
  mahjong?: boolean;
  kong?: boolean;
  pung?: boolean;
  /** Low tiles of each possible chow. */
  chows?: Tile[];
}

export interface MyOptions {
  /** May select/confirm a discard right now. */
  discard?: boolean;
  /** Self-draw mahjong available (pre-discard with a drawn tile). */
  mahjong?: boolean;
  /** Kong declarations available in this pre-discard phase. */
  kongs?: { tile: Tile; variant: 'concealed' | 'small' }[];
  /** Claims available in the current post-discard/robbing phase. */
  claim?: ClaimOptions;
}

export interface GameResultView {
  draw: boolean;
  winnerSeat?: number;
  winBy?: 'self' | 'discard';
  responsibleSeat?: number | null;
  winningHand?: { concealed: Tile[]; melds: MeldView[]; winTile: Tile };
  patterns?: PatternHit[];
  total?: number;
  limit?: 'none' | 'compound' | 'listed';
  deltas: number[];
  /** Seconds until the next game starts / match ends. */
  nextIn: number;
}

export interface MatchResultView {
  standings: { name: string; isBot: boolean; score: number; result: 'WIN' | 'LOSE' | 'DRAW' }[];
}

export interface GameView {
  phase: GamePhase;
  gameNumber: string; // e.g. "E1"
  gameNumberZh: string; // e.g. "東一"
  remaining: number;
  dice: number[] | null;
  mySeat: number; // current-seat index of this client (0=E..3=N)
  turnSeat: number;
  seats: SeatView[]; // indexed by current seat
  myHand: Tile[];
  myDrawn: Tile | null;
  selected: Tile | null;
  deadline: number | null; // epoch ms when the phase times out
  phaseDuration: number | null; // ms
  lastDiscard: { seat: number; tile: Tile } | null;
  /** Keywords currently shown, color-coded per spec. */
  claims: { seat: number; kind: 'chow' | 'pung' | 'kong' | 'mahjong' }[];
  myOptions: MyOptions;
  /** My provisional chow/pung meld awaiting a discard choice. */
  pendingClaim: { kind: 'chow' | 'pung'; tiles: Tile[] } | null;
  gameResult: GameResultView | null;
  matchResult: MatchResultView | null;
}

export type GameAction =
  | { kind: 'select'; tile: Tile | null; fromDrawn?: boolean }
  | { kind: 'discard'; tile: Tile; fromDrawn?: boolean }
  | { kind: 'kong'; tile: Tile; variant: 'concealed' | 'small' }
  | { kind: 'mahjong' }
  | { kind: 'claim'; claim: 'pass' | 'pung' | 'kong' | 'mahjong' }
  | { kind: 'claim'; claim: 'chow'; chowLow: Tile };

export type ClientMsg =
  | { type: 'hello'; playerId: string; name: string }
  | { type: 'createRoom'; settings: RoomSettings }
  | { type: 'joinRoom'; roomId: number }
  | { type: 'leaveRoom' }
  | { type: 'deleteRoom' }
  | { type: 'startMatch' }
  | { type: 'leaveMatch' }
  | { type: 'action'; action: GameAction };

export type ServerMsg =
  | { type: 'welcome'; you: { id: string; name: string } }
  | { type: 'lobby'; rooms: RoomSummary[]; myRoom: number | null; inMatch: boolean }
  | { type: 'game'; view: GameView }
  | { type: 'toast'; message: string };

export const ROUND_WINDS = ['E', 'S', 'W', 'N'] as const;
export const ROUND_WINDS_ZH = ['東', '南', '西', '北'] as const;
export const NUMS_ZH = ['一', '二', '三', '四'] as const;

export function gameNumberOf(gameIndex: number): { latin: string; zh: string } {
  const round = Math.floor(gameIndex / 4);
  const num = gameIndex % 4;
  return {
    latin: `${ROUND_WINDS[round]}${num + 1}`,
    zh: `${ROUND_WINDS_ZH[round]}${NUMS_ZH[num]}`,
  };
}
