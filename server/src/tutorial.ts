import { RoomSettings } from '../../shared/src/protocol';
import { fullTileSet, Tile } from '../../shared/src/tiles';

/**
 * The tutorial (v0.3): a scripted 1-round match against three ChickenBots
 * with rigged walls. The human always starts East; every game is set up so
 * the player wins while the bots sit on doomed Seven Pairs hands — each bot
 * waits on a tile that can never pair up (its remaining copies are buried
 * in the dead wall, held by the player, or split between the bots).
 *
 * The walls are constructed here from the dealt hands plus the exact draw
 * sequences; the bots then behave deterministically through their normal
 * ChickenBot logic (verified move-by-move in tutorial.test.ts). Junk draws
 * fed to a bot are always safe: a fresh tile ties its wait tile on unseen
 * copies (3 vs 3), and the discard priority order then sheds the junk —
 * honors are only ever fed to a bot whose own priority list discards them
 * before its wait tile.
 */

export const TUTORIAL_SETTINGS: RoomSettings = {
  rounds: 1,
  thinkingTime: 30, // nominal: tutorial matches run with unlimited thinking
  chickenHand: 'one',
  par: 25,
  scoring: 'original',
  bonusTiles: 'none',
};

export interface FixedWall {
  tiles: Tile[];
  dice: [number, number, number, number];
}

interface WallSpec {
  /** 13 tiles per CURRENT seat (E,S,W,N), any order. */
  deal: [Tile[], Tile[], Tile[], Tile[]];
  /** Live-wall draws in consumption order. */
  live: Tile[];
  /** Dead-wall replacement draws (kongs) in consumption order. */
  dead: Tile[];
  /** Tiles to bury deep in the dead wall (never drawn). */
  bury: Tile[];
  dice: [number, number, number, number];
}

/** Normalizes "E" → "E " etc. so the specs below can stay compact. */
const t = (s: string): Tile => (s.length === 1 ? `${s} ` : s);
const ts = (s: string): Tile[] => s.split(' ').filter(Boolean).map(t);

/**
 * Lays a spec out as a full 136-tile wall: the deal occupies positions
 * 0..51 (three rounds of four tiles per seat, then the 13th tiles), live
 * draws run from 52, dead-wall draws consume 134,135,132,133,… and the
 * leftover pool fills every remaining slot (bury tiles deepest first).
 * Throws unless the result is exactly the full 136-tile set.
 */
export function buildWall(spec: WallSpec): FixedWall {
  const tiles: (Tile | null)[] = new Array(136).fill(null);
  for (let seat = 0; seat < 4; seat++) {
    if (spec.deal[seat].length !== 13) {
      throw new Error(`seat ${seat} deal has ${spec.deal[seat].length} tiles`);
    }
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < 4; k++) {
        tiles[round * 16 + seat * 4 + k] = spec.deal[seat][round * 4 + k];
      }
    }
    tiles[48 + seat] = spec.deal[seat][12];
  }
  spec.live.forEach((tile, i) => {
    tiles[52 + i] = tile;
  });
  spec.dead.forEach((tile, k) => {
    const col = 67 - Math.floor(k / 2);
    tiles[k % 2 === 0 ? 2 * col : 2 * col + 1] = tile;
  });

  // Leftovers: the full set minus everything placed so far.
  const pool = new Map<Tile, number>();
  for (const tile of fullTileSet(false)) pool.set(tile, (pool.get(tile) ?? 0) + 1);
  const take = (tile: Tile): void => {
    const n = pool.get(tile) ?? 0;
    if (n <= 0) throw new Error(`wall spec uses too many ${tile}`);
    pool.set(tile, n - 1);
  };
  for (const tile of tiles) if (tile !== null) take(tile);
  for (const tile of spec.bury) take(tile);

  // Bury tiles go into the deepest unassigned dead-wall slots.
  let deep = 135;
  for (const tile of spec.bury) {
    while (tiles[deep] !== null) deep--;
    tiles[deep] = tile;
  }
  // Everything else fills the remaining holes in canonical order.
  const rest: Tile[] = [];
  for (const [tile, n] of pool) for (let k = 0; k < n; k++) rest.push(tile);
  let ri = 0;
  for (let i = 0; i < 136; i++) {
    if (tiles[i] === null) tiles[i] = rest[ri++];
  }
  if (ri !== rest.length) throw new Error('wall fill mismatch');
  return { tiles: tiles as Tile[], dice: spec.dice };
}

