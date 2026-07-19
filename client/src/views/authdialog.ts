import {
  PASSWORD_RULES,
  USERNAME_RULES,
  validateEmail,
  validatePassword,
  validateUsername,
} from '../../../shared/src/auth';
import {
  changePassword,
  currentAuth,
  deleteAccount,
  forgotPassword,
  getEmail,
  register,
  setEmail,
  signIn,
  signOut,
} from '../account';
import { playerName, setPlayerName } from '../identity';
import { containsProfanity, DISPLAY_NAME_RULES, validateDisplayName } from '../../../shared/src/names';
import { apiPost, updateStoredName } from '../account';
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
      ${field('Email (optional)', 'text', 're-email', 'email')}
      <div class="form-hint">Lets you recover a forgotten username or password. You can also add one later.</div>
      <div class="form-hint">Your guest statistics and records carry over to the new account.</div>
      <div class="form-error" id="re-err"></div>
      <div class="dialog-btns">
        <button type="button" id="re-cancel">Cancel</button>
        <button type="submit" id="re-go" style="border-color: var(--accent)">Create account</button>
      </div>
    </form>
    <form id="forgot" hidden>
      ${field('Email', 'text', 'fp-email', 'email')}
      <div class="form-hint">If your account has an email, you will receive a password-reset link and a reminder of your username. No email on the account? Contact the developer.</div>
      <div class="form-error" id="fp-err"></div>
      <div class="form-hint" id="fp-done" style="color:var(--kw-chow)"></div>
      <div class="dialog-btns">
        <button type="button" id="fp-cancel">Cancel</button>
        <button type="submit" id="fp-go" style="border-color: var(--accent)">Send recovery email</button>
      </div>
    </form>
    <div class="auth-alt">
      <a href="#" id="mode">New here? Create an account</a>
      <a href="#" id="forgotlink">Forgot your username or password?</a>
      <a href="#" id="rename">Playing as ${playerName()} · change name</a>
    </div>
  `);
  const $ = <T extends HTMLElement>(sel: string) => dlg.querySelector<T>(sel)!;
  const signinForm = $<HTMLFormElement>('#signin');
  const registerForm = $<HTMLFormElement>('#register');
  const forgotForm = $<HTMLFormElement>('#forgot');
  const title = $('#title');
  const modeLink = $('#mode');
  const forgotLink = $('#forgotlink');

  let mode: 'signin' | 'register' | 'forgot' = 'signin';
  const setMode = (m: typeof mode) => {
    mode = m;
    signinForm.hidden = m !== 'signin';
    registerForm.hidden = m !== 'register';
    forgotForm.hidden = m !== 'forgot';
    title.textContent =
      m === 'signin' ? 'Sign in 登入' : m === 'register' ? 'Create account 註冊' : 'Account recovery 找回帳戶';
    modeLink.textContent =
      m === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in';
    forgotLink.hidden = m === 'forgot';
  };
  modeLink.addEventListener('click', (e) => {
    e.preventDefault();
    setMode(mode === 'signin' ? 'register' : 'signin');
  });
  forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    setMode('forgot');
  });

  $('#si-cancel').addEventListener('click', () => dlg.close());
  $('#re-cancel').addEventListener('click', () => dlg.close());
  $('#fp-cancel').addEventListener('click', () => setMode('signin'));
  $('#rename').addEventListener('click', (e) => {
    e.preventDefault();
    const name = prompt(`Display name (${DISPLAY_NAME_RULES}):`, playerName())?.trim();
    if (!name) return;
    const bad = validateDisplayName(name);
    if (bad) {
      net.toast(bad);
      return;
    }
    // Rule-violating text is replaced with "---" (v0.2.1 #16).
    setPlayerName(containsProfanity(name) ? '---' : name);
    net.rehello();
    dlg.close();
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
    const email = $<HTMLInputElement>('#re-email').value.trim();
    const bad =
      validateUsername(username) ??
      validatePassword(pass) ??
      (pass !== pass2 ? 'Passwords do not match.' : null) ??
      (email ? validateEmail(email) : null);
    if (bad) throw new Error(bad);
    await register(username, pass, email || undefined);
    net.rehello();
    dlg.close();
  });

  wireForm(forgotForm, $('#fp-go'), $('#fp-err'), async () => {
    const email = $<HTMLInputElement>('#fp-email').value.trim();
    const bad = email ? validateEmail(email) : 'Email required.';
    if (bad) throw new Error(bad);
    $('#fp-done').textContent = '';
    const hint = await forgotPassword(email);
    $('#fp-done').textContent =
      `Recovery email sent${hint ? ` for account "${hint}"` : ''}. Check your inbox.`;
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

    <h3 class="auth-section">Display name</h3>
    <form id="chname">
      ${field('Display name', 'text', 'dn-new', 'nickname')}
      <div class="form-hint">Shown to other players; your username stays your sign-in. ${DISPLAY_NAME_RULES} Display names need not be unique.</div>
      <div class="form-error" id="dn-err"></div>
      <div class="dialog-btns">
        <button type="submit" id="dn-go">Change display name</button>
      </div>
    </form>

    <h3 class="auth-section">Recovery email</h3>
    <form id="chemail">
      <div class="form-hint" id="em-current">Checking for an email on file…</div>
      ${field('Email', 'text', 'em-new', 'email')}
      ${field('Password', 'password', 'em-pass', 'current-password')}
      <div class="form-hint">An email lets you recover a forgotten username or password. Setting it signs you out everywhere else.</div>
      <div class="form-error" id="em-err"></div>
      <div class="dialog-btns">
        <button type="submit" id="em-go">Set email</button>
      </div>
    </form>

    <h3 class="auth-section">Change password</h3>
    <form id="chpass">
      ${field('Old password', 'password', 'cp-old', 'current-password')}
      ${field('New password', 'password', 'cp-new', 'new-password')}
      <div class="form-hint">${PASSWORD_RULES}</div>
      ${field('Confirm new password', 'password', 'cp-new2', 'new-password')}
      <div class="form-hint">Changing the password signs you out everywhere else. Forgot your password? Use the recovery email if you set one; otherwise contact the developer.</div>
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

  $<HTMLInputElement>('#dn-new').value = currentAuth()?.name ?? '';

  void getEmail().then((email) => {
    $('#em-current').textContent = email
      ? `Email on file: ${email}`
      : 'No email on file — add one below.';
    $<HTMLButtonElement>('#em-go').textContent = email ? 'Change email' : 'Set email';
  });

  wireForm($<HTMLFormElement>('#chname'), $('#dn-go'), $('#dn-err'), async () => {
    const name = $<HTMLInputElement>('#dn-new').value.trim();
    const bad = validateDisplayName(name);
    if (bad) throw new Error(bad);
    // The server replaces rule-violating text with "---" (v0.2.1 #16).
    const res = await apiPost<{ name: string }>('/api/profile/name', { name });
    updateStoredName(res.name);
    net.rehello();
    dlg.close();
    net.toast(`Display name changed to ${res.name}.`);
  });

  wireForm($<HTMLFormElement>('#chemail'), $('#em-go'), $('#em-err'), async () => {
    const email = $<HTMLInputElement>('#em-new').value.trim();
    const pass = $<HTMLInputElement>('#em-pass').value;
    const bad = email ? validateEmail(email) : 'Email required.';
    if (bad) throw new Error(bad);
    await setEmail(pass, email);
    net.rehello();
    dlg.close();
    net.toast('Recovery email saved.');
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
