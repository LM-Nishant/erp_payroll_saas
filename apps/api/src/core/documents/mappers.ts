import {
  DOCUMENT_ACTIONS,
  type DocumentAction,
  type DocumentCategory,
  type DocumentDto,
  type DocumentGrantDto,
  type DocumentSignatureDto,
  type DocumentVersionDto,
} from '@erp/shared';
import type {
  Document,
  DocumentExpiryReminder,
  DocumentPermission,
  DocumentSignature,
  DocumentVersion,
} from '@prisma/client';
import { GRANT_ACTION_COLUMNS } from './access';

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toVersionDto(
  v: DocumentVersion,
  currentVersionId: string | null,
  names: ReadonlyMap<string, string> = new Map(),
): DocumentVersionDto {
  return {
    id: v.id,
    documentId: v.documentId,
    versionNumber: v.versionNumber,
    fileName: v.fileName,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    checksumSha256: v.checksumSha256,
    scanStatus: v.scanStatus,
    reason: v.reason,
    uploadedById: v.uploadedById,
    uploadedByName: v.uploadedById ? (names.get(v.uploadedById) ?? null) : null,
    previousVersionId: v.previousVersionId,
    restoredFromVersionId: v.restoredFromVersionId,
    isCurrent: v.id === currentVersionId,
    createdAt: v.createdAt.toISOString(),
  };
}

export type DocumentWithRelations = Document & {
  currentVersion: DocumentVersion | null;
  permissions: DocumentPermission[];
  reminders: DocumentExpiryReminder[];
};

export function toDocumentDto(
  d: DocumentWithRelations,
  allowed: ReadonlySet<DocumentAction>,
  names?: ReadonlyMap<string, string>,
): DocumentDto {
  return {
    id: d.id,
    ownerType: d.ownerType,
    ownerId: d.ownerId,
    module: d.module,
    category: d.category as DocumentCategory,
    documentType: d.documentType,
    title: d.title,
    description: d.description,
    confidentiality: d.confidentiality,
    status: d.status,
    groupId: d.groupId,
    institutionId: d.institutionId,
    campusId: d.campusId,
    departmentId: d.departmentId,
    issueDate: date(d.issueDate),
    expiryDate: date(d.expiryDate),
    reminderDays: d.reminders
      .filter((r) => r.status !== 'CANCELLED')
      .map((r) => r.daysBefore)
      .sort((a, b) => b - a),
    metadata: (d.metadata as Record<string, unknown> | null) ?? null,
    currentVersion: d.currentVersion
      ? toVersionDto(d.currentVersion, d.currentVersionId, names)
      : null,
    allowedActions: DOCUMENT_ACTIONS.filter((a) => allowed.has(a)),
    createdById: d.createdById,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    deletedAt: d.deletedAt?.toISOString() ?? null,
  };
}

export function toGrantDto(g: DocumentPermission): DocumentGrantDto {
  return {
    id: g.id,
    documentId: g.documentId,
    granteeType: g.granteeType,
    userId: g.userId,
    roleKey: g.roleKey,
    scopeType: g.scopeType,
    scopeId: g.scopeId,
    actions: DOCUMENT_ACTIONS.filter((a) => g[GRANT_ACTION_COLUMNS[a]]),
    expiresAt: g.expiresAt?.toISOString() ?? null,
    createdById: g.createdById,
    createdAt: g.createdAt.toISOString(),
  };
}

export function toSignatureDto(s: DocumentSignature): DocumentSignatureDto {
  return {
    id: s.id,
    documentId: s.documentId,
    versionId: s.versionId,
    signerUserId: s.signerUserId,
    signerName: s.signerName,
    signerEmail: s.signerEmail,
    signerRole: s.signerRole,
    signingOrder: s.signingOrder,
    status: s.status,
    note: s.note,
    respondedAt: s.respondedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}
