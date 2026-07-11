import { GameResultView, GameView, MatchResultView, RoomSettings } from '../../shared/src/protocol';
import { GameRecord, MatchRecord } from '../../shared/src/records';
import { Tile } from '../../shared/src/tiles';
import { Game, GameHost } from './game';

export interface MatchPlayer {
  id: string;
  name: string;
  isBot: boolean;
}

export interface MatchTiming {
  dealMs: number;
  botDelayMs: number;
  claimGapMs: number;
  resultMs: number;
  matchEndMs: number;
}

export const DEFAULT_TIMING: MatchTiming = {
  dealMs: 4500,
  botDelayMs: 700,
  claimGapMs: 1500,
  resultMs: 10000,
  matchEndMs: 10000, // final standings screen duration
};

/** Non-playing users allowed to watch a running match at one moment. */
export const SPECTATOR_CAP = 4;

export interface MatchDelegate {
  /** Push a view to a (human) player. */
  sendView(playerId: string, view: GameView): void;
  /** Called once when the match is over or aborted. */
  onMatchEnd(record: MatchRecord, aborted: boolean): void;
  isConnected(playerId: string): boolean;
  rng?: () => number;
  timing?: Partial<MatchTiming>;
}

/**
 * Runs a full match: seats players randomly, plays 4 x rounds games, keeps
 * cumulative scores, and assembles the MatchRecord.
 */
export class Match {
  readonly matchId = Date.now();
  readonly settings: RoomSettings;
  /** Players by starting seat (E,S,W,N). */
  readonly players: MatchPlayer[];
  readonly scores = [0, 0, 0, 0];
  private delegate: MatchDelegate;
  private timing: MatchTiming;
  private rng: () => number;

  private gameIndex = 0;
  private game: Game | null = null;
  private games: GameRecord[] = [];
  private resultView: GameResultView | null = null;
  private matchResultView: MatchResultView | null = null;
  private leftIds = new Set<string>();
  /** Watching playerIds mapped to their viewing perspective (START seat). */
  private spectators = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  finished = false;

  constructor(settings: RoomSettings, humans: MatchPlayer[], delegate: MatchDelegate) {
    this.settings = settings;
    this.delegate = delegate;
    this.timing = { ...DEFAULT_TIMING, ...delegate.timing };
    this.rng = delegate.rng ?? Math.random;

    const seated: MatchPlayer[] = [...humans];
    let botNum = 1;
    while (seated.length < 4) {
      seated.push({ id: `bot-${this.matchId}-${botNum}`, name: `Bot ${botNum}`, isBot: true });
      botNum++;
    }
    // Random seating regardless of join order (spec).
    for (let i = seated.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [seated[i], seated[j]] = [seated[j], seated[i]];
    }
    this.players = seated;
  }

  get totalGames(): number {
    return this.settings.rounds * 4;
  }

  /** Starting seat of the player at current seat s in the current game. */
  startSeatOf(currentSeat: number): number {
    return (currentSeat + this.gameIndex) % 4;
  }

  /** Current seat of the player who started at seat p. */
  currentSeatOf(startSeat: number): number {
    return (startSeat - this.gameIndex + 4 * this.totalGames) % 4;
  }

  playerAt(currentSeat: number): MatchPlayer {
    return this.players[this.startSeatOf(currentSeat)];
  }

  start(): void {
    this.startGame();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.game?.dispose();
  }

  private makeHost(): GameHost {
    return {
      settings: this.settings,
      isBot: (seat) => {
        const p = this.playerAt(seat);
        return p.isBot || this.leftIds.has(p.id) || !this.delegate.isConnected(p.id);
      },
      isBotPlayer: (seat) => this.playerAt(seat).isBot,
      nameOf: (seat) => this.playerAt(seat).name,
      isConnected: (seat) => {
        const p = this.playerAt(seat);
        return p.isBot ? true : !this.leftIds.has(p.id) && this.delegate.isConnected(p.id);
      },
      scoreOf: (seat) => this.scores[this.startSeatOf(seat)],
      onChange: () => this.broadcast(),
      onGameEnd: (record, deltas) => this.handleGameEnd(record, deltas),
      rng: this.rng,
      timing: {
        dealMs: this.timing.dealMs,
        botDelayMs: this.timing.botDelayMs,
        claimGapMs: this.timing.claimGapMs,
      },
    };
  }

  private startGame(): void {
    this.resultView = null;
    this.game = new Game(this.gameIndex, this.makeHost());
    this.game.start();
  }

