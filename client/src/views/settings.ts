import { getSettings, updateSettings } from '../settings';
import { tileEl } from '../tileui';
import { buildRoomSliders } from './sliders';

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
          <label class="toggle-row">
            <input type="checkbox" id="tile-indices" />
            <span>English indices on tiles<br/>
              <small>1–9 on number tiles, ESWN on winds, R/G on dragons</small></span>
          </label>
          <div class="tile-preview" id="tile-preview" style="--tw: 44px"></div>
        </section>

        <section class="settings-card">
          <h2>New Room Defaults 開房預設</h2>
          <div class="form-hint" style="margin-bottom:2px">Starting slider positions when you create a room.</div>
          <div id="room-sliders"></div>
        </section>

        <section class="settings-card">
          <h2>Sound 音效</h2>
          <div class="toggle-row disabled">
            <span>Background music 背景音樂 — <b>Coming soon!</b></span>
          </div>
          <div class="toggle-row disabled">
            <span>Sound effects 效果音 — <b>Coming soon!</b></span>
          </div>
        </section>
      </div>
    </div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));

  // English tile indices toggle with a live preview row.
  const indices = el.querySelector<HTMLInputElement>('#tile-indices')!;
  indices.checked = getSettings().tileIndices;
  const preview = el.querySelector<HTMLElement>('#tile-preview')!;
  const renderPreview = () => {
    preview.innerHTML = '';
    for (const t of ['C7', 'B3', 'D9', 'E ', 'N ', 'R ', 'G ', 'O ']) preview.appendChild(tileEl(t));
  };
  renderPreview();
  indices.addEventListener('change', () => {
    updateSettings({ tileIndices: indices.checked });
    renderPreview();
  });

  // Default room sliders, saved on every move.
  buildRoomSliders(
    el.querySelector<HTMLElement>('#room-sliders')!,
    getSettings().defaultRoom,
    (defaultRoom) => updateSettings({ defaultRoom }),
  );

  root.appendChild(el);
}
