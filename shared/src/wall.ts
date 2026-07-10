import { Tile, fullTileSet } from './tiles';

/**
 * The wall per spec: 136 tiles in 68 columns of 2 (top + bottom).
 * Two dice pick whose wall to break (sum: 5,9=E; 2,6,10=S; 3,7,11=W; 4,8,12=N),
 * then two more dice; the sum of all four counts columns backwards from the
 * right end of the chosen wall to establish the breakpoint.
 *
 * Internally we index columns 0..67 starting at the breakpoint and walking in
 * the dealing direction (leftwards). Column c occupies tiles[2c] (top) and
 * tiles[2c+1] (bottom).
 *
 * Deal: 3 rounds of 2 columns (4 tiles) per player E,S,W,N, then E takes the
 * top of the next column, S its bottom, W the top of the following column and
 * N its bottom — columns 0..25 (tiles[0..51]).
 *
 * Live wall: 70 tiles, tiles[52..121], drawn top-then-bottom per column.
 * Dead wall: the 14 tiles right of the breakpoint, columns 67 down to 61;
 * kong replacement draws take the top then bottom of column 67, then 66, etc.
 * The dead wall conceptually stays at 14 tiles, so every draw (live or dead)
 * decrements a single shared counter that starts at 70.
 *
 * With bonus tiles the set grows to 144 tiles in 72 columns, the dead wall
 * to 16 tiles (columns 71 down), and the live wall to 76; flower replacement
 * draws come from the dead wall exactly like kong replacements.
 */
export class Wall {
  readonly dice: [number, number, number, number];
  /** Seat (0=E..3=N) whose wall was broken — cosmetic, for display. */
  readonly breakSeat: number;
  readonly hands: Tile[][];
  readonly bonus: boolean;
  private tiles: Tile[];
  private liveNext = 52;
  private kongDrawn = 0;
  private drawnCount = 0;
  private liveTotal: number;
  private lastColumn: number;

  constructor(rng: () => number = Math.random, opts: { bonus?: boolean } = {}) {
    this.bonus = opts.bonus ?? false;
    this.liveTotal = this.bonus ? 76 : 70;
    this.lastColumn = this.bonus ? 71 : 67;
    const d = () => 1 + Math.floor(rng() * 6);
    this.dice = [d(), d(), d(), d()];
    const firstSum = this.dice[0] + this.dice[1];
    // sum % 4: 1 -> E, 2 -> S, 3 -> W, 0 -> N
    this.breakSeat = [3, 0, 1, 2][firstSum % 4];

    const pool = fullTileSet(this.bonus);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.tiles = pool;

    this.hands = [[], [], [], []];
    // 3 rounds of 4 tiles (2 columns) per player.
    for (let round = 0; round < 3; round++) {
      for (let seat = 0; seat < 4; seat++) {
        const base = round * 16 + seat * 4;
        this.hands[seat].push(...this.tiles.slice(base, base + 4));
      }
    }
    // 13th tiles: E top of col 24, S bottom of col 24, W top of col 25, N bottom of col 25.
    this.hands[0].push(this.tiles[48]);
    this.hands[1].push(this.tiles[49]);
    this.hands[2].push(this.tiles[50]);
    this.hands[3].push(this.tiles[51]);
  }

  /** Tiles left to draw (live wall counter: 70, or 76 with bonus tiles). */
  get remaining(): number {
    return this.liveTotal - this.drawnCount;
  }

  /** Total columns around the table: 68, or 72 with bonus tiles. */
  get columns(): number {
    return this.lastColumn + 1;
  }

  /** All four dice: counts the break position from the wall's right end. */
  get diceSum(): number {
    return this.dice[0] + this.dice[1] + this.dice[2] + this.dice[3];
  }

  /** Internal pointer past the last live-drawn tile (52 right after the deal). */
  get livePointer(): number {
    return this.liveNext;
  }

  /** Replacement tiles taken off the dead-wall end so far. */
  get kongDrawnCount(): number {
    return this.kongDrawn;
  }

  drawLive(): Tile {
    if (this.remaining <= 0) throw new Error('wall empty');
    this.drawnCount++;
    return this.tiles[this.liveNext++];
  }

  /** Replacement draw from the dead wall (kong or revealed bonus tile). */
  drawKong(): Tile {
    if (this.remaining <= 0) throw new Error('wall empty');
    const k = this.kongDrawn++;
    const col = this.lastColumn - Math.floor(k / 2);
    const idx = k % 2 === 0 ? 2 * col : 2 * col + 1;
    this.drawnCount++;
    return this.tiles[idx];
  }
}
