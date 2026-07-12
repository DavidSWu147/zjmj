import { RoomSettings, RoomSummary } from '../../../shared/src/protocol';
import { displayName, isAccount } from '../account';
import { getSettings } from '../settings';
import { net } from '../net';
import { renderGame } from './game';
import { BONUSES, buildRoomSliders, CHICKENS, PARS, SCORINGS } from './sliders';

function settingsSummary(s: RoomSettings): string {
  const len = `${s.rounds} round${s.rounds === 1 ? '' : 's'}`;
  const chick = CHICKENS.find((c) => c.v === s.chickenHand)!.label;
  const par = PARS.find((p) => p.v === s.par)!.label;
  const scoring = SCORINGS.find((o) => o.v === (s.scoring ?? 'original'))!.label;
  const bonus = BONUSES.find((o) => o.v === (s.bonusTiles ?? 'none'))!.label;
  return `${len} · ${s.thinkingTime}s · Chicken: ${chick} · Par: ${par} · ${scoring} · ${bonus}`;
}

/** Index of the lobby row the keyboard selection sits on (update #6). */
let lobbySel = 0;

export function renderPlay(root: HTMLElement): void {
  const el = document.createElement('div');
  el.style.height = '100%';
  root.appendChild(el);

  let unsub: (() => void) | null = null;
  const update = () => {
    // A detached root means the router rebuilt the page (play → home → play)
    // without an intervening server update: this subscription is stale. It
    // must die immediately — if it kept rendering into its dead element it
    // would consume renderGame's render-skip key and freeze the live board.
    if (!el.isConnected || location.hash.replace(/^#\/?/, '') !== 'play') {
      unsub?.();
      return;
    }
    if (net.state.gameView) {
      renderGame(el, net.state.gameView);
    } else {
      renderLobby(el);
    }
  };
  unsub = net.onUpdate(update);

  // Lobby keyboard: arrows pick a room, Enter joins it — or, already in a
  // room, Enter attempts to start the match (host only), ESC leaves the
  // room, and Backspace/Delete deletes it (host only).
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected || location.hash.replace(/^#\/?/, '') !== 'play') {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (net.state.gameView) return; // the board has its own keyboard layer
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (t?.closest('dialog')) return; // the Create Room dialog owns its keys
    const rows = [...el.querySelectorAll<HTMLElement>('.room-row')];
    const inMyRoom = (action: string) =>
      el.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
      lobbySel = Math.max(0, Math.min(rows.length - 1, lobbySel + delta));
      rows.forEach((r, i) => r.classList.toggle('kb-sel', i === lobbySel));
      rows[lobbySel]?.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      // Always claimed by the lobby: a leftover-focused button (e.g. Create
      // Room after its dialog was dismissed) must never swallow Enter.
      e.preventDefault();
      // In a room: try to start the match (the button exists only for members
      // and is disabled unless this player is the host).
      const btn = inMyRoom('start') ?? rows[lobbySel]?.querySelector<HTMLButtonElement>('[data-action="join"]');
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // In a room: leave it. Otherwise ESC backs out to the home page.
      const leave = inMyRoom('leave');
      if (leave && !leave.disabled) leave.click();
      else location.hash = '';
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const del = inMyRoom('delete'); // absent for room #0 and non-members
      if (del && !del.disabled) {
        e.preventDefault();
        del.click();
      }
    }
  };
  document.addEventListener('keydown', onKey);

  update();
}

