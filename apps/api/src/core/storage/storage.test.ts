import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { assertTenantKey, buildObjectKey, sanitizeFileName } from './keys';
import { signLocalToken, verifyLocalToken } from './local-signing';
import { FilesystemStorageProvider, MemoryStorageProvider } from './local-providers';
import { contentMatchesExtension, validateDeclaredFile } from './policy';
import { S3StorageProvider, contentDisposition, type S3LikeClient } from './s3';

const ORG = '11111111-1111-4111-8111-111111111111';
const INST = '22222222-2222-4222-8222-222222222222';
const ENTITY = '33333333-3333-4333-8333-333333333333';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

describe('storage keys', () => {
  it('builds tenant-isolated keys from trusted parts only', () => {
    const key = buildObjectKey({
      organizationId: ORG,
      institutionId: INST,
      module: 'documents',
      entity: 'employee',
      entityId: ENTITY,
      fileName: '../../etc/Pässwörd file?.PDF',
    });
    expect(key).toMatch(
      new RegExp(
        `^org/${ORG}/inst/${INST}/documents/employee/${ENTITY}/[0-9a-f-]{36}-Password-file\\.pdf$`,
      ),
    );
    expect(key.endsWith('.pdf')).toBe(true);
    expect(key).not.toContain('..');
    expect(() => assertTenantKey(key, ORG)).not.toThrow();
    expect(() => assertTenantKey(key, ENTITY)).toThrow();
    expect(() => assertTenantKey(`org/${ORG}/../x`, ORG)).toThrow();
  });

  it('uses group / shared levels and rejects malformed segments', () => {
    const base = {
      organizationId: ORG,
      module: 'branding',
      entity: 'organization',
      entityId: ORG,
      fileName: 'a.png',
    };
    expect(buildObjectKey(base)).toContain(`org/${ORG}/shared/branding/`);
    expect(buildObjectKey({ ...base, groupId: INST })).toContain(`/group/${INST}/`);
    expect(() => buildObjectKey({ ...base, module: '../x' })).toThrow();
    expect(() => buildObjectKey({ ...base, entityId: 'not-an-id' })).toThrow();
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('C:\\Users\\me\\My Résumé (final).docx')).toBe('My-Resume-final.docx');
    expect(sanitizeFileName('.....')).toBe('file');
  });
});

describe('upload policy', () => {
  const policy = { types: { pdf: ['application/pdf'], png: ['image/png'] }, maxBytes: 100 };

  it('requires an allowed extension, an agreeing MIME type and the size cap', () => {
    expect(
      validateDeclaredFile(
        { fileName: 'a.PDF', mimeType: 'application/pdf', sizeBytes: 10 },
        policy,
      ),
    ).toEqual({
      extension: 'pdf',
      mimeType: 'application/pdf',
    });
    expect(() =>
      validateDeclaredFile(
        { fileName: 'a.exe', mimeType: 'application/pdf', sizeBytes: 10 },
        policy,
      ),
    ).toThrow(/not allowed/);
    expect(() =>
      validateDeclaredFile({ fileName: 'a.pdf', mimeType: 'image/png', sizeBytes: 10 }, policy),
    ).toThrow();
    expect(() =>
      validateDeclaredFile(
        { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 101 },
        policy,
      ),
    ).toThrow();
  });

  it('sniffs magic bytes', () => {
    expect(contentMatchesExtension(Buffer.from('%PDF-1.7\n'), 'pdf')).toBe(true);
    expect(contentMatchesExtension(Buffer.from('<html>'), 'pdf')).toBe(false);
    expect(contentMatchesExtension(PNG, 'png')).toBe(true);
    expect(contentMatchesExtension(Buffer.from('%PDF-'), 'png')).toBe(false);
  });
});

describe('local signed tokens', () => {
  const payload = {
    p: 'memory',
    op: 'get' as const,
    key: 'org/x/a',
    exp: 2_000_000_000,
    ct: 'text/plain',
  };

  it('round-trips and rejects tampering, other secrets and expiry', () => {
    const token = signLocalToken(payload, 's3cret');
    expect(verifyLocalToken(token, 's3cret', 1_000)).toMatchObject({ key: 'org/x/a' });
    expect(verifyLocalToken(token, 'other', 1_000)).toBeNull();
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, key: 'org/y/a' })).toString(
      'base64url',
    );
    expect(verifyLocalToken(`${forged}.${mac}`, 's3cret', 1_000)).toBeNull();
    expect(verifyLocalToken(`${body}.${mac}`, 's3cret', 2_000_000_001_000)).toBeNull();
  });
});

