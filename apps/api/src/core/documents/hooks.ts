import type { DocumentScanStatus } from '@erp/shared';
import { audit } from '../audit';
import { prisma } from '../db/prisma';
import { registerUsageSource, releaseLimit } from '../features/limits';
import { NotFoundError } from '../http/errors';
import { logger } from '../logger';
import { storageForObject } from '../storage';
import { tenantDb } from '../tenancy/tenant-db';

/*
 * System hooks for jobs (Layer 5 scheduler / notification engine). They run in the CURRENT
 * tenant context (iterate organizations with runAsSystem / withTenant contexts) and perform no
 * permission checks — never expose them directly through an API.
 */

export interface DueExpiryReminder {
  reminderId: string;
  documentId: string;
  title: string;
  ownerType: string;
  ownerId: string;
  category: string;
  documentType: string | null;
  groupId: string | null;
  institutionId: string | null;
  expiryDate: string;
  daysBefore: number;
  remindAt: string;
}

/** Pending expiry reminders due on or before `asOf` (default today) for active documents. */
export async function dueExpiryReminders(
  options: { asOf?: Date; limit?: number } = {},
): Promise<DueExpiryReminder[]> {
  const rows = await tenantDb().documentExpiryReminder.findMany({
    where: {
      status: 'PENDING',
      remindAt: { lte: options.asOf ?? new Date() },
      document: { deletedAt: null, status: 'ACTIVE' },
    },
    include: { document: true },
    orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
    take: options.limit ?? 500,
  });
  return rows
    .filter((r) => r.document.expiryDate)
    .map((r) => ({
      reminderId: r.id,
      documentId: r.documentId,
      title: r.document.title,
      ownerType: r.document.ownerType,
      ownerId: r.document.ownerId,
      category: r.document.category,
      documentType: r.document.documentType,
      groupId: r.document.groupId,
      institutionId: r.document.institutionId,
      expiryDate: r.document.expiryDate!.toISOString().slice(0, 10),
      daysBefore: r.daysBefore,
      remindAt: r.remindAt.toISOString().slice(0, 10),
    }));
}

/** Mark a reminder as sent (idempotent). */
export async function markReminderSent(reminderId: string): Promise<void> {
  const { count } = await tenantDb().documentExpiryReminder.updateMany({
    where: { id: reminderId, status: 'PENDING' },
    data: { status: 'SENT', sentAt: new Date() },
  });
  if (count > 0) {
    await audit.record({
      action: 'document.expiry_reminder_sent',
      entityType: 'document_expiry_reminder',
      entityId: reminderId,
    });
  }
}

/** Report an asynchronous virus-scan result (scanners that returned PENDING). */
export async function recordScanResult(versionId: string, status: DocumentScanStatus) {
  const db = tenantDb();
  const version = await db.documentVersion.findFirst({ where: { id: versionId } });
  if (!version) throw new NotFoundError('Document version');
  await db.documentVersion.update({
    where: { id: version.id },
    data: { scanStatus: status, scannedAt: new Date() },
  });
  await audit.record({
    action: 'document.scan_result',
    entityType: 'document',
    entityId: version.documentId,
    before: { scanStatus: version.scanStatus },
    after: { scanStatus: status },
    metadata: { versionId },
  });
}

/**
 * Permanently delete the stored objects of documents soft-deleted past their retention
 * (`purgeAfter`), give the bytes back to `storage_bytes` and stamp `purgedAt`. Metadata rows
 * and versions stay for the audit trail.
 */
export async function purgeExpiredDocuments(
  options: { now?: Date; limit?: number } = {},
): Promise<{ documents: number; versions: number; bytes: number }> {
  const db = tenantDb();
  const docs = await db.document.findMany({
    where: {
      deletedAt: { not: null },
      purgedAt: null,
      purgeAfter: { lte: options.now ?? new Date() },
    },
    select: { id: true },
    take: options.limit ?? 100,
  });
  let versions = 0;
  let bytes = 0;
  for (const doc of docs) {
    const rows = await db.documentVersion.findMany({
      where: { documentId: doc.id, purgedAt: null },
    });
    for (const v of rows) {
      try {
        const provider = await storageForObject(v);
        await provider.deleteObject(v.storageKey, { versionId: v.storageVersionId });
      } catch (err) {
        logger.error({ err, versionId: v.id }, 'Failed to purge document object');
        continue;
      }
      await db.documentVersion.update({ where: { id: v.id }, data: { purgedAt: new Date() } });
      await releaseLimit('storage_bytes', v.sizeBytes);
      versions += 1;
      bytes += v.sizeBytes;
    }
    const remaining = await db.documentVersion.count({
      where: { documentId: doc.id, purgedAt: null },
    });
    if (remaining === 0) {
      await db.document.updateMany({
        where: { id: doc.id, deletedAt: { not: null } },
        data: { purgedAt: new Date() },
      });
      await audit.record({ action: 'document.purge', entityType: 'document', entityId: doc.id });
    }
  }
  return { documents: docs.length, versions, bytes };
}

/** Expire abandoned signed-URL uploads and delete any object they left behind. */
export async function expireStaleUploads(options: { now?: Date } = {}): Promise<number> {
  const db = tenantDb();
  const stale = await db.storageUpload.findMany({
    where: { status: 'PENDING', expiresAt: { lt: options.now ?? new Date() } },
    take: 500,
  });
  for (const u of stale) {
    await (await storageForObject(u)).deleteObject(u.storageKey).catch(() => undefined);
    await db.storageUpload.update({ where: { id: u.id }, data: { status: 'EXPIRED' } });
  }
  return stale.length;
}

/** Source of truth for the `storage_bytes` gauge: bytes of every non-purged version. */
export async function storageBytesUsed(organizationId: string): Promise<number> {
  const agg = await prisma.documentVersion.aggregate({
    where: { organizationId, purgedAt: null },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

registerUsageSource('storage_bytes', storageBytesUsed);
