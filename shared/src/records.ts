import { sortTiles, Tile, tileFromIndex, tileIndex, rankOf } from './tiles';
import { ADJUSTED_POINTS, PatternHit, PATTERNS } from './scoring';
import { MeldView, RoomSettings } from './protocol';
import { computePayments, findResponsible } from './payment';

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
  /** Self-drawn win; `tile` is the tile just drawn (absent in old records). */
  | { t: 'mahjong'; tile?: Tile }
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
  /** Display seed "XXXXXXXXXXXXX-YZ" of the wall+dice RNG (v0.2). */
  seed?: string;
  /** Live-wall tiles left when the game ended (v0.2 statistics). */
  remaining?: number;
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
  players: { id: string; name: string; isBot: boolean; registered?: boolean }[];
  games: GameRecord[];
  /** By starting seat. */
  finalScores: number[];
  /** Player ids who left before the match finished. */
  abandonedBy: string[];
  /** Player ids in system-set Auto Mode when the match ended (v0.2). */
  systemAutoAtEnd?: string[];
  /** Player ids disconnected when the match ended (v0.2). */
  disconnectedAtEnd?: string[];
  /** Weekly Tournament matches only (v0.2). */
  tournamentWeek?: string;
  /** Rank Points by starting seat (tournament matches only). */
  rankPoints?: number[];
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
      return p.tile ? `MAHJONG ${p.tile}` : 'MAHJONG';
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

/** Every player id counted as having abandoned the match (v0.2 broad rule):
 *  explicit leavers, system-set Auto Mode at end, disconnected at end. */
export function broadAbandoned(m: MatchRecord): Set<string> {
  return new Set([
    ...m.abandonedBy,
    ...(m.systemAutoAtEnd ?? []),
    ...(m.disconnectedAtEnd ?? []),
  ]);
}

/**
 * A pattern's fully-hyphenated record name(s) (v0.2): spaces become hyphens
 * and colons drop ("VALUE-HONOR-RED-DRAGON"). The bonus-tile patterns write
 * as IMPROPER-BONUS-TILE / PROPER-BONUS-TILE, one line-item per tile instead
 * of the on-screen ×n notation.
 */
function txtPatternNames(p: PatternHit): string[] {
  if (p.id === '11.1.1' || p.id === '11.1.2') {
    const n = Number(p.name.match(/×(\d+)/)?.[1] ?? 1);
    return Array(n).fill(p.id === '11.1.1' ? 'IMPROPER-BONUS-TILE' : 'PROPER-BONUS-TILE');
  }
  return [p.name.replace(/:/g, '').toUpperCase().split(/\s+/).join('-')];
}

export function matchToTxt(m: MatchRecord): string {
  const lines: string[] = [];
  const abandoned = broadAbandoned(m);
  lines.push(`Match ID: ${m.matchId}`);
  // v0.2.2 #8: the match's start moment — the Match ID is its epoch-ms.
  lines.push(
    `Date and Time: ${new Date(m.matchId).toISOString().slice(0, 19).replace('T', ' ')} UTC`,
  );
  lines.push(`Match Type: ${m.tournamentWeek ? 1 : 0}`);
  lines.push(`Match Length: ${m.matchLength}`);
  lines.push(`Thinking Time: ${m.settings.thinkingTime}`);
  lines.push(`Chicken Hand: ${chickenHandInt(m.settings.chickenHand)}`);
  lines.push(`Par Score: ${parScoreInt(m.settings.par)}`);
  lines.push(`Scoring: ${scoringInt(m.settings.scoring)}`);
  lines.push(`Bonus Tiles: ${bonusTilesInt(m.settings.bonusTiles)}`);
  for (let s = 0; s < 4; s++) {
    lines.push(`Starting ${SEAT_LABELS[s]} Username: ${m.players[s].name}`);
  }
  for (let s = 0; s < 4; s++) {
    const p = m.players[s];
    const base = p.isBot ? 'BOT' : p.registered ? 'USER' : 'GUEST';
    const suffix = !p.isBot && abandoned.has(p.id) ? ' ABANDONED' : '';
    lines.push(`Starting ${SEAT_LABELS[s]} Player Type: ${base}${suffix}`);
  }
  for (let s = 0; s < 4; s++) {
    lines.push(`Starting ${SEAT_LABELS[s]} Final Score: ${m.finalScores[s]}`);
  }
  for (const g of m.games) {
    lines.push('');
    lines.push(`Game Number: ${g.gameNumber}`);
    if (g.seed) lines.push(`Seed: ${g.seed}`);
    for (let s = 0; s < 4; s++) {
      lines.push(`${SEAT_LABELS[s]} player's starting hand: ${g.startingHands[s].join(', ')}`);
    }
    for (const mv of g.moves) lines.push(moveToTxt(mv));
    // Winning games list the achieved patterns (or CHICKEN-HAND) and the
    // hand's score before ENDGAME.
    if (g.result.winnerSeat !== null) {
      const pats = g.result.patterns ?? [];
      const chicken = pats.length === 0 || pats.every((p) => p.id === 'chicken');
      lines.push(chicken ? 'CHICKEN-HAND' : pats.flatMap(txtPatternNames).join(', '));
      lines.push(`SCORE: ${g.result.value ?? 0}`);
    }
    lines.push('ENDGAME');
  }
  return lines.join('\n') + '\n';
}