/**
 * Game E1 — basics: tiles, triplets/sequences/pairs, Pung, Chow, Mahjong.
 * Player (East) wins a chicken hand on ChickenBot1's C8 discard.
 * Bots wait to pair D9 (three singles; the 4th D9 is buried).
 */
const HAND_1: WallSpec = {
  deal: [
    ts('B1 B3 C5 C5 C6 C7 D1 D1 D2 S N N N'),
    ts('D8 D8 D9 E E W W R R G G O O'),
    ts('B8 B8 B9 B9 C9 C9 D8 D8 D9 E E W W'),
    ts('B8 B8 B9 B9 C9 C9 D9 R R G G O O'),
  ],
  live: ts('B7 D1 D2 D2 B2 C8'),
  dead: [],
  bury: ts('D9 N'),
  dice: [3, 4, 2, 5],
};

/**
 * Game E2 — claim precedence, Kongs, self-draw. Player sits North.
 * ChickenBot3 (West) holds the special near-ready hand and chows; the
 * player Pungs over it, then builds Concealed/Big/Small Kongs and wins
 * 130 by self-draw off the dead wall. Bot1 (East) waits on the White
 * Dragon so its own logic discards the fed South winds.
 */
const HAND_2: WallSpec = {
  deal: [
    ts('B1 B1 B2 B2 C7 C7 C8 C8 D2 D2 W W O'), // bot1 (E): 6 pairs + O wait
    ts('B3 B3 B6 B6 C5 C5 C6 C6 D8 D8 W W D9'), // bot2 (S): 6 pairs + D9 wait
    ts('B7 B8 C1 C1 C2 C2 C3 C3 D5 D9 E E E'), // bot3 (W): the special hand
    ts('B5 B9 B9 C4 C4 C4 D1 D3 D4 D6 S S R'), // player (N)
  ],
  live: ts('D7 B9 D3 C7 B8 R C9 B5 B7 B3 C2 B1 C4 S'),
  dead: ts('S B9 D1'),
  bury: ts('E D9 D9 O O O'),
  dice: [2, 6, 1, 4],
};

/**
 * Game E3 — Mixed One-Suit and the par-score payment split. Player sits
 * West with a bamboo hand, Pungs a fed East wind (keeping the hand open so
 * only Mixed One-Suit scores), and wins exactly 40 on ChickenBot3's B6.
 */
const HAND_3: WallSpec = {
  deal: [
    ts('C3 C3 C4 C4 C8 C8 D1 D1 D7 D7 N N D9'), // bot2 (E): 6 pairs + D9 wait
    ts('C6 C6 C7 C7 D2 D2 D4 D4 D8 D8 G G D9'), // bot3 (S): 6 pairs + D9 wait
    ts('B1 B2 B3 B3 B4 B5 B6 B7 B8 E E C5 D3'), // player (W)
    ts('C1 C1 C2 C2 D5 D5 D6 D6 S S W W O'), // bot1 (N): 6 pairs + O wait
  ],
  live: ts('C9 D3 B9 B1 B2 D1 B9 E C3 D5 B6'),
  dead: [],
  bury: ts('D9 D9 O O O E'),
  dice: [5, 3, 4, 2],
};

/**
 * Game E4 — the irregular hands: Thirteen Terminals (and Seven Pairs by
 * narration). Player sits South holding the 4th D9, draws C9 and E to
 * reach the 13-way wait, and self-draws C1 for 160.
 */
const HAND_4: WallSpec = {
  deal: [
    ts('B2 B2 B3 B3 C2 C2 C3 C3 D2 D2 D3 D3 D9'), // bot3 (E): 6 pairs + D9 wait
    ts('B1 B9 C1 C4 C7 D1 D9 S W N R G O'), // player (S)
    ts('B4 B4 B5 B5 C5 C5 C6 C6 D4 D4 D5 D5 D9'), // bot1 (W): 6 pairs + D9 wait
    ts('B6 B6 B7 B7 B8 B8 C8 C8 D6 D6 D7 D7 D9'), // bot2 (N): 6 pairs + D9 wait
  ],
  live: ts('B4 C9 C2 D3 C5 E B3 D2 C6 C1'),
  dead: [],
  bury: [],
  dice: [4, 4, 3, 3],
};

const WALLS: FixedWall[] = [HAND_1, HAND_2, HAND_3, HAND_4].map(buildWall);

/** The rigged wall for a tutorial game, by game index (0..3). */
export function tutorialWallFor(gameIndex: number): FixedWall | null {
  return WALLS[gameIndex] ?? null;
}
