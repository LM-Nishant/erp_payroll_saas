import { createHash } from 'node:crypto';
import type { DocumentScanStatus } from '@erp/shared';
import { AppError } from '../http/errors';
import { consumeLimit, releaseLimit } from '../features/limits';
import { logger } from '../logger';
import { currentOrganizationId } from '../tenancy/context';
import {
  assertContentMatches,
  buildObjectKey,
  storageForObject,
  storageForWrite,
  validateDeclaredFile,
  virusScanner,
  type StorageProvider,
  type UploadPolicy,
} from '../storage';
import type { OwnerScope } from './owners';

export const sha256Hex = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

export interface IncomingFile {
  fileName: string;
  mimeType: string;
  body: Buffer;
}

/** An object written to storage (and counted against `storage_bytes`), not yet in the DB. */
export interface StoredObject {
  storageKey: string;
  storageBackend: string;
  storageSecretId: string | null;
  storageVersionId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  scanStatus: DocumentScanStatus;
}

export class FileInfectedError extends AppError {
  constructor() {
    super(422, 'FILE_INFECTED', 'The file was rejected by the virus scanner');
  }
}

export interface ObjectTarget {
  scope: OwnerScope;
  module: string;
  entity: string;
  entityId: string;
}

/** Run the virus-scan hook; an INFECTED result discards the object and throws 422. */
async function scan(stored: StoredObject, provider: StorageProvider, body: Buffer) {
  const status = await virusScanner().scan({
    organizationId: currentOrganizationId(),
    key: stored.storageKey,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    read: async () => body,
  });
  if (status === 'INFECTED') {
    await discardObject(stored, provider);
    throw new FileInfectedError();
  }
  return status;
}

/**
 * Validate (allowlist, size, magic bytes), reserve `storage_bytes`, write the object under a
 * server-generated tenant key and run the virus-scan hook.
 */
export async function writeObject(
  target: ObjectTarget,
  file: IncomingFile,
  policy: UploadPolicy,
): Promise<StoredObject> {
  const { extension, mimeType } = validateDeclaredFile(
    { fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.body.length },
    policy,
  );
  assertContentMatches(file.body, extension);
  const storage = await storageForWrite(target.scope);
  const storageKey = buildObjectKey({
    organizationId: currentOrganizationId(),
    groupId: target.scope.groupId,
    institutionId: target.scope.institutionId,
    module: target.module,
    entity: target.entity,
    entityId: target.entityId,
    fileName: file.fileName,
  });
  const checksumSha256 = sha256Hex(file.body);
  await consumeLimit('storage_bytes', file.body.length);
  let info;
  try {
    info = await storage.provider.putObject({
      key: storageKey,
      body: file.body,
      contentType: mimeType,
      checksumSha256,
    });
  } catch (err) {
    await releaseLimit('storage_bytes', file.body.length);
    throw err;
  }
  const stored: StoredObject = {
    storageKey,
    storageBackend: storage.backend,
    storageSecretId: storage.secretId,
    storageVersionId: info.versionId,
    fileName: file.fileName.trim(),
    mimeType,
    sizeBytes: file.body.length,
    checksumSha256,
    scanStatus: 'PENDING',
  };
  stored.scanStatus = await scan(stored, storage.provider, file.body);
  return stored;
}

/**
 * Accept an object a client uploaded through a signed URL: it was already written, so verify
 * it (size, checksum, magic bytes), then reserve `storage_bytes` and scan.
 */
export async function acceptUploadedObject(
  stored: Omit<StoredObject, 'scanStatus'>,
  provider: StorageProvider,
  body: Buffer,
): Promise<StoredObject> {
  await consumeLimit('storage_bytes', stored.sizeBytes);
  const full: StoredObject = { ...stored, scanStatus: 'PENDING' };
  full.scanStatus = await scan(full, provider, body);
  return full;
}

/** Copy an existing object to a new key (restore) — same provider when possible. */
export async function copyStoredObject(
  source: StoredObject & { storageVersionId: string | null },
  target: ObjectTarget,
): Promise<StoredObject> {
  const from = await storageForObject(source);
  const to = await storageForWrite(target.scope);
  const storageKey = buildObjectKey({
    organizationId: currentOrganizationId(),
    groupId: target.scope.groupId,
    institutionId: target.scope.institutionId,
    module: target.module,
    entity: target.entity,
    entityId: target.entityId,
    fileName: source.fileName,
  });
  await consumeLimit('storage_bytes', source.sizeBytes);
  try {
    const sameBackend =
      to.backend === source.storageBackend && to.secretId === source.storageSecretId;
    const info = sameBackend
      ? await from.copyObject(source.storageKey, storageKey, {
          versionId: source.storageVersionId,
        })
      : await to.provider.putObject({
          key: storageKey,
          body: await from.getObject(source.storageKey, { versionId: source.storageVersionId }),
          contentType: source.mimeType,
          checksumSha256: source.checksumSha256,
        });
    return {
      ...source,
      storageKey,
      storageBackend: to.backend,
      storageSecretId: to.secretId,
      storageVersionId: info.versionId,
    };
  } catch (err) {
    await releaseLimit('storage_bytes', source.sizeBytes);
    throw err;
  }
}

/** Compensation: delete the object and give the bytes back (failed DB writes, rejections). */
export async function discardObject(stored: StoredObject, provider?: StorageProvider) {
  try {
    const p = provider ?? (await storageForObject(stored));
    await p.deleteObject(stored.storageKey, { versionId: stored.storageVersionId });
  } catch (err) {
    logger.error({ err, key: stored.storageKey }, 'Failed to delete discarded object');
  }
  await releaseLimit('storage_bytes', stored.sizeBytes).catch((err: unknown) =>
    logger.error({ err }, 'Failed to release storage reservation'),
  );
}
