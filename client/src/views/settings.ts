import {
  DEFAULT_KEY_BINDINGS,
  KeyBindings,
  TableFelt,
  TileBack,
  TileStyle,
  TwoChoiceKeys,
} from '../../../shared/src/protocol';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
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
  { key: 'optLeft', label: 'Choice: left option' },
  { key: 'optMid', label: 'Choice: middle option' },
  { key: 'optRight', label: 'Choice: right option' },
  { key: 'mahjong', label: 'Mahjong / Self-Draw 和' },
];

/** 0.1.5 #7: which two choice keys act when exactly two chows/kongs are offered. */
const TWO_CHOICE: { v: TwoChoiceKeys; label: string }[] = [
  { v: 'left-mid', label: 'Left and Middle' },
  { v: 'left-right', label: 'Left and Right' },
  { v: 'mid-right', label: 'Middle and Right' },
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
        <small>1–9 on character tiles, ESWN on winds</small></span>
    </label>
    <div class="tile-preview" id="tile-preview" style="--tw: 44px"></div>
    <label class="toggle-row">
      <input type="checkbox" id="physical-walls" />
      <span>Physical tile walls 牌牆<br/>
        <small>Draw the four walls around the table. Hidden automatically on mobile or small windows.</small></span>
    </label>
    <label class="toggle-row">
      <input type="checkbox" id="free-hand-order" />
      <span>Freely Organize Hand Tiles 自由理牌<br/>
        <small>Drag and drop to arrange your hand however you like; the drawn tile stays in its own spot. Turning this off sorts the hand again.</small></span>
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
  // A tile-style change elsewhere (the Graphics card) must swap these
  // preview faces at once, not on the next indices-checkbox click.
  const unsub = onSettingsChange(() => {
    if (!preview.isConnected) {
      unsub();
      return;
    }
    renderPreview();
  });
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
  const freeOrder = container.querySelector<HTMLInputElement>('#free-hand-order')!;
  freeOrder.checked = getSettings().freeHandOrder;
  freeOrder.addEventListener('change', () => {
    updateSettings({ freeHandOrder: freeOrder.checked });
    onChange?.();
  });
}

// ── Graphics (0.1.5 #8–10): tile style, tile back color, felt color ──
const TILE_STYLES: { v: TileStyle; label: string }[] = [
  { v: 'chinese', label: 'Chinese style 中式' },
  { v: 'japanese', label: 'Japanese style 日式' },
];
const TILE_BACKS: { v: TileBack; label: string }[] = [
  { v: 'beige', label: 'Beige' },
  { v: 'blue', label: 'Pastel blue' },
  { v: 'lavender', label: 'Lavender' },
  { v: 'pink', label: 'Pastel pink' },
];
const FELTS: { v: TableFelt; label: string; swatch: string }[] = [
  { v: 'green', label: 'Green', swatch: '#1d4d38' },
  { v: 'navy', label: 'Navy blue', swatch: '#1e2e4e' },
];

/** Radio group names must be unique per rendered instance of the card. */
let graphicsSeq = 0;

/**
 * Graphics settings with a live tile preview, in spec order: tile style,
 * then tile back color, then table background (0.1.5 #10).
 */
