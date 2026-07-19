import { AuthResponse } from '../../shared/src/protocol';
import { playerId, playerName } from './identity';

const AUTH_KEY = 'zjmj-auth';

type Listener = () => void;
const listeners = new Set<Listener>();

let inflight: Promise<AuthResponse> | null = null;

export function onAuthChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function currentAuth(): AuthResponse | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthResponse) : null;
  } catch {
    return null;
  }
}

function storeAuth(auth: AuthResponse | null): void {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
  emit();
}

export function isAccount(): boolean {
  return currentAuth()?.kind === 'account';
}

/** Adopts a changed display name into the cached auth blob (v0.2.1 #14). */
export function updateStoredName(name: string): void {
  const auth = currentAuth();
  if (auth) storeAuth({ ...auth, name });
}

/** Name shown in the UI and sent to the server: username, or the guest name. */
export function displayName(): string {
  const auth = currentAuth();
  return auth?.kind === 'account' ? auth.name : playerName();
}

async function post(path: string, body: Record<string, unknown>, token?: string): Promise<AuthResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as AuthResponse & { error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Request failed.');
  return json;
}

/** Returns the current session, bootstrapping a guest session if needed. */
export function ensureAuth(): Promise<AuthResponse> {
  const auth = currentAuth();
  if (auth) return Promise.resolve(auth);
  if (!inflight) {
    inflight = post('guest', { deviceId: playerId(), name: playerName() })
      .then((res) => {
        storeAuth(res);
        return res;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function signIn(username: string, password: string): Promise<void> {
  storeAuth(await post('login', { username, password }));
}

/** Creates an account from the current guest session (history carries over). */
export async function register(username: string, password: string, email?: string): Promise<void> {
  const auth = await ensureAuth();
  storeAuth(await post('register', { username, password, ...(email ? { email } : {}) }, auth.token));
}

export async function signOut(): Promise<void> {
  const auth = currentAuth();
  storeAuth(null);
  if (auth) await post('logout', {}, auth.token).catch(() => {});
  await ensureAuth();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const auth = currentAuth();
  if (!auth) throw new Error('Not signed in.');
  storeAuth(await post('changePassword', { oldPassword, newPassword }, auth.token));
}

/** Adds or changes the recovery email; the session is reissued on success. */
export async function setEmail(password: string, email: string): Promise<void> {
  const auth = currentAuth();
  if (!auth) throw new Error('Not signed in.');
  const res = await post('setEmail', { password, email }, auth.token);
  if (res.token) storeAuth(res); // no token = email was already set, session intact
}

/** The recovery email on file, or null (also on any lookup failure). */
export async function getEmail(): Promise<string | null> {
  const auth = currentAuth();
  if (!auth) return null;
  try {
    const res = await fetch('/api/auth/email', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { email: string | null }).email;
  } catch {
    return null;
  }
}

/** Requests a password-reset email; resolves to a masked username hint. */
export async function forgotPassword(email: string): Promise<string> {
  const res = (await post('forgot', { email })) as unknown as { usernameHint?: string };
  return res.usernameHint ?? '';
}

export async function deleteAccount(password: string): Promise<void> {
  const auth = currentAuth();
  if (!auth) throw new Error('Not signed in.');
  await post('deleteAccount', { password }, auth.token);
  storeAuth(null);
  await ensureAuth();
}

/** Authenticated GET against our API (waits for the session bootstrap). */
export async function apiGet<T>(path: string): Promise<T> {
  const auth = await ensureAuth();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/** Authenticated POST against our API. */
export async function apiPost<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const auth = await ensureAuth();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/** Authenticated DELETE against our API. */
export async function apiDelete(path: string): Promise<void> {
  const auth = await ensureAuth();
  const res = await fetch(path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed (${res.status})`);
}

/** Server revoked our session: drop it and fall back to a guest session. */
export async function handleSignedOut(): Promise<void> {
  storeAuth(null);
  await ensureAuth();
}
