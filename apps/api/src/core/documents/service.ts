import {
  DOCUMENT_ACTIONS,
  type CreateDocumentGrantInput,
  type CreateSignatureRequestInput,
  type DocumentAction,
  type DocumentDto,
  type DocumentGrantDto,
  type DocumentListQuery,
  type DocumentMetadata,
  type DocumentSignatureDto,
  type DocumentVersionDto,
  type ExpiringDocumentDto,
  type ExpiringDocumentsQuery,
  type SignedUrlDto,
  type UpdateDocumentInput,
  type UpdateSignatureInput,
  type UploadTicketDto,
  createDocumentGrantSchema,
  createSignatureRequestSchema,
  createDocumentUploadSchema,
  createVersionUploadSchema,
  documentMetadataSchema,
  updateDocumentSchema,
} from '@erp/shared';
import { Prisma, type Document, type DocumentVersion } from '@prisma/client';
import { audit } from '../audit';
import { authorize, currentPrincipal } from '../authz';
import type { Principal } from '../authz/principal';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { assertFeatureEnabled } from '../features/features';
import { assertWithinLimit } from '../features/limits';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../http/errors';
import { toPageWindow } from '../http/pagination';
import { parseInput } from '../http/validation';
import {
  DEFAULT_DOCUMENT_TYPES,
  assertContentMatches,
  assertTenantKey,
  buildObjectKey,
  fileExtension,
  storageForObject,
  storageForWrite,
  validateDeclaredFile,
  type UploadPolicy,
} from '../storage';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import {
  GRANT_ACTION_COLUMNS,
  documentActionsFor,
  documentScope,
  rbacAllows,
  visibleDocumentsWhere,
} from './access';
import {
  toDocumentDto,
  toGrantDto,
  toSignatureDto,
  toVersionDto,
  type DocumentWithRelations,
} from './mappers';
import { resolveDocumentOwner, toResourceScope, type ResolvedOwner } from './owners';
import {
  acceptUploadedObject,
  copyStoredObject,
  discardObject,
  sha256Hex,
  writeObject,
  type IncomingFile,
  type StoredObject,
} from './store';

/** Reminder schedule used when a document gets an expiry date without explicit reminderDays. */
export const DEFAULT_REMINDER_DAYS = [30, 7] as const;

const INCLUDE = { currentVersion: true, permissions: true, reminders: true } as const;

export const documentUploadPolicy = (): UploadPolicy => ({
  types: DEFAULT_DOCUMENT_TYPES,
  maxBytes: env.STORAGE_MAX_UPLOAD_BYTES,
});

