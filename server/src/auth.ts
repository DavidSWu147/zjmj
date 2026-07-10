import { randomBytes } from 'node:crypto';
import express from 'express';
import { validateEmail, validatePassword, validateUsername } from '../../shared/src/auth';
import { AuthResponse } from '../../shared/src/protocol';
import { Db, Session } from './db';
import {
  deleteMasterPlayerAccount,
  findAccountByEmail,
  getAccountEmail,
  getUserData,
  loginWithPassword,
  loginWithServerCustomId,
  PlayFabError,
  playFabEnabled,
  registerUser,
  registerUserWithRetry,
  sendAccountRecoveryEmail,
  updateUserData,
} from './playfab';

export interface AuthDelegate {
  /** Called after sessions are revoked so their sockets can be kicked. */
  onSessionsRevoked(tokens: string[], reason: string): void;
}

const SETTINGS_KEY = 'settings';
const SETTINGS_MAX_BYTES = 8 * 1024;

/** Friendly messages for the PlayFab errors users can actually cause. */
function friendly(err: unknown): { status: number; message: string } | null {
  if (!(err instanceof PlayFabError)) return null;
  switch (err.apiError) {
    case 'UsernameNotAvailable':
      return { status: 409, message: 'That username is already taken.' };
    case 'AccountNotFound':
    case 'InvalidUsernameOrPassword':
    case 'InvalidUsername':
    case 'InvalidPassword':
      return { status: 401, message: 'Incorrect username or password.' };
    case 'AccountBanned':
      return { status: 403, message: 'This account is banned.' };
    case 'EmailAddressNotAvailable':
      return { status: 409, message: 'That email is already in use by another account.' };
    case 'InvalidEmailAddress':
      return { status: 400, message: 'That email address looks invalid.' };
    case 'InvalidParams':
      return { status: 400, message: err.detail ?? 'Invalid username or password format.' };
    case 'APIClientRequestRateLimitExceeded':
      return { status: 429, message: 'Too many attempts. Please wait a minute and try again.' };
    case 'Unreachable':
    case 'NotConfigured':
      return { status: 503, message: 'Account service is unavailable. Please try again later.' };
    default:
      return { status: 502, message: `Account service error (${err.apiError}).` };
  }
}

function fail(res: express.Response, err: unknown, fallback: string): void {
  const f = friendly(err);
  if (f) {
    res.status(f.status).json({ error: f.message });
  } else {
    console.error(fallback, err);
    res.status(500).json({ error: fallback });
  }
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Very small per-IP rate limiter for the password-bearing endpoints. */
function rateLimiter(maxHits: number, windowMs: number): express.RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= maxHits) {
      res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
      return;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10000) hits.clear(); // crude memory cap
    next();
  };
}

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

export function sessionFromRequest(db: Db, req: express.Request): Session | null {
  const header = req.headers.authorization;
  const token =
    header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
  return token ? db.getSession(token) : null;
}

/**
 * Copies the settings blob from one PlayFab player to another (guest→account
 * carry-over and password-change recreation). Best-effort: a miss here only
 * loses preferences, never credentials or match data.
 */
async function copyUserData(fromId: string, toId: string): Promise<void> {
  try {
    const data = await getUserData(fromId);
    if (data[SETTINGS_KEY]) await updateUserData(toId, { [SETTINGS_KEY]: data[SETTINGS_KEY] });
  } catch (err) {
    console.error(`failed to copy user data ${fromId} -> ${toId}`, err);
  }
}

