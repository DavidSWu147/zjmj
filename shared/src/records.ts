import { sortTiles, Tile, tileFromIndex, tileIndex, rankOf } from './tiles';
import { PatternHit } from './scoring';
import { MeldView, RoomSettings } from './protocol';

/**
 * Match records. Seat indices inside a GameRecord are *current* seats for that
 * game (0 = the game's East). The player at current seat s of game g is
 * players[(s + g) % 4] (players[] is indexed by starting seat).
 */
export type MovePart1 =
  | { t: 'draw'; tile: Tile }
  | { t: 'drawAndDiscard'; tile: Tile }
  | { t: 'chow'; tile: Tile; low: Tile }
  | { t: 'pung'; tile: Tile }
  | { t: 'bigKong'; tile: Tile }
  | { t: 'mahjongDiscard'; tile: Tile }
  /**
   * A starting-hand bonus tile is revealed and set aside; `repl` is the
   * dead-wall replacement that joins the hand. Only used before play begins
   * — a bonus tile drawn mid-turn is a draw with a `bonus` part2 instead.
   */
  | { t: 'bonus'; tile: Tile; repl: Tile };

export type MovePart2 =
  | { t: 'discard'; tile: Tile }
  | { t: 'kong'; tile: Tile } // concealed or small exposed, disambiguated by context
  | { t: 'mahjong'; tile: Tile }
  /**
   * The drawn tile was a bonus tile: revealed and set aside; the dead-wall
   * replacement draw starts the player's next line, like a kong replacement.
   */
  | { t: 'bonus'; tile: Tile };

export interface MoveRecord {
  seat: number; // current seat (0=E..3=N)
  part1: MovePart1;
  part2?: MovePart2;
}

export interface GameResultRecord {
  winnerSeat: number | null; // null = drawn game
  winBy?: 'self' | 'discard';
  responsibleSeat?: number | null;
  value?: number;
  patterns?: PatternHit[];
  /** Score deltas by current seat. */
  deltas: number[];
}

export interface GameRecord {
  gameNumber: string;
  /** By current seat, 13 tiles each, sorted. */
  startingHands: Tile[][];
  moves: MoveRecord[];
  result: GameResultRecord;
}

export interface MatchRecord {
  matchId: number;
  matchLength: 1 | 2 | 4;
  settings: RoomSettings;
  /** Indexed by starting seat (E,S,W,N). */
  players: { id: string; name: string; isBot: boolean }[];
  games: GameRecord[];
  /** By starting seat. */
  finalScores: number[];
  /** Player ids who left before the match finished. */
  abandonedBy: string[];
}

const SEAT_NAMES = ['EAST', 'SOUTH', 'WEST', 'NORTH'];
const SEAT_LABELS = ['East', 'South', 'West', 'North'];

function part1ToTxt(p: MovePart1): string {
  switch (p.t) {
    case 'draw':
      return `DRAW ${p.tile}`;
    case 'drawAndDiscard':
      return `DRAW AND DISCARD ${p.tile}`;
    case 'chow': {
      const r = rankOf(p.low)!;
      return `CHOW ${p.tile} ${r}${r + 1}${r + 2}`;
    }
    case 'pung':
      return `PUNG ${p.tile}`;
    case 'bigKong':
      return `KONG ${p.tile}`;
    case 'mahjongDiscard':
      return `MAHJONG ${p.tile}`;
    case 'bonus':
      return `BONUS ${p.tile}, DRAW ${p.repl}`;
  }
}

function part2ToTxt(p: MovePart2): string {
  switch (p.t) {
    case 'discard':
      return `DISCARD ${p.tile}`;
    case 'kong':
      return `KONG ${p.tile}`;
    case 'mahjong':
      return `MAHJONG ${p.tile}`;
    case 'bonus':
      return `BONUS ${p.tile}`;
  }
}

export function moveToTxt(m: MoveRecord): string {
  const head = `${SEAT_NAMES[m.seat]}: ${part1ToTxt(m.part1)}`;
  if (m.part2) return `${head}, ${part2ToTxt(m.part2)}`;
  // A big exposed kong continues on the player's next line (replacement draw),
  // marked by a trailing comma. A discard win ends the game: no comma.
  if (m.part1.t === 'bigKong') return `${head},`;
  return head;
}

/** Chicken Hand setting as an int: 1 = scores 1, 0 = scores 0, -1 = not allowed. */
export function chickenHandInt(v: RoomSettings['chickenHand']): number {
  return v === 'one' ? 1 : v === 'zero' ? 0 : -1;
}

/** Par Score as an int: 25, 30, or -30 for "30 unless exact then 25". */
export function parScoreInt(v: RoomSettings['par']): number {
  return v === '30/25' ? -30 : v;
}

