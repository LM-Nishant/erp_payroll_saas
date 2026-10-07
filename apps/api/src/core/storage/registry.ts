import { env } from '../config/env';
import { ValidationError } from '../http/errors';
import { logger } from '../logger';
import { getSecret, getSecretById, type SecretValue } from '../secrets';
import { FilesystemStorageProvider, MemoryStorageProvider } from './local-providers';
import type { StorageProvider } from './provider';
import { S3StorageProvider, type S3ProviderConfig } from './s3';

/** Path of the local signed-URL endpoint (mounted in app.ts before authentication). */
export const LOCAL_STORAGE_ROUTE = '/api/v1/storage/local';

/** `platform` = env-configured storage; `tenant` = the organization's `storage` secret. */
export type StorageBackend = 'platform' | 'tenant';

export interface ResolvedStorage {
  provider: StorageProvider;
  backend: StorageBackend;
  secretId: string | null;
}

const localProviders = new Map<string, MemoryStorageProvider | FilesystemStorageProvider>();
let platformProvider: StorageProvider | null = null;

function localUrlPrefix() {
  return `${env.STORAGE_PUBLIC_BASE_URL ?? ''}${LOCAL_STORAGE_ROUTE}`;
}

function createPlatformProvider(): StorageProvider {
  const local = { signingSecret: env.STORAGE_LOCAL_SIGNING_SECRET, urlPrefix: localUrlPrefix() };
  switch (env.STORAGE_DRIVER) {
    case 'memory': {
      const p = new MemoryStorageProvider({ ...local, id: 'memory' });
      localProviders.set('memory', p);
      return p;
    }
    case 'local': {
      const p = new FilesystemStorageProvider({ ...local, id: 'local' }, env.STORAGE_LOCAL_DIR);
      localProviders.set('local', p);
      return p;
    }
    case 's3':
      return new S3StorageProvider({
        bucket: env.STORAGE_S3_BUCKET!,
        region: env.STORAGE_S3_REGION,
        endpoint: env.STORAGE_S3_ENDPOINT,
        forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
        credentials:
          env.STORAGE_S3_ACCESS_KEY_ID && env.STORAGE_S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
                secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
              }
            : undefined,
        sse: env.STORAGE_S3_SSE,
        kmsKeyId: env.STORAGE_S3_KMS_KEY_ID,
      });
  }
}

/** The platform (env-configured) provider. */
export function platformStorage(): StorageProvider {
  platformProvider ??= createPlatformProvider();
  return platformProvider;
}

/** Local provider instance by id (used by the signed-URL route). */
export function localProvider(id: string) {
  platformStorage();
  return localProviders.get(id) ?? null;
}

/**
 * Builds a provider from an organization `storage` secret. Value: JSON
 * `{"accessKeyId":"…","secretAccessKey":"…"}`; metadata: `{provider:"s3", bucket, region,
 * endpoint?, forcePathStyle?, sse?, kmsKeyId?}`. Replaceable for tests.
 */
export type TenantStorageFactory = (secret: SecretValue) => StorageProvider;

export const defaultTenantStorageFactory: TenantStorageFactory = (secret) => {
  const meta = secret.meta.metadata ?? {};
  if ((meta.provider ?? 's3') !== 's3' || typeof meta.bucket !== 'string') {
    throw new ValidationError('The storage secret must have metadata provider "s3" and a bucket');
  }
  let credentials: S3ProviderConfig['credentials'];
  try {
    const parsed = JSON.parse(secret.reveal()) as Record<string, unknown>;
    if (typeof parsed.accessKeyId === 'string' && typeof parsed.secretAccessKey === 'string') {
      credentials = { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.secretAccessKey };
    }
  } catch {
    // fall through
  }
  if (!credentials) {
    throw new ValidationError('The storage secret value must be {accessKeyId, secretAccessKey}');
  }
  return new S3StorageProvider({
    bucket: meta.bucket,
    region: typeof meta.region === 'string' ? meta.region : env.STORAGE_S3_REGION,
    endpoint: typeof meta.endpoint === 'string' ? meta.endpoint : undefined,
    forcePathStyle: meta.forcePathStyle === true || meta.forcePathStyle === 'true',
    credentials,
    sse: meta.sse === 'aws:kms' ? 'aws:kms' : 'AES256',
    kmsKeyId: typeof meta.kmsKeyId === 'string' ? meta.kmsKeyId : undefined,
  });
};

let tenantFactory: TenantStorageFactory = defaultTenantStorageFactory;

/** Test / extension hooks. */
export function setPlatformStorage(provider: StorageProvider | null): void {
  platformProvider = provider;
}
export function setTenantStorageFactory(factory: TenantStorageFactory | null): void {
  tenantFactory = factory ?? defaultTenantStorageFactory;
}

/**
 * Storage for NEW objects of the current tenant at a hierarchy level: the most specific
 * `storage` secret (institution → group → organization) wins, else platform storage.
 */
export async function storageForWrite(target: {
  institutionId?: string | null;
  groupId?: string | null;
}): Promise<ResolvedStorage> {
  const secret = await getSecret({
    kind: 'storage',
    institutionId: target.institutionId,
    groupId: target.groupId,
    purpose: 'storage.write',
  });
  if (!secret) return { provider: platformStorage(), backend: 'platform', secretId: null };
  return { provider: tenantFactory(secret), backend: 'tenant', secretId: secret.meta.id };
}

/** Storage holding an EXISTING object (as recorded on its version / upload row). */
export async function storageForObject(ref: {
  storageBackend: string;
  storageSecretId: string | null;
}): Promise<StorageProvider> {
  if (ref.storageBackend !== 'tenant') return platformStorage();
  const secret = ref.storageSecretId
    ? await getSecretById({ id: ref.storageSecretId, purpose: 'storage.read' })
    : null;
  if (!secret) {
    logger.error({ secretRef: ref.storageSecretId }, 'Storage secret for object is missing');
    throw new Error('Storage configuration for this object is no longer available');
  }
  return tenantFactory(secret);
}