export function buildGraphicsSettings(container: HTMLElement, onChange?: () => void): void {
  container.innerHTML = `
    <div id="g-style"></div>
    <div class="tile-preview" id="g-preview" style="--tw: 44px"></div>
    <div id="g-back"></div>
    <div id="g-felt"></div>
    <label class="toggle-row">
      <input type="checkbox" id="zh-hand-number" />
      <span>Chinese Hand Number Indicator 中文局數<br/>
        <small>The center dial shows 東一…北四 instead of E1…N4.</small></span>
    </label>
  `;
  const preview = container.querySelector<HTMLElement>('#g-preview')!;
  const renderPreview = () => {
    preview.innerHTML = '';
    // O last: the Japanese white dragon renders as a completely blank tile.
    // This preview is about the artwork, so the English indices never show
    // here — they are demoed by the Tiles card's own preview.
    for (const t of ['B3', 'C7', 'D5', 'E ', 'R ', 'G ', 'O ']) {
      preview.appendChild(tileEl(t, { noIndex: true }));
    }
    preview.appendChild(tileEl(null, { back: true }));
  };
  renderPreview();

  const seq = ++graphicsSeq;
  const radios = <T extends string>(
    el: HTMLElement,
    label: string,
    name: string,
    opts: { v: T; label: string; swatch?: string }[],
    current: T,
    save: (v: T) => void,
  ): void => {
    el.className = 'radio-group';
    el.innerHTML = `
      <label>${label}</label>
      <div class="radio-opts">
        ${opts.map(
          (o) => `
          <label class="radio-opt">
            <input type="radio" name="g${seq}-${name}" value="${o.v}" ${o.v === current ? 'checked' : ''} />
            ${o.swatch ? `<span class="color-swatch" style="background:${o.swatch}"></span>` : ''}
            <span>${o.label}</span>
          </label>`,
        ).join('')}
      </div>
    `;
    el.querySelectorAll<HTMLInputElement>('input').forEach((r) => {
      r.addEventListener('change', () => {
        if (!r.checked) return;
        save(r.value as T);
        renderPreview();
        onChange?.();
      });
    });
  };
  const s = getSettings();
  radios(container.querySelector<HTMLElement>('#g-style')!, 'Tile style 牌面', 'style', TILE_STYLES,
    s.tileStyle, (v) => updateSettings({ tileStyle: v }));
  radios(container.querySelector<HTMLElement>('#g-back')!, 'Tile back color 牌背', 'back', TILE_BACKS,
    s.tileBack, (v) => updateSettings({ tileBack: v }));
  radios(container.querySelector<HTMLElement>('#g-felt')!, 'Background color 桌面', 'felt', FELTS,
    s.tableFelt, (v) => updateSettings({ tableFelt: v }));
  const zhNum = container.querySelector<HTMLInputElement>('#zh-hand-number')!;
  zhNum.checked = getSettings().chineseHandNumber;
  zhNum.addEventListener('change', () => {
    updateSettings({ chineseHandNumber: zhNum.checked });
    onChange?.();
  });
}

/**
 * Hotkeys on/off toggle; with `bindings` (settings page only, not in-match)
 * also the custom key binding editor for the 7 rebindable actions.
 */
export function buildHotkeySettings(
  container: HTMLElement,
  opts: { bindings: boolean; onChange?: () => void },
): void {
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
  toggle.addEventListener('change', () => {
    updateSettings({ hotkeys: toggle.checked });
    opts.onChange?.();
  });

  if (!opts.bindings) return;
  const bindings = container.querySelector<HTMLElement>('#bindings')!;
  let listening: keyof KeyBindings | null = null;

  const renderBindings = () => {
    const kb = getSettings().keyBindings;
    const twoIdx = Math.max(0, TWO_CHOICE.findIndex((o) => o.v === getSettings().twoChoiceKeys));
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
      <div class="slider-group" style="margin-top:10px">
        <label>Selecting from two ambiguous Chows/Kongs</label>
        <input id="two-choice" type="range" min="0" max="${TWO_CHOICE.length - 1}" step="1" value="${twoIdx}" />
        <div class="slider-value" id="two-choice-value">${TWO_CHOICE[twoIdx].label}</div>
      </div>
      <div style="margin-top:10px"><button id="reset-keys">Reset to defaults (A S D · Q W E · ⏎)</button></div>
    `;
    bindings.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        listening = listening === btn.dataset.bind ? null : (btn.dataset.bind as keyof KeyBindings);
        renderBindings();
      });
    });
    const two = bindings.querySelector<HTMLInputElement>('#two-choice')!;
    two.addEventListener('input', () => {
      const opt = TWO_CHOICE[Number(two.value)];
      bindings.querySelector('#two-choice-value')!.textContent = opt.label;
      updateSettings({ twoChoiceKeys: opt.v });
    });
    bindings.querySelector('#reset-keys')!.addEventListener('click', () => {
      listening = null;
      updateSettings({ keyBindings: { ...DEFAULT_KEY_BINDINGS }, twoChoiceKeys: 'mid-right' });
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
          <h2>Graphics 畫面</h2>
          <div id="graphics-settings"></div>
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
  buildGraphicsSettings(el.querySelector<HTMLElement>('#graphics-settings')!);
  buildHotkeySettings(el.querySelector<HTMLElement>('#hotkey-settings')!, { bindings: true });

  // Default room sliders, saved on every move.
  buildRoomSliders(
    el.querySelector<HTMLElement>('#room-sliders')!,
    getSettings().defaultRoom,
    (defaultRoom) => updateSettings({ defaultRoom }),
  );

  root.appendChild(el);
}
