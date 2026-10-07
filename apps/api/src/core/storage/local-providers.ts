import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signLocalToken, type LocalTokenPayload } from './local-signing';
import type {
  ObjectInfo,
  ObjectRef,
  PutObjectInput,
  SignedDownloadOptions,
  SignedUpload,
  SignedUploadOptions,
  StorageProvider,
} from './provider';

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

interface StoredObject {
  body: Buffer;
  contentType: string;
  checksumSha256: string;
}

interface LocalOptions {
  /** Identifies the provider instance inside signed tokens. */
  id: string;
  signingSecret: string;
  /** Prefix of signed URLs, e.g. `https://api.example.com/api/v1/storage/local`. */
  urlPrefix: string;
}

/** Shared logic of the local providers; subclasses implement raw object persistence. */
abstract class LocalStorageProvider implements StorageProvider {
  abstract readonly driver: string;
  constructor(protected readonly options: LocalOptions) {}

  get id(): string {
    return this.options.id;
  }

  protected abstract read(key: string): Promise<StoredObject | null>;
  protected abstract write(key: string, object: StoredObject): Promise<void>;
  protected abstract remove(key: string): Promise<void>;

  private info(key: string, o: StoredObject): ObjectInfo {
    return {
      key,
      sizeBytes: o.body.length,
      contentType: o.contentType,
      checksumSha256: o.checksumSha256,
      versionId: null,
    };
  }

  async putObject(input: PutObjectInput): Promise<ObjectInfo> {
    const checksum = sha256(input.body);
    if (input.checksumSha256 && input.checksumSha256 !== checksum) {
      throw new Error('Checksum mismatch');
    }
    const object = { body: input.body, contentType: input.contentType, checksumSha256: checksum };
    await this.write(input.key, object);
    return this.info(input.key, object);
  }

  async getObject(key: string): Promise<Buffer> {
    const o = await this.read(key);
    if (!o) throw new Error('Object not found');
    return o.body;
  }

  async headObject(key: string): Promise<ObjectInfo | null> {
    const o = await this.read(key);
    return o ? this.info(key, o) : null;
  }

  async deleteObject(key: string): Promise<void> {
    await this.remove(key);
  }

  async copyObject(sourceKey: string, destinationKey: string, _ref?: ObjectRef) {
    const o = await this.read(sourceKey);
    if (!o) throw new Error('Object not found');
    await this.write(destinationKey, { ...o, body: Buffer.from(o.body) });
    return this.info(destinationKey, o);
  }

  private url(payload: Omit<LocalTokenPayload, 'p' | 'exp'>, expiresInSeconds: number) {
    const token = signLocalToken(
      {
        ...payload,
        p: this.options.id,
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      },
      this.options.signingSecret,
    );
    return `${this.options.urlPrefix}/${token}`;
  }

  async getSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string> {
    return this.url(
      {
        op: 'get',
        key,
        ct: options.contentType,
        fn: options.fileName,
        disp: options.disposition,
      },
      options.expiresInSeconds,
    );
  }

  async getSignedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUpload> {
    return {
      method: 'PUT',
      url: this.url(
        {
          op: 'put',
          key,
          ct: options.contentType,
          len: options.contentLength,
          ...(options.checksumSha256 ? { sha: options.checksumSha256 } : {}),
        },
        options.expiresInSeconds,
      ),
      headers: { 'Content-Type': options.contentType },
    };
  }
}

/** In-process provider for tests (STORAGE_DRIVER=memory). */
export class MemoryStorageProvider extends LocalStorageProvider {
  readonly driver = 'memory';
  private readonly objects = new Map<string, StoredObject>();

  protected async read(key: string) {
    return this.objects.get(key) ?? null;
  }
  protected async write(key: string, object: StoredObject) {
    this.objects.set(key, object);
  }
  protected async remove(key: string) {
    this.objects.delete(key);
  }
  /** Test helper: every stored key. */
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

/** Filesystem provider for local development (STORAGE_DRIVER=local). */
export class FilesystemStorageProvider extends LocalStorageProvider {
  readonly driver = 'local';
  constructor(
    options: LocalOptions,
    private readonly root: string,
  ) {
    super(options);
  }

  private pathFor(key: string) {
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error('Invalid storage key');
    return full;
  }

  protected async read(key: string): Promise<StoredObject | null> {
    const file = this.pathFor(key);
    try {
      const [body, meta] = await Promise.all([
        readFile(file),
        readFile(`${file}.meta.json`, 'utf8'),
      ]);
      const parsed = JSON.parse(meta) as { contentType: string; checksumSha256: string };
      return { body, ...parsed };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  protected async write(key: string, object: StoredObject) {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, object.body);
    await writeFile(
      `${file}.meta.json`,
      JSON.stringify({ contentType: object.contentType, checksumSha256: object.checksumSha256 }),
    );
  }

  protected async remove(key: string) {
    const file = this.pathFor(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async exists(key: string) {
    return stat(this.pathFor(key)).then(
      () => true,
      () => false,
    );
  }
}