function renderLobby(el: HTMLElement): void {
  const { rooms, myRoom } = net.state;
  el.innerHTML = `
    <div class="page">
      <div class="page-head">
        <button id="back">← Home</button>
        <h1>Lobby 對局室</h1>
        <span class="spacer"></span>
        <span style="color: var(--text-dim)">${escapeHtml(displayName())}${net.state.connected ? '' : ' · reconnecting…'}</span>
        <button id="create" ${myRoom !== null ? 'disabled' : ''}>Create Room</button>
      </div>
      <div class="portrait-note">For the best experience, rotate your device to landscape 🔄 請將裝置轉為橫向</div>
      <div class="page-body" id="rooms"></div>
    </div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  el.querySelector('#create')!.addEventListener('click', () => openSettingsDialog());

  const list = el.querySelector('#rooms')!;
  for (const room of rooms) {
    list.appendChild(roomRow(room, myRoom));
  }
  // Keep the keyboard selection on a valid row across lobby refreshes.
  const rows = list.querySelectorAll<HTMLElement>('.room-row');
  lobbySel = Math.max(0, Math.min(rows.length - 1, lobbySel));
  rows.forEach((r, i) => r.classList.toggle('kb-sel', i === lobbySel));
}

function roomRow(room: RoomSummary, myRoom: number | null): HTMLElement {
  const row = document.createElement('div');
  row.className = 'room-row' + (myRoom === room.id ? ' mine' : '');
  const isMine = myRoom === room.id;
  const iAmHost = isMine && room.players.length > 0 && room.hostName === displayName();

  const players = room.players
    .map(
      (p, i) =>
        `<span class="player-chip${i === 0 ? ' host' : ''}">${escapeHtml(p.name)}${i === 0 ? ' ★' : ''}</span>`,
    )
    .join('');
  const empties = Array(Math.max(0, 4 - room.players.length))
    .fill('<span class="player-chip" style="opacity:.35">empty</span>')
    .join('');

  const isMyPrivate = isMine && room.isPrivate && net.state.myRoomCode;
  row.innerHTML = `
    <div class="room-id">Room #${room.id}${room.id === 0 ? ' 🔒' : ''}${room.isPrivate ? ' 🔐' : ''}</div>
    <div class="room-settings">${settingsSummary(room.settings)}${
      isMyPrivate ? ` · <b>Code: ${net.state.myRoomCode}</b>` : ''
    }</div>
    <div class="room-players">${players}${empties}</div>
    <div class="btns"></div>
  `;
  const btns = row.querySelector('.btns')!;
  const mk = (label: string, fn: () => void, disabled = false, action?: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    if (action) b.dataset.action = action; // keyboard Enter targets (update #6)
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };

  if (room.inGame) {
    const tag = document.createElement('span');
    tag.style.color = 'var(--kw-mahjong)';
    tag.textContent = 'In game';
    btns.appendChild(tag);
    const specs = room.spectators ?? 0;
    const b = document.createElement('button');
    b.textContent = specs > 0 ? `Watch 👁${specs}` : 'Watch';
    b.title = 'Watch this match as a spectator (up to 4 watchers)';
    b.disabled = myRoom !== null || specs >= 4;
    b.dataset.action = 'join'; // lobby Enter watches an in-game room too
    b.addEventListener('click', () => {
      if (room.isPrivate) {
        const code = prompt(`Room #${room.id} is private. Enter its 4-digit code:`)?.trim();
        if (!code) return;
        net.send({ type: 'watchMatch', roomId: room.id, code });
      } else {
        net.send({ type: 'watchMatch', roomId: room.id });
      }
    });
    btns.appendChild(b);
  } else if (isMine) {
    mk('Start Match', () => net.send({ type: 'startMatch' }), !iAmHost, 'start');
    mk('Leave', () => net.send({ type: 'leaveRoom' }), false, 'leave');
    if (room.id !== 0) mk('Delete', () => net.send({ type: 'deleteRoom' }), !iAmHost, 'delete');
    // Empty seats are filled by bots; the host picks their brain (0.1.4 #5).
    const diff = room.botDifficulty === 'chicken' ? 'Chicken' : 'Dummy';
    mk(
      `Bot Difficulty: ${diff}`,
      () =>
        net.send({
          type: 'setBotDifficulty',
          difficulty: room.botDifficulty === 'chicken' ? 'dummy' : 'chicken',
        }),
      !iAmHost,
    );
  } else {
    const join = () => {
      if (room.isPrivate) {
        const code = prompt(`Room #${room.id} is private. Enter its 4-digit code:`)?.trim();
        if (!code) return;
        net.send({ type: 'joinRoom', roomId: room.id, code });
      } else {
        net.send({ type: 'joinRoom', roomId: room.id });
      }
    };
    mk('Join', join, myRoom !== null || room.players.length >= 4, 'join');
  }
  return row;
}

function openSettingsDialog(): void {
  const dlg = document.createElement('dialog');
  const canPrivate = isAccount();
  dlg.innerHTML = `
    <h2 style="margin-bottom:6px">Create Room</h2>
    <div id="sliders"></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px;${canPrivate ? '' : 'opacity:.5'}">
      <input type="checkbox" id="private" ${canPrivate ? '' : 'disabled'} />
      <span>Private room 私人房 — joining needs a 4-digit code${canPrivate ? '' : ' (sign in to use)'}</span>
    </label>
    <div class="dialog-btns">
      <button id="cancel">Cancel</button>
      <button id="ok" style="border-color: var(--accent)">Create</button>
    </div>
  `;
  // Sliders start from the player's saved defaults (Settings page).
  const sliders = buildRoomSliders(
    dlg.querySelector<HTMLElement>('#sliders')!,
    getSettings().defaultRoom,
  );
  dlg.querySelector('#cancel')!.addEventListener('click', () => dlg.close());
  dlg.querySelector('#ok')!.addEventListener('click', () => {
    const isPrivate = dlg.querySelector<HTMLInputElement>('#private')!.checked;
    net.send({ type: 'createRoom', settings: sliders.read(), isPrivate });
    dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
