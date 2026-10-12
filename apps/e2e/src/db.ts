import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConnection, type RowDataPacket } from 'mysql2/promise';

/**
 * Direct access to the dev database for the few flows whose secret only ever leaves the server by
 * e-mail (invite / password-reset tokens). The dev "log" mail provider keeps messages in the API
 * process's memory, so specs mint their own one-time token row instead (the API stores only the
 * SHA-256 hash). Uses E2E_DATABASE_URL, else DATABASE_URL from apps/api/.env.
 */
function databaseUrl(): string | null {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const envFile = resolve(import.meta.dirname, '../../api/.env');
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  return line ? line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '') : null;
}

export const hasDatabase = () => databaseUrl() !== null;

/** Issues a fresh one-time token for `email` exactly like the API does and returns the raw value. */
export async function mintUserToken(
  email: string,
  type: 'INVITE' | 'PASSWORD_RESET',
): Promise<string> {
  const url = databaseUrl();
  if (!url) throw new Error('No database URL for e2e token minting');
  const db = await createConnection(url);
  try {
    const [users] = await db.query<Array<RowDataPacket & { id: string; organization_id: string }>>(
      `SELECT u.id, m.organization_id FROM users u
         JOIN organization_memberships m ON m.user_id = u.id AND m.deleted_at IS NULL
        WHERE u.email = ? AND u.deleted_at IS NULL LIMIT 1`,
      [email],
    );
    const user = users[0];
    if (!user) throw new Error(`No user ${email}`);
    await db.query(
      'UPDATE user_tokens SET used_at = NOW(3) WHERE user_id = ? AND type = ? AND used_at IS NULL',
      [user.id, type],
    );
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO user_tokens (id, user_id, organization_id, type, token_hash, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 30 MINUTE), NOW(3), NOW(3))`,
      [
        randomUUID(),
        user.id,
        user.organization_id,
        type,
        createHash('sha256').update(token).digest('hex'),
      ],
    );
    return token;
  } finally {
    await db.end();
  }
}
