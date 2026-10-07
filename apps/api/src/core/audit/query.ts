import type { ListAuditLogsQuery } from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { toListResponse, toPageWindow } from '../http/pagination';

export interface AuditLogView {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actorType: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

/**
 * Read audit logs. `organizationId` is REQUIRED for tenant reads (pass the current tenant);
 * `null` restricts to platform-level rows and `undefined` (platform audit view only) means all.
 */
export async function listAuditLogs(
  organizationId: string | null | undefined,
  query: ListAuditLogsQuery,
) {
  const where: Prisma.AuditLogWhereInput = {
    ...(organizationId !== undefined ? { organizationId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { actor: { select: { email: true } } },
      ...toPageWindow(query),
    }),
    prisma.auditLog.count({ where }),
  ]);
  const data: AuditLogView[] = rows.map(({ actor, updatedAt: _u, ...row }) => ({
    ...row,
    actorEmail: actor?.email ?? null,
  }));
  return toListResponse(data, total, query);
}