/** Scoring mode as an int: 0 original, 1 adjusted, 2 adjusted with extras. */
export function scoringInt(v: RoomSettings['scoring']): number {
  return v === 'adjustedExtra' ? 2 : v === 'adjusted' ? 1 : 0;
}

/** Bonus tiles setting as an int: 0 none, 1 half value, 2 full value. */
export function bonusTilesInt(v: RoomSettings['bonusTiles']): number {
  return v === 'full' ? 2 : v === 'half' ? 1 : 0;
}

export function matchToTxt(m: MatchRecord): string {
  const lines: string[] = [];
  lines.push(`Match ID: ${m.matchId}`);
  lines.push(`Match Length: ${m.matchLength}`);
  lines.push(`Thinking Time: ${m.settings.thinkingTime}`);
  lines.push(`Chicken Hand: ${chickenHandInt(m.settings.chickenHand)}`);
  lines.push(`Par Score: ${parScoreInt(m.settings.par)}`);
  lines.push(`Scoring: ${scoringInt(m.settings.scoring)}`);
  lines.push(`Bonus Tiles: ${bonusTilesInt(m.settings.bonusTiles)}`);
  for (let s = 0; s < 4; s++) {
    lines.push(`Starting ${SEAT_LABELS[s]} Username: ${m.players[s].name}`);
  }
  for (const g of m.games) {
    lines.push('');
    lines.push(`Game Number: ${g.gameNumber}`);
    for (let s = 0; s < 4; s++) {
      lines.push(`${SEAT_LABELS[s]} player's starting hand: ${g.startingHands[s].join(', ')}`);
    }
    for (const mv of g.moves) lines.push(moveToTxt(mv));
    // Winning games list the achieved patterns (or CHICKEN HAND) and the
    // hand's score before ENDGAME.
    if (g.result.winnerSeat !== null) {
      const pats = g.result.patterns ?? [];
      const chicken = pats.length === 0 || pats.every((p) => p.id === 'chicken');
      lines.push(chicken ? 'CHICKEN HAND' : pats.map((p) => p.name.toUpperCase()).join(', '));
      lines.push(`SCORE: ${g.result.value ?? 0}`);
    }
    lines.push('ENDGAME');
  }
  return lines.join('\n') + '\n';
}

/** One reconstructed position while stepping through a game record. */
export interface ReplayStep {
  moveIndex: number; // index of the move just applied; -1 = initial deal
  text: string;
  hands: Tile[][];
  melds: MeldView[][];
  discards: { tile: Tile; fromDraw: boolean }[][];
  drawn: (Tile | null)[];
  /** Revealed flowers & seasons per seat. */
  bonus: Tile[][];
}

/**
 * Replays a game record into a list of positions (one per move, plus the
 * initial deal) for the archive viewer. All hands are face-up.
 */
