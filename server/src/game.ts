import {
  canWinShape,
  chowOptions,
  countsFrom,
  gameNumberOf,
  Meld,
  scoreWin,
  ScoreResult,
  sortTiles,
  Tile,
  tileFromIndex,
  tileIndex,
  Wall,
  winningTileIndices,
} from '../../shared/src/index';
import { computePayments, findResponsible } from '../../shared/src/payment';
import {
  ClaimOptions,
  GameAction,
  GamePhase,
  GameResultView,
  GameView,
  MeldView,
  MyOptions,
  RoomSettings,
  SeatView,
} from '../../shared/src/protocol';
import { GameRecord, GameResultRecord, MoveRecord, MovePart1 } from '../../shared/src/records';

/** All seat indices in this module are *current* seats (0 = this game's East). */

export interface GameTiming {
  dealMs: number;
  botDelayMs: number;
  /**
   * Minimum time a discard sits on the table before the next turn starts,
   * whether or not any claims are possible — instant advancement would leak
   * that nobody could claim. Matches the client's discard-slide animation.
   */
  claimGapMs: number;
}

export interface GameHost {
  settings: RoomSettings;
  /** Is this current seat driven by the server (bot or disconnected human)? */
  isBot(seat: number): boolean;
  nameOf(seat: number): string;
  isBotPlayer(seat: number): boolean;
  isConnected(seat: number): boolean;
  scoreOf(seat: number): number;
  onChange(): void;
  onGameEnd(record: GameRecord, deltas: number[]): void;
  rng(): number;
  timing: GameTiming;
}

type ClaimKind = 'chow' | 'pung' | 'kong' | 'mahjong';

interface ClaimAvail {
  mahjong: boolean;
  kong: boolean;
  pung: boolean;
  chows: number[]; // low tile indices
}

type ClaimChoice =
  | null
  | { kind: 'pass' }
  | { kind: 'mahjong' }
  | { kind: 'kong' }
  | { kind: 'pung' }
  | { kind: 'chow'; low: number };

interface ClaimSlot {
  avail: ClaimAvail;
  choice: ClaimChoice;
  discardSel: Tile | null;
  discardSelFromDrawn: boolean;
  discardConfirmed: boolean;
  kongAfter: { tile: Tile; variant: 'concealed' | 'small' } | null;
  /**
   * Claim kinds this seat has already made visible in this phase. The phase
   * timer resets only on first-time announcements, so cycling a claim on and
   * off cannot farm unlimited thinking time.
   */
  announcedKinds: Set<ClaimKind>;
  /**
   * Set when another player makes a visible claim after this seat has acted:
   * the seat may amend. Sticky — a quick claim-then-cancel by the other
   * player must not snatch the reopened options away; only this seat acting
   * again (or resolution) closes them.
   */
  reopened: boolean;
}

interface ClaimPhase {
  discarder: number;
  tile: Tile;
  riverbed: boolean;
  slots: Map<number, ClaimSlot>;
}

interface RobPhase {
  konger: number;
  tile: Tile;
  /** Seats that can rob, mapped to their choice. */
  slots: Map<number, 'undecided' | 'pass' | 'mahjong'>;
  pungMeld: Meld;
}

export class Game {
  readonly gameIndex: number;
  private host: GameHost;
  private wall: Wall;

  readonly startingHands: Tile[][];
  private hands: Tile[][]; // sorted, excluding drawn tile
  private drawn: (Tile | null)[] = [null, null, null, null];
  private drawnFromDead = false;
  private melds: Meld[][] = [[], [], [], []];
  private discards: { tile: Tile; fromDraw: boolean }[][] = [[], [], [], []];
  private discardLog: { seat: number; tile: Tile }[] = [];
  private selected: (Tile | null)[] = [null, null, null, null];
  private selectedFromDrawn = [false, false, false, false];

  private phase: GamePhase = 'dealing';
  private turnSeat = 0;
  private deadline: number | null = null;
  private phaseDuration: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

  private claim: ClaimPhase | null = null;
  private rob: RobPhase | null = null;
  /** When the current discard hit the table (uniform-window pacing). */
  private claimWindowStart = 0;
  /** Tile just claimed by pung within the still-open claim turn (small-kong restriction). */
  private justPunged: Tile | null = null;

  private moves: MoveRecord[] = [];
  private currentMove: { seat: number; part1: MovePart1 } | null = null;
  /** Transient keyword announcements (kong declarations, wins, cancels). */
  private announcements: {
    seat: number;
    kind: 'kong' | 'mahjong' | 'selfdraw' | 'cancel';
    expires: number;
  }[] = [];

  result: GameResultRecord | null = null;
  resultScore: ScoreResult | null = null;
  ended = false;

  constructor(gameIndex: number, host: GameHost) {
    this.gameIndex = gameIndex;
    this.host = host;
    this.wall = new Wall(host.rng);
    this.hands = this.wall.hands.map((h) => sortTiles(h));
    this.startingHands = this.hands.map((h) => [...h]);
  }

  get dice(): number[] {
    return [...this.wall.dice];
  }

  start(): void {
    this.phase = 'dealing';
    this.schedule(this.host.timing.dealMs, () => this.beginTurn(0, 'live'));
    this.host.onChange();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.timer = null;
    this.botTimer = null;
  }

  // ── timers ────────────────────────────────────────────────────────────────

