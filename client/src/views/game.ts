import { GameAction, GameView } from '../../../shared/src/protocol';
import { Tile } from '../../../shared/src/tiles';
import {
  animateTransition,
  BoardSnapshot,
  clearFlights,
  Rect,
  reapplyFlights,
  rectOf,
  setFlightLayer,
  takeSnapshot,
} from '../anim';
import { net } from '../net';
import { getSettings } from '../settings';
import { meldEl, orientedTile, tileEl, Deg } from '../tileui';
import { buildHelpContent } from './help';
import { buildHotkeySettings, buildTileSettings, normalizeKey, soundSettingsHtml } from './settings';
import { escapeHtml } from './play';

/** Seat colors by current seat wind (spec: E green, S vermilion, W cream, N blue). */
const SEAT_COLORS = ['var(--seat-e)', 'var(--seat-s)', 'var(--seat-w)', 'var(--seat-n)'];
const SEAT_LETTERS = ['E', 'S', 'W', 'N'];
const SEAT_ZH = ['東', '南', '西', '北'];
const BASE_DEG: Deg[] = [0, 270, 180, 90]; // tile orientation by relative seat
const KW_LABEL: Record<string, { en: string; zh: string; cls: string }> = {
  chow: { en: 'CHOW', zh: '吃', cls: 'chow' },
  pung: { en: 'PUNG', zh: '碰', cls: 'pung' },
  kong: { en: 'KONG', zh: '槓', cls: 'kong' },
  mahjong: { en: 'MAHJONG', zh: '和', cls: 'mahjong' },
  selfdraw: { en: 'SELF-DRAW', zh: '自摸', cls: 'mahjong' },
  cancel: { en: 'CANCEL', zh: '取消', cls: 'discarder' },
  dealin: { en: 'DEAL-IN', zh: '放銃', cls: 'discarder' },
};

let selKey: string | null = null;
let lastTurnKey = '';
let lastGameNumber = '';
let shownKW = new Set<string>();
let resizeHooked = false;
let prevSnap: BoardSnapshot | null = null;
let ownClickRect: Rect | null = null;
let lastViewKey = '';
let showZhNumber = false;
let shownBigPattern = '';
let winFlashKey = '';
let winFlashStart = 0;
/** The element renderGame last mounted into (panel + re-render target). */
let mountEl: HTMLElement | null = null;
/** In-match overlay panel currently open (top-bar Settings/Help buttons). */
let panelOpen: 'settings' | 'help' | null = null;
/** Autoplay: auto-discard the draw and pass claims, but always take a win. */
let autoplay = false;
let autoTimer: number | null = null;
/** Situation key autoplay last acted on (never act twice on one state). */
let autoKey = '';
/** Matches the server's dummy-bot delay so autoplay feels the same. */
const AUTO_DELAY_MS = 700;
/** Choice handlers of the open chow/kong variant bar (hotkey selection). */
let variantFns: (() => void)[] | null = null;
/** Hooks the keyboard layer uses to "click" this render's controls. */
let kbCtx: {
  handLen: number;
  clickHand: (idx: number) => void;
  clickDrawn: () => void;
  buttons: Partial<Record<'chow' | 'pung' | 'kong' | 'mahjong' | 'pass', HTMLButtonElement>>;
} | null = null;
let keysHooked = false;
/**
 * Physical walls are an opt-out embellishment, but even when enabled they
 * need a desktop pointer and enough room to draw four extra tile bands.
 */
function wallsWanted(W: number, H: number): boolean {
  return (
    getSettings().physicalWalls &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    W >= 900 &&
    H >= 620
  );
}

function act(action: GameAction): void {
  net.send({ type: 'action', action });
}

/** Full re-render of the live board (settings changed, autoplay toggled). */
function forceRerender(): void {
  const v = net.state.gameView;
  if (mountEl && v && location.hash.includes('play')) {
    clearFlights();
    lastViewKey = '';
    renderGame(mountEl, v);
  }
}

/** Update #1: drop the nudged-up tile back down (background click / ESC). */
function deselectTile(): void {
  if (selKey === null) return;
  selKey = null;
  mountEl?.querySelectorAll('.hand-area .tile-selected').forEach((n) => n.classList.remove('tile-selected'));
  act({ kind: 'select', tile: null });
}

function stopAutoplay(): void {
  autoplay = false;
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
}

/** Leave the match for the lobby (top-bar ✕ and the standings screen). */
function exitMatch(): void {
  stopAutoplay();
  closePanel();
  net.send({ type: 'leaveMatch' });
  net.state.gameView = null;
  location.hash = '#/play';
}

// ── in-match Settings / Help panels ─────────────────────────────────
// The panel lives on the mount element (a SIBLING of the board), so the
// per-view board rebuilds never tear it down.

function syncTopBtns(): void {
  mountEl?.querySelector('.top-btn.gear')?.classList.toggle('active', panelOpen === 'settings');
  mountEl?.querySelector('.top-btn.helpq')?.classList.toggle('active', panelOpen === 'help');
}

function closePanel(): void {
  panelOpen = null;
  mountEl?.querySelector('.match-panel')?.remove();
  syncTopBtns();
}

/** Opening one panel closes the other (Settings ⇄ Help toggle per spec). */
function togglePanel(kind: 'settings' | 'help'): void {
  const next = panelOpen === kind ? null : kind;
  closePanel();
  if (!next || !mountEl) return;
  panelOpen = next;

  const panel = document.createElement('div');
  panel.className = 'match-panel';
  const head = document.createElement('div');
  head.className = 'mp-head';
  head.innerHTML = `<h2>${next === 'settings' ? 'Settings 設定' : 'Help 說明'}</h2>`;
  const close = document.createElement('button');
  close.className = 'mp-close';
  close.title = 'Close';
  close.textContent = '✕';
  close.addEventListener('click', () => closePanel());
  head.appendChild(close);
  const body = document.createElement('div');
  body.className = 'mp-body';
  panel.append(head, body);

  if (next === 'settings') {
    // Everything from the main Settings page except the new-room defaults
    // (not relevant mid-match).
    const section = (title: string): HTMLElement => {
      const card = document.createElement('section');
      card.className = 'settings-card';
      card.innerHTML = `<h2>${title}</h2>`;
      const inner = document.createElement('div');
      card.appendChild(inner);
      body.appendChild(card);
      return inner;
    };
    buildTileSettings(section('Tiles 牌面'), forceRerender);
    buildHotkeySettings(section('Hotkeys 快捷鍵'), { bindings: false });
    section('Sound 音效').innerHTML = soundSettingsHtml();
  } else {
    buildHelpContent(body);
  }
  mountEl.appendChild(panel);
  syncTopBtns();
}

// ── keyboard hotkeys (update #3) ────────────────────────────────────
// Hand keys mirror the top keyboard row right-to-left: '=' is the tile next
// to the drawn tile, '`' the 13th over (the leftmost of a meld-free hand).
const HAND_KEYS = ['=', '-', '0', '9', '8', '7', '6', '5', '4', '3', '2', '1', '`'];

function onGameKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const view = net.state.gameView;
  if (!view || !location.hash.includes('play')) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
    return;
  }
  const k = normalizeKey(e.key);
  if (k === 'Escape') {
    e.preventDefault();
    // ESC first dismisses an open panel; otherwise it deselects (update #1).
    if (panelOpen) closePanel();
    else if (getSettings().hotkeys) deselectTile();
    return;
  }
  if (!getSettings().hotkeys || !kbCtx) return;
  const kb = getSettings().keyBindings;

  // An open chow/kong choice bar: E/W/Q (rightmost / 2nd / leftmost-of-3).
  if (variantFns && variantFns.length > 0) {
    const n = variantFns.length;
    let fn: (() => void) | undefined;
    if (k === kb.optRight) fn = variantFns[n - 1];
    else if (k === kb.optMid && n >= 2) fn = variantFns[n - 2];
    else if (k === kb.optLeft && n === 3) fn = variantFns[0];
    if (fn) {
      e.preventDefault();
      fn();
      return;
    }
  }

  if (k === 'Backspace' || k === 'Delete') {
    e.preventDefault();
    kbCtx.clickDrawn();
    return;
  }
  const hi = HAND_KEYS.indexOf(k);
  if (hi >= 0) {
    e.preventDefault();
    // Offset from the drawn tile; melds shorten the hand and thereby retire
    // the leftover keys on the left end.
    kbCtx.clickHand(kbCtx.handLen - 1 - hi);
    return;
  }
  const btn =
    k === ' '
      ? kbCtx.buttons.pass
      : k === kb.chow
        ? kbCtx.buttons.chow
        : k === kb.pung
          ? kbCtx.buttons.pung
          : k === kb.kong
            ? kbCtx.buttons.kong
            : k === kb.mahjong
              ? kbCtx.buttons.mahjong
              : undefined;
  if (k === ' ' || btn) e.preventDefault(); // Space must never scroll the page
  btn?.click();
}

