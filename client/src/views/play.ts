import { DEFAULT_SETTINGS, RoomSettings, RoomSummary } from '../../../shared/src/protocol';
import { playerName } from '../identity';
import { net } from '../net';
import { renderGame } from './game';

const LENGTHS: { v: 1 | 2 | 4; label: string }[] = [
  { v: 1, label: '1 round (東風戰)' },
  { v: 2, label: '2 rounds (半莊戰)' },
  { v: 4, label: '4 rounds (一莊戰)' },
];
const TIMES: { v: 7.5 | 10 | 15; label: string }[] = [
  { v: 7.5, label: '7.5 seconds' },
  { v: 10, label: '10 seconds' },
  { v: 15, label: '15 seconds' },
];
const CHICKENS: { v: RoomSettings['chickenHand']; label: string }[] = [
  { v: 'notAllowed', label: 'Not allowed' },
  { v: 'zero', label: 'Scores 0 points' },
  { v: 'one', label: 'Scores 1 point' },
];
const PARS: { v: RoomSettings['par']; label: string }[] = [
  { v: 25, label: '25 points' },
  { v: '30/25', label: '30 points unless exact then 25' },
  { v: 30, label: '30 points' },
];

function settingsSummary(s: RoomSettings): string {
  const len = LENGTHS.find((l) => l.v === s.rounds)!.label;
  const chick = CHICKENS.find((c) => c.v === s.chickenHand)!.label;
  const par = PARS.find((p) => p.v === s.par)!.label;
  return `${len} · ${s.thinkingTime}s · Chicken: ${chick} · Par: ${par}`;
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
        <span style="color: var(--text-dim)">${playerName()}${net.state.connected ? '' : ' · reconnecting…'}</span>
        <button id="create" ${myRoom !== null ? 'disabled' : ''}>Create Room</button>
      </div>
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
  const iAmHost = isMine && room.players.length > 0 && room.hostName === playerName();

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
  const groups = [
    { key: 'rounds', label: 'Match Length', opts: LENGTHS, def: LENGTHS.findIndex((o) => o.v === DEFAULT_SETTINGS.rounds) },
    { key: 'thinkingTime', label: 'Thinking Time', opts: TIMES, def: TIMES.findIndex((o) => o.v === DEFAULT_SETTINGS.thinkingTime) },
    { key: 'chickenHand', label: 'Chicken Hand (雞和)', opts: CHICKENS, def: CHICKENS.findIndex((o) => o.v === DEFAULT_SETTINGS.chickenHand) },
    { key: 'par', label: 'Par Score', opts: PARS, def: PARS.findIndex((o) => o.v === DEFAULT_SETTINGS.par) },
  ] as const;

  dlg.innerHTML = `
    <h2 style="margin-bottom:6px">Create Room</h2>
    <div id="sliders"></div>
    <div class="dialog-btns">
      <button id="cancel">Cancel</button>
      <button id="ok" style="border-color: var(--accent)">Create</button>
    </div>
  `;
  const sliders = dlg.querySelector('#sliders')!;
  const values: Record<string, number> = {};
  for (const grp of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-group';
    wrap.innerHTML = `
      <label>${grp.label}</label>
      <input type="range" min="0" max="${grp.opts.length - 1}" step="1" value="${grp.def}" />
      <div class="slider-value"></div>
    `;
    const input = wrap.querySelector<HTMLInputElement>('input')!;
    const valEl = wrap.querySelector<HTMLElement>('.slider-value')!;
    const show = () => {
      values[grp.key] = Number(input.value);
      valEl.textContent = grp.opts[Number(input.value)].label;
    };
    input.addEventListener('input', show);
    show();
    sliders.appendChild(wrap);
  }
  dlg.querySelector('#cancel')!.addEventListener('click', () => dlg.close());
  dlg.querySelector('#ok')!.addEventListener('click', () => {
    const settings: RoomSettings = {
      rounds: LENGTHS[values.rounds].v,
      thinkingTime: TIMES[values.thinkingTime].v,
      chickenHand: CHICKENS[values.chickenHand].v,
      par: PARS[values.par].v,
    };
    net.send({ type: 'createRoom', settings });
    dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