  private schedule(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.phaseDuration = ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  /** Schedule without a visible countdown (uniform pacing windows). */
  private scheduleSilent(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.deadline = null;
    this.phaseDuration = null;
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private thinkingMs(): number {
    return this.host.settings.thinkingTime * 1000;
  }

  /** Post-discard time: half the thinking time, but at least 5 seconds. */
  private claimMs(): number {
    return Math.max(this.thinkingMs() / 2, 5000);
  }

  /** Uniform window per discard: 1s at 7.5s/10s thinking time, 1.5s at 15s. */
  private gapMs(): number {
    const base = this.host.timing.claimGapMs;
    return this.host.settings.thinkingTime === 15 ? base : Math.min(base, 1000);
  }

  // ── move recording ────────────────────────────────────────────────────────

  private flushMove(): void {
    if (this.currentMove) {
      this.moves.push(this.currentMove as MoveRecord);
      this.currentMove = null;
    }
  }

  private recordMove(m: MoveRecord): void {
    this.flushMove();
    this.moves.push(m);
  }

  private announce(seat: number, kind: 'kong' | 'mahjong' | 'selfdraw' | 'cancel', ms = 1600): void {
    const now = Date.now();
    this.announcements = this.announcements.filter((a) => a.expires > now);
    this.announcements.push({ seat, kind, expires: now + ms });
  }

  // ── turn flow ─────────────────────────────────────────────────────────────

  private beginTurn(seat: number, source: 'live' | 'dead'): void {
    this.flushMove();
    this.phase = 'preDiscard';
    this.turnSeat = seat;
    this.claim = null;
    this.rob = null;
    this.justPunged = null;
    this.selected[seat] = null;

    const tile = source === 'live' ? this.wall.drawLive() : this.wall.drawKong();
    this.drawn[seat] = tile;
    this.drawnFromDead = source === 'dead';
    this.currentMove = { seat, part1: { t: 'draw', tile } };

    this.schedule(this.thinkingMs(), () => this.preDiscardTimeout(seat));
    if (this.host.isBot(seat)) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.phase === 'preDiscard' && this.turnSeat === seat && !this.ended) {
          this.doDiscard(seat, this.drawn[seat]!, true);
        }
      }, this.host.timing.botDelayMs);
    }
    this.host.onChange();
  }

  private preDiscardTimeout(seat: number): void {
    if (this.phase !== 'preDiscard' || this.turnSeat !== seat || this.ended) return;
    // Timeout: discard the selected tile if any, else the drawn tile.
    const sel = this.selected[seat];
    if (sel !== null) this.doDiscard(seat, sel, this.selectedFromDrawn[seat]);
    else this.doDiscard(seat, this.drawn[seat]!, true);
  }

  /** The seat holding the seabed tile (drawn when the counter reached 0). */
  private isSeabedTurn(): boolean {
    return this.wall.remaining === 0;
  }

  private doDiscard(seat: number, tile: Tile, fromDrawn: boolean): void {
    // Normalize: can only discard "from drawn" if it matches the drawn tile.
    const drawnTile = this.drawn[seat];
    if (fromDrawn && tile !== drawnTile) fromDrawn = false;
    if (!fromDrawn) {
      const i = this.hands[seat].indexOf(tile);
      if (i < 0) return; // invalid
      this.hands[seat].splice(i, 1);
      if (drawnTile !== null) {
        this.hands[seat].push(drawnTile);
        this.hands[seat] = sortTiles(this.hands[seat]);
      }
    }
    this.drawn[seat] = null;
    this.selected[seat] = null;
    this.discards[seat].push({ tile, fromDraw: fromDrawn });
    this.discardLog.push({ seat, tile });

    if (this.currentMove && this.currentMove.part1.t === 'draw') {
      if (fromDrawn) {
        this.currentMove = { seat, part1: { t: 'drawAndDiscard', tile } };
        this.flushMove();
      } else {
        this.moves.push({ seat, part1: this.currentMove.part1, part2: { t: 'discard', tile } });
        this.currentMove = null;
      }
    } else {
      // Shouldn't happen: claim discards go through resolveClaimWinner.
      this.recordMove({ seat, part1: { t: 'drawAndDiscard', tile } });
    }

    this.enterClaimPhase(seat, tile);
  }

  // ── claim phase ───────────────────────────────────────────────────────────

  private computeAvail(seat: number, discarder: number, tile: Tile, riverbed: boolean): ClaimAvail {
    const avail: ClaimAvail = { mahjong: false, kong: false, pung: false, chows: [] };
    const counts = countsFrom(this.hands[seat]);
    const ti = tileIndex(tile);
    avail.mahjong = this.canWinOn(seat, tile);
    if (!riverbed) {
      if (counts[ti] >= 3 && this.wall.remaining > 0) avail.kong = true;
      if (counts[ti] >= 2) avail.pung = true;
      if (seat === (discarder + 1) % 4) avail.chows = chowOptions(counts, tile);
    }
    return avail;
  }

  private canWinOn(seat: number, tile: Tile): boolean {
    const counts = countsFrom(this.hands[seat]);
    counts[tileIndex(tile)]++;
    if (!canWinShape(counts, this.melds[seat].length)) return false;
    if (this.host.settings.chickenHand === 'notAllowed') {
      return !this.scoreFor(seat, tile, 'discard', false).chicken;
    }
    return true;
  }

  private enterClaimPhase(discarder: number, tile: Tile): void {
    const riverbed = this.isSeabedTurn();
    const slots = new Map<number, ClaimSlot>();
    for (let s = 0; s < 4; s++) {
      if (s === discarder) continue;
      if (this.host.isBot(s)) continue; // dummy bots never claim
      const avail = this.computeAvail(s, discarder, tile, riverbed);
      if (avail.mahjong || avail.kong || avail.pung || avail.chows.length > 0) {
        slots.set(s, {
          avail,
          choice: null,
          discardSel: null,
          discardSelFromDrawn: false,
          discardConfirmed: false,
          kongAfter: null,
          announcedKinds: new Set(),
          reopened: false,
        });
      }
    }
    this.claimWindowStart = Date.now();
    if (slots.size === 0) {
      // Nobody can claim, but pause for the uniform window anyway so the
      // pacing never reveals whether a claim was possible.
      this.phase = 'postDiscard';
      this.claim = null;
      this.scheduleSilent(this.gapMs(), () => this.afterUnclaimedDiscard(discarder, riverbed));
      this.host.onChange();
      return;
    }
    this.phase = 'postDiscard';
    this.claim = { discarder, tile, riverbed, slots };
    this.schedule(this.claimMs(), () => this.resolveClaims(true));
    this.host.onChange();
  }

  /** All-passed: advance, but never before the uniform window has elapsed. */
  private advanceAfterGap(discarder: number, riverbed: boolean): void {
    this.claim = null;
    const wait = this.claimWindowStart + this.gapMs() - Date.now();
    if (wait > 10) {
      this.phase = 'postDiscard';
      this.scheduleSilent(wait, () => this.afterUnclaimedDiscard(discarder, riverbed));
      this.host.onChange();
    } else {
      this.afterUnclaimedDiscard(discarder, riverbed);
    }
  }

  private afterUnclaimedDiscard(discarder: number, riverbed: boolean): void {
    if (riverbed) {
      this.endInDraw();
    } else {
      this.beginTurn((discarder + 1) % 4, 'live');
    }
  }

  /** Priority rank of a claim; lower wins. */
  private claimRank(seat: number, kind: ClaimKind, discarder: number): number {
    const dist = (seat - discarder + 4) % 4; // 1 = next, 2 = opposite, 3 = previous
    if (kind === 'mahjong') return dist; // 1..3
    if (kind === 'kong') return 10;
    if (kind === 'pung') return 11;
    return 12; // chow
  }

  handleClaimAction(seat: number, action: GameAction): void {
    const c = this.claim;
    if (!c || this.phase !== 'postDiscard') return;
    const slot = c.slots.get(seat);
    if (!slot) return;

    if (action.kind === 'claim') {
      let choice: ClaimChoice = null;
      if (action.claim === 'pass') choice = { kind: 'pass' };
      else if (action.claim === 'mahjong' && slot.avail.mahjong) choice = { kind: 'mahjong' };
      else if (action.claim === 'kong' && slot.avail.kong) choice = { kind: 'kong' };
      else if (action.claim === 'pung' && slot.avail.pung) choice = { kind: 'pung' };
      else if (action.claim === 'chow') {
        const low = tileIndex(action.chowLow);
        if (slot.avail.chows.includes(low)) choice = { kind: 'chow', low };
      }
      if (!choice) return;
      // Amendments after acting are only reopened by ANOTHER player's visible
      // claim (spec's reactivation rule): a seat that passed may claim again,
      // and a pung/chow claimant may upgrade to mahjong, only in that case.
      if (slot.choice && choice.kind !== 'pass') {
        if (slot.choice.kind === 'pass' && !slot.reopened) return;
        if (slot.choice.kind === 'pung' || slot.choice.kind === 'chow') {
          // Only a mahjong upgrade is allowed, and only when reopened.
          if (choice.kind !== 'mahjong' || !slot.reopened) return;
        }
      }
      const wasPungChow = slot.choice && (slot.choice.kind === 'pung' || slot.choice.kind === 'chow');
      if (wasPungChow && choice.kind === 'pass') {
        // Withdrawn claim: everyone sees CANCEL so the vanished keyword is
        // not mistaken for a frozen screen.
        this.announce(seat, 'cancel', 1400);
      }
      slot.choice = choice;
      // Acting consumes this seat's reopening; a visible claim reopens the
      // options of every other seat that has already acted.
      slot.reopened = false;
      if (choice.kind !== 'pass') {
        for (const [s2, sl2] of c.slots) {
          if (s2 !== seat && sl2.choice !== null) sl2.reopened = true;
        }
      }
      slot.discardSel = null;
      slot.discardConfirmed = false;
      slot.kongAfter = null;
      // A newly visible claim resets the phase timer so higher-priority
      // holders can amend (spec) — but only the first time this seat shows
      // this claim kind, so on/off cycling cannot farm thinking time.
      if (choice.kind !== 'pass' && !slot.announcedKinds.has(choice.kind as ClaimKind)) {
        slot.announcedKinds.add(choice.kind as ClaimKind);
        this.schedule(this.claimMs(), () => this.resolveClaims(true));
      }
      this.checkClaimResolution();
      this.host.onChange();
      return;
    }

    // Provisional discard selection for a pung/chow claimant.
    if (slot.choice && (slot.choice.kind === 'pung' || slot.choice.kind === 'chow')) {
      if (action.kind === 'select') {
        slot.discardSel = action.tile;
        slot.discardConfirmed = false;
        this.host.onChange();
        return;
      }
      if (action.kind === 'discard') {
        if (!this.claimantCanDiscard(seat, slot, action.tile)) return;
        slot.discardSel = action.tile;
        slot.discardConfirmed = true;
        slot.kongAfter = null;
        this.checkClaimResolution();
        this.host.onChange();
        return;
      }
      if (action.kind === 'kong') {
        if (!this.validKongAfter(seat, slot, action.tile, action.variant)) return;
        slot.kongAfter = { tile: action.tile, variant: action.variant };
        slot.discardConfirmed = false;
        this.checkClaimResolution();
        this.host.onChange();
        return;
      }
    }
  }

  /** Tiles the claimant would hold after the meld is taken out. */
  private handAfterClaim(seat: number, slot: ClaimSlot): Tile[] | null {
    const c = this.claim!;
    const hand = [...this.hands[seat]];
    const used: Tile[] = [];
    if (slot.choice!.kind === 'pung') used.push(c.tile, c.tile);
    else if (slot.choice!.kind === 'chow') {
      const low = (slot.choice as { kind: 'chow'; low: number }).low;
      for (let k = 0; k < 3; k++) {
        const t = tileFromIndex(low + k);
        if (t !== c.tile || used.includes(t)) used.push(t);
      }
      // remove the claimed tile itself from "used from hand"
      const i = used.indexOf(c.tile);
      if (i >= 0) used.splice(i, 1);
      while (used.length > 2) used.pop();
    }
    for (const t of used) {
      const i = hand.indexOf(t);
      if (i < 0) return null;
      hand.splice(i, 1);
    }
    return hand;
  }

  private claimantCanDiscard(seat: number, slot: ClaimSlot, tile: Tile): boolean {
    const rest = this.handAfterClaim(seat, slot);
    return rest !== null && rest.includes(tile);
  }

  private validKongAfter(
    seat: number,
    slot: ClaimSlot,
    tile: Tile,
    variant: 'concealed' | 'small',
  ): boolean {
    if (this.wall.remaining === 0) return false;
    const rest = this.handAfterClaim(seat, slot);
    if (!rest) return false;
    const counts = countsFrom(rest);
    const ti = tileIndex(tile);
    if (variant === 'concealed') return counts[ti] === 4;
    // Small exposed kong: an existing exposed pung (from an earlier turn — the
    // meld being made right now is not on the table yet, so it cannot be
    // upgraded, which enforces the "just punged" restriction naturally).
    return (
      counts[ti] >= 1 &&
      this.melds[seat].some((m) => m.kind === 'pung' && m.tile === tile)
    );
  }

  /**
   * Early-resolution check. Resolve when the current best selection can
   * neither be beaten nor amended-over; otherwise the deadline resolves.
   */
  private checkClaimResolution(): void {
    const c = this.claim!;
    const slots = [...c.slots.entries()];

    const mahjongCapable = slots
      .filter(([, s]) => s.avail.mahjong)
      .map(([seat]) => seat)
      .sort(
        (a, b) => this.claimRank(a, 'mahjong', c.discarder) - this.claimRank(b, 'mahjong', c.discarder),
      );

    // Immediate win: the top-priority mahjong-capable seat locked mahjong.
    if (mahjongCapable.length > 0) {
      const top = mahjongCapable[0];
      const topSlot = c.slots.get(top)!;
      if (topSlot.choice?.kind === 'mahjong') {
        this.resolveClaims(false);
        return;
      }
    }

    // Otherwise wait until everyone has chosen.
    if (slots.some(([, s]) => s.choice === null)) return;

    const best = this.bestSelection(false);
    if (!best) {
      // Everyone passed.
      this.advanceAfterGap(c.discarder, c.riverbed);
      return;
    }
    const [bestSeat, bestKind] = best;

    // Can any other seat still amend to something that beats the best claim?
    const beatable = slots.some(([seat, s]) => {
      if (seat === bestSeat) return false;
      const options: ClaimKind[] = [];
      if (s.avail.mahjong) options.push('mahjong');
      if (s.avail.kong) options.push('kong');
      if (s.avail.pung) options.push('pung');
      if (s.avail.chows.length) options.push('chow');
      return options.some(
        (k) =>
          this.claimRank(seat, k, c.discarder) < this.claimRank(bestSeat, bestKind, c.discarder),
      );
    });
    if (beatable) return; // deadline (with resets) arbitrates amendments

    if (bestKind === 'pung' || bestKind === 'chow') {
      const s = c.slots.get(bestSeat)!;
      if (!s.discardConfirmed && !s.kongAfter) return; // wait for their discard
    }
    this.resolveClaims(false);
  }

  /**
   * Best claim among current selections. On timeout, pung/chow claims survive
   * only if a discard tile was at least selected (spec).
   */
  private bestSelection(timedOut: boolean): [number, ClaimKind] | null {
    const c = this.claim!;
    let best: [number, ClaimKind] | null = null;
    let bestRank = Infinity;
    for (const [seat, s] of c.slots) {
      if (!s.choice || s.choice.kind === 'pass') continue;
      const kind = s.choice.kind as ClaimKind;
      if (kind === 'pung' || kind === 'chow') {
        const hasFollowup = s.discardConfirmed || s.kongAfter !== null || s.discardSel !== null;
        if (timedOut && !hasFollowup) continue; // claim fails, cascade
        if (!timedOut && !(s.discardConfirmed || s.kongAfter)) {
          // Not ready; still counts for ranking (phase stays open for them).
        }
      }
      const rank = this.claimRank(seat, kind, c.discarder);
      if (rank < bestRank) {
        bestRank = rank;
        best = [seat, kind];
      }
    }
    return best;
  }

  private resolveClaims(timedOut: boolean): void {
    const c = this.claim;
    if (!c || this.phase !== 'postDiscard' || this.ended) return;
    if (timedOut) {
      // Pung/chow claims that never got a discard selected fail now: show
      // CANCEL so other players understand why the keyword vanished.
      for (const [seat, slot] of c.slots) {
        if (
          slot.choice &&
          (slot.choice.kind === 'pung' || slot.choice.kind === 'chow') &&
          !slot.discardConfirmed &&
          !slot.kongAfter &&
          slot.discardSel === null
        ) {
          this.announce(seat, 'cancel', 1400);
        }
      }
    }
    const best = this.bestSelection(timedOut);
    if (!best) {
      this.advanceAfterGap(c.discarder, c.riverbed);
      return;
    }
    const [seat, kind] = best;
    const slot = c.slots.get(seat)!;

    if (kind === 'mahjong') {
      this.claim = null;
      this.winByDiscard(seat, c.discarder, c.tile, false);
      return;
    }

    // Take the claimed tile off the table.
    this.discards[c.discarder].pop();

    if (kind === 'kong') {
      this.claim = null;
      this.takeBigKong(seat, c.discarder, c.tile);
      return;
    }

    // Pung / chow.
    const meld: Meld =
      kind === 'pung'
        ? { kind: 'pung', tile: c.tile, claimedFrom: c.discarder, claimedTile: c.tile }
        : {
            kind: 'chow',
            tile: tileFromIndex((slot.choice as { kind: 'chow'; low: number }).low),
            claimedFrom: c.discarder,
            claimedTile: c.tile,
          };
    // Remove the meld tiles from hand.
    const rest = this.handAfterClaim(seat, slot)!;
    this.hands[seat] = sortTiles(rest);
    this.melds[seat].push(meld);
    this.turnSeat = seat;
    this.claim = null;

    const part1: MovePart1 =
      kind === 'pung'
        ? { t: 'pung', tile: c.tile }
        : { t: 'chow', tile: c.tile, low: meld.tile };

    if (slot.kongAfter) {
      this.justPunged = kind === 'pung' ? c.tile : null;
      this.recordMove({ seat, part1, part2: { t: 'kong', tile: slot.kongAfter.tile } });
      this.declareKongTiles(seat, slot.kongAfter.tile, slot.kongAfter.variant, false);
      return;
    }

    // Discard to finish the claim turn.
    const tile = slot.discardSel!;
    const i = this.hands[seat].indexOf(tile);
    if (i < 0) {
      // Defensive: discard the last tile instead.
      const fallback = this.hands[seat][this.hands[seat].length - 1];
      this.finishClaimDiscard(seat, part1, fallback);
      return;
    }
    this.finishClaimDiscard(seat, part1, tile);
  }

  private finishClaimDiscard(seat: number, part1: MovePart1, tile: Tile): void {
    const i = this.hands[seat].indexOf(tile);
    this.hands[seat].splice(i, 1);
    this.discards[seat].push({ tile, fromDraw: false });
    this.discardLog.push({ seat, tile });
    this.recordMove({ seat, part1, part2: { t: 'discard', tile } });
    this.selected[seat] = null;
    this.enterClaimPhase(seat, tile);
  }

  // ── kongs ─────────────────────────────────────────────────────────────────

  private takeBigKong(seat: number, discarder: number, tile: Tile): void {
    // Remove the three matching tiles from hand.
    for (let k = 0; k < 3; k++) {
      const i = this.hands[seat].indexOf(tile);
      this.hands[seat].splice(i, 1);
    }
    this.melds[seat].push({
      kind: 'kong',
      tile,
      kongType: 'big',
      claimedFrom: discarder,
      claimedTile: tile,
    });
    this.turnSeat = seat;
    this.recordMove({ seat, part1: { t: 'bigKong', tile } });
    this.announce(seat, 'kong');
    this.beginTurn(seat, 'dead');
  }

  /**
   * Executes a concealed or small exposed kong for the turn player (or a
   * pung/chow claimant). A small exposed kong opens a robbing window.
   */
  private declareKongTiles(
    seat: number,
    tile: Tile,
    variant: 'concealed' | 'small',
    fromPreDiscard: boolean,
  ): void {
    // Merge the drawn tile into hand first (pre-discard case).
    if (fromPreDiscard && this.drawn[seat] !== null) {
      this.hands[seat].push(this.drawn[seat]!);
      this.hands[seat] = sortTiles(this.hands[seat]);
      this.drawn[seat] = null;
    }
    this.announce(seat, 'kong');

    if (variant === 'concealed') {
      for (let k = 0; k < 4; k++) {
        const i = this.hands[seat].indexOf(tile);
        this.hands[seat].splice(i, 1);
      }
      this.melds[seat].push({ kind: 'kong', tile, kongType: 'concealed' });
      this.beginTurn(seat, 'dead');
      return;
    }

    // Small exposed kong: check for robbers before completing.
    const i = this.hands[seat].indexOf(tile);
    this.hands[seat].splice(i, 1);
    const pungMeld = this.melds[seat].find((m) => m.kind === 'pung' && m.tile === tile)!;

    const slots = new Map<number, 'undecided' | 'pass' | 'mahjong'>();
    for (let s = 0; s < 4; s++) {
      if (s === seat || this.host.isBot(s)) continue;
      if (this.canWinOn(s, tile)) slots.set(s, 'undecided');
    }
    if (slots.size === 0) {
      this.completeSmallKong(seat, pungMeld, tile);
      return;
    }
    this.phase = 'robbing';
    this.rob = { konger: seat, tile, slots, pungMeld };
    this.schedule(this.claimMs(), () => this.resolveRob(true));
    this.host.onChange();
  }

  private completeSmallKong(seat: number, pungMeld: Meld, tile: Tile): void {
    pungMeld.kind = 'kong';
    pungMeld.kongType = 'small';
    this.rob = null;
    this.beginTurn(seat, 'dead');
  }

  handleRobAction(seat: number, action: GameAction): void {
    const r = this.rob;
    if (!r || this.phase !== 'robbing') return;
    if (!r.slots.has(seat)) return;
    if (action.kind === 'claim' && action.claim === 'mahjong') {
      r.slots.set(seat, 'mahjong');
    } else if (action.kind === 'claim' && action.claim === 'pass') {
      r.slots.set(seat, 'pass');
    } else return;
    this.checkRobResolution();
    this.host.onChange();
  }

  private checkRobResolution(): void {
    const r = this.rob!;
    const entries = [...r.slots.entries()].sort(
      (a, b) => ((a[0] - r.konger + 4) % 4) - ((b[0] - r.konger + 4) % 4),
    );
    // Top-priority robber locked mahjong -> immediate.
    if (entries[0][1] === 'mahjong') {
      this.resolveRob(false);
      return;
    }
    if (entries.some(([, v]) => v === 'undecided')) return;
    this.resolveRob(false);
  }

  private resolveRob(timedOut: boolean): void {
    const r = this.rob;
    if (!r || this.phase !== 'robbing' || this.ended) return;
    void timedOut;
    const entries = [...r.slots.entries()]
      .filter(([, v]) => v === 'mahjong')
      .sort((a, b) => ((a[0] - r.konger + 4) % 4) - ((b[0] - r.konger + 4) % 4));
    if (entries.length === 0) {
      this.completeSmallKong(r.konger, r.pungMeld, r.tile);
      return;
    }
    const winner = entries[0][0];
    this.rob = null;
    this.winByDiscard(winner, r.konger, r.tile, true);
  }

  // ── pre-discard actions ───────────────────────────────────────────────────

  handleAction(seat: number, action: GameAction): void {
    if (this.ended) return;
    if (this.phase === 'postDiscard') {
      this.handleClaimAction(seat, action);
      return;
    }
    if (this.phase === 'robbing') {
      this.handleRobAction(seat, action);
      return;
    }
    if (this.phase !== 'preDiscard' || seat !== this.turnSeat) return;

    switch (action.kind) {
      case 'select': {
        this.selected[seat] = action.tile;
        this.selectedFromDrawn[seat] =
          action.tile !== null && action.tile === this.drawn[seat] && action.fromDrawn !== false;
        this.host.onChange();
        return;
      }
      case 'discard': {
        const fromDrawn = action.fromDrawn ?? action.tile === this.drawn[seat];
        if (!fromDrawn && !this.hands[seat].includes(action.tile)) return;
        if (fromDrawn && action.tile !== this.drawn[seat]) return;
        this.doDiscard(seat, action.tile, fromDrawn);
        return;
      }
      case 'kong': {
        if (this.isSeabedTurn()) return; // seabed holder cannot kong
        if (this.wall.remaining === 0) return;
        const all = [...this.hands[seat]];
        if (this.drawn[seat] !== null) all.push(this.drawn[seat]!);
        const counts = countsFrom(all);
        const ti = tileIndex(action.tile);
        if (action.variant === 'concealed') {
          if (counts[ti] !== 4) return;
        } else {
          if (counts[ti] < 1) return;
          if (!this.melds[seat].some((m) => m.kind === 'pung' && m.tile === action.tile)) return;
        }
        if (this.currentMove && this.currentMove.part1.t === 'draw') {
          this.moves.push({
            seat,
            part1: this.currentMove.part1,
            part2: { t: 'kong', tile: action.tile },
          });
          this.currentMove = null;
        } else {
          this.recordMove({ seat, part1: { t: 'draw', tile: this.drawn[seat] ?? action.tile }, part2: { t: 'kong', tile: action.tile } });
        }
        this.declareKongTiles(seat, action.tile, action.variant, true);
        return;
      }
      case 'mahjong': {
        if (this.drawn[seat] === null) return;
        const counts = countsFrom([...this.hands[seat], this.drawn[seat]!]);
        if (!canWinShape(counts, this.melds[seat].length)) return;
        const score = this.scoreFor(seat, this.drawn[seat]!, 'self', this.drawnFromDead);
        if (this.host.settings.chickenHand === 'notAllowed' && score.chicken) return;
        this.winBySelf(seat);
        return;
      }
      default:
        return;
    }
  }

  /** Kong declarations available to the turn player right now (for the view). */
  private kongOptionsFor(seat: number): { tile: Tile; variant: 'concealed' | 'small' }[] {
    if (this.phase !== 'preDiscard' || this.turnSeat !== seat) return [];
    if (this.isSeabedTurn() || this.wall.remaining === 0) return [];
    const all = [...this.hands[seat]];
    if (this.drawn[seat] !== null) all.push(this.drawn[seat]!);
    const counts = countsFrom(all);
    const out: { tile: Tile; variant: 'concealed' | 'small' }[] = [];
    for (let i = 0; i < 34; i++) {
      if (counts[i] === 4) out.push({ tile: tileFromIndex(i), variant: 'concealed' });
    }
    for (const m of this.melds[seat]) {
      if (m.kind === 'pung' && counts[tileIndex(m.tile)] >= 1) {
        out.push({ tile: m.tile, variant: 'small' });
      }
    }
    return out;
  }

  // ── winning and ending ────────────────────────────────────────────────────

  private scoreFor(
    seat: number,
    winTile: Tile,
    winBy: 'self' | 'discard',
    kongReplacement: boolean,
    robbing = false,
  ): ScoreResult {
    const chickenPoints = this.host.settings.chickenHand === 'zero' ? 0 : 1;
    const anyMelds = this.melds.some((m) => m.length > 0);
    const heaven =
      winBy === 'self' && seat === 0 && this.discardLog.length === 0 && !anyMelds;
    const earth =
      winBy === 'discard' &&
      !robbing &&
      seat !== 0 &&
      this.discardLog.length === 1 &&
      this.discardLog[0].seat === 0 &&
      this.melds[0].length === 0 &&
      this.melds[seat].length === 0;
    return scoreWin(
      {
        melds: this.melds[seat],
        concealed: this.hands[seat],
        winTile,
        winBy,
        seatWind: seat,
        seabed: winBy === 'self' && this.wall.remaining === 0,
        riverbed: winBy === 'discard' && !robbing && this.wall.remaining === 0,
        kongReplacement: kongReplacement && winBy === 'self',
        robbingKong: robbing,
        heaven,
        earth,
      },
      chickenPoints,
    );
  }

  private winBySelf(seat: number): void {
    const winTile = this.drawn[seat]!;
    const score = this.scoreFor(seat, winTile, 'self', this.drawnFromDead);
    if (this.currentMove && this.currentMove.part1.t === 'draw') {
      this.moves.push({ seat, part1: this.currentMove.part1, part2: { t: 'mahjong' } });
      this.currentMove = null;
    }
    const deltas = computePayments({
      value: score.total,
      winnerSeat: seat,
      winBy: 'self',
      responsibleSeat: null,
      par: this.host.settings.par,
    });
    this.announce(seat, 'selfdraw');
    this.finishWithPause(
      {
        winnerSeat: seat,
        winBy: 'self',
        responsibleSeat: null,
        value: score.total,
        patterns: score.patterns,
        deltas,
      },
      score,
    );
  }

  private winByDiscard(seat: number, discarder: number, tile: Tile, robbing: boolean): void {
    const score = this.scoreFor(seat, tile, 'discard', false, robbing);
    if (!robbing) {
      // The winning tile leaves the discard pile.
      this.discards[discarder].pop();
    }
    this.recordMove({ seat, part1: { t: 'mahjongDiscard', tile } });
    const responsible = robbing
      ? discarder
      : findResponsible(this.discardLog, seat, tile);
    const deltas = computePayments({
      value: score.total,
      winnerSeat: seat,
      winBy: 'discard',
      responsibleSeat: responsible,
      par: this.host.settings.par,
    });
    this.drawn[seat] = tile;
    this.announce(seat, 'mahjong');
    this.finishWithPause(
      {
        winnerSeat: seat,
        winBy: 'discard',
        responsibleSeat: responsible,
        value: score.total,
        patterns: score.patterns,
        deltas,
      },
      score,
    );
  }

  private endInDraw(): void {
    this.flushMove();
    this.finishGame({ winnerSeat: null, deltas: [0, 0, 0, 0] });
  }

  /**
   * Shows the winning keyword on the board for a moment before the scoring
   * screen appears, so all players can take in what happened.
   */
  private finishWithPause(result: GameResultRecord, score: ScoreResult): void {
    this.ended = true;
    this.phase = 'gameEnd';
    // Result is set now so the winner's hand is revealed during the pause.
    this.result = result;
    this.resultScore = score;
    this.claim = null;
    this.rob = null;
    this.deadline = null;
    this.phaseDuration = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.host.onChange();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.finishGame(result, score);
    }, 1600);
  }

  private finishGame(result: GameResultRecord, score: ScoreResult | null = null): void {
    this.ended = true;
    this.phase = 'gameEnd';
    this.deadline = null;
    this.phaseDuration = null;
    this.dispose();
    this.result = result;
    this.resultScore = score;
    this.claim = null;
    this.rob = null;
    this.host.onGameEnd(this.toRecord(), result.deltas);
  }

  publicHand(seat: number): Tile[] {
    return [...this.hands[seat]];
  }

  publicDrawn(seat: number): Tile | null {
    return this.drawn[seat];
  }

  publicMeldViews(seat: number): MeldView[] {
    return this.melds[seat].map((m) => this.meldView(m, seat));
  }

  /** Called when a human leaves/disconnects so a stalled phase moves along. */
  nudgeBots(): void {
    if (this.ended) return;
    if (this.phase === 'preDiscard' && this.host.isBot(this.turnSeat)) {
      const seat = this.turnSeat;
      if (this.drawn[seat] !== null && !this.botTimer) {
        this.botTimer = setTimeout(() => {
          this.botTimer = null;
          if (this.phase === 'preDiscard' && this.turnSeat === seat && !this.ended) {
            this.doDiscard(seat, this.drawn[seat]!, true);
          }
        }, this.host.timing.botDelayMs);
      }
    } else if (this.phase === 'postDiscard' && this.claim) {
      for (const [seat, slot] of this.claim.slots) {
        if (this.host.isBot(seat) && slot.choice === null) slot.choice = { kind: 'pass' };
      }
      this.checkClaimResolution();
    } else if (this.phase === 'robbing' && this.rob) {
      for (const [seat, v] of this.rob.slots) {
        if (this.host.isBot(seat) && v === 'undecided') this.rob.slots.set(seat, 'pass');
      }
      this.checkRobResolution();
    }
  }

  toRecord(): GameRecord {
    return {
      gameNumber: gameNumberOf(this.gameIndex).latin,
      startingHands: this.startingHands,
      moves: this.moves,
      result: this.result ?? { winnerSeat: null, deltas: [0, 0, 0, 0] },
    };
  }

  // ── views ─────────────────────────────────────────────────────────────────

  private meldView(m: Meld, ownerSeat: number): MeldView {
    if (m.kind === 'chow') {
      const low = tileIndex(m.tile);
      const tiles = [0, 1, 2].map((k) => tileFromIndex(low + k));
      return { kind: 'chow', tiles, rotated: tiles.indexOf(m.claimedTile ?? tiles[0]), faceDown: [] };
    }
    const size = m.kind === 'kong' ? 4 : 3;
    const tiles = new Array(size).fill(m.tile) as Tile[];
    if (m.kind === 'kong' && m.kongType === 'concealed') {
      return { kind: 'kong', kongType: 'concealed', tiles, rotated: -1, faceDown: [0, 3] };
    }
    const rel = m.claimedFrom !== undefined ? (m.claimedFrom - ownerSeat + 4) % 4 : 1;
    const rotated = rel === 3 ? 0 : rel === 2 ? 1 : size - 1;
    if (m.kind === 'kong' && m.kongType === 'small') {
      // Upgraded pung: 3 tiles with the 4th stacked on the rotated one.
      return { kind: 'kong', kongType: 'small', tiles, rotated, faceDown: [], stacked: true };
    }
    return { kind: m.kind as 'pung' | 'kong', kongType: m.kongType, tiles, rotated, faceDown: [] };
  }

  buildView(viewer: number, gameResultView: GameResultView | null): GameView {
    const g = gameNumberOf(this.gameIndex);
    const seats: SeatView[] = [];
    for (let s = 0; s < 4; s++) {
      seats.push({
        name: this.host.nameOf(s),
        isBot: this.host.isBotPlayer(s),
        connected: this.host.isConnected(s),
        score: this.host.scoreOf(s),
        handCount: this.hands[s].length,
        hasDrawn: this.drawn[s] !== null,
        melds: this.melds[s].map((m) => this.meldView(m, s)),
        discards: this.discards[s],
      });
    }

    const myOptions: MyOptions = {};
    let pendingClaim: GameView['pendingClaim'] = null;

    if (this.phase === 'preDiscard' && this.turnSeat === viewer && !this.host.isBot(viewer)) {
      myOptions.discard = true;
      const kongs = this.kongOptionsFor(viewer);
      if (kongs.length > 0) myOptions.kongs = kongs;
      if (this.drawn[viewer] !== null) {
        const counts = countsFrom([...this.hands[viewer], this.drawn[viewer]!]);
        if (canWinShape(counts, this.melds[viewer].length)) {
          if (
            this.host.settings.chickenHand !== 'notAllowed' ||
            !this.scoreFor(viewer, this.drawn[viewer]!, 'self', this.drawnFromDead).chicken
          ) {
            myOptions.mahjong = true;
          }
        }
      }
    }

    const claims: GameView['claims'] = [];
    if (this.phase === 'postDiscard' && this.claim) {
      for (const [seat, slot] of this.claim.slots) {
        if (slot.choice && slot.choice.kind !== 'pass') {
          claims.push({ seat, kind: slot.choice.kind as ClaimKind });
        }
      }
      const slot = this.claim.slots.get(viewer);
      if (slot) {
        // Amendments after acting reopen when another player makes a visible
        // claim, and stay open until this seat acts again (sticky).
        const reopened = slot.reopened;
        if (!slot.choice) {
          const co: ClaimOptions = {};
          if (slot.avail.mahjong) co.mahjong = true;
          if (slot.avail.kong) co.kong = true;
          if (slot.avail.pung) co.pung = true;
          if (slot.avail.chows.length) co.chows = slot.avail.chows.map(tileFromIndex);
          myOptions.claim = co;
        } else if (slot.choice.kind === 'pass') {
          // Buttons disappear after passing; they return if someone claims.
          if (reopened) {
            const co: ClaimOptions = {};
            if (slot.avail.mahjong) co.mahjong = true;
            if (slot.avail.kong) co.kong = true;
            if (slot.avail.pung) co.pung = true;
            if (slot.avail.chows.length) co.chows = slot.avail.chows.map(tileFromIndex);
            myOptions.claim = co;
          }
        } else if (slot.choice.kind === 'pung' || slot.choice.kind === 'chow') {
          myOptions.discard = true;
          // A made claim can be withdrawn (Cancel); a mahjong upgrade is
          // offered only while another player's claim has reopened the phase.
          const locked = slot.discardConfirmed || slot.kongAfter !== null;
          myOptions.claim =
            slot.avail.mahjong && reopened ? { mahjong: true } : locked && !reopened ? undefined : {};
          const low = slot.choice.kind === 'chow' ? (slot.choice as { low: number }).low : null;
          const tiles =
            slot.choice.kind === 'pung'
              ? [this.claim.tile, this.claim.tile, this.claim.tile]
              : [0, 1, 2].map((k) => tileFromIndex(low! + k));
          pendingClaim = { kind: slot.choice.kind, tiles };
          const rest = this.handAfterClaim(viewer, slot);
          if (rest) {
            const kongs: { tile: Tile; variant: 'concealed' | 'small' }[] = [];
            const counts = countsFrom(rest);
            for (let i = 0; i < 34; i++) {
              if (counts[i] === 4) kongs.push({ tile: tileFromIndex(i), variant: 'concealed' });
            }
            for (const m of this.melds[viewer]) {
              if (m.kind === 'pung' && counts[tileIndex(m.tile)] >= 1) {
                kongs.push({ tile: m.tile, variant: 'small' });
              }
            }
            if (kongs.length > 0 && this.wall.remaining > 0) myOptions.kongs = kongs;
          }
        } else {
          myOptions.claim = {}; // locked a kong/mahjong claim; can still pass
        }
      }
    }
    if (this.phase === 'robbing' && this.rob) {
      for (const [seat, v] of this.rob.slots) {
        if (v === 'mahjong') claims.push({ seat, kind: 'mahjong' });
      }
      // The kong itself is visible while it can be robbed.
      claims.push({ seat: this.rob.konger, kind: 'kong' });
      if (this.rob.slots.get(viewer) === 'undecided') {
        myOptions.claim = { mahjong: true };
      }
    }
    // Transient announcements (kong declarations, wins), deduped against
    // claim keywords already shown for the same seat.
    const now = Date.now();
    for (const a of this.announcements) {
      if (a.expires <= now) continue;
      if (claims.some((c) => c.seat === a.seat && c.kind === a.kind)) continue;
      claims.push({ seat: a.seat, kind: a.kind, expires: a.expires });
    }

    // Pending pung/chow claimants see their provisional hand.
    let myHand = this.hands[viewer];
    if (pendingClaim) {
      const slot = this.claim!.slots.get(viewer)!;
      myHand = this.handAfterClaim(viewer, slot) ?? myHand;
    }

    const lastLog = this.discardLog[this.discardLog.length - 1] ?? null;
    const winnerSeat = this.result?.winnerSeat;
    const reveal =
      this.phase === 'gameEnd' && winnerSeat !== null && winnerSeat !== undefined
        ? { seat: winnerSeat, hand: [...this.hands[winnerSeat]], drawn: this.drawn[winnerSeat] }
        : null;
    return {
      phase: this.phase,
      now: Date.now(),
      claimGapMs: this.gapMs(),
      reveal,
      gameNumber: g.latin,
      gameNumberZh: g.zh,
      remaining: this.wall.remaining,
      dice: this.phase === 'dealing' ? this.dice : null,
      mySeat: viewer,
      turnSeat: this.turnSeat,
      seats,
      myHand,
      myDrawn: this.drawn[viewer],
      selected: this.selected[viewer],
      deadline: this.deadline,
      phaseDuration: this.phaseDuration,
      lastDiscard:
        this.phase === 'postDiscard' && this.claim
          ? { seat: this.claim.discarder, tile: this.claim.tile }
          : lastLog
            ? { seat: lastLog.seat, tile: lastLog.tile }
            : null,
      claims,
      myOptions,
      pendingClaim,
      gameResult: gameResultView,
      matchResult: null,
    };
  }
}