export function renderGame(el: HTMLElement, view: GameView): void {
  mountEl = el;
  if (!resizeHooked) {
    resizeHooked = true;
    window.addEventListener('resize', () => {
      const v = net.state.gameView;
      if (v && location.hash.includes('play')) {
        // Layout moves: in-flight rects are invalid and a re-render is forced.
        clearFlights();
        lastViewKey = '';
        renderGame(el, v);
      }
    });
  }
  if (!keysHooked) {
    keysHooked = true;
    document.addEventListener('keydown', onGameKey);
  }
  if (view.gameNumber !== lastGameNumber) {
    lastGameNumber = view.gameNumber;
    shownKW = new Set();
    selKey = null;
    lastTurnKey = '';
    prevSnap = null;
    ownClickRect = null;
    lastViewKey = '';
    shownBigPattern = '';
    clearFlights();
  }
  // Reset the local tile selection only when the situation actually changes,
  // not on every server broadcast (a select echo must not clear it).
  const turnKey = [
    view.gameNumber,
    view.turnSeat,
    view.phase,
    view.myDrawn ?? '-',
    view.remaining,
    view.pendingClaim ? 'pc' : '-',
  ].join(':');
  if (turnKey !== lastTurnKey) {
    lastTurnKey = turnKey;
    selKey = null;
  }

  // The board's content is rebuilt per state; the flight layer persists so
  // animations survive re-renders. Identical states are skipped entirely.
  let board = el.querySelector<HTMLElement>(':scope > .board');
  let flightLayer = el.querySelector<HTMLElement>(':scope > .flight-layer');
  const viewKey = JSON.stringify({ ...view, now: 0 });
  if (board && flightLayer && viewKey === lastViewKey) return;
  lastViewKey = viewKey;
  if (!board || !flightLayer) {
    el.innerHTML = ''; // wipes any open panel too — the flag must follow
    panelOpen = null;
    el.style.position = 'relative';
    el.style.height = '100%';
    board = document.createElement('div');
    board.className = 'board';
    // Update #1: a click on the bare felt (not a tile/button) drops the
    // nudged-up tile back down, so discarding needs two clicks again.
    board.addEventListener('pointerdown', (e) => {
      if (e.target === board) deselectTile();
    });
    flightLayer = document.createElement('div');
    flightLayer.className = 'flight-layer';
    el.append(board, flightLayer);
  } else {
    board.innerHTML = '';
  }
  setFlightLayer(flightLayer);
  variantFns = null; // the board rebuild removed any open variant bar

  // ── geometry ──────────────────────────────────────────────────────
  const W = el.clientWidth || window.innerWidth;
  const H = el.clientHeight || window.innerHeight;
  const tw = Math.min(W / 21, H * 0.075); // own hand tile width
  const th = (tw * 4) / 3;
  const otw = Math.max(13, tw * 0.5); // opponent tile short side
  const oth = (otw * 4) / 3; // opponent tile long side
  const bonusActive = view.wall !== null && view.wall.cols === 72;

  // Worst-case strip depth from a hand line: a small exposed kong's pocket
  // is two upright short sides deep. Opponents' bonus tiles sit just past
  // this, so with bonus tiles in play the top reserve grows to keep the top
  // opponent's row clear of the board center; the bottom reserve grows in
  // wall mode so the bottom wall can never reach the player's own pocket.
  const oppMeldDepth = Math.max(oth, 2 * otw + 1);
  const ownMeldDepth = Math.max(th, 2 * tw + 1);
  const showWalls = view.wall !== null && wallsWanted(W, H);
  const topReserve = bonusActive
    ? Math.max(oth + 32, oppMeldDepth + otw + 22)
    : oth + 32; // top opponent strip + name tag
  const bottomReserve = (showWalls ? ownMeldDepth : th) + 30;
  const availV = H - topReserve - bottomReserve - 28;
  const availH = W / 2 - (8 + oppMeldDepth + (bonusActive ? oth + 6 : 0) + 30);
  // Central area: panel P = 4.5·dt plus 3 discard rows on each side; the
  // desktop wall bands reserve roughly 1.3·dh more per side, plus a little
  // slack so the pinwheel's overhang has breathing room.
  let dh = availV / (showWalls ? 13.4 : 9.7);
  dh = Math.min(dh, availH / (showWalls ? 6.2 : 4.9));
  const dt = dh * 0.75;
  const P = 4.5 * dt;
  // The gutter between panel and discards hosts the timer bar (4px), with
  // clearance from the panel's 2px shadow ring on one side and the tiles on
  // the other, so it must never collapse below that.
  const gap = Math.max(12, dh * 0.15);
  // Wall metrics (desktop): the walls form a real-life pinwheel around the
  // discard windmill (see the walls section). The band reserved between the
  // discards and each player's hand is budgeted for the max column width —
  // capped at discard-tile size, so the walls always read as background.
  const wallL = view.wall ? view.wall.cols / 4 : 17;
  const wallGap = Math.max(6, dh * 0.15);
  const wallCwMax = 0.75 * dh;
  const wallBand = showWalls
    ? wallGap + (wallCwMax * 4) / 3 + Math.max(2, ((wallCwMax * 4) / 3) * 0.13)
    : 0;
  const cx = W / 2;
  let cy = topReserve + 10 + 3 * dh + gap + P / 2 + wallBand;
  if (showWalls) {
    // The pinwheel's overhang is capped by whichever side has less room, so
    // the center floats toward the midpoint between the top furniture and
    // the player's hand (within the bottom slack the dh budget left free)
    // to give the overhang equal room both ways.
    const bottomRoom = H - bottomReserve - 18 - (cy + P / 2 + gap + 3 * dh + wallBand);
    const cyBalanced = (topReserve + 4 + H - th - 30) / 2;
    cy = Math.min(cy + Math.max(0, bottomRoom), Math.max(cy, cyBalanced));
  }
  // Full 13-tile hand lengths (12 flex gaps of 2px), own and opponent.
  const handOwn13 = 13 * tw + 12 * 2;
  const handW13 = 13 * otw + 12 * 2;
  // Length of the always-reserved drawn-tile slot at the free end of a strip
  // (strip gap + tile + two flex gaps).
  const drawnSlotOwn = tw * 1.45 + 4;
  const drawnSlotOpp = otw * 1.4 + 4;

  board.style.setProperty('--tw', `${tw}px`);

  // ── central control panel ─────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'cpanel';
  panel.style.left = `${cx - P / 2}px`;
  panel.style.top = `${cy - P / 2}px`;
  panel.style.width = `${P}px`;
  panel.style.height = `${P}px`;
  const QUAD_CLIP = [
    'polygon(0% 100%, 50% 50%, 100% 100%)',
    'polygon(100% 0%, 50% 50%, 100% 100%)',
    'polygon(0% 0%, 50% 50%, 100% 0%)',
    'polygon(0% 0%, 50% 50%, 0% 100%)',
  ];
  const LABEL_POS = [
    'left: 50%; bottom: 3%; transform: translateX(-50%)',
    'right: 3%; top: 50%; transform: translateY(-50%)',
    'left: 50%; top: 3%; transform: translateX(-50%)',
    'left: 3%; top: 50%; transform: translateY(-50%)',
  ];
  panel.style.setProperty('--ps', `${P}px`);
  for (let rel = 0; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const quad = document.createElement('div');
    quad.className = 'quad' + (view.turnSeat === seat && !view.gameResult && view.phase !== 'gameEnd' ? ' active' : '');
    quad.style.background = SEAT_COLORS[seat];
    quad.style.clipPath = QUAD_CLIP[rel];
    panel.appendChild(quad);
    const label = document.createElement('div');
    // Side seats put the score on its own line so 東南西北 fits (issue #7).
    const side = rel === 1 || rel === 3;
    label.className = 'quad-label' + (side ? ' side' : '');
    label.style.cssText = LABEL_POS[rel];
    const windLine = `<span class="seat-letter">${SEAT_LETTERS[seat]}</span><span class="seat-zh">${SEAT_ZH[seat]}</span>`;
    label.innerHTML = side
      ? `<span class="wind-line">${windLine}</span><span class="seat-score">${view.seats[seat].score}</span>`
      : `${windLine}<span class="seat-score">${view.seats[seat].score}</span>`;
    label.title = escapeHtml(view.seats[seat].name);
    panel.appendChild(label);
  }
  const circle = document.createElement('div');
  circle.className = 'ccircle';
  if (view.phase === 'dealing' && view.dice) {
    const grid = document.createElement('div');
    grid.className = 'dice-grid';
    view.dice.forEach((d, i) => {
      const die = dieEl(d);
      grid.appendChild(die);
      setTimeout(() => die.classList.add('shown'), i < 2 ? 350 : 1500);
    });
    circle.appendChild(grid);
  } else {
    // Click toggles between E1..N4 and 東一..北四 (issue #10).
    circle.innerHTML = `<div class="gnum">${showZhNumber ? view.gameNumberZh : view.gameNumber}</div><div class="rem">${String(view.remaining).padStart(2, '0')}</div>`;
    circle.style.cursor = 'pointer';
    circle.addEventListener('pointerdown', () => {
      showZhNumber = !showZhNumber;
      const gnum = circle.querySelector('.gnum');
      const v = net.state.gameView;
      if (gnum && v) gnum.textContent = showZhNumber ? v.gameNumberZh : v.gameNumber;
    });
  }
  panel.appendChild(circle);
  board.appendChild(panel);

  // ── timer bar (in the gutter between panel and discards) ──────────
  if (view.deadline && view.phaseDuration && !view.gameResult && view.phase !== 'gameEnd') {
    const bar = document.createElement('div');
    bar.className = 'timerbar';
    bar.style.left = `${cx - P / 2}px`;
    bar.style.top = `${cy + P / 2 + (gap - 4) / 2}px`; // centered in the gutter
    bar.style.width = `${P}px`;
    const fill = document.createElement('div');
    fill.className = 'fill';
    // All view timestamps are on the server clock; never mix in Date.now().
    const remainMs = Math.max(0, view.deadline - view.now);
    fill.style.transform = `scaleX(${Math.min(1, remainMs / view.phaseDuration)})`;
    bar.appendChild(fill);
    board.appendChild(bar);
    requestAnimationFrame(() => {
      fill.style.transition = `transform ${remainMs}ms linear`;
      fill.style.transform = 'scaleX(0)';
    });
  }

  // ── discard zones (windmill, right edge aligned with the panel) ───
  const rot = (x: number, y: number, k: number): [number, number] => {
    let px = x;
    let py = y;
    for (let i = 0; i < k; i++) {
      const nx = cx + (py - cy);
      const ny = cy - (px - cx);
      px = nx;
      py = ny;
    }
    return [px, py];
  };
  for (let rel = 0; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const zone = document.createElement('div');
    zone.className = 'discard-zone';
    zone.style.setProperty('--tw', `${dt}px`);
    const discards = view.seats[seat].discards;
    const wrapW = rel % 2 === 0 ? dt : dh;
    const wrapH = rel % 2 === 0 ? dh : dt;
    discards.forEach((d, i) => {
      // 3 rows of 6; extra discards continue along the 3rd row (the 19th
      // tile is its 7th), jutting out where they cannot collide with the
      // next player's first column.
      const row = Math.min(2, Math.floor(i / 6));
      const col = row < 2 ? i % 6 : i - 12;
      const x0 = cx + P / 2 - 6 * dt + col * dt;
      const y0 = cy + P / 2 + gap + row * dh;
      const [x, y] = rot(x0 + dt / 2, y0 + dh / 2, rel);
      const t = orientedTile(d.tile, BASE_DEG[rel], { dimmed: d.fromDraw });
      t.style.left = `${x - wrapW / 2}px`;
      t.style.top = `${y - wrapH / 2}px`;
      t.dataset.ds = `${seat}-${i}`;
      const isNewest =
        i === discards.length - 1 &&
        view.lastDiscard !== null &&
        view.lastDiscard.seat === seat &&
        view.phase === 'postDiscard';
      if (isNewest) t.classList.add('discard-last');
      zone.appendChild(t);
    });
    board.appendChild(zone);
  }

  // ── physical tile walls (desktop only) ────────────────────────────
  // The four walls form a pinwheel around the discard windmill the way four
  // players push them together in real life: each wall's owner-RIGHT end
  // tucks into the square corner on the owner's right and its owner-left
  // end runs outward past the adjacent wall's band — the left-hand player's
  // wall tops out just below the opposite opponent's row. Slots are
  // numbered in consumption order — clockwise from the right end of
  // breakSeat's wall — and the dice sum locates internal column 0 (the
  // breakpoint) among them. A full column is two face-down tiles, the
  // bottom one peeking out on the side nearest the panel; a half column is
  // a single flat tile.
  if (showWalls && view.wall) {
    const wi = view.wall;
    const C = wi.cols;
    const L = wallL;
    // Inner edge: the walls hug the discard windmill, and each wall's
    // overhang stops just below/beside the players' furniture (the top
    // strip and its bonus row, the own hand, the side strips).
    const inner = P / 2 + gap + 3 * dh + wallGap;
    const extLimits = [
      cy - (topReserve + 2),
      H - cy - th - 24,
      cx - (8 + oppMeldDepth + (bonusActive ? oth + 6 : 0) + 8),
    ];
    if (bonusActive) extLimits.push(cx - (8 + oppMeldDepth + 6 + oth + 4 * (tw + 2) + 12));
    const cw = Math.max(6, Math.min((inner + Math.min(...extLimits)) / L, wallCwMax));
    const wh = (cw * 4) / 3;
    const peek = Math.max(2, wh * 0.13);

    const lp = wi.livePointer;
    const kd = wi.kongDrawn;
    const liveCols = Math.floor(lp / 2);
    const frontHalf = lp % 2 === 1;
    const deadCols = Math.floor(kd / 2);
    const backHalf = kd % 2 === 1;
    const tilesLeft = (c: number): number => {
      const front = c < liveCols ? 2 : c === liveCols && frontHalf ? 1 : 0;
      const fromBack = C - 1 - c;
      const back = fromBack < deadCols ? 2 : fromBack === deadCols && backHalf ? 1 : 0;
      return Math.max(0, 2 - front - back);
    };
    // The dead wall is every tile the live wall will never reach: indices at
    // or past the final live pointer (2C − deadSize − kd). Each replacement
    // draw rolls the gray boundary forward BOTTOM-first — the boundary
    // column's top tile stays live as the eventual seabed tile — so an odd
    // dead wall shows two lone bottom tiles.
    const deadSize = C === 72 ? 16 : 14;
    const isDeadTile = (c: number, half: 0 | 1): boolean =>
      2 * c + half >= 2 * C - deadSize - kd;

    const zone = document.createElement('div');
    zone.className = 'discard-zone';
    zone.style.setProperty('--tw', `${cw}px`);
    const T = wi.diceSum % C;
    for (let k = 0; k < C; k++) {
      const c = (k - T + C) % C; // internal column at this physical slot
      const left = tilesLeft(c);
      if (left === 0) continue;
      const wallIdx = Math.floor(k / L);
      const seat = (wi.breakSeat + [0, 3, 2, 1][wallIdx]) % 4;
      const rel = (seat - view.mySeat + 4) % 4;
      const p = k % L; // column position from the owner's right end
      // Bottom-tile base position plus the top tile's outward stack offset.
      // Owner-right ends sit at the inner corners; owner-left ends run out
      // toward the screen edges (pinwheel overhang of L·cw − inner).
      let bx: number;
      let by: number;
      let ox = 0;
      let oy = 0;
      if (rel === 0) {
        bx = cx + inner - (p + 1) * cw;
        by = cy + inner;
        oy = peek;
      } else if (rel === 1) {
        bx = cx + inner;
        by = cy - inner + p * cw;
        ox = peek;
      } else if (rel === 2) {
        bx = cx - inner + p * cw;
        by = cy - inner - wh;
        oy = -peek;
      } else {
        bx = cx - inner - wh;
        by = cy + inner - (p + 1) * cw;
        ox = -peek;
      }
      const isFront = c === liveCols;
      // The dead-wall end's next replacement tile (kong/bonus draws start
      // their flight here).
      const isBackNext = c === C - 1 - deadCols;
      const bot = orientedTile(null, BASE_DEG[rel], { back: true });
      bot.dataset.wt = `${c}-bot`;
      bot.style.left = `${bx}px`;
      bot.style.top = `${by}px`;
      if (isDeadTile(c, 1)) bot.classList.add('tile-dead');
      zone.appendChild(bot);
      if (left === 2) {
        const top = orientedTile(null, BASE_DEG[rel], { back: true });
        top.dataset.wt = `${c}-top`;
        top.style.left = `${bx + ox}px`;
        top.style.top = `${by + oy}px`;
        top.style.zIndex = '2';
        if (isDeadTile(c, 0)) top.classList.add('tile-dead');
        if (isFront) top.dataset.wallfront = '1';
        if (isBackNext && !backHalf) top.dataset.wallback = '1';
        else if (isBackNext) bot.dataset.wallback = '1';
        zone.appendChild(top);
      } else {
        if (isFront) bot.dataset.wallfront = '1';
        if (isBackNext) bot.dataset.wallback = '1';
      }
    }
    board.appendChild(zone);
  }

  // ── opponent hands + melds ────────────────────────────────────────
  // Each strip is anchored on its drawn-tile slot, which is ALWAYS laid out
  // (an invisible placeholder when the seat holds no drawn tile): draws
  // cause zero shift, the drawn tile's spot never moves, and melds grow
  // away from it toward the other end — a strip full of kongs starts
  // further along rather than moving the anchor.
  for (let rel = 1; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const sv = view.seats[seat];
    const wrap = document.createElement('div');
    wrap.className =
      'opp-hand' + (rel !== 2 ? ' vertical' : '') + (rel === 1 ? ' opp-right' : '');
    wrap.style.setProperty('--tw', `${otw}px`);
    wrap.dataset.strip = String(seat);

    // Owner's left-to-right order: melds (earliest farthest left), anchor, hand.
    const pieces: HTMLElement[] = [];
    sv.melds.forEach((m, i) => {
      const me = meldEl(m, rel as 1 | 2 | 3);
      me.dataset.meld = `${seat}-${i}`;
      pieces.push(me);
      if (i < sv.melds.length - 1) {
        const g = document.createElement('div');
        g.className = 'strip-gap';
        g.style.width = g.style.height = `${otw * 0.35}px`;
        pieces.push(g);
      }
    });
    if (sv.melds.length > 0) {
      const g = document.createElement('div');
      g.className = 'strip-gap';
      g.style.width = g.style.height = `${otw * 0.35}px`;
      pieces.push(g);
    }
    // After a win the winner's concealed hand is revealed to everyone.
    const revealed = view.reveal && view.reveal.seat === seat ? view.reveal : null;
    if (revealed) {
      for (const t of revealed.hand) {
        pieces.push(orientedTile(t, BASE_DEG[rel]));
      }
    } else {
      for (let i = 0; i < sv.handCount; i++) {
        const back = orientedTile(null, BASE_DEG[rel], { back: true });
        back.dataset.hb = String(seat); // hand-back: discard flights start here
        // The back beside the drawn slot: a hand discard visually takes this
        // tile, and the drawn tile slides over into its place.
        if (i === sv.handCount - 1) back.dataset.hbend = String(seat);
        pieces.push(back);
      }
    }
    // The drawn slot is always laid out so its presence never re-flows the
    // hand; without a drawn tile it is an invisible placeholder.
    const g = document.createElement('div');
    g.className = 'strip-gap';
    g.style.width = g.style.height = `${otw * 0.4}px`;
    pieces.push(g);
    const drawnTile = orientedTile(
      sv.hasDrawn && revealed ? revealed.drawn : null,
      BASE_DEG[rel],
      sv.hasDrawn && revealed && revealed.drawn ? { highlight: true } : { back: true },
    );
    if (sv.hasDrawn) drawnTile.dataset.odrawn = String(seat);
    else drawnTile.style.visibility = 'hidden';
    pieces.push(drawnTile);
    // Map owner's left-to-right onto the screen: right seat runs bottom-to-top
    // and top seat runs right-to-left, so those two reverse.
    const ordered = rel === 1 || rel === 2 ? pieces.reverse() : pieces;
    for (const p of ordered) wrap.appendChild(p);

    board.appendChild(wrap);
    // Anchor so a full 13-tile hand sits centered and the drawn slot caps
    // its free end; the position is computed from constants (or the strip's
    // own deterministic length), never from the drawn tile's presence.
    let stripTop: number;
    if (rel === 2) {
      // Reversed layout: the drawn slot is the LEFT end — fixed.
      wrap.style.top = '8px';
      wrap.style.left = `${cx - handW13 / 2 - drawnSlotOpp}px`;
      stripTop = 8;
    } else if (rel === 1) {
      // Reversed layout: the drawn slot is the TOP end — fixed.
      wrap.style.right = '8px';
      stripTop = cy - handW13 / 2 - drawnSlotOpp;
      wrap.style.top = `${stripTop}px`;
    } else {
      // The drawn slot is the BOTTOM end — fixed; melds extend upward.
      wrap.style.left = '8px';
      stripTop = cy + handW13 / 2 + drawnSlotOpp - wrap.getBoundingClientRect().height;
      wrap.style.top = `${stripTop}px`;
    }

    // Names sit at fixed board positions: side opponents' names at the top,
    // near the top opponent's name, yielding to the strip's top end when
    // melds push it further up.
    const tag = document.createElement('div');
    tag.textContent = `${sv.name}${sv.connected ? '' : ' (away)'}`;
    tag.style.cssText =
      'position:absolute;font-size:11px;color:#dfe7e2;text-shadow:0 1px 2px #000;white-space:nowrap;z-index:5;';
    const sideTop = cy - handW13 / 2 - otw * 1.7 - 16;
    if (rel === 2) {
      tag.style.left = `${cx}px`;
      tag.style.transform = 'translateX(-50%)';
      tag.style.top = `${8 + oth + 6}px`;
    } else if (rel === 1) {
      tag.style.right = '8px';
      tag.style.top = `${Math.min(sideTop, stripTop - 18)}px`;
    } else {
      // Melds extend upward on the left side.
      tag.style.left = '8px';
      tag.style.top = `${Math.min(sideTop, stripTop - 18)}px`;
    }
    board.appendChild(tag);
  }

  // ── own hand ──────────────────────────────────────────────────────
  const mine = view.seats[view.mySeat];
  const handWrap = document.createElement('div');
  handWrap.className = 'hand-area';
  handWrap.style.bottom = '10px';
  handWrap.dataset.strip = String(view.mySeat);

  const canDiscard = !!view.myOptions.discard;
  const clickTile = (key: string, tile: Tile, fromDrawn: boolean, node: HTMLElement) => {
    if (!canDiscard) return;
    if (selKey === key) {
      selKey = null;
      ownClickRect = rectOf(node, board);
      act({ kind: 'discard', tile, fromDrawn });
    } else {
      selKey = key;
      handWrap.querySelectorAll('.tile-selected').forEach((n) => n.classList.remove('tile-selected'));
      node.classList.add('tile-selected');
      act({ kind: 'select', tile, fromDrawn });
    }
  };

  // Melds live in one sub-strip so they can be scaled down as a block when
  // a meld-heavy hand would otherwise run off the left edge of the screen.
  const meldStrip = document.createElement('div');
  meldStrip.className = 'meld-strip';
  mine.melds.forEach((m, mi) => {
    const me = meldEl(m, 0);
    me.dataset.meld = `${view.mySeat}-${mi}`;
    meldStrip.appendChild(me);
    const g = document.createElement('div');
    g.className = 'meld-gap';
    meldStrip.appendChild(g);
  });
  if (mine.melds.length > 0) handWrap.appendChild(meldStrip);
  const handTileEls: HTMLElement[] = [];
  view.myHand.forEach((t, i) => {
    const key = `h${i}`;
    const tile = tileEl(t, { selected: selKey === key });
    tile.classList.add('hand-tile');
    tile.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      clickTile(key, t, false, tile);
    });
    handTileEls.push(tile);
    handWrap.appendChild(tile);
  });
  // The drawn slot is always laid out (invisible placeholder without a
  // tile) so drawing and discarding never re-flow the hand.
  const dg = document.createElement('div');
  dg.className = 'drawn-gap';
  handWrap.appendChild(dg);
  let drawnEl: HTMLElement | null = null;
  if (view.myDrawn !== null) {
    const tile = tileEl(view.myDrawn, { selected: selKey === 'drawn' });
    tile.classList.add('hand-tile');
    tile.dataset.drawn = '1';
    tile.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      clickTile('drawn', view.myDrawn!, true, tile);
    });
    drawnEl = tile;
    handWrap.appendChild(tile);
  } else {
    const ph = tileEl(null, { back: true });
    ph.style.visibility = 'hidden';
    handWrap.appendChild(ph);
  }
  board.appendChild(handWrap);
  // Keyboard layer targets for this render (update #3). The buttons map is
  // filled in when the action bar is built below.
  kbCtx = {
    handLen: view.myHand.length,
    clickHand: (idx: number) => {
      const node = handTileEls[idx];
      if (node) clickTile(`h${idx}`, view.myHand[idx], false, node);
    },
    clickDrawn: () => {
      if (drawnEl && view.myDrawn !== null) clickTile('drawn', view.myDrawn, true, drawnEl);
    },
    buttons: {},
  };
  // Right-anchored on the drawn slot: a full 13-tile hand sits centered and
  // the drawn tile's spot never moves; melds push the hand leftward instead.
  // If they would push it past the left edge, the meld block shrinks just
  // enough to stay on screen. Positioned synchronously so animation rects
  // measured right after this render are correct.
  const handAnchor = (W + handOwn13) / 2 + drawnSlotOwn;
  let handLeft = handAnchor - handWrap.getBoundingClientRect().width;
  if (handLeft < 8 && mine.melds.length > 0) {
    const meldW = meldStrip.getBoundingClientRect().width;
    const scale = Math.max(0.5, (meldW - (8 - handLeft)) / meldW);
    meldStrip.style.setProperty('--tw', `${tw * scale}px`);
    handLeft = handAnchor - handWrap.getBoundingClientRect().width;
  }
  handWrap.style.left = `${handLeft}px`;

  // ── bonus tiles (flowers & seasons) ───────────────────────────────
  // Each seat's revealed bonus tiles sit in front of that seat's melds at
  // hand-tile size: the local player's in the bottom-left corner (mirroring
  // the action buttons), each opponent's along the meld end of their strip —
  // the anchored end, so the row stays put as the drawn tile comes and goes.
  const myBonus = view.seats[view.mySeat].bonus ?? [];
  if (myBonus.length > 0) {
    // Rows of 4, stacking upward (the 5th tile sits above the 1st) so a
    // long run of bonus tiles never reaches the player's own wall.
    const stack = document.createElement('div');
    stack.className = 'bonus-stack';
    // Left edge on the far edge of the left opponent's bonus column — past
    // their strip's worst-case depth, so even a small exposed kong made as
    // their final meld (its pocket near the strip's bottom end) can't reach.
    stack.style.left = `${8 + oppMeldDepth + 6 + oth}px`;
    stack.style.bottom = `${Math.max(th + 34, 2 * tw + 20)}px`;
    stack.style.setProperty('--tw', `${tw}px`);
    let row: HTMLElement | null = null;
    myBonus.forEach((t, i) => {
      if (i % 4 === 0) {
        row = document.createElement('div');
        row.className = 'bonus-row';
        stack.appendChild(row); // column-reverse puts later rows above
      }
      const el = tileEl(t);
      el.dataset.bonus = `${view.mySeat}-${i}`;
      row!.appendChild(el);
    });
    board.appendChild(stack);
  }
  for (let rel = 1; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const bonus = view.seats[seat].bonus ?? [];
    if (bonus.length === 0) continue;
    const strip = rectOf(board.querySelector(`[data-strip="${seat}"]`), board);
    if (!strip) continue;
    const zone = document.createElement('div');
    zone.className = 'discard-zone';
    zone.style.setProperty('--tw', `${otw}px`);
    const step = otw + 2;
    // The row sits one worst-case meld depth inside the hand line — past a
    // small exposed kong's two-tile pocket — so no meld can ever reach it.
    const inset = oppMeldDepth + 6;
    bonus.forEach((t, i) => {
      const el = orientedTile(t, BASE_DEG[rel]);
      if (rel === 2) {
        // Top strip is reversed: melds end at the screen-right edge; the row
        // sits below the strip and reads left-to-right for its owner.
        el.style.left = `${strip.x + strip.w - otw - i * step}px`;
        el.style.top = `${8 + inset}px`;
      } else if (rel === 1) {
        // Right strip: melds end at the bottom; the column sits to its left.
        el.style.left = `${W - 8 - inset - oth}px`;
        el.style.top = `${strip.y + strip.h - otw - i * step}px`;
      } else {
        // Left strip: melds end at the top; the column sits to its right.
        el.style.left = `${8 + inset}px`;
        el.style.top = `${strip.y + i * step}px`;
      }
      el.dataset.bonus = `${seat}-${i}`;
      zone.appendChild(el);
    });
    board.appendChild(zone);
  }

  // ── 30+ point win: the winner's hand & meld area flashes gold ─────
  // The blink's phase is anchored to when the flash first appeared, so a
  // board re-render mid-pause doesn't restart it in its invisible half.
  // Prepended so it paints behind the tiles it backs.
  if (view.winFlash && view.winFlash.value >= 30) {
    const wseat = view.winFlash.seat;
    const key = `${view.gameNumber}:${wseat}`;
    if (winFlashKey !== key) {
      winFlashKey = key;
      winFlashStart = Date.now();
    }
    const strip = rectOf(board.querySelector(`[data-strip="${wseat}"]`), board);
    if (strip) {
      const glow = document.createElement('div');
      glow.className = 'win-flash';
      glow.style.left = `${strip.x - 8}px`;
      glow.style.top = `${strip.y - 8}px`;
      glow.style.width = `${strip.w + 16}px`;
      glow.style.height = `${strip.h + 16}px`;
      glow.style.animationDelay = `${-(Date.now() - winFlashStart)}ms`;
      board.prepend(glow);
    }
  }

  // ── claim keywords (animate only when they first appear) ──────────
  const D = P / 2 + gap + 2 * dh;
  const KW_POS: [number, number][] = [
    [cx, cy + D],
    [cx + D, cy],
    [cx, cy - D],
    [cx - D, cy],
  ];
  const shownNow = new Set<string>();
  for (const c of view.claims) {
    // Compare against the server clock: client clocks may be skewed.
    if (c.expires && c.expires <= view.now) continue;
    const kwKey = `${c.seat}:${c.kind}`;
    shownNow.add(kwKey);
    const rel = (c.seat - view.mySeat + 4) % 4;
    const kw = KW_LABEL[c.kind];
    const w = document.createElement('div');
    const firstShowing = !shownKW.has(kwKey);
    w.className = 'claim-word' + (firstShowing ? ' pop' : '');
    w.style.color = `var(--kw-${kw.cls})`;
    w.textContent = `${kw.en} ${kw.zh}`;
    // On a discard win, DEAL-IN pops on the feeder a beat before MAHJONG.
    if (firstShowing && c.kind === 'mahjong' && view.claims.some((o) => o.kind === 'dealin')) {
      w.style.animationDelay = '0.3s';
      w.style.animationFillMode = 'backwards';
    }
    const [x, y] = KW_POS[rel];
    w.style.left = `${x}px`;
    w.style.top = `${y}px`;
    w.style.transform = 'translate(-50%,-50%)';
    if (c.expires) {
      setTimeout(() => w.remove(), Math.max(0, c.expires - view.now));
    }
    board.appendChild(w);
  }
  shownKW = shownNow;

  // ── 125+ point pattern celebration: big golden Chinese text ───────
  if (view.winFlash?.bigPattern) {
    const bp = view.winFlash.bigPattern;
    const key = `${view.gameNumber}:${bp.zh}`;
    const big = document.createElement('div');
    big.className = 'big-pattern' + (shownBigPattern === key ? '' : ' pop');
    shownBigPattern = key;
    big.textContent = bp.zh;
    big.style.left = `${cx}px`;
    big.style.top = `${cy}px`;
    board.appendChild(big);
  }

  // ── pending claim preview ─────────────────────────────────────────
  if (view.pendingClaim) {
    const pv = document.createElement('div');
    pv.className = 'variant-bar';
    pv.style.right = '18px';
    pv.style.bottom = `${th + 88}px`;
    pv.style.setProperty('--tw', `${tw * 0.7}px`);
    const lbl = document.createElement('span');
    lbl.textContent = 'Claiming:';
    lbl.style.alignSelf = 'center';
    lbl.style.color = 'var(--text-dim)';
    pv.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'tile-row';
    for (const t of view.pendingClaim.tiles) row.appendChild(tileEl(t));
    pv.appendChild(row);
    board.appendChild(pv);
  }

  // ── action buttons ────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'action-bar';
  bar.style.right = '18px';
  bar.style.bottom = `${th + 34}px`;
  const btn = (cls: string, en: string, zh: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `action-btn ${cls}`;
    b.innerHTML = `${en}<span class="zh">${zh}</span>`;
    b.addEventListener('click', fn);
    bar.appendChild(b);
    // The keyboard layer presses buttons by role; CANCEL shares PASS's slot
    // (both live on Space, "PASS or CANCEL depending on context").
    if (kbCtx) kbCtx.buttons[cls as 'chow' | 'pung' | 'kong' | 'mahjong' | 'pass'] = b;
    return b;
  };
  const o = view.myOptions;

  const showVariants = (items: { label: HTMLElement; fn: () => void }[]): void => {
    const vb = document.createElement('div');
    vb.className = 'variant-bar';
    vb.style.right = '18px';
    vb.style.bottom = `${th + 96}px`;
    vb.style.setProperty('--tw', `${tw * 0.72}px`);
    const fns: (() => void)[] = [];
    for (const it of items) {
      const choose = () => {
        vb.remove();
        variantFns = null;
        it.fn();
      };
      fns.push(choose);
      const opt = document.createElement('div');
      opt.className = 'variant-opt';
      opt.appendChild(it.label);
      opt.addEventListener('click', choose);
      vb.appendChild(opt);
    }
    // Ambiguous-choice hotkeys (E/W/Q) pick from the same list, left-to-right.
    variantFns = fns;
    board.appendChild(vb);
  };

  if (o.kongs && o.kongs.length > 0 && view.phase !== 'robbing') {
    btn('kong', 'KONG', '槓', () => {
      if (o.kongs!.length === 1) {
        act({ kind: 'kong', tile: o.kongs![0].tile, variant: o.kongs![0].variant });
      } else {
        showVariants(
          o.kongs!.map((k) => ({
            label: kongPreview(k.tile, k.variant),
            fn: () => act({ kind: 'kong', tile: k.tile, variant: k.variant }),
          })),
        );
      }
    });
  }
  if (o.mahjong) {
    btn('mahjong', 'MAHJONG', '自摸', () => act({ kind: 'mahjong' }));
  }
  if (o.claim) {
    const c = o.claim;
    if (c.chows && c.chows.length > 0) {
      btn('chow', 'CHOW', '吃', () => {
        if (c.chows!.length === 1) {
          act({ kind: 'claim', claim: 'chow', chowLow: c.chows![0] });
        } else {
          showVariants(
            c.chows!.map((low) => ({
              label: chowPreview(low),
              fn: () => act({ kind: 'claim', claim: 'chow', chowLow: low }),
            })),
          );
        }
      });
    }
    if (c.pung) btn('pung', 'PUNG', '碰', () => act({ kind: 'claim', claim: 'pung' }));
    if (c.kong) btn('kong', 'KONG', '槓', () => act({ kind: 'claim', claim: 'kong' }));
    if (c.mahjong) btn('mahjong', 'MAHJONG', '和', () => act({ kind: 'claim', claim: 'mahjong' }));
    // A pending chow/pung is withdrawn ("Cancel"), not passed.
    if (view.pendingClaim) btn('pass', 'CANCEL', '取消', () => act({ kind: 'claim', claim: 'pass' }));
    else btn('pass', 'PASS', '過', () => act({ kind: 'claim', claim: 'pass' }));
  }
  if (bar.children.length > 0) board.appendChild(bar);

  // ── top bar: leave ✕ · autoplay A · settings ⚙ · help ? ──────────
  // Stays above the scoring overlay so players can use it between games;
  // hidden on the match-over screen (the match is already finished).
  if (!view.matchResult) {
    const top = document.createElement('div');
    top.className = 'top-bar';
    const mkTop = (cls: string, text: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = `top-btn ${cls}`;
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', fn);
      top.appendChild(b);
      return b;
    };
    mkTop('leave', '✕', 'Leave the match', () => {
      if (confirm('Leave the match? A bot will take your seat.')) exitMatch();
    });
    const autoBtn = mkTop(
      'auto' + (autoplay ? ' active' : ''),
      'A',
      'Autoplay: discard every draw and pass all claims, but always take a win',
      () => {
        autoplay = !autoplay;
        if (!autoplay) stopAutoplay();
        autoKey = ''; // re-evaluate the current situation on the next render
        autoBtn.classList.toggle('active', autoplay);
        if (autoplay) forceRerender();
      },
    );
    mkTop('gear' + (panelOpen === 'settings' ? ' active' : ''), '⚙', 'Settings', () =>
      togglePanel('settings'),
    );
    mkTop('helpq' + (panelOpen === 'help' ? ' active' : ''), '?', 'Help', () => togglePanel('help'));
    board.appendChild(top);
  }

  // ── autoplay (update #2.1) ────────────────────────────────────────
  // Like the dummy bot — discard the draw, pass every claim — except a win
  // is always taken immediately. Claim options still render for the moment
  // the delay lasts, so the player sees what autoplay passed on.
  if (autoplay && !view.gameResult && !view.matchResult && autoKey !== turnKey) {
    const schedule = (fn: () => void): void => {
      if (autoTimer !== null) clearTimeout(autoTimer);
      autoTimer = window.setTimeout(() => {
        autoTimer = null;
        fn();
      }, AUTO_DELAY_MS);
    };
    if (o.mahjong) {
      autoKey = turnKey;
      act({ kind: 'mahjong' });
    } else if (o.claim?.mahjong) {
      autoKey = turnKey;
      act({ kind: 'claim', claim: 'mahjong' });
    } else if (view.phase === 'preDiscard' && o.discard && view.myDrawn !== null) {
      autoKey = turnKey;
      const drawn = view.myDrawn;
      schedule(() => {
        const v = net.state.gameView;
        if (autoplay && v?.phase === 'preDiscard' && v.myOptions.discard && v.myDrawn === drawn) {
          act({ kind: 'discard', tile: drawn, fromDrawn: true });
        }
      });
    } else if (o.claim) {
      autoKey = turnKey;
      schedule(() => {
        if (autoplay && net.state.gameView?.myOptions.claim) act({ kind: 'claim', claim: 'pass' });
      });
    }
  }

  // ── result overlays ───────────────────────────────────────────────
  if (view.matchResult) {
    board.appendChild(matchResultOverlay(view));
  } else if (view.gameResult) {
    board.appendChild(gameResultOverlay(view));
  }

  // ── tile flight animations (diff against the previous state) ──────
  animateTransition(board, prevSnap, view, ownClickRect, view.claimGapMs || 1500);
  reapplyFlights(board);
  if (prevSnap && view.seats[view.mySeat].discards.length > prevSnap.discardCounts[view.mySeat]) {
    ownClickRect = null; // consumed by this render's discard flight
  }
  prevSnap = takeSnapshot(board, view);
}

