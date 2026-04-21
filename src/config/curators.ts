/**
 * Curator allowlist for in-app editorial publishing.
 *
 * This only controls UI visibility — the server has its own allowlist
 * (CURATOR_EMAILS env var) that is the authoritative gate. Bypassing
 * this client check won't let anyone actually publish.
 */
const CURATOR_EMAILS: string[] = [
  'bworthy89@gmail.com',
];

export function isCurator(email: string | null | undefined): boolean {
  if (!email) return false;
  return CURATOR_EMAILS.includes(email.toLowerCase());
}