describe('local providers', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it.each(['memory', 'local'])(
    '%s provider stores, verifies checksums, copies and deletes',
    async (kind) => {
      const options = { id: kind, signingSecret: 'x'.repeat(32), urlPrefix: 'http://api/storage' };
      let provider: MemoryStorageProvider | FilesystemStorageProvider;
      if (kind === 'memory') provider = new MemoryStorageProvider(options);
      else {
        const dir = await mkdtemp(path.join(tmpdir(), 'erp-storage-'));
        dirs.push(dir);
        provider = new FilesystemStorageProvider(options, dir);
      }
      const body = Buffer.from('hello');
      await expect(
        provider.putObject({
          key: `org/${ORG}/a.txt`,
          body,
          contentType: 'text/plain',
          checksumSha256: sha(Buffer.from('x')),
        }),
      ).rejects.toThrow(/Checksum/);
      const info = await provider.putObject({
        key: `org/${ORG}/a.txt`,
        body,
        contentType: 'text/plain',
      });
      expect(info).toMatchObject({ sizeBytes: 5, checksumSha256: sha(body) });
      expect((await provider.getObject(`org/${ORG}/a.txt`)).toString()).toBe('hello');
      await provider.copyObject(`org/${ORG}/a.txt`, `org/${ORG}/b.txt`);
      expect(await provider.headObject(`org/${ORG}/b.txt`)).toMatchObject({ sizeBytes: 5 });
      await provider.deleteObject(`org/${ORG}/a.txt`);
      expect(await provider.headObject(`org/${ORG}/a.txt`)).toBeNull();

      const url = await provider.getSignedDownloadUrl(`org/${ORG}/b.txt`, {
        expiresInSeconds: 60,
        fileName: 'b.txt',
        contentType: 'text/plain',
        disposition: 'attachment',
      });
      const token = url.slice('http://api/storage/'.length);
      expect(verifyLocalToken(token, options.signingSecret)).toMatchObject({
        op: 'get',
        key: `org/${ORG}/b.txt`,
      });
    },
  );

  it('filesystem provider refuses path traversal', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'erp-storage-'));
    dirs.push(dir);
    const provider = new FilesystemStorageProvider(
      { id: 'l', signingSecret: 'x'.repeat(32), urlPrefix: 'u' },
      dir,
    );
    await expect(
      provider.putObject({
        key: '../../escape.txt',
        body: Buffer.from('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow();
  });
});

