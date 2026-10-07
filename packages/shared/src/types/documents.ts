import type {
  DocumentAction,
  DocumentCategory,
  DocumentConfidentiality,
  DocumentGranteeType,
  DocumentScanStatus,
  DocumentSignatureStatus,
  DocumentStatus,
} from '../schemas/documents';
import type { ScopeType } from '../auth/permissions';

export interface DocumentVersionDto {
  id: string;
  documentId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  scanStatus: DocumentScanStatus;
  reason: string | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  previousVersionId: string | null;
  restoredFromVersionId: string | null;
  isCurrent: boolean;
  createdAt: string;
}

export interface DocumentDto {
  id: string;
  ownerType: string;
  ownerId: string;
  module: string;
  category: DocumentCategory;
  documentType: string | null;
  title: string;
  description: string | null;
  confidentiality: DocumentConfidentiality;
  status: DocumentStatus;
  groupId: string | null;
  institutionId: string | null;
  campusId: string | null;
  departmentId: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  reminderDays: number[];
  metadata: Record<string, unknown> | null;
  currentVersion: DocumentVersionDto | null;
  /** Actions the CURRENT principal may perform on this document. */
  allowedActions: DocumentAction[];
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DocumentGrantDto {
  id: string;
  documentId: string;
  granteeType: DocumentGranteeType;
  userId: string | null;
  roleKey: string | null;
  scopeType: ScopeType | null;
  scopeId: string | null;
  actions: DocumentAction[];
  expiresAt: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface DocumentSignatureDto {
  id: string;
  documentId: string;
  versionId: string;
  signerUserId: string | null;
  signerName: string;
  signerEmail: string | null;
  signerRole: string | null;
  signingOrder: number;
  status: DocumentSignatureStatus;
  note: string | null;
  respondedAt: string | null;
  createdAt: string;
}

/** Response of a signed-URL upload request: PUT the bytes to `url` with `headers`. */
export interface UploadTicketDto {
  uploadId: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}

export interface SignedUrlDto {
  url: string;
  expiresAt: string;
  fileName: string;
  mimeType: string;
  versionId: string;
}

export interface ExpiringDocumentDto {
  id: string;
  title: string;
  ownerType: string;
  ownerId: string;
  category: DocumentCategory;
  documentType: string | null;
  institutionId: string | null;
  expiryDate: string;
  daysRemaining: number;
}

export interface PdfTemplateDto {
  key: string;
  version: number;
  name: string;
  description: string;
  defaultCategory: DocumentCategory;
  defaultDocumentType: string;
}
