import { Tile } from './tiles';
import { KongType, PatternHit, ScoringMode } from './scoring';
import { ParSetting } from './payment';

export interface RoomSettings {
  /** Match length in rounds: 1 (東風戰), 2 (半莊戰), 4 (一莊戰). */
  rounds: 1 | 2 | 4;
  /** Pre-discard thinking time in seconds (10 is legacy, pre-0.1.1). */
  thinkingTime: 7.5 | 10 | 15 | 30;
  chickenHand: 'notAllowed' | 'zero' | 'one';
  par: ParSetting;
  /** Absent in v0.0 records: treat as 'original'. */
  scoring?: ScoringMode;
  /** Flowers & seasons; 'half' halves the category-11 values. Absent = none. */
  bonusTiles?: 'none' | 'half' | 'full';
}

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 4,
  thinkingTime: 30,
  chickenHand: 'one',
  par: 25,
  scoring: 'original',
  bonusTiles: 'none',
};

/**
 * "Standard settings" for the statistics split (0.1.4 #7): identical to Room
 * #0's defaults except that Match Length and Thinking Time are free. Matches
 * played under anything else are counted on the separate custom-stats page.
 */
export function isStandardSettings(s: RoomSettings): boolean {
  return (
    s.chickenHand === DEFAULT_SETTINGS.chickenHand &&
    s.par === DEFAULT_SETTINGS.par &&
    (s.scoring ?? 'original') === DEFAULT_SETTINGS.scoring &&
    (s.bonusTiles ?? 'none') === DEFAULT_SETTINGS.bonusTiles
  );
}

export const ROOM_CAP = 24; // user-created rooms #1..#24, not counting room #0

/** Brain used for the bots that fill a match's empty seats (0.1.4 #5). */
export type BotDifficulty = 'dummy' | 'chicken';

/**
 * The rebindable action hotkeys, as KeyboardEvent.key values (letters stored
 * uppercase, 'Enter' for return). The fixed keys — Escape, the digit row,
 * Backspace/Delete and Space — are not rebindable and never stored here.
 */
export interface KeyBindings {
  chow: string;
  pung: string;
  kong: string;
  /** Rightmost option of an ambiguous chow/kong choice. */
  optRight: string;
  /** Second-rightmost option. */
  optMid: string;
  /** Leftmost option when there are 3 choices. */
  optLeft: string;
  mahjong: string;
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  chow: 'A',
  pung: 'S',
  kong: 'D',
  optRight: 'E',
  optMid: 'W',
  optLeft: 'Q',
  mahjong: 'Enter',
};

/** Per-player preferences, cached client-side and saved to PlayFab user data. */
export interface PlayerSettings {
  /** Show English indices (1–9 / ESWN / R / G) in tile corners. */
  tileIndices: boolean;
  /** Draw the physical tile walls (ignored on mobile / small screens). */
  physicalWalls: boolean;
  /** In-match keyboard hotkeys (desktop). */
  hotkeys: boolean;
  keyBindings: KeyBindings;
  /** Slider defaults used when creating a new room. */
  defaultRoom: RoomSettings;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  tileIndices: false,
  physicalWalls: true,
  hotkeys: true,
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
  defaultRoom: { ...DEFAULT_SETTINGS },
};

/** Result of any successful /api/auth call that establishes a session. */
export interface AuthResponse {
  token: string;
  playerId: string;
  kind: 'guest' | 'account';
  /** Username for accounts; the guest display name otherwise. */
  name: string;
}

export interface RoomSummary {
  id: number;
  settings: RoomSettings;
  players: { name: string; isBot: boolean }[];
  hostName: string | null;
  inGame: boolean;
  /** Joining needs the room's 4-digit code (the code itself is never listed). */
  isPrivate: boolean;
  /** Spectators currently watching the running match (cap 4). */
  spectators?: number;
  /** Brain for the bots that fill empty seats (host-toggled). */
  botDifficulty: BotDifficulty;
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
  /** Revealed flowers & seasons, in the order they were set aside. */
  bonus: Tile[];
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
  /** Epoch ms when the next game starts (or the match ends). */
  nextAt: number;
  /** True if this was the final game: the match ends next, not another game. */
  lastGame: boolean;
}

export interface MatchResultView {
  /** Sorted by final score, highest first. */
  standings: { name: string; isBot: boolean; score: number; result: 'WIN' | 'LOSE' | 'DRAW' }[];
  /** Epoch ms (server clock) when the match screen closes. */
  endsAt: number;
}

