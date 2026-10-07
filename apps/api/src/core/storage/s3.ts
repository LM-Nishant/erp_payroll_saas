import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectInfo,
  ObjectRef,
  PutObjectInput,
  SignedDownloadOptions,
  SignedUpload,
  SignedUploadOptions,
  StorageProvider,
} from './provider';

export interface S3ProviderConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Server-side encryption applied to every object. */
  sse: 'AES256' | 'aws:kms';
  kmsKeyId?: string;
}

/** Minimal client surface (lets tests inject a mock). */
export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export type Presigner = (
  client: S3LikeClient,
  command: PutObjectCommand | GetObjectCommand,
  options: { expiresIn: number; signableHeaders?: Set<string>; unhoistableHeaders?: Set<string> },
) => Promise<string>;

const hexToB64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
const b64ToHex = (b64: string) => Buffer.from(b64, 'base64').toString('hex');

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 file name. */
export function contentDisposition(disposition: 'attachment' | 'inline', fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * Amazon S3 (or S3-compatible) provider. The bucket must be PRIVATE (block public access) with
 * versioning enabled; every object is written with server-side encryption and a SHA-256
 * additional checksum. Signed URLs are short-lived and bound to content type / length.
 */
export class S3StorageProvider implements StorageProvider {
  readonly driver = 's3';
  private readonly client: S3LikeClient;
  private readonly presign: Presigner;

  constructor(
    private readonly config: S3ProviderConfig,
    deps: { client?: S3LikeClient; presign?: Presigner } = {},
  ) {
    const clientConfig: S3ClientConfig = {
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(config.credentials ? { credentials: config.credentials } : {}),
    };
    this.client = deps.client ?? new S3Client(clientConfig);
    this.presign =
      deps.presign ??
      ((client, command, options) => getSignedUrl(client as S3Client, command, options));
  }

  get bucket(): string {
    return this.config.bucket;
  }

  private sseParams() {
    return {
      ServerSideEncryption: this.config.sse,
      ...(this.config.sse === 'aws:kms' && this.config.kmsKeyId
        ? { SSEKMSKeyId: this.config.kmsKeyId }
        : {}),
    } as const;
  }

  private sseHeaders(): Record<string, string> {
    return {
      'x-amz-server-side-encryption': this.config.sse,
      ...(this.config.sse === 'aws:kms' && this.config.kmsKeyId
        ? { 'x-amz-server-side-encryption-aws-kms-key-id': this.config.kmsKeyId }
        : {}),
    };
  }

  async putObject(input: PutObjectInput): Promise<ObjectInfo> {
    const out = (await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.length,
        ...(input.checksumSha256
          ? { ChecksumSHA256: hexToB64(input.checksumSha256) }
          : { ChecksumAlgorithm: 'SHA256' as const }),
        ...this.sseParams(),
      }),
    )) as { VersionId?: string; ChecksumSHA256?: string };
    return {
      key: input.key,
      sizeBytes: input.body.length,
      contentType: input.contentType,
      checksumSha256: out.ChecksumSHA256 ? b64ToHex(out.ChecksumSHA256) : null,
      versionId: out.VersionId ?? null,
    };
  }

  async getObject(key: string, ref?: ObjectRef): Promise<Buffer> {
    const out = (await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(ref?.versionId ? { VersionId: ref.versionId } : {}),
      }),
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
    if (!out.Body) throw new Error('Empty object body');
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async headObject(key: string, ref?: ObjectRef): Promise<ObjectInfo | null> {
    try {
      const out = (await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ChecksumMode: 'ENABLED',
          ...(ref?.versionId ? { VersionId: ref.versionId } : {}),
        }),
      )) as {
        ContentLength?: number;
        ContentType?: string;
        ChecksumSHA256?: string;
        VersionId?: string;
      };
      // Composite (multipart) checksums look like "<b64>-<parts>" and are not a file digest.
      const checksum =
        out.ChecksumSHA256 && !out.ChecksumSHA256.includes('-')
          ? b64ToHex(out.ChecksumSHA256)
          : null;
      return {
        key,
        sizeBytes: out.ContentLength ?? 0,
        contentType: out.ContentType ?? null,
        checksumSha256: checksum,
        versionId: out.VersionId ?? null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string, ref?: ObjectRef): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(ref?.versionId ? { VersionId: ref.versionId } : {}),
      }),
    );
  }

  async copyObject(sourceKey: string, destinationKey: string, ref?: ObjectRef) {
    const source =
      `${this.config.bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}` +
      (ref?.versionId ? `?versionId=${encodeURIComponent(ref.versionId)}` : '');
    const out = (await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: destinationKey,
        CopySource: source,
        MetadataDirective: 'COPY',
        ChecksumAlgorithm: 'SHA256',
        ...this.sseParams(),
      }),
    )) as { VersionId?: string; CopyObjectResult?: { ChecksumSHA256?: string } };
    const head = await this.headObject(destinationKey, { versionId: out.VersionId ?? null });
    if (!head) throw new Error('Copied object not found');
    return head;
  }

  async getSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string> {
    return this.presign(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(options.versionId ? { VersionId: options.versionId } : {}),
        ResponseContentType: options.contentType,
        ResponseContentDisposition: contentDisposition(options.disposition, options.fileName),
        ResponseCacheControl: 'private, no-store',
      }),
      { expiresIn: options.expiresInSeconds },
    );
  }

  async getSignedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUpload> {
    const checksumHeader: Record<string, string> = options.checksumSha256
      ? { 'x-amz-checksum-sha256': hexToB64(options.checksumSha256) }
      : {};
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      ...(options.checksumSha256 ? { ChecksumSHA256: hexToB64(options.checksumSha256) } : {}),
      ...this.sseParams(),
    });
    const sseHeaders = this.sseHeaders();
    const url = await this.presign(this.client, command, {
      expiresIn: options.expiresInSeconds,
      // Bind the URL to the declared type/length; SSE + checksum must be sent as headers.
      signableHeaders: new Set(['content-type', 'content-length']),
      unhoistableHeaders: new Set([...Object.keys(sseHeaders), ...Object.keys(checksumHeader)]),
    });
    return {
      method: 'PUT',
      url,
      headers: { 'Content-Type': options.contentType, ...sseHeaders, ...checksumHeader },
    };
  }
}
