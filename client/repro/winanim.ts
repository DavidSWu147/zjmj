/**
 * Visual harness for the v0.1 win celebration and bonus tile display: the
 * top opponent has just won a 345-point Small Four Winds hand during the
 * pre-scoring pause (gold quadrant flash + big golden pattern text), and
 * every seat shows revealed bonus tiles in its pinwheel corner.
 */
import '../src/style.css';
import { GameView, MeldView } from '../../shared/src/protocol';
import { renderGame } from '../src/views/game';

const app = document.getElementById('app')!;

const windPung = (w: string): MeldView => ({
  kind: 'pung',
  tiles: [w, w, w],
  rotated: 0,
  faceDown: [],
});

function seat(
  handCount: number,
  melds: MeldView[],
  discards: { tile: string; fromDraw: boolean }[],
  bonus: string[],
) {
  return {
    name: 'player',
    isBot: false,
    connected: true,
    score: 25,
    handCount,
    hasDrawn: false,
    melds,
    discards,
    bonus,
  };
}

const disc = (tiles: string[]) => tiles.map((tile) => ({ tile, fromDraw: false }));

const view: GameView = {
  phase: 'gameEnd',
  now: Date.now(),
  claimGapMs: 1500,
  reveal: {
    seat: 2,
    hand: ['N ', 'N ', 'C7', 'C8'],
    drawn: 'C9',
  },
  gameNumber: 'E3',
  gameNumberZh: '東三',
  remaining: 31,
  dice: null,
  mySeat: 0,
  turnSeat: 2,
  seats: [
    seat(13, [], disc(['B1', 'C4', 'D9', 'E ']), ['F1', 'A3']),
    seat(13, [], disc(['D2', 'B7']), ['F2']),
    seat(4, [windPung('E '), windPung('S '), windPung('W ')], disc(['B9', 'C1']), ['A1', 'A2', 'F4']),
    seat(13, [], disc(['G ', 'O ', 'B5']), ['F3']),
  ],
  myHand: ['B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'D7', 'D8', 'D9', 'E '],
  myDrawn: null,
  selected: null,
  deadline: null,
  phaseDuration: null,
  lastDiscard: null,
  claims: [{ seat: 2, kind: 'mahjong', expires: Date.now() + 60000 }],
  myOptions: {},
  pendingClaim: null,
  winFlash: {
    seat: 2,
    value: 345,
    bigPattern: { name: 'Small Four Winds', zh: '小四喜' },
  },
  gameResult: null,
  matchResult: null,
};

renderGame(app, view);
(window as unknown as { reproDone: boolean }).reproDone = true;
