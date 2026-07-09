import { RoomSettings, RoomSummary } from '../../../shared/src/protocol';
import { displayName } from '../account';
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

export function renderPlay(root: HTMLElement): void {
  const el = document.createElement('div');
  el.style.height = '100%';
  root.appendChild(el);

  let unsub: (() => void) | null = null;
  const update = () => {
    if (location.hash.replace(/^#\/?/, '') !== 'play') {
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

  row.innerHTML = `
    <div class="room-id">Room #${room.id}${room.id === 0 ? ' 🔒' : ''}</div>
    <div class="room-settings">${settingsSummary(room.settings)}</div>
    <div class="room-players">${players}${empties}</div>
    <div class="btns"></div>
  `;
  const btns = row.querySelector('.btns')!;
  const mk = (label: string, fn: () => void, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };

  if (room.inGame) {
    const tag = document.createElement('span');
    tag.style.color = 'var(--kw-mahjong)';
    tag.textContent = 'In game';
    btns.appendChild(tag);
  } else if (isMine) {
    mk('Start Match', () => net.send({ type: 'startMatch' }), !iAmHost);
    mk('Leave', () => net.send({ type: 'leaveRoom' }));
    if (room.id !== 0) mk('Delete', () => net.send({ type: 'deleteRoom' }), !iAmHost);
  } else {
    mk('Join', () => net.send({ type: 'joinRoom', roomId: room.id }), myRoom !== null || room.players.length >= 4);
  }
  return row;
}

function openSettingsDialog(): void {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <h2 style="margin-bottom:6px">Create Room</h2>
    <div id="sliders"></div>
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
    net.send({ type: 'createRoom', settings: sliders.read() });
    dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