/** Normalized pattern-name key: case/punctuation-insensitive word list. */
function patternKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

const PATTERN_BY_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [id, p] of Object.entries(PATTERNS)) m.set(patternKey(p.name), id);
  // v0.2 record names for the bonus-tile patterns.
  m.set('IMPROPER BONUS TILE', '11.1.1');
  m.set('PROPER BONUS TILE', '11.1.2');
  return m;
})();

/**
 * Rebuilds PatternHits from a record's pattern-name line. Accepts both the
 * v0.2 hyphenated names (bonus tiles repeated per copy) and the older
 * spaced names with ×n counts. Returns null if any token is unrecognized —
 * the caller then skips the line, as the old parser did.
 */
function parsePatternLine(line: string, settings: RoomSettings): PatternHit[] | null {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const token of line.split(',')) {
    let key = patternKey(token);
    let n = 1;
    const withCount = key.match(/^(.*?) (\d+)$/); // old "×n" notation
    if (withCount && PATTERN_BY_KEY.has(withCount[1])) {
      key = withCount[1];
      n = Number(withCount[2]);
    }
    const id = PATTERN_BY_KEY.get(key);
    if (!id) return null;
    if (!counts.has(id)) order.push(id);
    counts.set(id, (counts.get(id) ?? 0) + n);
  }
  const adjusted = (settings.scoring ?? 'original') !== 'original';
  return order.map((id) => {
    const p = PATTERNS[id];
    let points =
      id === 'chicken'
        ? settings.chickenHand === 'zero'
          ? 0
          : 1
        : adjusted && ADJUSTED_POINTS[id] !== undefined
          ? ADJUSTED_POINTS[id]
          : p.points;
    const n = counts.get(id)!;
    if (id === '11.1.1' || id === '11.1.2') {
      // Per-tile value (halved under the half-value setting), aggregated
      // back into the on-screen ×n form.
      points = (p.points / (settings.bonusTiles === 'half' ? 2 : 1)) * n;
      return { id, name: n > 1 ? `${p.name} ×${n}` : p.name, zh: p.zh, points };
    }
    return { id, name: p.name, zh: p.zh, points };
  });
}

/**
 * Parses a record in the matchToTxt format back into a MatchRecord (for
 * viewing an uploaded .txt file) — both the v0.2 format and the older one
 * without the v0.2 fields. Per-game payments are recomputed from the result
 * and the par setting, so the viewer can show scores for uploads too.
 * Throws an Error with a human-readable message on malformed input.
 */