/** A die face with traditional pips: 1 and 4 are red, the 1 pip is large. */
function dieEl(value: number): HTMLElement {
  const die = document.createElement('div');
  die.className = 'die' + (value === 1 || value === 4 ? ' red' : '');
  const LAYOUT: Record<number, number[]> = {
    1: [4],
    2: [2, 6],
    3: [2, 4, 6],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  for (let cell = 0; cell < 9; cell++) {
    const c = document.createElement('div');
    c.className = 'die-cell';
    if ((LAYOUT[value] ?? []).includes(cell)) {
      const pip = document.createElement('div');
      pip.className = 'pip' + (value === 1 ? ' big' : '');
      c.appendChild(pip);
    }
    die.appendChild(c);
  }
  return die;
}

function chowPreview(low: Tile): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  const idx = 'BCD'.indexOf(low[0]) * 9 + Number(low[1]) - 1;
  for (let k = 0; k < 3; k++) {
    const t = `${'BCD'[Math.floor((idx + k) / 9)]}${((idx + k) % 9) + 1}`;
    row.appendChild(tileEl(t));
  }
  return row;
}

function kongPreview(tile: Tile, variant: 'concealed' | 'small'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  for (let k = 0; k < 4; k++) {
    row.appendChild(tileEl(tile, { back: variant === 'concealed' && (k === 0 || k === 3) }));
  }
  return row;
}

