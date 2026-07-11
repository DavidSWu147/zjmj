import { DEFAULT_KEY_BINDINGS, KeyBindings } from '../../../shared/src/protocol';
import { getSettings, updateSettings } from '../settings';
import { tileEl } from '../tileui';
import { buildRoomSliders } from './sliders';

/**
 * Keys with a fixed in-game meaning; never accepted as custom bindings.
 * Escape (deselect), the top digit row + Backspace/Delete (discard hotkeys)
 * and Space (pass/cancel).
 */
const RESERVED_KEYS = new Set([
  'Escape', 'Backspace', 'Delete', ' ',
  '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=',
]);

const BINDABLE: { key: keyof KeyBindings; label: string }[] = [
  { key: 'chow', label: 'Chow 吃' },
  { key: 'pung', label: 'Pung 碰' },
  { key: 'kong', label: 'Kong 槓' },
  { key: 'optRight', label: 'Choice: rightmost option' },
  { key: 'optMid', label: 'Choice: 2nd rightmost option' },
  { key: 'optLeft', label: 'Choice: leftmost option (of 3)' },
  { key: 'mahjong', label: 'Mahjong / Self-Draw 和' },
];

/** Normalizes a KeyboardEvent.key for storage/matching ('a' -> 'A'). */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function keyLabel(k: string): string {
  return k === 'Enter' ? '⏎ Enter' : k;
}

/** Tile display settings (English indices + physical walls) with preview. */
export function buildTileSettings(container: HTMLElement, onChange?: () => void): void {
  container.innerHTML = `
    <label class="toggle-row">
      <input type="checkbox" id="tile-indices" />
      <span>English indices on tiles<br/>
        <small>1–9 on number tiles, ESWN on winds, R/G on dragons</small></span>
    </label>
    <div class="tile-preview" id="tile-preview" style="--tw: 44px"></div>
    <label class="toggle-row">
      <input type="checkbox" id="physical-walls" />
      <span>Physical tile walls 牌牆<br/>
        <small>Draw the four walls around the table. Hidden automatically on mobile or small windows.</small></span>
    </label>
  `;
  const indices = container.querySelector<HTMLInputElement>('#tile-indices')!;
  indices.checked = getSettings().tileIndices;
  const preview = container.querySelector<HTMLElement>('#tile-preview')!;
  const renderPreview = () => {
    preview.innerHTML = '';
    for (const t of ['B3', 'C7', 'D5', 'E ', 'N ', 'R ', 'G ', 'O ']) preview.appendChild(tileEl(t));
  };
  renderPreview();
  indices.addEventListener('change', () => {
    updateSettings({ tileIndices: indices.checked });
    renderPreview();
    onChange?.();
  });

  const walls = container.querySelector<HTMLInputElement>('#physical-walls')!;
  walls.checked = getSettings().physicalWalls;
  walls.addEventListener('change', () => {
    updateSettings({ physicalWalls: walls.checked });
    onChange?.();
  });
}

/**
 * Hotkeys on/off toggle; with `bindings` (settings page only, not in-match)
 * also the custom key binding editor for the 7 rebindable actions.
 */
export function buildHotkeySettings(container: HTMLElement, opts: { bindings: boolean }): void {
  container.innerHTML = `
    <label class="toggle-row">
      <input type="checkbox" id="hotkeys-on" />
      <span>Keyboard hotkeys during matches 快捷鍵<br/>
        <small>ESC deselects · top row (\` 1–9 0 - =) selects hand tiles from the left ·
        Backspace/Delete the drawn tile · Space passes/cancels.</small></span>
    </label>
    <div id="bindings"></div>
  `;
  const toggle = container.querySelector<HTMLInputElement>('#hotkeys-on')!;
  toggle.checked = getSettings().hotkeys;
  toggle.addEventListener('change', () => updateSettings({ hotkeys: toggle.checked }));

  if (!opts.bindings) return;
  const bindings = container.querySelector<HTMLElement>('#bindings')!;
  let listening: keyof KeyBindings | null = null;

  const renderBindings = () => {
    const kb = getSettings().keyBindings;
    bindings.innerHTML = `
      <div class="form-hint" style="margin-top:8px">Action keys — click one to rebind it.
        The fixed keys above cannot be assigned.</div>
      ${BINDABLE.map(
        (b) => `
        <div class="keybind-row">
          <span>${b.label}</span>
          <button class="keybind-key${listening === b.key ? ' listening' : ''}" data-bind="${b.key}">
            ${listening === b.key ? 'Press a key…' : keyLabel(kb[b.key])}
          </button>
        </div>`,
      ).join('')}
      <div style="margin-top:10px"><button id="reset-keys">Reset to defaults (A S D · E W Q · ⏎)</button></div>
    `;
    bindings.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        listening = listening === btn.dataset.bind ? null : (btn.dataset.bind as keyof KeyBindings);
        renderBindings();
      });
    });
    bindings.querySelector('#reset-keys')!.addEventListener('click', () => {
      listening = null;
      updateSettings({ keyBindings: { ...DEFAULT_KEY_BINDINGS } });
      renderBindings();
    });
  };

  const onKey = (e: KeyboardEvent) => {
    if (!bindings.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (!listening) return;
    e.preventDefault();
    if (e.key === 'Escape') {
      // Cancel listening (Escape is reserved and could never bind anyway).
      listening = null;
      renderBindings();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = normalizeKey(e.key);
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return;
    // Reserved keys and keys already bound to another action are a no-op.
    if (RESERVED_KEYS.has(k)) return;
    const kb = getSettings().keyBindings;
    if (Object.entries(kb).some(([action, key]) => key === k && action !== listening)) return;
    updateSettings({ keyBindings: { ...kb, [listening]: k } });
    listening = null;
    renderBindings();
  };
  document.addEventListener('keydown', onKey);
  renderBindings();
}

export function soundSettingsHtml(): string {
  return `
    <div class="toggle-row disabled">
      <span>Background music 背景音樂 — <b>Coming soon!</b></span>
    </div>
    <div class="toggle-row disabled">
      <span>Sound effects 效果音 — <b>Coming soon!</b></span>
    </div>
  `;
}

export function renderSettings(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Settings 設定</h1>
      <span class="spacer"></span>
      <span style="color:var(--text-dim);font-size:13px">Saved automatically 自動儲存</span>
    </div>
    <div class="page-body">
      <div class="settings-grid">
        <section class="settings-card">
          <h2>Tiles 牌面</h2>
          <div id="tile-settings"></div>
        </section>

        <section class="settings-card">
          <h2>Hotkeys 快捷鍵</h2>
          <div id="hotkey-settings"></div>
        </section>

        <section class="settings-card">
          <h2>New Room Defaults 開房預設</h2>
          <div class="form-hint" style="margin-bottom:2px">Starting slider positions when you create a room.</div>
          <div id="room-sliders"></div>
        </section>

        <section class="settings-card">
          <h2>Sound 音效</h2>
          ${soundSettingsHtml()}
        </section>
      </div>
    </div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));

  buildTileSettings(el.querySelector<HTMLElement>('#tile-settings')!);
  buildHotkeySettings(el.querySelector<HTMLElement>('#hotkey-settings')!, { bindings: true });

  // Default room sliders, saved on every move.
  buildRoomSliders(
    el.querySelector<HTMLElement>('#room-sliders')!,
    getSettings().defaultRoom,
    (defaultRoom) => updateSettings({ defaultRoom }),
  );

  root.appendChild(el);
}
