/** Display-name rules (v0.2.1): shared by client UX and server enforcement. */

export const DISPLAY_NAME_RULES = '3–24 characters: letters, numbers, and hyphens only.';

const DISPLAY_NAME_RE = /^[A-Za-z0-9-]{3,24}$/;

/** Charset/length check with a friendly message; null when acceptable. */
export function validateDisplayName(name: string): string | null {
  if (name.length < 3) return 'Display name must be at least 3 characters.';
  if (name.length > 24) return 'Display name must be at most 24 characters.';
  if (!DISPLAY_NAME_RE.test(name)) {
    return 'Display name may only contain letters, numbers, and hyphens.';
  }
  return null;
}

/**
 * A small, conservative blocklist (matched as lowercase substrings). Not a
 * complete profanity filter — extend as needed.
 */
const BLOCKLIST = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'asshole',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'wanker',
  'bastard',
  'dickhead',
  'cocksuck',
  'pussy',
];

export function containsProfanity(name: string): boolean {
  const lower = name.toLowerCase();
  return BLOCKLIST.some((w) => lower.includes(w));
}

/**
 * The server-side gate: any rule-violating display name (bad charset/length
 * or profanity) is automatically replaced with three hyphens.
 */
export function sanitizeDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!DISPLAY_NAME_RE.test(trimmed) || containsProfanity(trimmed)) return '---';
  return trimmed;
}
