import { displayName, isAccount, onAuthChange } from '../account';
import { openAccountDialog, openSignInDialog } from './authdialog';

export function renderHome(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'home';
  el.innerHTML = `
    <div class="home-top">
      <div class="home-corner"></div>
      <div class="home-title">ZUNG JUNG MAHJONG<small>中庸麻將</small></div>
      <div class="home-corner" style="text-align:right;font-size:10.5px;color:var(--text-dim);opacity:.6" title="build">${__BUILD_TIME__}</div>
    </div>
    <div class="portrait-note">For the best experience, rotate your device to landscape 🔄 請將裝置轉為橫向</div>
    <div class="home-main">
      <div class="home-col">
        <div class="home-panel side" data-go="stats">Statistics<span class="zh">統計</span></div>
        <div class="home-panel side" data-go="settings">Settings<span class="zh">設定</span></div>
      </div>
      <div class="home-col">
        <div class="home-panel play" data-go="play">Play<span class="zh">對局</span></div>
        <div class="welcome-bar" id="welcome"></div>
      </div>
      <div class="home-col">
        <div class="home-panel side" data-go="records">Records<span class="zh">牌譜</span></div>
        <div class="home-panel side" data-go="help">Help<span class="zh">說明</span></div>
      </div>
    </div>
  `;
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((p) => {
    p.addEventListener('click', () => {
      location.hash = `#/${p.dataset.go}`;
    });
  });

  const welcome = el.querySelector<HTMLElement>('#welcome')!;
  const showWelcome = () => {
    if (isAccount()) {
      welcome.innerHTML = `<div class="wname">Welcome, ${escapeHtml(displayName())}!</div><div class="wsub">Account 帳戶</div>`;
      welcome.title = 'Manage your account';
    } else {
      welcome.innerHTML = `<div class="wname">Welcome, ${escapeHtml(displayName())}!</div><div class="wsub">Sign in 登入</div>`;
      welcome.title = 'Sign in or create an account';
    }
  };
  showWelcome();
  const unsub = onAuthChange(() => {
    if (!document.body.contains(welcome)) {
      unsub();
      return;
    }
    showWelcome();
  });
  welcome.addEventListener('click', () => {
    if (isAccount()) openAccountDialog();
    else openSignInDialog();
  });
  root.appendChild(el);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