const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00.000Z`);
const utcToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const DAY = 86_400_000;

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function loadDocument(id: string): Promise<DocumentWithRelations> {
  const doc = await tenantDb().document.findFirst({ where: { id }, include: INCLUDE });
  if (!doc) throw new NotFoundError('Document');
  return doc;
}

/** Load + authorize. Invisible documents are reported as 404 (no existence leak). */
async function documentFor(id: string, action: DocumentAction) {
  const principal = currentPrincipal();
  const doc = await loadDocument(id);
  const allowed = await documentActionsFor(principal, doc);
  if (!allowed.has('view')) throw new NotFoundError('Document');
  if (!allowed.has(action)) {
    throw new ForbiddenError(
      `Not allowed to ${action.replace('_', ' ')} this document`,
      'DOCUMENT_ACCESS_DENIED',
    );
  }
  return { doc, allowed, principal };
}

async function requireManage(principal: Principal, doc: Document) {
  if (!(await rbacAllows(principal, 'document.manage', doc))) {
    throw new ForbiddenError('Permission "document.manage" is required', 'DOCUMENT_ACCESS_DENIED');
  }
}

/** Authorization to create a document for an owner (path 1 only — grants need a document). */
async function authorizeCreate(
  principal: Principal,
  owner: ResolvedOwner,
  confidentiality: Document['confidentiality'],
) {
  const scope = toResourceScope(owner.scope);
  await assertFeatureEnabled('documents', {
    institutionId: owner.scope.institutionId,
    groupId: owner.scope.groupId,
  });
  await authorize(principal, 'document.upload', scope);
  if (confidentiality === 'CONFIDENTIAL') {
    await authorize(principal, 'document.view_confidential', scope);
  }
}

async function syncReminders(
  documentId: string,
  expiryDate: Date | null,
  days: number[] | undefined,
  expiryChanged: boolean,
) {
  const db = tenantDb();
  if (!expiryDate) {
    await db.documentExpiryReminder.deleteMany({ where: { documentId } });
    return;
  }
  let existing = await db.documentExpiryReminder.findMany({ where: { documentId } });
  const wanted =
    days ?? (existing.length > 0 ? existing.map((r) => r.daysBefore) : [...DEFAULT_REMINDER_DAYS]);
  if (expiryChanged) {
    await db.documentExpiryReminder.deleteMany({ where: { documentId } });
    existing = [];
  } else {
    await db.documentExpiryReminder.deleteMany({
      where: { documentId, daysBefore: { notIn: wanted } },
    });
  }
  const today = utcToday().getTime();
  const have = new Set(existing.map((r) => r.daysBefore));
  const rows = wanted
    .filter((d) => !have.has(d))
    .map((d) => ({ daysBefore: d, remindAt: new Date(expiryDate.getTime() - d * DAY) }))
    .filter((r) => r.remindAt.getTime() >= today);
  if (rows.length > 0) {
    await db.documentExpiryReminder.createMany({
      data: rows.map((r) => withTenant({ documentId, ...r })),
    });
  }
}

async function nextVersionNumber(documentId: string) {
  const last = await tenantDb().documentVersion.findFirst({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });
  return (last?.versionNumber ?? 0) + 1;
}

const versionData = (stored: StoredObject) => ({
  storageKey: stored.storageKey,
  storageBackend: stored.storageBackend,
  storageSecretId: stored.storageSecretId,
  storageVersionId: stored.storageVersionId,
  fileName: stored.fileName,
  mimeType: stored.mimeType,
  sizeBytes: stored.sizeBytes,
  checksumSha256: stored.checksumSha256,
  scanStatus: stored.scanStatus,
  scannedAt: stored.scanStatus === 'PENDING' ? null : new Date(),
});

const auditVersion = (v: {
  id: string;
  versionNumber: number;
  fileName: string;
  sizeBytes: number;
  checksumSha256: string;
  scanStatus: string;
}) => ({
  versionId: v.id,
  versionNumber: v.versionNumber,
  fileName: v.fileName,
  sizeBytes: v.sizeBytes,
  checksumSha256: v.checksumSha256,
  scanStatus: v.scanStatus,
});

export interface PersistDocumentInput {
  owner: ResolvedOwner;
  module: string;
  metadata: DocumentMetadata;
  stored: StoredObject;
  /** Non-sensitive module metadata stored on the document (e.g. PDF template key). */
  extra?: Record<string, unknown>;
}

/** Create the document + version 1 rows for an already stored object (discards it on error). */
async function persistNewDocument(input: PersistDocumentInput): Promise<DocumentDto> {
  const principal = currentPrincipal();
  const db = tenantDb();
  const { metadata: m, owner, stored } = input;
  try {
    const doc = await db.document.create({
      data: withTenant({
        ...owner.scope,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        module: input.module,
        category: m.category,
        documentType: m.documentType ?? null,
        title: m.title,
        description: m.description ?? null,
        confidentiality: m.confidentiality,
        issueDate: toDate(m.issueDate) ?? null,
        expiryDate: toDate(m.expiryDate) ?? null,
        metadata: input.extra ? (input.extra as Prisma.InputJsonValue) : Prisma.DbNull,
        createdById: principal.userId,
        updatedById: principal.userId,
      }),
    });
    const version = await db.documentVersion.create({
      data: withTenant({
        documentId: doc.id,
        versionNumber: 1,
        ...versionData(stored),
        uploadedById: principal.userId,
      }),
    });
    await db.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    if (m.confidentiality === 'RESTRICTED' && principal.userId) {
      // The creator of a RESTRICTED document keeps full access through an explicit grant.
      await db.documentPermission.create({
        data: withTenant({
          documentId: doc.id,
          granteeType: 'USER' as const,
          userId: principal.userId,
          canView: true,
          canDownload: true,
          canUploadVersion: true,
          canDelete: true,
          canShare: true,
          createdById: principal.userId,
        }),
      });
    }
    await syncReminders(doc.id, doc.expiryDate, m.reminderDays, true);
    const created = await loadDocument(doc.id);
    await audit.record({
      action: 'document.create',
      entityType: 'document',
      entityId: doc.id,
      after: {
        title: doc.title,
        ownerType: doc.ownerType,
        ownerId: doc.ownerId,
        module: doc.module,
        category: doc.category,
        confidentiality: doc.confidentiality,
        expiryDate: m.expiryDate ?? null,
        ...auditVersion(version),
      },
    });
    return toDocumentDto(created, await documentActionsFor(principal, created));
  } catch (err) {
    await discardObject(stored);
    throw err;
  }
}

async function persistNewVersion(
  doc: Document,
  stored: StoredObject,
  extra: { reason?: string | null; restoredFromVersionId?: string | null },
): Promise<DocumentVersionDto> {
  const principal = currentPrincipal();
  const db = tenantDb();
  try {
    const version = await db.documentVersion.create({
      data: withTenant({
        documentId: doc.id,
        versionNumber: await nextVersionNumber(doc.id),
        ...versionData(stored),
        uploadedById: principal.userId,
        reason: extra.reason ?? null,
        previousVersionId: doc.currentVersionId,
        restoredFromVersionId: extra.restoredFromVersionId ?? null,
      }),
    });
    await db.document.update({
      where: { id: doc.id },
      data: { currentVersionId: version.id, updatedById: principal.userId },
    });
    await audit.record({
      action: extra.restoredFromVersionId ? 'document.version_restore' : 'document.version_create',
      entityType: 'document',
      entityId: doc.id,
      after: auditVersion(version),
      reason: extra.reason ?? null,
      metadata: {
        previousVersionId: doc.currentVersionId,
        ...(extra.restoredFromVersionId
          ? { restoredFromVersionId: extra.restoredFromVersionId }
          : {}),
      },
    });
    return toVersionDto(version, version.id, await userNames([version.uploadedById]));
  } catch (err) {
    await discardObject(stored);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Another version was uploaded concurrently; retry');
    }
    throw err;
  }
}

export interface AttachDocumentInput {
  ownerType: string;
  ownerId?: string;
  /** Module attaching the file (storage key segment + `documents.module`). */
  module: string;
  metadata: DocumentMetadata | Record<string, unknown>;
  file: IncomingFile;
  /** Override allowlist / size cap (e.g. logos). */
  policy?: UploadPolicy;
  extra?: Record<string, unknown>;
  /**
   * `principal` (default): normal create authorization (feature + document.upload in scope).
   * `caller`: the calling module already authorized the action with its own permission.
   */
  authorization?: 'principal' | 'caller';
}

/**
 * Document engine — the API other modules use to attach and read files. All functions run in
 * the current tenant + principal context and audit their mutations.
 */
export const documentEngine = {
  /** Attach a file to an owner entity as a NEW document (module API). */
  async attach(input: AttachDocumentInput): Promise<DocumentDto> {
    const principal = currentPrincipal();
    const metadata = parseInput(documentMetadataSchema, {
      ...input.metadata,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
    });
    const owner = await resolveDocumentOwner(metadata.ownerType, metadata.ownerId);
    if (input.authorization !== 'caller') {
      await authorizeCreate(principal, owner, metadata.confidentiality);
    }
    const stored = await writeObject(
      {
        scope: owner.scope,
        module: input.module,
        entity: owner.ownerType,
        entityId: owner.ownerId,
      },
      input.file,
      input.policy ?? documentUploadPolicy(),
    );
    return persistNewDocument({
      owner,
      module: input.module,
      metadata,
      stored,
      extra: input.extra,
    });
  },

  /** Add a version to an existing document. `caller` authorization skips the action check. */
  async addVersion(
    id: string,
    file: IncomingFile,
    options: {
      reason?: string;
      policy?: UploadPolicy;
      authorization?: 'principal' | 'caller';
    } = {},
  ): Promise<DocumentVersionDto> {
    const doc =
      options.authorization === 'caller'
        ? await loadDocument(id)
        : (await documentFor(id, 'upload_version')).doc;
    const stored = await writeObject(
      { scope: doc, module: doc.module, entity: doc.ownerType, entityId: doc.ownerId },
      file,
      options.policy ?? documentUploadPolicy(),
    );
    return persistNewVersion(doc, stored, { reason: options.reason });
  },

  async list(query: DocumentListQuery): Promise<{ items: DocumentDto[]; total: number }> {
    const principal = currentPrincipal();
    const where: Prisma.DocumentWhereInput = {
      AND: [
        await visibleDocumentsWhere(principal),
        {
          ...(query.ownerType ? { ownerType: query.ownerType } : {}),
          ...(query.ownerId ? { ownerId: query.ownerId } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.documentType ? { documentType: query.documentType } : {}),
          ...(query.module ? { module: query.module } : {}),
          ...(query.confidentiality ? { confidentiality: query.confidentiality } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.groupId ? { groupId: query.groupId } : {}),
          ...(query.institutionId ? { institutionId: query.institutionId } : {}),
          ...(query.campusId ? { campusId: query.campusId } : {}),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(query.search ? { title: { contains: query.search } } : {}),
        },
      ],
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.document.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db.document.count({ where }),
    ]);
    const names = await userNames(rows.map((r) => r.currentVersion?.uploadedById ?? null));
    const items = await Promise.all(
      rows.map(async (r) => toDocumentDto(r, await documentActionsFor(principal, r), names)),
    );
    return { items, total };
  },

  async get(id: string): Promise<DocumentDto> {
    const { doc, allowed } = await documentFor(id, 'view');
    return toDocumentDto(doc, allowed, await userNames([doc.currentVersion?.uploadedById ?? null]));
  },

  async versions(id: string): Promise<DocumentVersionDto[]> {
    const { doc } = await documentFor(id, 'view');
    const rows = await tenantDb().documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { versionNumber: 'desc' },
    });
    const names = await userNames(rows.map((r) => r.uploadedById));
    return rows.map((v) => toVersionDto(v, doc.currentVersionId, names));
  },

  /** Signed-URL upload, step 1 (new document). */
  async requestUpload(raw: unknown): Promise<UploadTicketDto> {
    const input = parseInput(createDocumentUploadSchema, raw);
    const principal = currentPrincipal();
    const owner = await resolveDocumentOwner(input.document.ownerType, input.document.ownerId);
    await authorizeCreate(principal, owner, input.document.confidentiality);
    return createTicket({
      purpose: 'document.create',
      documentId: null,
      owner,
      module: 'documents',
      file: input,
      payload: { document: { ...input.document, ownerId: owner.ownerId } },
    });
  },

  /** Signed-URL upload, step 1 (new version). */
  async requestVersionUpload(id: string, raw: unknown): Promise<UploadTicketDto> {
    const input = parseInput(createVersionUploadSchema, raw);
    const { doc } = await documentFor(id, 'upload_version');
    return createTicket({
      purpose: 'document.version',
      documentId: doc.id,
      owner: { ownerType: doc.ownerType, ownerId: doc.ownerId, scope: doc },
      module: doc.module,
      file: input,
      payload: { reason: input.reason ?? null },
    });
  },

  /**
   * Signed-URL upload, step 2: verify the uploaded object (exists, size, SHA-256, magic bytes),
   * consume `storage_bytes`, scan and record the document / version.
   */
  async completeUpload(
    uploadId: string,
    input: { checksumSha256?: string },
  ): Promise<{ document: DocumentDto } | { version: DocumentVersionDto }> {
    const principal = currentPrincipal();
    const db = tenantDb();
    const upload = await db.storageUpload.findFirst({ where: { id: uploadId } });
    if (!upload || upload.createdById !== principal.userId) throw new NotFoundError('Upload');
    if (upload.status !== 'PENDING') throw new ConflictError('This upload was already finalized');
    const provider = await storageForObject(upload);
    if (upload.expiresAt.getTime() < Date.now()) {
      await db.storageUpload.update({ where: { id: upload.id }, data: { status: 'EXPIRED' } });
      await provider.deleteObject(upload.storageKey).catch(() => undefined);
      throw new AppError(410, 'UPLOAD_EXPIRED', 'The upload URL has expired; request a new one');
    }
    const claimed = await db.storageUpload.updateMany({
      where: { id: upload.id, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictError('This upload was already finalized');

    const fail = async (message: string, code: string): Promise<never> => {
      await db.storageUpload.update({ where: { id: upload.id }, data: { status: 'FAILED' } });
      await provider.deleteObject(upload.storageKey).catch(() => undefined);
      await audit.record({
        action: 'storage.upload_rejected',
        entityType: 'storage_upload',
        entityId: upload.id,
        metadata: { code },
      });
      throw new ValidationError(message, { code });
    };

    const head = await provider.headObject(upload.storageKey);
    if (!head) {
      await db.storageUpload.update({
        where: { id: upload.id },
        data: { status: 'PENDING', completedAt: null },
      });
      throw new ValidationError('The file has not been uploaded yet', { code: 'UPLOAD_MISSING' });
    }
    if (head.sizeBytes !== upload.declaredSizeBytes) {
      return fail('Uploaded size does not match the declared size', 'SIZE_MISMATCH');
    }
    const body = await provider.getObject(upload.storageKey, { versionId: head.versionId });
    const checksum = sha256Hex(body);
    const expected = input.checksumSha256 ?? upload.declaredChecksum;
    if (
      body.length !== upload.declaredSizeBytes ||
      (expected && expected !== checksum) ||
      (head.checksumSha256 && head.checksumSha256 !== checksum)
    ) {
      return fail('Uploaded content does not match the declared checksum', 'CHECKSUM_MISMATCH');
    }
    try {
      assertContentMatches(body, fileExtension(upload.fileName));
    } catch {
      return fail('File content does not match its type', 'FILE_TYPE_MISMATCH');
    }

    try {
      const payload = upload.payload as Record<string, unknown>;
      if (upload.purpose === 'document.create') {
        const metadata = parseInput(documentMetadataSchema, payload.document);
        const owner = await resolveDocumentOwner(metadata.ownerType, metadata.ownerId);
        await authorizeCreate(principal, owner, metadata.confidentiality);
        const stored = await acceptUploadedObject(
          {
            storageKey: upload.storageKey,
            storageBackend: upload.storageBackend,
            storageSecretId: upload.storageSecretId,
            storageVersionId: head.versionId,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            sizeBytes: body.length,
            checksumSha256: checksum,
          },
          provider,
          body,
        );
        const document = await persistNewDocument({ owner, module: 'documents', metadata, stored });
        await db.storageUpload.update({
          where: { id: upload.id },
          data: { documentId: document.id },
        });
        return { document };
      }
      const { doc } = await documentFor(upload.documentId!, 'upload_version');
      const stored = await acceptUploadedObject(
        {
          storageKey: upload.storageKey,
          storageBackend: upload.storageBackend,
          storageSecretId: upload.storageSecretId,
          storageVersionId: head.versionId,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          sizeBytes: body.length,
          checksumSha256: checksum,
        },
        provider,
        body,
      );
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      return { version: await persistNewVersion(doc, stored, { reason }) };
    } catch (err) {
      await db.storageUpload.update({ where: { id: upload.id }, data: { status: 'FAILED' } });
      throw err;
    }
  },

  async restoreVersion(
    id: string,
    versionId: string,
    reason?: string,
  ): Promise<DocumentVersionDto> {
    const { doc } = await documentFor(id, 'upload_version');
    const source = await tenantDb().documentVersion.findFirst({
      where: { id: versionId, documentId: doc.id },
    });
    if (!source || source.purgedAt) throw new NotFoundError('Document version');
    if (source.id === doc.currentVersionId) {
      throw new ConflictError('This version is already the current version');
    }
    assertDownloadable(source);
    const stored = await copyStoredObject(
      { ...source, scanStatus: source.scanStatus },
      { scope: doc, module: doc.module, entity: doc.ownerType, entityId: doc.ownerId },
    );
    return persistNewVersion(doc, stored, {
      reason: reason ?? `Restored from version ${source.versionNumber}`,
      restoredFromVersionId: source.id,
    });
  },

  /** Issue a short-lived signed download URL (audited as `document.download`). */
  async downloadUrl(
    id: string,
    input: { versionId?: string; disposition: 'attachment' | 'inline' },
  ): Promise<SignedUrlDto> {
    const { doc } = await documentFor(id, 'download');
    const versionId = input.versionId ?? doc.currentVersionId;
    const version = versionId
      ? await tenantDb().documentVersion.findFirst({ where: { id: versionId, documentId: doc.id } })
      : null;
    if (!version || version.purgedAt) throw new NotFoundError('Document version');
    return issueDownloadUrl(doc, version, input.disposition);
  },

  async update(id: string, raw: UpdateDocumentInput): Promise<DocumentDto> {
    const input = parseInput(updateDocumentSchema, raw);
    const principal = currentPrincipal();
    const doc = await loadDocument(id);
    const before = await documentActionsFor(principal, doc);
    if (!before.has('view')) throw new NotFoundError('Document');
    await requireManage(principal, doc);
    const scope = documentScope(doc);
    if (input.confidentiality && input.confidentiality !== doc.confidentiality) {
      if (input.confidentiality === 'CONFIDENTIAL' || input.confidentiality === 'RESTRICTED') {
        await authorize(principal, 'document.view_confidential', scope);
      }
    }
    const issueDate = toDate(input.issueDate);
    const expiryDate = toDate(input.expiryDate);
    const nextIssue = issueDate === undefined ? doc.issueDate : issueDate;
    const nextExpiry = expiryDate === undefined ? doc.expiryDate : expiryDate;
    if (nextIssue && nextExpiry && nextIssue > nextExpiry) {
      throw new ValidationError('expiryDate must not be before issueDate');
    }
    const updated = await tenantDb().document.update({
      where: { id: doc.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.documentType !== undefined ? { documentType: input.documentType } : {}),
        ...(input.confidentiality !== undefined ? { confidentiality: input.confidentiality } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(issueDate !== undefined ? { issueDate } : {}),
        ...(expiryDate !== undefined ? { expiryDate } : {}),
        updatedById: principal.userId,
      },
    });
    const expiryChanged =
      (doc.expiryDate?.getTime() ?? null) !== (updated.expiryDate?.getTime() ?? null);
    if (expiryChanged || input.reminderDays) {
      await syncReminders(doc.id, updated.expiryDate, input.reminderDays, expiryChanged);
    }
    const after = await loadDocument(doc.id);
    const pick = (d: Document) => ({
      title: d.title,
      description: d.description,
      category: d.category,
      documentType: d.documentType,
      confidentiality: d.confidentiality,
      status: d.status,
      issueDate: d.issueDate?.toISOString().slice(0, 10) ?? null,
      expiryDate: d.expiryDate?.toISOString().slice(0, 10) ?? null,
    });
    await audit.record({
      action: 'document.update',
      entityType: 'document',
      entityId: doc.id,
      before: pick(doc),
      after: pick(after),
      ...(input.reminderDays ? { metadata: { reminderDays: input.reminderDays } } : {}),
    });
    return toDocumentDto(after, await documentActionsFor(principal, after));
  },

  /** Soft delete; objects are purged after DOCUMENT_RETENTION_DAYS (`purgeExpiredDocuments`). */
  async remove(id: string, reason?: string): Promise<void> {
    const { doc, principal } = await documentFor(id, 'delete');
    const now = new Date();
    const db = tenantDb();
    await db.document.update({
      where: { id: doc.id },
      data: {
        deletedAt: now,
        deletedById: principal.userId,
        purgeAfter: new Date(now.getTime() + env.DOCUMENT_RETENTION_DAYS * DAY),
      },
    });
    await db.documentExpiryReminder.updateMany({
      where: { documentId: doc.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    // A deleted logo stops being used by branding.
    await db.brandingProfile.updateMany({
      where: { logoFileId: doc.id },
      data: { logoFileId: null, logoStorageKey: null },
    });
    await audit.record({
      action: 'document.delete',
      entityType: 'document',
      entityId: doc.id,
      before: { title: doc.title, ownerType: doc.ownerType, ownerId: doc.ownerId },
      reason: reason ?? null,
      metadata: { retentionDays: env.DOCUMENT_RETENTION_DAYS },
    });
  },

  async expiring(
    query: ExpiringDocumentsQuery,
  ): Promise<{ items: ExpiringDocumentDto[]; total: number }> {
    const principal = currentPrincipal();
    const today = utcToday();
    const until = new Date(today.getTime() + query.withinDays * DAY);
    const where: Prisma.DocumentWhereInput = {
      AND: [
        await visibleDocumentsWhere(principal),
        {
          status: 'ACTIVE',
          expiryDate: query.includeExpired ? { not: null, lte: until } : { gte: today, lte: until },
          ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        },
      ],
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.document.findMany({
        where,
        orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db.document.count({ where }),
    ]);
    return {
      items: rows.map((d) => ({
        id: d.id,
        title: d.title,
        ownerType: d.ownerType,
        ownerId: d.ownerId,
        category: d.category as ExpiringDocumentDto['category'],
        documentType: d.documentType,
        institutionId: d.institutionId,
        expiryDate: d.expiryDate!.toISOString().slice(0, 10),
        daysRemaining: Math.round((d.expiryDate!.getTime() - today.getTime()) / DAY),
      })),
      total,
    };
  },

  // ---- Explicit grants -------------------------------------------------------------------

  async listGrants(id: string): Promise<DocumentGrantDto[]> {
    const { doc } = await documentFor(id, 'share');
    return doc.permissions.map(toGrantDto);
  },

  async createGrant(id: string, raw: CreateDocumentGrantInput): Promise<DocumentGrantDto> {
    const input = parseInput(createDocumentGrantSchema, raw);
    const { doc, principal } = await documentFor(id, 'share');
    const db = tenantDb();
    if (input.granteeType === 'USER') {
      const member = await db.organizationMembership.findFirst({
        where: { userId: input.userId! },
        select: { id: true },
      });
      if (!member) throw new InvalidReferenceError('userId', 'User');
    } else if (input.granteeType === 'ROLE') {
      const role = await db.role.findFirst({
        where: { key: input.roleKey! },
        select: { id: true },
      });
      if (!role) throw new InvalidReferenceError('roleKey', 'Role');
    } else if (input.scopeType !== 'ORGANIZATION') {
      const where = { where: { id: input.scopeId! }, select: { id: true } };
      const found =
        input.scopeType === 'GROUP'
          ? await db.group.findFirst(where)
          : input.scopeType === 'INSTITUTION'
            ? await db.institution.findFirst(where)
            : input.scopeType === 'CAMPUS'
              ? await db.campus.findFirst(where)
              : await db.department.findFirst(where);
      if (!found) throw new InvalidReferenceError('scopeId', input.scopeType!);
    }
    const actions = new Set<DocumentAction>(['view', ...input.actions]);
    const row = await db.documentPermission.create({
      data: withTenant({
        documentId: doc.id,
        granteeType: input.granteeType,
        userId: input.granteeType === 'USER' ? input.userId! : null,
        roleKey: input.granteeType === 'ROLE' ? input.roleKey! : null,
        scopeType: input.granteeType === 'SCOPE' ? input.scopeType! : null,
        scopeId:
          input.granteeType === 'SCOPE' && input.scopeType !== 'ORGANIZATION'
            ? input.scopeId!
            : null,
        ...Object.fromEntries(
          DOCUMENT_ACTIONS.map((a) => [GRANT_ACTION_COLUMNS[a], actions.has(a)]),
        ),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdById: principal.userId,
      }),
    });
    const dto = toGrantDto(row);
    await audit.record({
      action: 'document.share',
      entityType: 'document',
      entityId: doc.id,
      after: dto,
    });
    return dto;
  },

  async deleteGrant(id: string, grantId: string): Promise<void> {
    const { doc } = await documentFor(id, 'share');
    const grant = doc.permissions.find((g) => g.id === grantId);
    if (!grant) throw new NotFoundError('Document permission');
    await tenantDb().documentPermission.delete({ where: { id: grant.id } });
    await audit.record({
      action: 'document.unshare',
      entityType: 'document',
      entityId: doc.id,
      before: toGrantDto(grant),
    });
  },

  // ---- E-signature placeholder ----------------------------------------------------------

  async listSignatures(id: string): Promise<DocumentSignatureDto[]> {
    const { doc } = await documentFor(id, 'view');
    const rows = await tenantDb().documentSignature.findMany({
      where: { documentId: doc.id },
      orderBy: [{ signingOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toSignatureDto);
  },

  async requestSignature(
    id: string,
    raw: CreateSignatureRequestInput,
  ): Promise<DocumentSignatureDto> {
    const input = parseInput(createSignatureRequestSchema, raw);
    const { doc, principal } = await documentFor(id, 'view');
    await requireManage(principal, doc);
    const versionId = input.versionId ?? doc.currentVersionId;
    const version = versionId
      ? await tenantDb().documentVersion.findFirst({ where: { id: versionId, documentId: doc.id } })
      : null;
    if (!version) throw new InvalidReferenceError('versionId', 'Document version');
    if (input.signerUserId) {
      const member = await tenantDb().organizationMembership.findFirst({
        where: { userId: input.signerUserId },
        select: { id: true },
      });
      if (!member) throw new InvalidReferenceError('signerUserId', 'User');
    }
    const row = await tenantDb().documentSignature.create({
      data: withTenant({
        documentId: doc.id,
        versionId: version.id,
        signerUserId: input.signerUserId ?? null,
        signerName: input.signerName,
        signerEmail: input.signerEmail ?? null,
        signerRole: input.signerRole ?? null,
        signingOrder: input.signingOrder,
        createdById: principal.userId,
      }),
    });
    const dto = toSignatureDto(row);
    await audit.record({
      action: 'document.signature_request',
      entityType: 'document',
      entityId: doc.id,
      after: dto,
    });
    return dto;
  },

  /** Status update. The signer may sign/decline; managers may change any open request. */
  async updateSignature(
    id: string,
    signatureId: string,
    input: UpdateSignatureInput,
  ): Promise<DocumentSignatureDto> {
    const { doc, principal } = await documentFor(id, 'view');
    const sig = await tenantDb().documentSignature.findFirst({
      where: { id: signatureId, documentId: doc.id },
    });
    if (!sig) throw new NotFoundError('Signature request');
    const isSigner = !!principal.userId && sig.signerUserId === principal.userId;
    const signerTransition = input.status === 'SIGNED' || input.status === 'DECLINED';
    if (!(isSigner && signerTransition)) await requireManage(principal, doc);
    if (sig.status !== 'PENDING' && sig.status !== 'SENT') {
      throw new ConflictError(`Signature request is already ${sig.status}`);
    }
    const row = await tenantDb().documentSignature.update({
      where: { id: sig.id },
      data: {
        status: input.status,
        note: input.note ?? sig.note,
        respondedAt: signerTransition ? new Date() : sig.respondedAt,
      },
    });
    await audit.record({
      action: 'document.signature_update',
      entityType: 'document',
      entityId: doc.id,
      before: { signatureId: sig.id, status: sig.status },
      after: { signatureId: sig.id, status: row.status },
    });
    return toSignatureDto(row);
  },

  // ---- Trusted helpers for core / modules (caller authorized) ----------------------------

  /** Bytes of a document's current version (e.g. a logo embedded into a PDF). */
  async readCurrentVersion(
    documentId: string,
  ): Promise<{ version: DocumentVersion; body: Buffer } | null> {
    const doc = await tenantDb().document.findFirst({
      where: { id: documentId },
      include: { currentVersion: true },
    });
    const version = doc?.currentVersion;
    if (!version || version.purgedAt || version.scanStatus === 'INFECTED') return null;
    const provider = await storageForObject(version);
    return {
      version,
      body: await provider.getObject(version.storageKey, { versionId: version.storageVersionId }),
    };
  },

  /** Signed URL of a document's current version for a caller-authorized purpose (audited). */
  async currentVersionUrl(
    documentId: string,
    disposition: 'attachment' | 'inline' = 'inline',
  ): Promise<SignedUrlDto | null> {
    const doc = await tenantDb().document.findFirst({
      where: { id: documentId },
      include: { currentVersion: true },
    });
    if (!doc?.currentVersion || doc.currentVersion.purgedAt) return null;
    return issueDownloadUrl(doc, doc.currentVersion, disposition);
  },
};

function assertDownloadable(version: DocumentVersion) {
  if (version.scanStatus === 'PENDING') {
    throw new AppError(409, 'SCAN_PENDING', 'The file is still being scanned; try again shortly');
  }
  if (version.scanStatus === 'INFECTED') {
    throw new ForbiddenError('The file was flagged by the virus scanner', 'FILE_INFECTED');
  }
}

async function issueDownloadUrl(
  doc: Document,
  version: DocumentVersion,
  disposition: 'attachment' | 'inline',
): Promise<SignedUrlDto> {
  assertDownloadable(version);
  assertTenantKey(version.storageKey, currentOrganizationId());
  const provider = await storageForObject(version);
  const ttl = env.STORAGE_SIGNED_URL_TTL_SECONDS;
  const url = await provider.getSignedDownloadUrl(version.storageKey, {
    expiresInSeconds: ttl,
    fileName: version.fileName,
    contentType: version.mimeType,
    disposition,
    versionId: version.storageVersionId,
  });
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await audit.record({
    action: 'document.download',
    entityType: 'document',
    entityId: doc.id,
    metadata: {
      versionId: version.id,
      versionNumber: version.versionNumber,
      fileName: version.fileName,
      disposition,
      expiresAt,
    },
  });
  return {
    url,
    expiresAt,
    fileName: version.fileName,
    mimeType: version.mimeType,
    versionId: version.id,
  };
}

async function createTicket(input: {
  purpose: 'document.create' | 'document.version';
  documentId: string | null;
  owner: ResolvedOwner | { ownerType: string; ownerId: string; scope: Document };
  module: string;
  file: { fileName: string; mimeType: string; sizeBytes: number; checksumSha256?: string };
  payload: Record<string, unknown>;
}): Promise<UploadTicketDto> {
  const principal = currentPrincipal();
  const policy = documentUploadPolicy();
  const { mimeType } = validateDeclaredFile(input.file, policy);
  await assertWithinLimit('storage_bytes', input.file.sizeBytes);
  const scope = input.owner.scope;
  const storage = await storageForWrite(scope);
  const storageKey = buildObjectKey({
    organizationId: currentOrganizationId(),
    groupId: scope.groupId,
    institutionId: scope.institutionId,
    module: input.module,
    entity: input.owner.ownerType,
    entityId: input.owner.ownerId,
    fileName: input.file.fileName,
  });
  const ttl = env.STORAGE_UPLOAD_URL_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const signed = await storage.provider.getSignedUploadUrl(storageKey, {
    expiresInSeconds: ttl,
    contentType: mimeType,
    contentLength: input.file.sizeBytes,
    checksumSha256: input.file.checksumSha256,
  });
  const row = await tenantDb().storageUpload.create({
    data: withTenant({
      purpose: input.purpose,
      documentId: input.documentId,
      storageKey,
      storageBackend: storage.backend,
      storageSecretId: storage.secretId,
      fileName: input.file.fileName,
      mimeType,
      declaredSizeBytes: input.file.sizeBytes,
      declaredChecksum: input.file.checksumSha256 ?? null,
      payload: input.payload as Prisma.InputJsonValue,
      expiresAt,
      createdById: principal.userId,
    }),
  });
  await audit.record({
    action: 'storage.upload_request',
    entityType: 'storage_upload',
    entityId: row.id,
    metadata: {
      purpose: input.purpose,
      documentId: input.documentId,
      fileName: input.file.fileName,
      sizeBytes: input.file.sizeBytes,
    },
  });
  return {
    uploadId: row.id,
    method: signed.method,
    url: signed.url,
    headers: signed.headers,
    expiresAt: expiresAt.toISOString(),
    maxBytes: policy.maxBytes,
  };
}
