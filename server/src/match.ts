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
  resultMs: number;
  matchEndMs: number;
}

export const DEFAULT_TIMING: MatchTiming = {
  dealMs: 4500,
  botDelayMs: 700,
  resultMs: 10000,
  matchEndMs: 20000,
};

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
      timing: { dealMs: this.timing.dealMs, botDelayMs: this.timing.botDelayMs },
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
      nextIn: Math.round(this.timing.resultMs / 1000),
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
      standings: this.players.map((p, seat) => ({
        name: p.name,
        isBot: p.isBot,
        score: this.scores[seat],
        result: this.scores[seat] > 0 ? 'WIN' : this.scores[seat] < 0 ? 'LOSE' : 'DRAW',
      })),
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

  handleAction(playerId: string, action: Parameters<Game['handleAction']>[1]): void {
    if (this.finished || !this.game) return;
    const startSeat = this.players.findIndex((p) => p.id === playerId);
    if (startSeat < 0 || this.leftIds.has(playerId)) return;
    this.game.handleAction(this.currentSeatOf(startSeat), action);
  }

  viewFor(playerId: string): GameView | null {
    const startSeat = this.players.findIndex((p) => p.id === playerId);
    if (startSeat < 0) return null;
    const seat = this.currentSeatOf(startSeat);
    if (this.matchResultView || !this.game) {
      const base = this.game
        ? this.game.buildView(seat, this.resultView)
        : null;
      if (base) {
        base.phase = 'matchEnd';
        base.matchResult = this.matchResultView;
        return base;
      }
      return null;
    }
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
  }
}