export function makeAuthApi(db: Db, delegate: AuthDelegate): express.Router {
  const router = express.Router();
  router.use(express.json());

  const issueSession = (
    playerId: string,
    kind: 'guest' | 'account',
    username: string | null,
    deviceId: string | null,
    name: string,
  ): AuthResponse => {
    const token = newToken();
    db.createSession({ token, playerId, kind, username, deviceId });
    return { token, playerId, kind, name };
  };

  const revokeOthers = (playerId: string, keepToken: string | null, reason: string): void => {
    const dropped = db.deleteSessionsFor(playerId, keepToken);
    if (dropped.length > 0) delegate.onSessionsRevoked(dropped, reason);
  };

  /**
   * Guest bootstrap. Registers the device id with PlayFab (idempotent) and
   * adopts any match data recorded under the raw device id — both v0.0
   * guests and rows written while PlayFab was unreachable.
   */
  router.post('/guest', async (req, res) => {
    const deviceId = str(req.body?.deviceId, 64);
    const name = str(req.body?.name, 24) ?? 'Guest';
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId required' });
      return;
    }
    let playerId = deviceId; // fallback key if PlayFab is down
    if (playFabEnabled()) {
      try {
        playerId = await loginWithServerCustomId(deviceId);
        db.migratePlayerId(deviceId, playerId);
      } catch (err) {
        console.error('guest PlayFab login failed; issuing local session', err);
      }
    }
    res.json(issueSession(playerId, 'guest', null, deviceId, name));
  });

  /**
   * Creates an account from the current guest session. The guest's stats,
   * records, and settings carry over to the new PlayFab player; the old
   * guest player is then deleted so the device id can start fresh later.
   */
  router.post('/register', rateLimiter(10, 5 * 60 * 1000), async (req, res) => {
    const session = sessionFromRequest(db, req);
    const username = str(req.body?.username, 64);
    const password = str(req.body?.password, 200);
    const email = str(req.body?.email, 254); // optional recovery email
    if (!session || session.kind !== 'guest') {
      res.status(401).json({ error: 'Sign out before creating an account.' });
      return;
    }
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required.' });
      return;
    }
    const bad =
      validateUsername(username) ?? validatePassword(password) ?? (email ? validateEmail(email) : null);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
    try {
      const playerId = await registerUser(username, password, email);
      const guestId = session.playerId;
      db.migratePlayerId(guestId, playerId);
      if (guestId !== session.deviceId) {
        // The guest had a real PlayFab player: move settings, then drop it.
        await copyUserData(guestId, playerId);
        deleteMasterPlayerAccount(guestId).catch((err) =>
          console.error('failed to delete old guest player', guestId, err),
        );
      }
      db.deleteSession(session.token);
      res.json(issueSession(playerId, 'account', username, session.deviceId, username));
    } catch (err) {
      fail(res, err, 'Could not create the account.');
    }
  });

  /** Signs in, revoking every other session of the account (one device at a time). */
  // More generous than the others: several players can share one IP, and
  // PlayFab already applies per-account lockout on repeated failures.
  router.post('/login', rateLimiter(30, 5 * 60 * 1000), async (req, res) => {
    const username = str(req.body?.username, 64);
    const password = str(req.body?.password, 200);
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required.' });
      return;
    }
    try {
      const playerId = await loginWithPassword(username, password);
      const out = issueSession(playerId, 'account', username, null, username);
      revokeOthers(playerId, out.token, 'Signed in on another device.');
      res.json(out);
    } catch (err) {
      fail(res, err, 'Could not sign in.');
    }
  });

  router.post('/logout', (req, res) => {
    const session = sessionFromRequest(db, req);
    if (session) db.deleteSession(session.token);
    res.json({ ok: true });
  });

  /**
   * Changes the password. PlayFab has no email-less password mutation, so
   * this verifies the old password, snapshots the player's settings, deletes
   * the master account (which frees the username after a few seconds), and
   * re-registers the same username with the new password, re-keying our
   * match data to the new PlayFabId. All other sessions are revoked.
   */
  router.post('/changePassword', rateLimiter(6, 5 * 60 * 1000), async (req, res) => {
    const session = sessionFromRequest(db, req);
    const oldPassword = str(req.body?.oldPassword, 200);
    const newPassword = str(req.body?.newPassword, 200);
    if (!session || session.kind !== 'account' || !session.username) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Old and new password required.' });
      return;
    }
    const bad = validatePassword(newPassword);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
    const username = session.username;
    try {
      const oldId = await loginWithPassword(username, oldPassword);
      const settings = (await getUserData(oldId).catch(() => ({}) as Record<string, string>))[
        SETTINGS_KEY
      ];
      const email = await getAccountEmail(oldId).catch(() => null);
      await deleteMasterPlayerAccount(oldId);
      const newId = await registerUserWithRetry(username, newPassword, email);
      if (settings) {
        await updateUserData(newId, { [SETTINGS_KEY]: settings }).catch((err) =>
          console.error('failed to restore settings after password change', err),
        );
      }
      db.migratePlayerId(oldId, newId);
      revokeOthers(newId, null, 'Password was changed on another device.');
      res.json(issueSession(newId, 'account', username, session.deviceId, username));
    } catch (err) {
      fail(res, err, 'Could not change the password.');
    }
  });

  /**
   * Adds or changes the account's recovery email after re-verifying the
   * password. PlayFab has no email mutation for username accounts either, so
   * this uses the same recreate-the-account dance as /changePassword.
   */
  router.post('/setEmail', rateLimiter(6, 5 * 60 * 1000), async (req, res) => {
    const session = sessionFromRequest(db, req);
    const password = str(req.body?.password, 200);
    const email = str(req.body?.email, 254);
    if (!session || session.kind !== 'account' || !session.username) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (!password || !email) {
      res.status(400).json({ error: 'Password and email required.' });
      return;
    }
    const bad = validateEmail(email);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
    const username = session.username;
    try {
      const oldId = await loginWithPassword(username, password);
      // Surface an email conflict BEFORE deleting anything.
      const holder = await findAccountByEmail(email);
      if (holder && holder.playFabId !== oldId) {
        res.status(409).json({ error: 'That email is already in use by another account.' });
        return;
      }
      if (holder && holder.playFabId === oldId) {
        res.json({ ok: true, email }); // already set: nothing to do
        return;
      }
      const settings = (await getUserData(oldId).catch(() => ({}) as Record<string, string>))[
        SETTINGS_KEY
      ];
      await deleteMasterPlayerAccount(oldId);
      const newId = await registerUserWithRetry(username, password, email);
      if (settings) {
        await updateUserData(newId, { [SETTINGS_KEY]: settings }).catch((err) =>
          console.error('failed to restore settings after email change', err),
        );
      }
      db.migratePlayerId(oldId, newId);
      revokeOthers(newId, null, 'Email was changed on another device.');
      res.json({ ...issueSession(newId, 'account', username, session.deviceId, username), email });
    } catch (err) {
      fail(res, err, 'Could not set the email.');
    }
  });

  /** The signed-in account's recovery email, for the account dialog. */
  router.get('/email', async (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session || session.kind !== 'account') {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    try {
      res.json({ email: await getAccountEmail(session.playerId) });
    } catch (err) {
      fail(res, err, 'Could not load the email.');
    }
  });

  /**
   * Forgotten password/username: sends PlayFab's password-reset email and
   * echoes a masked username so the player can recognize their account.
   * Email-less players are pointed at the developer instead.
   */
  router.post('/forgot', rateLimiter(6, 5 * 60 * 1000), async (req, res) => {
    const email = str(req.body?.email, 254);
    if (!email || validateEmail(email)) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }
    try {
      const account = await findAccountByEmail(email);
      if (!account) {
        res.status(404).json({
          error:
            'No account has that email. If you never added one, contact the developer to recover your account.',
        });
        return;
      }
      await sendAccountRecoveryEmail(email);
      const u = account.username ?? '';
      const masked = u.length > 2 ? `${u.slice(0, 2)}${'*'.repeat(u.length - 2)}` : u;
      res.json({ ok: true, usernameHint: masked });
    } catch (err) {
      fail(res, err, 'Could not send the recovery email.');
    }
  });

  /** Deletes the account (PlayFab master player) after re-verifying the password. */
  router.post('/deleteAccount', rateLimiter(6, 5 * 60 * 1000), async (req, res) => {
    const session = sessionFromRequest(db, req);
    const password = str(req.body?.password, 200);
    if (!session || session.kind !== 'account' || !session.username) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (!password) {
      res.status(400).json({ error: 'Password required.' });
      return;
    }
    try {
      const playerId = await loginWithPassword(session.username, password);
      await deleteMasterPlayerAccount(playerId);
      revokeOthers(playerId, null, 'Account deleted.');
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, 'Could not delete the account.');
    }
  });

  /** Player settings, stored in PlayFab user data so they roam with the account. */
  router.get('/settings', async (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (!playFabEnabled() || session.playerId === session.deviceId) {
      res.json({ settings: null });
      return;
    }
    try {
      const data = await getUserData(session.playerId);
      res.json({ settings: data[SETTINGS_KEY] ? JSON.parse(data[SETTINGS_KEY]) : null });
    } catch (err) {
      fail(res, err, 'Could not load settings.');
    }
  });

  router.put('/settings', async (req, res) => {
    const session = sessionFromRequest(db, req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    const blob = JSON.stringify(req.body?.settings ?? null);
    if (blob === 'null' || blob.length > SETTINGS_MAX_BYTES) {
      res.status(400).json({ error: 'Bad settings payload.' });
      return;
    }
    if (!playFabEnabled() || session.playerId === session.deviceId) {
      res.json({ ok: false }); // local-only session: client cache is the store
      return;
    }
    try {
      await updateUserData(session.playerId, { [SETTINGS_KEY]: blob });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, 'Could not save settings.');
    }
  });

  return router;
}