export interface GameView {
  phase: GamePhase;
  /**
   * Server clock (epoch ms) when this view was built. All timestamps in the
   * view (deadline, claim expires, nextAt) are on this clock; clients must
   * offset against their own clock instead of trusting Date.now().
   */
  now: number;
  gameNumber: string; // e.g. "E1"
  gameNumberZh: string; // e.g. "東一"
  remaining: number;
  dice: number[] | null;
  /**
   * Physical wall state for clients that draw the walls (desktop). Columns
   * are indexed 0..cols-1 from the breakpoint in the dealing direction; the
   * dice sum locates the breakpoint from the right end of breakSeat's wall.
   */
  wall: {
    breakSeat: number;
    cols: number;
    diceSum: number;
    /** Tiles consumed off the live end (2 per column; 52 covers the deal). */
    livePointer: number;
    /** Tiles consumed off the dead end (kong/bonus replacements). */
    kongDrawn: number;
  } | null;
  mySeat: number; // current-seat index of this client (0=E..3=N)
  turnSeat: number;
  seats: SeatView[]; // indexed by current seat
  myHand: Tile[];
  myDrawn: Tile | null;
  selected: Tile | null;
  deadline: number | null; // epoch ms when the phase times out
  phaseDuration: number | null; // ms
  lastDiscard: { seat: number; tile: Tile } | null;
  /** Length of the uniform post-discard window (drives the discard slide). */
  claimGapMs: number;
  /** After a win: the winner's concealed hand, revealed to everyone. */
  reveal: { seat: number; hand: Tile[]; drawn: Tile | null } | null;
  /**
   * Keywords currently shown, color-coded per spec. Claim keywords stay for
   * the whole claim phase; announcements (kong declarations, wins) carry an
   * `expires` epoch-ms timestamp.
   */
  claims: {
    seat: number;
    kind: 'chow' | 'pung' | 'kong' | 'mahjong' | 'selfdraw' | 'cancel' | 'dealin';
    expires?: number;
  }[];
  myOptions: MyOptions;
  /** My provisional chow/pung meld awaiting a discard choice. */
  pendingClaim: { kind: 'chow' | 'pung'; tiles: Tile[] } | null;
  /**
   * Set during the pause between a win and the scoring screen. Hands of 30+
   * points flash the winner's quadrant gold; a pattern worth 125+ also shows
   * its name in large golden Chinese text (the pause is longer then).
   */
  winFlash: { seat: number; value: number; bigPattern?: { name: string; zh: string } } | null;
  gameResult: GameResultView | null;
  matchResult: MatchResultView | null;
  /**
   * The hosting room, shown at the top of the match screen — the only place
   * a private room's code stays visible once the match is under way (it is
   * needed to invite spectators). Null outside a room context (tests).
   */
  room: { id: number; code: string | null } | null;
  /**
   * Spectator view: `mySeat` is only a viewing perspective. All private
   * state (myHand, myDrawn, myOptions, …) is blanked server-side; the
   * perspective seat's tiles show as backs until a winning hand is revealed.
   */
  spectator?: boolean;
}

export type GameAction =
  | { kind: 'select'; tile: Tile | null; fromDrawn?: boolean }
  | { kind: 'discard'; tile: Tile; fromDrawn?: boolean }
  | { kind: 'kong'; tile: Tile; variant: 'concealed' | 'small' }
  | { kind: 'mahjong' }
  | { kind: 'claim'; claim: 'pass' | 'pung' | 'kong' | 'mahjong' }
  | { kind: 'claim'; claim: 'chow'; chowLow: Tile };

export type ClientMsg =
  | { type: 'hello'; token: string; name?: string }
  | { type: 'createRoom'; settings: RoomSettings; isPrivate?: boolean }
  | { type: 'joinRoom'; roomId: number; code?: string }
  | { type: 'leaveRoom' }
  | { type: 'deleteRoom' }
  /** Host only: pick the brain for the bots that fill empty seats. */
  | { type: 'setBotDifficulty'; difficulty: BotDifficulty }
  | { type: 'startMatch' }
  | { type: 'leaveMatch' }
  /** Join a running match as a spectator (up to 4 per match). Watching a
   *  private room's match needs its 4-digit code, same as joining. */
  | { type: 'watchMatch'; roomId: number; code?: string }
  /** Spectator only: switch the viewing perspective to this current seat. */
  | { type: 'spectateSeat'; seat: number }
  | { type: 'action'; action: GameAction };

export type ServerMsg =
  | { type: 'welcome'; you: { id: string; name: string } }
  /** `myRoomCode` is my private room's join code (shared out-of-band). */
  | { type: 'lobby'; rooms: RoomSummary[]; myRoom: number | null; myRoomCode: string | null; inMatch: boolean }
  | { type: 'game'; view: GameView }
  | { type: 'toast'; message: string }
  /** The session is no longer valid (signed in elsewhere, signed out, etc.). */
  | { type: 'signedOut'; reason: string };

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