export function replayGame(g: GameRecord): ReplayStep[] {
  const hands = g.startingHands.map((h) => sortTiles(h));
  const melds: MeldView[][] = [[], [], [], []];
  const discards: { tile: Tile; fromDraw: boolean }[][] = [[], [], [], []];
  const discardOrder: number[][] = [[], [], [], []]; // global sequence numbers
  const drawn: (Tile | null)[] = [null, null, null, null];
  const bonus: Tile[][] = [[], [], [], []];
  let discardSeq = 0;
  // Set when a small exposed kong is being robbed: the tile awaiting the winner.
  let robbedTile: { seat: number; tile: Tile } | null = null;

  const snapshot = (moveIndex: number, text: string): ReplayStep =>
    JSON.parse(
      JSON.stringify({ moveIndex, text, hands, melds, discards, drawn, bonus }),
    ) as ReplayStep;

  const steps: ReplayStep[] = [snapshot(-1, 'Initial deal')];

  const removeFromHand = (seat: number, tiles: Tile[]) => {
    for (const t of tiles) {
      const i = hands[seat].indexOf(t);
      if (i < 0) throw new Error(`replay: ${t} not in seat ${seat} hand`);
      hands[seat].splice(i, 1);
    }
  };

  const settleDrawn = (seat: number) => {
    if (drawn[seat] !== null) {
      hands[seat].push(drawn[seat]!);
      hands[seat] = sortTiles(hands[seat]);
      drawn[seat] = null;
    }
  };

  const addDiscard = (seat: number, tile: Tile, fromDraw: boolean) => {
    discards[seat].push({ tile, fromDraw });
    discardOrder[seat].push(discardSeq++);
  };

  /** Removes the newest discard on the table (the claimed tile). */
  const claimLastDiscard = (claimer: number, tile: Tile): number => {
    let from = -1;
    let bestSeq = -1;
    for (let s = 0; s < 4; s++) {
      if (s === claimer) continue;
      const d = discards[s];
      const last = d.length - 1;
      if (last >= 0 && d[last].tile === tile && discardOrder[s][last] > bestSeq) {
        bestSeq = discardOrder[s][last];
        from = s;
      }
    }
    if (from < 0) throw new Error(`replay: claimed tile ${tile} not on table`);
    discards[from].pop();
    discardOrder[from].pop();
    return from;
  };

  const rotatedIndexFor = (claimer: number, from: number, size: number): number => {
    const rel = (from - claimer + 4) % 4; // 3 = left, 2 = opposite, 1 = right
    if (rel === 3) return 0;
    if (rel === 2) return 1;
    return size - 1;
  };

  g.moves.forEach((mv, mi) => {
    const seat = mv.seat;
    const p1 = mv.part1;
    switch (p1.t) {
      case 'draw':
        drawn[seat] = p1.tile;
        break;
      case 'drawAndDiscard':
        addDiscard(seat, p1.tile, true);
        break;
      case 'chow': {
        claimLastDiscard(seat, p1.tile);
        const low = tileIndex(p1.low);
        const seqTiles = [0, 1, 2].map((k) => tileFromIndex(low + k));
        const fromHand = [...seqTiles];
        fromHand.splice(fromHand.indexOf(p1.tile), 1);
        removeFromHand(seat, fromHand);
        melds[seat].push({
          kind: 'chow',
          tiles: seqTiles,
          rotated: seqTiles.indexOf(p1.tile),
          faceDown: [],
        });
        break;
      }
      case 'pung': {
        const from = claimLastDiscard(seat, p1.tile);
        removeFromHand(seat, [p1.tile, p1.tile]);
        melds[seat].push({
          kind: 'pung',
          tiles: [p1.tile, p1.tile, p1.tile],
          rotated: rotatedIndexFor(seat, from, 3),
          faceDown: [],
        });
        break;
      }
      case 'bigKong': {
        const from = claimLastDiscard(seat, p1.tile);
        removeFromHand(seat, [p1.tile, p1.tile, p1.tile]);
        melds[seat].push({
          kind: 'kong',
          kongType: 'big',
          tiles: [p1.tile, p1.tile, p1.tile, p1.tile],
          rotated: rotatedIndexFor(seat, from, 4),
          faceDown: [],
        });
        break;
      }
      case 'mahjongDiscard': {
        if (robbedTile && robbedTile.tile === p1.tile) {
          robbedTile = null;
        } else {
          claimLastDiscard(seat, p1.tile);
        }
        drawn[seat] = p1.tile;
        break;
      }
      case 'bonus': {
        // Starting-hand bonus: swap it for the dead-wall replacement.
        bonus[seat].push(p1.tile);
        removeFromHand(seat, [p1.tile]);
        hands[seat] = sortTiles([...hands[seat], p1.repl]);
        break;
      }
    }

    const p2 = mv.part2;
    if (p2) {
      switch (p2.t) {
        case 'discard':
          settleDrawn(seat);
          removeFromHand(seat, [p2.tile]);
          addDiscard(seat, p2.tile, false);
          break;
        case 'kong': {
          settleDrawn(seat);
          const next = g.moves[mi + 1];
          const robbed =
            !!next &&
            next.seat !== seat &&
            next.part1.t === 'mahjongDiscard' &&
            next.part1.tile === p2.tile;
          const pungMeld = melds[seat].find(
            (m) => m.kind === 'pung' && m.tiles[0] === p2.tile,
          );
          if (pungMeld) {
            // Small exposed kong.
            removeFromHand(seat, [p2.tile]);
            if (robbed) {
              robbedTile = { seat, tile: p2.tile };
            } else {
              pungMeld.kind = 'kong';
              pungMeld.kongType = 'small';
              pungMeld.tiles = [...pungMeld.tiles, p2.tile];
              pungMeld.stacked = true;
            }
          } else {
            // Concealed kong. (A concealed kong cannot be robbed.)
            removeFromHand(seat, [p2.tile, p2.tile, p2.tile, p2.tile]);
            melds[seat].push({
              kind: 'kong',
              kongType: 'concealed',
              tiles: [p2.tile, p2.tile, p2.tile, p2.tile],
              rotated: -1,
              faceDown: [0, 3],
            });
          }
          break;
        }
        case 'mahjong':
          // Self-draw win; the drawn tile stays separated for display.
          break;
        case 'bonus':
          // The drawn bonus tile moves from the drawn slot to the bonus row.
          bonus[seat].push(p2.tile);
          drawn[seat] = null;
          break;
      }
    }

    steps.push(snapshot(mi, moveToTxt(mv)));
  });
  return steps;
}
