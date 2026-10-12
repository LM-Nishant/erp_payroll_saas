import { prisma } from '../db/prisma';

export interface PasswordResetTarget {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
}

/**
 * Who a self-service reset e-mail goes to: an active user with an active membership (in the
 * given organization, else their earliest one). The e-mail is sent through that organization's
 * mail settings. Returns null for unknown / disabled users and platform-only accounts.
 */
export async function findPasswordResetTarget(
  email: string,
  organizationSlug?: string,
): Promise<PasswordResetTarget | null> {
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null, status: 'ACTIVE' },
    include: {
      memberships: {
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          organization: {
            deletedAt: null,
            status: 'ACTIVE',
            ...(organizationSlug ? { slug: organizationSlug } : {}),
          },
        },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        take: 1,
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || !membership) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
  };
}
