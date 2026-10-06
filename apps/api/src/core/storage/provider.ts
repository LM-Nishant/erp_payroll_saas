/**
 * Object storage abstraction (spec §29–§31). Implementations: S3 (production), filesystem
 * (dev) and memory (tests). Objects are always PRIVATE — access is only ever granted through
 * short-lived signed URLs issued after authorization. Keys are server generated (keys.ts).
 */

export interface ObjectInfo {
  key: string;
  sizeBytes: number;
  contentType: string | null;
  /** Hex SHA-256 when the backend knows it (S3 additional checksums, local providers). */
  checksumSha256: string | null;
  /** Object version id for versioned buckets (S3); null otherwise. */
  versionId: string | null;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /** Hex SHA-256 of `body`; the backend verifies it when supported. */
  checksumSha256?: string;
}

export interface ObjectRef {
  /** Specific object version (versioned buckets). */
  versionId?: string | null;
}

export interface SignedDownloadOptions extends ObjectRef {
  expiresInSeconds: number;
  fileName: string;
  contentType: string;
  disposition: 'attachment' | 'inline';
}

export interface SignedUploadOptions {
  expiresInSeconds: number;
  contentType: string;
  contentLength: number;
  /** Hex SHA-256 the uploaded bytes must match (enforced by S3 when given). */
  checksumSha256?: string;
}

export interface SignedUpload {
  method: 'PUT';
  url: string;
  /** Headers the client MUST send with the PUT. */
  headers: Record<string, string>;
}

export interface StorageProvider {
  /** `s3`, `local` or `memory`. */
  readonly driver: string;
  putObject(input: PutObjectInput): Promise<ObjectInfo>;
  getObject(key: string, ref?: ObjectRef): Promise<Buffer>;
  /** Null when the object does not exist. */
  headObject(key: string, ref?: ObjectRef): Promise<ObjectInfo | null>;
  deleteObject(key: string, ref?: ObjectRef): Promise<void>;
  copyObject(sourceKey: string, destinationKey: string, ref?: ObjectRef): Promise<ObjectInfo>;
  getSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string>;
  getSignedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUpload>;
}
