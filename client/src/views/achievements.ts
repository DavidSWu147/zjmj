import { ACHIEVEMENTS } from '../../../shared/src/achievements';
import { apiGet, isAccount } from '../account';

interface AchievementsResponse {
  registered: boolean;
  achievements: { id: string; name: string; desc: string; earnedAt: number | null }[];
}

/** A rounded, starfruit-shaped five-point star (round joins plump it up). */
export function starSvg(size = 34): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2 L14.94 7.96 L21.51 8.91 L16.76 13.55 L17.88 20.09 L12 17
             L6.12 20.09 L7.24 13.55 L2.49 8.91 L9.06 7.96 Z"
      fill="currentColor" stroke="currentColor" stroke-width="3.5"
      stroke-linejoin="round"/>
  </svg>`;
}

export function renderAchievements(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button id="back">← Home</button>
      <h1>Achievements 成就</h1>
      <span class="spacer"></span>
    </div>
    <div class="page-body" id="body">Loading…</div>
  `;
  el.querySelector('#back')!.addEventListener('click', () => (location.hash = ''));
  root.appendChild(el);
  const body = el.querySelector<HTMLElement>('#body')!;

  const draw = (
    rows: { id: string; name: string; desc: string; earnedAt: number | null }[],
    registered: boolean,
  ): void => {
    const note = registered
      ? ''
      : `<div class="help-note">Achievements are for registered users only —
          <b>register an account to earn achievements</b>. 註冊帳戶即可獲得成就。</div>`;
    body.innerHTML = `
      ${note}
      <div class="ach-list">
        ${rows
          .map((a) => {
            const earned = registered && a.earnedAt !== null;
            const when = earned
              ? `<div class="ach-date">Achieved ${new Date(a.earnedAt!).toLocaleDateString()}</div>`
              : '';
            return `<div class="ach-row${earned ? ' earned' : ''}">
              <div class="ach-badge">${starSvg()}</div>
              <div class="ach-text">
                <div class="ach-name">${escapeHtml(a.name)}</div>
                <div class="ach-desc">${escapeHtml(a.desc)}</div>
                ${when}
              </div>
            </div>`;
          })
          .join('')}
      </div>
    `;
  };

  apiGet<AchievementsResponse>('/api/achievements')
    .then((res) => draw(res.achievements, res.registered))
    .catch(() => {
      // Offline fallback: the catalogue is shared code; show it all faded.
      draw(
        ACHIEVEMENTS.map((a) => ({ ...a, earnedAt: null })),
        isAccount(),
      );
    });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