function deltaCell(view: GameView, seat: number, delta: number): string {
  const name = escapeHtml(view.seats[seat].name);
  const cls = delta > 0 ? 'win-gold' : delta < 0 ? 'lose-gray' : '';
  const sign = delta > 0 ? '+' : '';
  return `<div class="delta-cell">
    <div class="nm">${SEAT_LETTERS[seat]} · ${name}</div>
    <div class="dv ${cls}">${sign}${delta}</div>
  </div>`;
}

/**
 * Cumulative scores after this game's payments, shown under the payment
 * deltas behind a divider (and on the Drawn Game screen) — update #10.
 * By the time the scoring screen is up the server has already applied the
 * payments, so the seats' scores are the post-payment totals.
 */
function scoresAfterEl(view: GameView): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'result-scores';
  const cells = [0, 1, 2, 3]
    .map((s) => {
      const score = view.seats[s].score;
      const cls = score > 0 ? 'win-gold' : score < 0 ? 'lose-gray' : '';
      return `<div class="delta-cell">
        <div class="nm">${SEAT_LETTERS[s]} · ${escapeHtml(view.seats[s].name)}</div>
        <div class="dv ${cls}">${score > 0 ? '+' : ''}${score}</div>
      </div>`;
    })
    .join('');
  wrap.innerHTML = `<div class="result-divider"></div>
    <div class="result-scores-label">Scores 總分</div>
    <div class="result-deltas" style="margin-top:6px">${cells}</div>`;
  return wrap;
}

