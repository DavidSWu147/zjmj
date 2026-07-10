import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads KEY=VALUE pairs from the repo-root .env into process.env (without
 * overriding variables that are already set). Kept dependency-free.
 */
export function loadDotEnv(): void {
  const file = path.join(__dirname, '..', '..', '.env');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export class PlayFabError extends Error {
  /** PlayFab error name, e.g. 'UsernameNotAvailable', or 'Unreachable'. */
  readonly apiError: string;
  /** First per-field detail message, e.g. 'Username contains invalid characters.' */
  readonly detail: string | null;

  constructor(apiError: string, message: string, detail: string | null = null) {
    super(message);
    this.apiError = apiError;
    this.detail = detail;
  }
}

interface PlayFabApiResult {
  code: number;
  error?: string;
  errorMessage?: string;
  errorDetails?: Record<string, string[]>;
  data?: Record<string, unknown>;
}

function config(): { titleId: string; secretKey: string } | null {
  const titleId = process.env.PLAYFAB_TITLE_ID;
  const secretKey = process.env.PLAYFAB_SECRET_KEY;
  return titleId && secretKey ? { titleId, secretKey } : null;
}

export function playFabEnabled(): boolean {
  return config() !== null;
}

async function call(
  api: string,
  body: Record<string, unknown>,
  opts: { secret?: boolean } = {},
): Promise<Record<string, unknown>> {
  const cfg = config();
  if (!cfg) throw new PlayFabError('NotConfigured', 'PlayFab is not configured');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret) headers['X-SecretKey'] = cfg.secretKey;
  let res: Response;
  try {
    res = await fetch(`https://${cfg.titleId}.playfabapi.com/${api}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ TitleId: cfg.titleId, ...body }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new PlayFabError('Unreachable', `PlayFab unreachable: ${String(err)}`);
  }
  let json: PlayFabApiResult;
  try {
    json = (await res.json()) as PlayFabApiResult;
  } catch {
    throw new PlayFabError('BadResponse', `PlayFab ${api} returned a non-JSON response`);
  }
  if (!res.ok || json.error) {
    const detail = Object.values(json.errorDetails ?? {}).flat()[0] ?? null;
    throw new PlayFabError(
      json.error ?? 'Unknown',
      json.errorMessage ?? `PlayFab ${api} failed`,
      detail,
    );
  }
  return json.data ?? {};
}

/** Logs a guest in by device id, creating the PlayFab player if needed. */
export async function loginWithServerCustomId(customId: string): Promise<string> {
  const data = await call(
    'Server/LoginWithServerCustomId',
    { ServerCustomId: customId, CreateAccount: true },
    { secret: true },
  );
  return String(data.PlayFabId);
}

/** Creates a username/password account, with an optional recovery email. */
export async function registerUser(
  username: string,
  password: string,
  email?: string | null,
): Promise<string> {
  const data = await call('Client/RegisterPlayFabUser', {
    Username: username,
    Password: password,
    RequireBothUsernameAndEmail: false,
    ...(email ? { Email: email } : {}),
  });
  return String(data.PlayFabId);
}

/** The login/recovery email on the account, or null if none was ever added. */
export async function getAccountEmail(playFabId: string): Promise<string | null> {
  const data = await call('Server/GetUserAccountInfo', { PlayFabId: playFabId }, { secret: true });
  const info = data.UserInfo as { PrivateInfo?: { Email?: string } } | undefined;
  return info?.PrivateInfo?.Email ?? null;
}

/** Looks an account up by its recovery email; null when no account has it. */
export async function findAccountByEmail(
  email: string,
): Promise<{ playFabId: string; username: string | null } | null> {
  try {
    const data = await call('Admin/GetUserAccountInfo', { Email: email }, { secret: true });
    const info = data.UserInfo as { PlayFabId?: string; Username?: string } | undefined;
    return info?.PlayFabId ? { playFabId: info.PlayFabId, username: info.Username ?? null } : null;
  } catch (err) {
    if (err instanceof PlayFabError && err.apiError === 'AccountNotFound') return null;
    throw err;
  }
}

/** Has PlayFab email the account's password-reset link to its recovery email. */
export async function sendAccountRecoveryEmail(email: string): Promise<void> {
  const templateId = process.env.PLAYFAB_RECOVERY_TEMPLATE_ID;
  await call('Client/SendAccountRecoveryEmail', {
    Email: email,
    ...(templateId ? { EmailTemplateId: templateId } : {}),
  });
}

/** Verifies username/password; resolves to the PlayFabId. */
export async function loginWithPassword(username: string, password: string): Promise<string> {
  const data = await call('Client/LoginWithPlayFab', { Username: username, Password: password });
  return String(data.PlayFabId);
}

export async function getUserData(playFabId: string): Promise<Record<string, string>> {
  const data = await call('Server/GetUserData', { PlayFabId: playFabId }, { secret: true });
  const out: Record<string, string> = {};
  const entries = (data.Data ?? {}) as Record<string, { Value?: string }>;
  for (const [k, v] of Object.entries(entries)) {
    if (typeof v?.Value === 'string') out[k] = v.Value;
  }
  return out;
}

export async function updateUserData(playFabId: string, data: Record<string, string>): Promise<void> {
  if (Object.keys(data).length === 0) return;
  await call('Server/UpdateUserData', { PlayFabId: playFabId, Data: data }, { secret: true });
}

/**
 * Deletes the master player account (the only way to free a username for
 * re-registration; plain DeletePlayer keeps the username reserved).
 */
export async function deleteMasterPlayerAccount(playFabId: string): Promise<void> {
  await call('Admin/DeleteMasterPlayerAccount', { PlayFabId: playFabId }, { secret: true });
}

/**
 * Registers a username (and email) being freed by an in-flight master-account
 * deletion. Deletion takes a few seconds, so retry on UsernameNotAvailable
 * (and EmailAddressNotAvailable, when the email rides along).
 */
export async function registerUserWithRetry(
  username: string,
  password: string,
  email?: string | null,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 15; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      return await registerUser(username, password, email);
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof PlayFabError &&
        (err.apiError === 'UsernameNotAvailable' || err.apiError === 'EmailAddressNotAvailable');
      if (!retryable) throw err;
    }
  }
  throw lastErr;
}