describe('S3 provider (mocked client)', () => {
  const config = {
    bucket: 'erp-docs',
    region: 'ap-south-1',
    sse: 'aws:kms' as const,
    kmsKeyId: 'kms-1',
  };
  const body = Buffer.from('%PDF-1.7 test');
  const b64 = Buffer.from(sha(body), 'hex').toString('base64');

  const mockClient = () => {
    const send = vi.fn(async (command: unknown): Promise<Record<string, unknown>> => {
      if (command instanceof PutObjectCommand) return { VersionId: 'v1', ChecksumSHA256: b64 };
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === 'missing') {
          throw Object.assign(new Error('nf'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          });
        }
        return {
          ContentLength: body.length,
          ContentType: 'application/pdf',
          ChecksumSHA256: b64,
          VersionId: command.input.VersionId ?? 'v2',
        };
      }
      if (command instanceof GetObjectCommand)
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      if (command instanceof CopyObjectCommand) return { VersionId: 'v9' };
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error('unexpected command');
    });
    return { send } satisfies S3LikeClient;
  };

  it('puts objects with SSE-KMS and a SHA-256 checksum and maps the response', async () => {
    const client = mockClient();
    const s3 = new S3StorageProvider(config, { client });
    const info = await s3.putObject({
      key: 'org/k',
      body,
      contentType: 'application/pdf',
      checksumSha256: sha(body),
    });
    const cmd = client.send.mock.calls[0]![0] as PutObjectCommand;
    expect(cmd.input).toMatchObject({
      Bucket: 'erp-docs',
      Key: 'org/k',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'kms-1',
      ChecksumSHA256: b64,
      ContentLength: body.length,
    });
    expect(cmd.input).not.toHaveProperty('ACL');
    expect(info).toEqual({
      key: 'org/k',
      sizeBytes: body.length,
      contentType: 'application/pdf',
      checksumSha256: sha(body),
      versionId: 'v1',
    });
  });

  it('heads (null when missing, ignores composite checksums), gets, deletes versions and copies', async () => {
    const client = mockClient();
    const s3 = new S3StorageProvider({ ...config, sse: 'AES256' }, { client });
    expect(await s3.headObject('missing')).toBeNull();
    expect(await s3.headObject('org/k', { versionId: 'v1' })).toMatchObject({
      checksumSha256: sha(body),
      versionId: 'v1',
    });
    const head = client.send.mock.calls[1]![0] as HeadObjectCommand;
    expect(head.input).toMatchObject({ ChecksumMode: 'ENABLED', VersionId: 'v1' });

    client.send.mockResolvedValueOnce({ ContentLength: 3, ChecksumSHA256: `${b64}-3` });
    expect((await s3.headObject('org/k'))?.checksumSha256).toBeNull();

    expect((await s3.getObject('org/k')).equals(body)).toBe(true);
    await s3.deleteObject('org/k', { versionId: 'v1' });
    expect(client.send.mock.calls.at(-1)![0]).toBeInstanceOf(DeleteObjectCommand);
    expect((client.send.mock.calls.at(-1)![0] as DeleteObjectCommand).input.VersionId).toBe('v1');

    const copied = await s3.copyObject('org/a b.pdf', 'org/c.pdf', { versionId: 'v1' });
    const copy = client.send.mock.calls.find(
      (c) => c[0] instanceof CopyObjectCommand,
    )![0] as CopyObjectCommand;
    expect(copy.input).toMatchObject({
      CopySource: 'erp-docs/org/a%20b.pdf?versionId=v1',
      ServerSideEncryption: 'AES256',
    });
    expect(copied.versionId).toBe('v9');
  });

  it('presigns short-lived downloads with forced disposition and version', async () => {
    const presign = vi.fn(async () => 'https://signed');
    const s3 = new S3StorageProvider(config, { client: mockClient(), presign });
    await s3.getSignedDownloadUrl('org/k', {
      expiresInSeconds: 120,
      fileName: 'Résumé.pdf',
      contentType: 'application/pdf',
      disposition: 'attachment',
      versionId: 'v3',
    });
    const [, command, options] = presign.mock.calls[0] as unknown as [
      unknown,
      GetObjectCommand,
      { expiresIn: number },
    ];
    expect(options.expiresIn).toBe(120);
    expect(command.input).toMatchObject({
      Key: 'org/k',
      VersionId: 'v3',
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: contentDisposition('attachment', 'Résumé.pdf'),
      ResponseCacheControl: 'private, no-store',
    });
    expect(contentDisposition('inline', 'Résumé.pdf')).toBe(
      `inline; filename="R_sum_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`,
    );
  });

  it('presigns uploads bound to type/length with SSE + checksum headers (real presigner)', async () => {
    const client = new S3Client({
      region: 'ap-south-1',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
    });
    const s3 = new S3StorageProvider(config, {
      client,
      presign: (c, command, options) => getSignedUrl(c as S3Client, command, options),
    });
    const upload = await s3.getSignedUploadUrl('org/k', {
      expiresInSeconds: 300,
      contentType: 'application/pdf',
      contentLength: body.length,
      checksumSha256: sha(body),
    });
    const url = new URL(upload.url);
    expect(url.hostname).toContain('erp-docs');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!;
    expect(signed).toContain('content-type');
    expect(signed).toContain('content-length');
    expect(signed).toContain('x-amz-server-side-encryption');
    expect(upload.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': 'kms-1',
      'x-amz-checksum-sha256': b64,
    });
  });
});
