import './style.css';
import { net } from './net';
import { installTileHighlight } from './tileui';
import { renderHome } from './views/home';
import { renderPlay } from './views/play';
import { renderStats } from './views/stats';
import { renderRecords, renderRecordViewer } from './views/records';

const app = document.getElementById('app')!;

function route(): void {
  const hash = location.hash.replace(/^#\/?/, '');
  app.innerHTML = '';
  if (hash === 'play') {
    renderPlay(app);
  } else if (hash === 'stats') {
    renderStats(app);
  } else if (hash === 'records') {
    renderRecords(app);
  } else if (hash.startsWith('records/')) {
    renderRecordViewer(app, Number(hash.slice('records/'.length)));
  } else {
    renderHome(app);
  }
}

console.log(`zjmj client build ${__BUILD_TIME__}`);
window.addEventListener('hashchange', route);
installTileHighlight();
net.connect();
net.onUpdate(() => {
  // Global toast display.
  let toast = document.getElementById('toast');
  if (net.state.toast) {
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = net.state.toast;
    toast.classList.add('show');
  } else if (toast) {
    toast.classList.remove('show');
  }
});
route();
