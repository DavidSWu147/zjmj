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
import { meldEl, orientedTile, tileEl, Deg } from '../tileui';
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

function act(action: GameAction): void {
  net.send({ type: 'action', action });
}

export function renderGame(el: HTMLElement, view: GameView): void {
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
  if (view.gameNumber !== lastGameNumber) {
    lastGameNumber = view.gameNumber;
    shownKW = new Set();
    selKey = null;
    lastTurnKey = '';
    prevSnap = null;
    ownClickRect = null;
    lastViewKey = '';
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
    el.innerHTML = '';
    el.style.position = 'relative';
    el.style.height = '100%';
    board = document.createElement('div');
    board.className = 'board';
    flightLayer = document.createElement('div');
    flightLayer.className = 'flight-layer';
    el.append(board, flightLayer);
  } else {
    board.innerHTML = '';
  }
  setFlightLayer(flightLayer);

  // ── geometry ──────────────────────────────────────────────────────
  const W = el.clientWidth || window.innerWidth;
  const H = el.clientHeight || window.innerHeight;
  const tw = Math.min(W / 21, H * 0.075); // own hand tile width
  const th = (tw * 4) / 3;
  const otw = Math.max(13, tw * 0.5); // opponent tile short side
  const oth = (otw * 4) / 3; // opponent tile long side

  const topReserve = oth + 32; // top opponent strip + name tag
  const bottomReserve = th + 30;
  const availV = H - topReserve - bottomReserve - 28;
  const availH = W / 2 - (oth + 44);
  // Central area: panel P = 4.5·dt plus 4 discard rows on each side.
  let dh = availV / 11.6; // 8·dh + 3.375·dh + gaps
  dh = Math.min(dh, availH / 5.8);
  const dt = dh * 0.75;
  const P = 4.5 * dt;
  const gap = Math.max(4, dh * 0.12);
  const cx = W / 2;
  const cy = topReserve + 10 + 4 * dh + gap + P / 2;

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

  // ── timer bar (inside the panel's bottom edge: never covers discards) ──
  if (view.deadline && view.phaseDuration && !view.gameResult && view.phase !== 'gameEnd') {
    const bar = document.createElement('div');
    bar.className = 'timerbar';
    bar.style.left = `${cx - P / 2}px`;
    bar.style.top = `${cy + P / 2 - 6}px`;
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
      const row = Math.min(3, Math.floor(i / 6));
      const col = row < 3 ? i % 6 : i - 18;
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

  // ── opponent hands + melds ────────────────────────────────────────
  for (let rel = 1; rel < 4; rel++) {
    const seat = (view.mySeat + rel) % 4;
    const sv = view.seats[seat];
    const wrap = document.createElement('div');
    wrap.className = 'opp-hand' + (rel !== 2 ? ' vertical' : '');
    wrap.style.setProperty('--tw', `${otw}px`);

    wrap.dataset.strip = String(seat);

    // Owner's left-to-right order: melds (earliest farthest left), gap, hand.
    const pieces: HTMLElement[] = [];
    sv.melds.forEach((m, i) => {
      const me = meldEl(m, rel as 1 | 2 | 3);
      me.dataset.meld = `${seat}-${i}`;
      pieces.push(me);
      if (i < sv.melds.length - 1 || sv.handCount > 0) {
        const g = document.createElement('div');
        g.className = 'strip-gap';
        g.style.width = g.style.height = `${otw * 0.35}px`;
        pieces.push(g);
      }
    });
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
        pieces.push(back);
      }
    }
    if (sv.hasDrawn) {
      const g = document.createElement('div');
      g.className = 'strip-gap';
      g.style.width = g.style.height = `${otw * 0.4}px`;
      pieces.push(g);
      const drawnTile = orientedTile(
        revealed ? revealed.drawn : null,
        BASE_DEG[rel],
        revealed && revealed.drawn ? { highlight: true } : { back: true },
      );
      drawnTile.dataset.odrawn = String(seat);
      pieces.push(drawnTile);
    }
    // Map owner's left-to-right onto the screen: right seat runs bottom-to-top
    // and top seat runs right-to-left, so those two reverse.
    const ordered = rel === 1 || rel === 2 ? pieces.reverse() : pieces;
    for (const p of ordered) wrap.appendChild(p);

    if (rel === 2) {
      wrap.style.top = '8px';
      wrap.style.left = '50%';
      wrap.style.transform = 'translateX(-50%)';
    } else if (rel === 1) {
      wrap.style.right = '8px';
      wrap.style.top = `${cy}px`;
      wrap.style.transform = 'translateY(-50%)';
    } else {
      wrap.style.left = '8px';
      wrap.style.top = `${cy}px`;
      wrap.style.transform = 'translateY(-50%)';
    }
    const tag = document.createElement('div');
    tag.textContent = `${sv.name}${sv.connected ? '' : ' (away)'}`;
    tag.style.cssText =
      'position:absolute;font-size:11px;color:#dfe7e2;text-shadow:0 1px 2px #000;white-space:nowrap;';
    if (rel === 2) tag.style.cssText += 'left:50%;transform:translateX(-50%);bottom:-17px;';
    else if (rel === 1) tag.style.cssText += 'right:2px;top:-18px;';
    else tag.style.cssText += 'left:2px;top:-18px;';
    wrap.appendChild(tag);
    board.appendChild(wrap);
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

  mine.melds.forEach((m, mi) => {
    const me = meldEl(m, 0);
    me.dataset.meld = `${view.mySeat}-${mi}`;
    handWrap.appendChild(me);
    const g = document.createElement('div');
    g.className = 'meld-gap';
    handWrap.appendChild(g);
  });
  view.myHand.forEach((t, i) => {
    const key = `h${i}`;
    const tile = tileEl(t, { selected: selKey === key });
    tile.classList.add('hand-tile');
    tile.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      clickTile(key, t, false, tile);
    });
    handWrap.appendChild(tile);
  });
  let drawnExtra = 0;
  if (view.myDrawn !== null) {
    const g = document.createElement('div');
    g.className = 'drawn-gap';
    handWrap.appendChild(g);
    const tile = tileEl(view.myDrawn, { selected: selKey === 'drawn' });
    tile.classList.add('hand-tile');
    tile.dataset.drawn = '1';
    tile.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      clickTile('drawn', view.myDrawn!, true, tile);
    });
    handWrap.appendChild(tile);
    drawnExtra = tw * 0.45 + tw + 4;
  }
  board.appendChild(handWrap);
  // Center on the 13-tile hand + melds so the strip does not shift when the
  // 14th drawn tile comes and goes. Positioned synchronously so animation
  // rects measured right after this render are correct.
  handWrap.style.left = `${Math.max(8, (W - (handWrap.offsetWidth - drawnExtra)) / 2)}px`;

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
    w.className = 'claim-word' + (shownKW.has(kwKey) ? '' : ' pop');
    w.style.color = `var(--kw-${kw.cls})`;
    w.textContent = `${kw.en} ${kw.zh}`;
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
    return b;
  };
  const o = view.myOptions;

  const showVariants = (items: { label: HTMLElement; fn: () => void }[]): void => {
    const vb = document.createElement('div');
    vb.className = 'variant-bar';
    vb.style.right = '18px';
    vb.style.bottom = `${th + 96}px`;
    vb.style.setProperty('--tw', `${tw * 0.72}px`);
    for (const it of items) {
      const opt = document.createElement('div');
      opt.className = 'variant-opt';
      opt.appendChild(it.label);
      opt.addEventListener('click', () => {
        vb.remove();
        it.fn();
      });
      vb.appendChild(opt);
    }
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

  // ── leave button ──────────────────────────────────────────────────
  // Stays above the scoring overlay so players can leave between games;
  // hidden on the match-over screen (the match is already finished).
  if (!view.matchResult) {
    const leave = document.createElement('button');
    leave.textContent = 'Leave';
    leave.style.cssText = 'position:absolute;top:10px;left:10px;z-index:25;opacity:.75;';
    leave.addEventListener('click', () => {
      if (confirm('Leave the match? A bot will take your seat.')) {
        net.send({ type: 'leaveMatch' });
        net.state.gameView = null;
        location.hash = '#/play';
      }
    });
    board.appendChild(leave);
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

function gameResultOverlay(view: GameView): HTMLElement {
  const r = view.gameResult!;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const card = document.createElement('div');
  card.className = 'result-card';

  if (r.draw) {
    card.innerHTML = `<h2 class="draw-green">Drawn Game 流局</h2>
      <p style="color:var(--text-dim)">The live wall is exhausted. Nobody scores.</p>`;
    card.appendChild(countdownEl(r.nextAt - view.now, r.lastGame));
    overlay.appendChild(card);
    return overlay;
  }

  const winnerName = escapeHtml(view.seats[r.winnerSeat!].name);
  const winByText =
    r.winBy === 'self'
      ? '<span class="win-gold">Self-Draw 自摸</span>'
      : `Mahjong 和 — <span class="lose-gray">Discarder 放銃: ${
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
