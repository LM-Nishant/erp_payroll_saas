import { prisma } from '../db/prisma';
import { currentRequestMeta } from '../http/request-context';

export async function recordLoginEvent(event: {
  email: string;
  userId?: string | null;
  organizationId?: string | null;
  success: boolean;
  failureReason?: string;
  mfaUsed?: boolean;
}): Promise<void> {
  const meta = currentRequestMeta();
  await prisma.loginEvent.create({
    data: {
      email: event.email,
      userId: event.userId ?? null,
      organizationId: event.organizationId ?? null,
      success: event.success,
      failureReason: event.failureReason ?? null,
      mfaUsed: event.mfaUsed ?? false,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
}

export async function listLoginEvents(userId: string, take = 50) {
  return prisma.loginEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      organizationId: true,
      success: true,
      failureReason: true,
      mfaUsed: true,
      ip: true,
      userAgent: true,
      createdAt: true,
    },
  });
}