function gameResultOverlay(view: GameView): HTMLElement {
  const r = view.gameResult!;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const card = document.createElement('div');
  card.className = 'result-card';

  if (r.draw) {
    card.innerHTML = `<h2 class="draw-green">Drawn Game 流局</h2>
      <p style="color:var(--text-dim)">The live wall is exhausted. Nobody scores.</p>`;
    card.appendChild(scoresAfterEl(view));
    card.appendChild(countdownEl(r.nextAt - view.now, r.lastGame));
    overlay.appendChild(card);
    return overlay;
  }

  const winnerName = escapeHtml(view.seats[r.winnerSeat!].name);
  const winByText =
    r.winBy === 'self'
      ? '<span class="win-gold">Self-Draw 自摸</span>'
      : `<span class="win-gold">Mahjong 和</span> — <span class="lose-gray">Discarder 放銃: ${
          r.responsibleSeat !== null && r.responsibleSeat !== undefined
            ? escapeHtml(view.seats[r.responsibleSeat].name)
            : 'nobody (same-round immunity)'
        }</span>`;
  card.innerHTML = `<h2><span class="win-gold">${winnerName}</span> wins!</h2>
    <div>${winByText}</div>`;

  if (r.winningHand) {
    const handRow = document.createElement('div');
    handRow.className = 'result-hand';
    for (const m of r.winningHand.melds) handRow.appendChild(meldEl(m, 0));
    if (r.winningHand.melds.length > 0) {
      const g = document.createElement('div');
      g.style.width = '14px';
      handRow.appendChild(g);
    }
    for (const t of r.winningHand.concealed) handRow.appendChild(tileEl(t));
    const g2 = document.createElement('div');
    g2.style.width = '14px';
    handRow.appendChild(g2);
    handRow.appendChild(tileEl(r.winningHand.winTile, { highlight: true }));
    const winnerBonus = view.seats[r.winnerSeat!]?.bonus ?? [];
    if (winnerBonus.length > 0) {
      const g3 = document.createElement('div');
      g3.style.width = '14px';
      handRow.appendChild(g3);
      for (const t of winnerBonus) handRow.appendChild(tileEl(t, { dimmed: true }));
    }
    card.appendChild(handRow);
  }

  const table = document.createElement('table');
  table.className = 'pattern-list';
  for (const p of r.patterns ?? []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td style="color:var(--text-dim)">${p.zh}</td><td class="pts">${p.points}</td>`;
    table.appendChild(tr);
  }
  card.appendChild(table);

  const total = document.createElement('div');
  total.className = 'result-total';
  const limitNote =
    r.limit === 'compound'
      ? ' (compound limit 320)'
      : r.limit === 'listed'
        ? ' (listed limit hand)'
        : '';
  total.textContent = `Total: ${r.total} points${limitNote}`;
  card.appendChild(total);

  const deltas = document.createElement('div');
  deltas.className = 'result-deltas';
  deltas.innerHTML = [0, 1, 2, 3].map((s) => deltaCell(view, s, r.deltas[s])).join('');
  card.appendChild(deltas);

  card.appendChild(scoresAfterEl(view));
  card.appendChild(countdownEl(r.nextAt - view.now, r.lastGame));

  overlay.appendChild(card);
  return overlay;
}

/** A live "next game / match ends in Ns…" countdown from a relative duration. */
function countdownEl(msRemaining: number, lastGame: boolean): HTMLElement {
  const next = document.createElement('div');
  next.className = 'result-next';
  const label = lastGame ? 'Match ends in' : 'Next game in';
  const localDeadline = Date.now() + Math.max(0, msRemaining);
  const update = () => {
    const secs = Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000));
    next.textContent = `${label} ${secs}s…`;
  };
  update();
  const timer = window.setInterval(() => {
    if (!next.isConnected) {
      clearInterval(timer);
      return;
    }
    update();
  }, 250);
  return next;
}

function matchResultOverlay(view: GameView): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const card = document.createElement('div');
  card.className = 'result-card';
  const rows = view
    .matchResult!.standings.map((s, i) => {
      const cls = s.result === 'WIN' ? 'win-gold' : s.result === 'LOSE' ? 'lose-gray' : 'draw-green';
      return `<tr>
        <td style="color:var(--text-dim)">${i + 1}.</td>
        <td>${escapeHtml(s.name)}${s.isBot ? ' 🤖' : ''}</td>
        <td class="pts">${s.score > 0 ? '+' : ''}${s.score}</td>
        <td class="pts ${cls}" style="font-weight:800">${s.result}</td>
      </tr>`;
    })
    .join('');
  card.innerHTML = `<h2>Match Over 終局</h2>
    <table class="pattern-list">${rows}</table>
    <div class="dialog-btns"><button id="tolobby">Back to Lobby</button></div>`;
  const exit = () => {
    stopAutoplay();
    closePanel();
    net.send({ type: 'leaveMatch' });
    net.state.gameView = null;
    net.state.inMatch = false;
    location.hash = '#/play';
    location.reload();
  };
  card.querySelector('#tolobby')!.addEventListener('click', exit);
  // The standings screen closes itself after the server's window.
  const msRemaining = Math.max(0, view.matchResult!.endsAt - view.now);
  const note = document.createElement('div');
  note.className = 'result-next';
  const localDeadline = Date.now() + msRemaining;
  const tick = () => {
    const secs = Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000));
    note.textContent = `Returning to lobby in ${secs}s…`;
    if (secs <= 0 && note.isConnected) exit();
  };
  tick();
  const timer = window.setInterval(() => {
    if (!note.isConnected) {
      clearInterval(timer);
      return;
    }
    tick();
  }, 250);
  card.appendChild(note);
  overlay.appendChild(card);
  return overlay;
}