  private handleGameEnd(record: GameRecord, deltas: number[]): void {
    this.games.push(record);
    for (let s = 0; s < 4; s++) {
      this.scores[this.startSeatOf(s)] += deltas[s];
    }
    const r = record.result;
    this.resultView = {
      draw: r.winnerSeat === null,
      winnerSeat: r.winnerSeat ?? undefined,
      winBy: r.winBy,
      responsibleSeat: r.responsibleSeat,
      winningHand:
        r.winnerSeat !== null && this.game
          ? {
              concealed: this.game.publicHand(r.winnerSeat),
              melds: this.game.publicMeldViews(r.winnerSeat),
              winTile: this.game.publicDrawn(r.winnerSeat) ?? ('' as Tile),
            }
          : undefined,
      patterns: r.patterns,
      total: r.value,
      limit: this.game?.resultScore?.limit,
      deltas,
      nextAt: Date.now() + this.timing.resultMs,
      lastGame: this.gameIndex + 1 >= this.totalGames,
    };
    this.broadcast();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, this.timing.resultMs);
  }

  private advance(): void {
    if (this.finished) return;
    this.game?.dispose();
    this.gameIndex++;
    if (this.gameIndex >= this.totalGames) {
      this.endMatch(false);
    } else {
      this.startGame();
    }
  }

  private endMatch(aborted: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.game?.dispose();
    if (this.timer) clearTimeout(this.timer);
    this.matchResultView = {
      standings: this.players
        .map((p, seat) => ({
          name: p.name,
          isBot: p.isBot,
          score: this.scores[seat],
          result: (this.scores[seat] > 0 ? 'WIN' : this.scores[seat] < 0 ? 'LOSE' : 'DRAW') as
            | 'WIN'
            | 'LOSE'
            | 'DRAW',
        }))
        .sort((a, b) => b.score - a.score),
      endsAt: Date.now() + this.timing.matchEndMs,
    };
    this.broadcast();
    const record: MatchRecord = {
      matchId: this.matchId,
      matchLength: this.settings.rounds,
      settings: this.settings,
      players: this.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
      games: this.games,
      finalScores: [...this.scores],
      abandonedBy: [...this.leftIds],
    };
    this.delegate.onMatchEnd(record, aborted);
  }

  /** A human leaves mid-match: bots take over; abort if no humans remain. */
  leave(playerId: string): void {
    this.leftIds.add(playerId);
    const humansLeft = this.players.some((p) => !p.isBot && !this.leftIds.has(p.id));
    if (!humansLeft) {
      this.endMatch(true);
      return;
    }
    // If it is now a bot-controlled seat's turn, nudge the game.
    this.broadcast();
    this.game?.nudgeBots();
  }

  /** Let bot control take over any phase stalled on a departed human. */
  nudge(): void {
    this.game?.nudgeBots();
  }

  /** Has this player permanently left the match (a bot holds their seat)? */
  hasLeft(playerId: string): boolean {
    return this.leftIds.has(playerId);
  }

  // ── spectators ──────────────────────────────────────────────────────
  // Watchers are not players: they hold no seat, cannot act, and see only
  // public information. Their perspective is stored as a START seat so it
  // follows the same player across the match's seat rotations.

  get spectatorCount(): number {
    return this.spectators.size;
  }

  hasSpectator(playerId: string): boolean {
    return this.spectators.has(playerId);
  }

  /** Adds a watcher (default perspective: the starting East player). */
  addSpectator(playerId: string): string | null {
    if (this.finished) return 'The match has already finished.';
    if (this.players.some((p) => p.id === playerId)) return 'You are playing in this match.';
    if (!this.spectators.has(playerId) && this.spectators.size >= SPECTATOR_CAP) {
      return `Spectator limit reached (${SPECTATOR_CAP}).`;
    }
    this.spectators.set(playerId, 0);
    this.sendSpectatorView(playerId);
    return null;
  }

  removeSpectator(playerId: string): void {
    this.spectators.delete(playerId);
  }

  /** Perspective switch; `currentSeat` is a seat of the game being shown. */
  setSpectatorSeat(playerId: string, currentSeat: number): void {
    if (!this.spectators.has(playerId) || !this.game) return;
    const seat = ((Math.trunc(currentSeat) % 4) + 4) % 4;
    this.spectators.set(playerId, (seat + this.game.gameIndex) % 4);
    this.sendSpectatorView(playerId);
  }

  viewForSpectator(playerId: string): GameView | null {
    const startSeat = this.spectators.get(playerId);
    if (startSeat === undefined || !this.game) return null;
    const seat = (startSeat - (this.game.gameIndex % 4) + 4) % 4;
    const v = this.game.buildView(seat, this.resultView);
    // Blank every piece of private state: the perspective seat's concealed
    // tiles stay hidden (the client draws backs from seats[].handCount and
    // only the reveal-on-win shows faces).
    v.spectator = true;
    v.myHand = [];
    v.myDrawn = null;
    v.selected = null;
    v.myOptions = {};
    v.pendingClaim = null;
    if (this.matchResultView) {
      v.phase = 'matchEnd';
      v.matchResult = this.matchResultView;
    }
    return v;
  }

  private sendSpectatorView(playerId: string): void {
    const v = this.viewForSpectator(playerId);
    if (v) this.delegate.sendView(playerId, v);
  }

  handleAction(playerId: string, action: Parameters<Game['handleAction']>[1]): void {
    if (this.finished || !this.game) return;
    const startSeat = this.players.findIndex((p) => p.id === playerId);
    if (startSeat < 0 || this.leftIds.has(playerId)) return;
    this.game.handleAction(this.currentSeatOf(startSeat), action);
  }

  viewFor(playerId: string): GameView | null {
    const startSeat = this.players.findIndex((p) => p.id === playerId);
    if (startSeat < 0 || !this.game) return null;
    // Seat mapping must follow the game being SHOWN, not the match's game
    // counter: at match end the counter has already advanced past the final
    // game, which used to rotate every viewer's perspective to their
    // starting seat under the standings screen.
    const seat = (startSeat - (this.game.gameIndex % 4) + 4) % 4;
    const v = this.game.buildView(seat, this.resultView);
    if (this.matchResultView) {
      v.phase = 'matchEnd';
      v.matchResult = this.matchResultView;
    }
    return v;
  }

  broadcast(): void {
    for (const p of this.players) {
      if (p.isBot || this.leftIds.has(p.id)) continue;
      const v = this.viewFor(p.id);
      if (v) this.delegate.sendView(p.id, v);
    }
    for (const pid of this.spectators.keys()) this.sendSpectatorView(pid);
  }
}
