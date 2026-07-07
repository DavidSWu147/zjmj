/** Account credential rules, enforced client-side for UX and server-side for real. */

export const USERNAME_RULES = '3–20 characters: letters and numbers only.';

// PlayFab rejects anything beyond plain alphanumerics (verified empirically:
// underscores and hyphens are "invalid characters").
export function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 20) {
    return 'Username must be 3–20 characters.';
  }
  if (!/^[A-Za-z0-9]+$/.test(username)) {
    return 'Username may only contain letters and numbers.';
  }
  return null;
}

export const PASSWORD_RULES =
  '8+ characters, with at least one uppercase letter, one lowercase letter, and one number or symbol.';

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 64) return 'Password must be at most 64 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[^A-Za-z]/.test(password)) return 'Password must contain a number or symbol.';
  return null;
}
