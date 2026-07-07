import { PASSWORD_RULES, USERNAME_RULES, validatePassword, validateUsername } from '../../../shared/src/auth';
import { changePassword, currentAuth, deleteAccount, register, signIn, signOut } from '../account';
import { playerName, setPlayerName } from '../identity';
import { syncSettingsFromServer } from '../settings';
import { net } from '../net';

function field(label: string, type: 'text' | 'password', id: string, autocomplete: string): string {
  return `
    <label class="field">
      <span>${label}</span>
      <input type="${type}" id="${id}" autocomplete="${autocomplete}" spellcheck="false" />
    </label>
  `;
}

function baseDialog(html: string): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  dlg.className = 'auth-dialog';
  dlg.innerHTML = html;
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}

/** Wires a form: disables the submit button while busy, shows errors inline. */
function wireForm(
  form: HTMLFormElement,
  submit: HTMLButtonElement,
  errEl: HTMLElement,
  action: () => Promise<void>,
): void {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errEl.textContent = '';
    submit.disabled = true;
    action()
      .catch((err: Error) => {
        errEl.textContent = err.message || 'Something went wrong.';
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
}

/** Sign-in / create-account dialog (guest state). */
export function openSignInDialog(): void {
  const dlg = baseDialog(`
    <h2 id="title">Sign in 登入</h2>
    <form id="signin">
      ${field('Username', 'text', 'si-user', 'username')}
      ${field('Password', 'password', 'si-pass', 'current-password')}
      <div class="form-error" id="si-err"></div>
      <div class="dialog-btns">
        <button type="button" id="si-cancel">Cancel</button>
        <button type="submit" id="si-go" style="border-color: var(--accent)">Sign in</button>
      </div>
    </form>
    <form id="register" hidden>
      ${field('Username', 'text', 're-user', 'username')}
      <div class="form-hint">${USERNAME_RULES}</div>
      ${field('Password', 'password', 're-pass', 'new-password')}
      <div class="form-hint">${PASSWORD_RULES}</div>
      ${field('Confirm password', 'password', 're-pass2', 'new-password')}
      <div class="form-hint">Your guest statistics and records carry over to the new account.</div>
      <div class="form-error" id="re-err"></div>
      <div class="dialog-btns">
        <button type="button" id="re-cancel">Cancel</button>
        <button type="submit" id="re-go" style="border-color: var(--accent)">Create account</button>
      </div>
    </form>
    <div class="auth-alt">
      <a href="#" id="mode">New here? Create an account</a>
      <a href="#" id="rename">Playing as ${playerName()} · change name</a>
    </div>
  `);
  const $ = <T extends HTMLElement>(sel: string) => dlg.querySelector<T>(sel)!;
  const signinForm = $<HTMLFormElement>('#signin');
  const registerForm = $<HTMLFormElement>('#register');
  const title = $('#title');
  const modeLink = $('#mode');

  let mode: 'signin' | 'register' = 'signin';
  const setMode = (m: typeof mode) => {
    mode = m;
    signinForm.hidden = m !== 'signin';
    registerForm.hidden = m !== 'register';
    title.textContent = m === 'signin' ? 'Sign in 登入' : 'Create account 註冊';
    modeLink.textContent =
      m === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in';
  };
  modeLink.addEventListener('click', (e) => {
    e.preventDefault();
    setMode(mode === 'signin' ? 'register' : 'signin');
  });

  $('#si-cancel').addEventListener('click', () => dlg.close());
  $('#re-cancel').addEventListener('click', () => dlg.close());
  $('#rename').addEventListener('click', (e) => {
    e.preventDefault();
    const name = prompt('Display name:', playerName());
    if (name) {
      setPlayerName(name);
      net.rehello();
      dlg.close();
    }
  });

  wireForm(signinForm, $('#si-go'), $('#si-err'), async () => {
    await signIn($<HTMLInputElement>('#si-user').value.trim(), $<HTMLInputElement>('#si-pass').value);
    await syncSettingsFromServer();
    net.rehello();
    dlg.close();
  });

  wireForm(registerForm, $('#re-go'), $('#re-err'), async () => {
    const username = $<HTMLInputElement>('#re-user').value.trim();
    const pass = $<HTMLInputElement>('#re-pass').value;
    const pass2 = $<HTMLInputElement>('#re-pass2').value;
    const bad =
      validateUsername(username) ??
      validatePassword(pass) ??
      (pass !== pass2 ? 'Passwords do not match.' : null);
    if (bad) throw new Error(bad);
    await register(username, pass);
    net.rehello();
    dlg.close();
  });
}

/** Account management dialog (signed-in state). */
export function openAccountDialog(): void {
  const username = currentAuth()?.name ?? '';
  const dlg = baseDialog(`
    <h2>Account 帳戶</h2>
    <div class="form-hint" style="margin-bottom:12px">Signed in as <b>${username}</b></div>
    <div class="dialog-btns" style="justify-content:flex-start;margin-top:0">
      <button id="signout">Sign out</button>
    </div>

    <h3 class="auth-section">Change password</h3>
    <form id="chpass">
      ${field('Old password', 'password', 'cp-old', 'current-password')}
      ${field('New password', 'password', 'cp-new', 'new-password')}
      <div class="form-hint">${PASSWORD_RULES}</div>
      ${field('Confirm new password', 'password', 'cp-new2', 'new-password')}
      <div class="form-hint">Changing the password signs you out everywhere else. Forgot your password? There is no email recovery yet — contact the developer.</div>
      <div class="form-error" id="cp-err"></div>
      <div class="dialog-btns">
        <button type="submit" id="cp-go">Change password</button>
      </div>
    </form>

    <h3 class="auth-section danger">Delete account</h3>
    <form id="delacct">
      ${field('Password', 'password', 'da-pass', 'current-password')}
      ${field('Confirm password', 'password', 'da-pass2', 'current-password')}
      <div class="form-hint">This permanently deletes the account, its statistics, records, and settings.</div>
      <div class="form-error" id="da-err"></div>
      <div class="dialog-btns">
        <button type="submit" id="da-go" class="danger-btn">Delete account</button>
      </div>
    </form>

    <div class="dialog-btns">
      <button id="close">Close</button>
    </div>
  `);
  const $ = <T extends HTMLElement>(sel: string) => dlg.querySelector<T>(sel)!;

  $('#close').addEventListener('click', () => dlg.close());
  $('#signout').addEventListener('click', () => {
    void signOut().then(() => {
      net.rehello();
      dlg.close();
    });
  });

  wireForm($<HTMLFormElement>('#chpass'), $('#cp-go'), $('#cp-err'), async () => {
    const oldP = $<HTMLInputElement>('#cp-old').value;
    const newP = $<HTMLInputElement>('#cp-new').value;
    const newP2 = $<HTMLInputElement>('#cp-new2').value;
    const bad = validatePassword(newP) ?? (newP !== newP2 ? 'Passwords do not match.' : null);
    if (bad) throw new Error(bad);
    await changePassword(oldP, newP);
    net.rehello();
    dlg.close();
    net.toast('Password changed.');
  });

  wireForm($<HTMLFormElement>('#delacct'), $('#da-go'), $('#da-err'), async () => {
    const pass = $<HTMLInputElement>('#da-pass').value;
    const pass2 = $<HTMLInputElement>('#da-pass2').value;
    if (pass !== pass2) throw new Error('Passwords do not match.');
    if (!confirm(`Really delete the account "${username}" forever?`)) return;
    await deleteAccount(pass);
    net.rehello();
    dlg.close();
  });
}