export function matchFromTxt(txt: string): MatchRecord {
  const lines = txt.split(/\r?\n/);
  let ln = 0;
  const fail = (msg: string): never => {
    throw new Error(`Line ${ln + 1}: ${msg}`);
  };

  // Tiles are two chars ("B3", "E "); editors may strip trailing spaces.
  const tile = (s: string): Tile => {
    const t = s.trim();
    if (/^[BCDFA][1-9]$/.test(t)) return t;
    if (/^[ESWNRGO]$/.test(t)) return `${t} `;
    return fail(`bad tile "${s}"`);
  };

  const header: Record<string, string> = {};
  while (ln < lines.length && lines[ln].trim() !== '') {
    const m = lines[ln].match(/^([^:]+):\s*(.*)$/);
    if (!m) fail('expected a "Key: value" header line');
    header[m![1].trim()] = m![2].trim();
    ln++;
  }
  const num = (key: string): number => {
    if (!(key in header)) throw new Error(`Missing header "${key}"`);
    const n = Number(header[key]);
    if (Number.isNaN(n)) throw new Error(`Header "${key}" is not a number`);
    return n;
  };
  const chicken = num('Chicken Hand');
  const par = num('Par Score');
  const scoring = 'Scoring' in header ? num('Scoring') : 0;
  const bonus = 'Bonus Tiles' in header ? num('Bonus Tiles') : 0;
  const settings: RoomSettings = {
    rounds: num('Match Length') as RoomSettings['rounds'],
    thinkingTime: num('Thinking Time') as RoomSettings['thinkingTime'],
    chickenHand: chicken === 1 ? 'one' : chicken === 0 ? 'zero' : 'notAllowed',
    par: par === -30 ? '30/25' : (par as 25 | 30),
    scoring: scoring === 2 ? 'adjustedExtra' : scoring === 1 ? 'adjusted' : 'original',
    bonusTiles: bonus === 2 ? 'full' : bonus === 1 ? 'half' : 'none',
  };
  const abandonedBy: string[] = [];
  const players = SEAT_LABELS.map((label, s) => {
    const id = `uploaded-${s}`;
    const type = header[`Starting ${label} Player Type`] ?? '';
    if (type.includes('ABANDONED')) abandonedBy.push(id);
    return {
      id,
      name: header[`Starting ${label} Username`] ?? label,
      isBot: type.startsWith('BOT'),
      registered: type.startsWith('USER'),
    };
  });
  const headerFinalScores = SEAT_LABELS.map((label) => {
    const v = header[`Starting ${label} Final Score`];
    return v === undefined ? null : Number(v);
  });

  const parseMove = (seat: number, rest: string): MoveRecord => {
    const segs = rest.replace(/,\s*$/, '').split(', ');
    const p1s = segs[0];
    let m: RegExpMatchArray | null;
    let part1: MovePart1;
    let p2seg: string | undefined = segs[1];
    if ((m = p1s.match(/^BONUS (.+)$/)) && segs[1]?.startsWith('DRAW ')) {
      part1 = { t: 'bonus', tile: tile(m[1]), repl: tile(segs[1].slice('DRAW '.length)) };
      p2seg = segs[2];
    } else if ((m = p1s.match(/^DRAW AND DISCARD (.+)$/))) {
      part1 = { t: 'drawAndDiscard', tile: tile(m[1]) };
    } else if ((m = p1s.match(/^DRAW (.+)$/))) {
      part1 = { t: 'draw', tile: tile(m[1]) };
    } else if ((m = p1s.match(/^CHOW (.+) ([1-9])[1-9][1-9]$/))) {
      const t = tile(m[1]);
      part1 = { t: 'chow', tile: t, low: `${t[0]}${m[2]}` };
    } else if ((m = p1s.match(/^PUNG (.+)$/))) {
      part1 = { t: 'pung', tile: tile(m[1]) };
    } else if ((m = p1s.match(/^KONG (.+)$/))) {
      part1 = { t: 'bigKong', tile: tile(m[1]) };
    } else if ((m = p1s.match(/^MAHJONG (.+)$/))) {
      part1 = { t: 'mahjongDiscard', tile: tile(m[1]) };
    } else {
      return fail(`bad move "${p1s}"`);
    }
    if (p2seg === undefined) return { seat, part1 };
    let part2: MovePart2;
    if ((m = p2seg.match(/^DISCARD (.+)$/))) part2 = { t: 'discard', tile: tile(m[1]) };
    else if ((m = p2seg.match(/^KONG (.+)$/))) part2 = { t: 'kong', tile: tile(m[1]) };
    else if ((m = p2seg.match(/^BONUS (.+)$/))) part2 = { t: 'bonus', tile: tile(m[1]) };
    else if ((m = p2seg.match(/^MAHJONG(?: (.+))?$/))) {
      part2 = m[1] ? { t: 'mahjong', tile: tile(m[1]) } : { t: 'mahjong' };
    } else {
      return fail(`bad move part "${p2seg}"`);
    }
    return { seat, part1, part2 };
  };

  const games: GameRecord[] = [];
  while (ln < lines.length) {
    while (ln < lines.length && lines[ln].trim() === '') ln++;
    if (ln >= lines.length) break;
    let m = lines[ln].match(/^Game Number:\s*(\S+)/);
    if (!m) fail('expected "Game Number: …"');
    const gameNumber = m![1];
    ln++;
    let seed: string | undefined;
    if ((m = lines[ln]?.match(/^Seed:\s*(\S+)/))) {
      seed = m[1];
      ln++;
    }
    const startingHands: Tile[][] = [];
    for (let s = 0; s < 4; s++) {
      m = lines[ln]?.match(/^(East|South|West|North) player's starting hand:\s*(.*)$/);
      if (!m || m[1] !== SEAT_LABELS[s]) fail(`expected ${SEAT_LABELS[s]}'s starting hand`);
      startingHands.push(m![2].split(',').map(tile));
      ln++;
    }
    const moves: MoveRecord[] = [];
    const discardLog: { seat: number; tile: Tile }[] = [];
    const result: GameResultRecord = { winnerSeat: null, deltas: [0, 0, 0, 0] };
    let robbedWin = false;
    for (;;) {
      if (ln >= lines.length) fail('game never reached ENDGAME');
      const line = lines[ln].trim();
      if (line === 'ENDGAME') {
        ln++;
        break;
      }
      if ((m = line.match(/^SCORE:\s*(-?\d+)$/))) {
        result.value = Number(m[1]);
        ln++;
        continue;
      }
      if ((m = line.match(/^(EAST|SOUTH|WEST|NORTH): (.*)$/))) {
        const seat = SEAT_NAMES.indexOf(m[1]);
        const mv = parseMove(seat, m[2]);
        moves.push(mv);
        // Track discards + wins so the result summary can be reconstructed.
        if (mv.part1.t === 'drawAndDiscard') discardLog.push({ seat, tile: mv.part1.tile });
        if (mv.part2?.t === 'discard') discardLog.push({ seat, tile: mv.part2.tile });
        if (mv.part1.t === 'mahjongDiscard') {
          result.winnerSeat = seat;
          result.winBy = 'discard';
          const prev = moves[moves.length - 2];
          robbedWin =
            !!prev && prev.seat !== seat && prev.part2?.t === 'kong' && prev.part2.tile === mv.part1.tile;
          result.responsibleSeat = robbedWin
            ? prev.seat
            : findResponsible(discardLog, seat, mv.part1.tile);
        }
        if (mv.part2?.t === 'mahjong') {
          result.winnerSeat = seat;
          result.winBy = 'self';
          result.responsibleSeat = null;
        }
        ln++;
        continue;
      }
      // Anything else before ENDGAME is the pattern-name line; unrecognized
      // names are tolerated (the line is simply skipped, as before v0.2).
      const pats = parsePatternLine(line, settings);
      if (pats) result.patterns = pats;
      ln++;
    }
    // Recompute the payments the engine would have made, so the viewer can
    // show deltas and running scores for uploaded records too. Blessing of
    // Earth (a non-East win on East's very first discard, no melds declared)
    // pays out like a self-draw.
    if (result.winnerSeat !== null && result.value !== undefined) {
      const anyMelds = moves.some(
        (mv) =>
          mv.part1.t === 'chow' ||
          mv.part1.t === 'pung' ||
          mv.part1.t === 'bigKong' ||
          mv.part2?.t === 'kong',
      );
      const earth =
        result.winBy === 'discard' &&
        !robbedWin &&
        result.winnerSeat !== 0 &&
        discardLog.length === 1 &&
        discardLog[0].seat === 0 &&
        !anyMelds;
      result.deltas = computePayments({
        value: result.value,
        winnerSeat: result.winnerSeat,
        winBy: earth ? 'self' : result.winBy!,
        responsibleSeat: earth ? null : (result.responsibleSeat ?? null),
        par: settings.par,
      });
    }
    games.push({ gameNumber, ...(seed ? { seed } : {}), startingHands, moves, result });
  }
  if (games.length === 0) throw new Error('No games found in the file.');

  // Final scores: from the v0.2 headers when present, else summed from the
  // recomputed per-game deltas (current seat s of game g = starting seat
  // (s + g) % 4).
  const finalScores = [0, 0, 0, 0];
  if (headerFinalScores.every((v) => v !== null && !Number.isNaN(v))) {
    headerFinalScores.forEach((v, s) => (finalScores[s] = v!));
  } else {
    games.forEach((g, gi) => {
      g.result.deltas.forEach((d, cs) => {
        finalScores[(cs + gi) % 4] += d;
      });
    });
  }

  return {
    matchId: num('Match ID'),
    matchLength: settings.rounds,
    settings,
    players,
    games,
    finalScores,
    abandonedBy,
    ...(header['Match Type'] === '1' ? { tournamentWeek: 'uploaded' } : {}),
  };
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
