import { DOCUMENT_UPLOAD_TYPES } from '@erp/shared';
import { AppError, ValidationError } from '../http/errors';

export type UploadTypeMap = Record<string, readonly string[]>;

export interface UploadPolicy {
  types: UploadTypeMap;
  maxBytes: number;
}

export class FileTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super(413, 'FILE_TOO_LARGE', `File exceeds the maximum size of ${maxBytes} bytes`, {
      maxBytes,
    });
  }
}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * Validate a declared file against an allowlist (extension AND MIME type must both be allowed
 * and agree) and the size cap. Returns the canonical MIME type.
 */
export function validateDeclaredFile(
  file: { fileName: string; mimeType: string; sizeBytes: number },
  policy: UploadPolicy,
): { extension: string; mimeType: string } {
  const extension = fileExtension(file.fileName);
  const allowed = policy.types[extension];
  const mime = file.mimeType.toLowerCase().split(';')[0]!.trim();
  if (!allowed) {
    throw new ValidationError(`File type ".${extension || '?'}" is not allowed`, {
      code: 'FILE_TYPE_NOT_ALLOWED',
      allowed: Object.keys(policy.types),
    });
  }
  if (!allowed.includes(mime)) {
    throw new ValidationError(`MIME type "${mime}" does not match ".${extension}"`, {
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
  }
  if (file.sizeBytes <= 0) throw new ValidationError('File is empty');
  if (file.sizeBytes > policy.maxBytes) throw new FileTooLargeError(policy.maxBytes);
  return { extension, mimeType: allowed[0]! };
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Magic-byte check of the actual content against the declared extension. */
export function contentMatchesExtension(buf: Buffer, extension: string): boolean {
  switch (extension) {
    case 'pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'webp':
      return (
        startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'docx':
    case 'xlsx':
      return startsWith(buf, ZIP);
    case 'doc':
    case 'xls':
      return startsWith(buf, OLE);
    case 'csv':
    case 'txt':
      return !buf.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}

export function assertContentMatches(buf: Buffer, extension: string): void {
  if (!contentMatchesExtension(buf, extension)) {
    throw new ValidationError(`File content does not match ".${extension}"`, {
      code: 'FILE_TYPE_MISMATCH',
    });
  }
}

export const DEFAULT_DOCUMENT_TYPES: UploadTypeMap = DOCUMENT_UPLOAD_TYPES;
