import { playerName, setPlayerName } from '../identity';
import { net } from '../net';

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
      <div class="home-panel side" data-go="stats">Statistics<span class="zh">統計</span></div>
      <div class="home-col">
        <div class="home-panel play" data-go="play">Play<span class="zh">對局</span></div>
        <div class="welcome-bar" id="welcome"></div>
      </div>
      <div class="home-panel side" data-go="records">Records<span class="zh">牌譜</span></div>
    </div>
  `;
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((p) => {
    p.addEventListener('click', () => {
      location.hash = `#/${p.dataset.go}`;
    });
  });
  const welcome = el.querySelector<HTMLElement>('#welcome')!;
  welcome.textContent = `Welcome, ${playerName()}!`;
  welcome.title = 'Click to change your name';
  welcome.addEventListener('click', () => {
    const name = prompt('Display name:', playerName());
    if (name) {
      setPlayerName(name);
      welcome.textContent = `Welcome, ${playerName()}!`;
      net.rehello();
    }
  });
  root.appendChild(el);
}
