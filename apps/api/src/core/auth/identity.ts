import { prisma } from '../db/prisma';
import { NotFoundError } from '../http/errors';
import { assertPasswordPolicy, hashPassword } from './password';

/**
 * Identity service: the ONLY way modules touch the global `users` table. Never expose
 * password hashes / MFA secrets — use `PUBLIC_USER_SELECT`.
 */
export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export function findUserByEmail(email: string) {
  return prisma.user
    .findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      select: { ...PUBLIC_USER_SELECT, passwordHash: true },
    })
    .then((u) => (u ? { user: stripHash(u), hasPassword: Boolean(u.passwordHash) } : null));
}

function stripHash<T extends { passwordHash?: string | null }>(u: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _p, ...rest } = u;
  return rest;
}

export async function getUserById(id: string): Promise<PublicUser> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: PUBLIC_USER_SELECT,
  });
  if (!user) throw new NotFoundError('User');
  return user;
}

export async function createIdentity(input: {
  email: string;
  name: string;
  password?: string | undefined;
}): Promise<PublicUser> {
  if (input.password) assertPasswordPolicy(input.password, input.email);
  return prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      ...(input.password
        ? { passwordHash: await hashPassword(input.password), passwordChangedAt: new Date() }
        : {}),
    },
    select: PUBLIC_USER_SELECT,
  });
}

export function updateIdentityName(id: string, name: string): Promise<PublicUser> {
  return prisma.user.update({ where: { id }, data: { name }, select: PUBLIC_USER_SELECT });
}

export async function userHasPassword(id: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
  return Boolean(user?.passwordHash);
}
