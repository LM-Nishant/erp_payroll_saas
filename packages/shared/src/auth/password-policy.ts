/**
 * Password policy shared by API (authoritative) and web (instant feedback).
 * - 12..128 characters
 * - at least 3 of: lowercase, uppercase, digit, symbol
 * - must not contain the email's local part
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordPolicyViolations(password: string, email?: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes < 3) {
    problems.push('Password must contain 3 of: lowercase, uppercase, digit, symbol');
  }
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    problems.push('Password must not contain your email name');
  }
  return problems;
}
