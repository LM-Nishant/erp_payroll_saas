import busboy from 'busboy';
import type { Request } from 'express';
import { FileTooLargeError } from '../storage/policy';
import { ValidationError } from './errors';

export interface MultipartFile {
  fileName: string;
  /** Client-declared MIME type (validated against the allowlist + magic bytes later). */
  mimeType: string;
  body: Buffer;
}

export interface MultipartResult {
  file: MultipartFile;
  fields: Record<string, string>;
}

/**
 * Parse a `multipart/form-data` request with exactly ONE file part named `file` plus small text
 * fields. Buffers the file in memory up to `maxBytes` (413 above) — files go to object storage,
 * never to the database.
 */
export function parseMultipartFile(
  req: Request,
  options: { maxBytes: number; maxFields?: number },
): Promise<MultipartResult> {
  if (!req.is('multipart/form-data')) {
    return Promise.reject(new ValidationError('Expected multipart/form-data'));
  }
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: options.maxBytes,
          fields: options.maxFields ?? 10,
          fieldSize: 64 * 1024,
          parts: (options.maxFields ?? 10) + 1,
        },
      });
    } catch {
      reject(new ValidationError('Malformed multipart request'));
      return;
    }
    const fields: Record<string, string> = {};
    let file: MultipartFile | null = null;
    let failure: Error | null = null;
    let pending: Promise<void> | null = null;

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || file || pending) {
        stream.resume();
        failure ??= new ValidationError('Exactly one file part named "file" is expected');
        return;
      }
      const chunks: Buffer[] = [];
      pending = new Promise<void>((done) => {
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('limit', () => {
          failure ??= new FileTooLargeError(options.maxBytes);
        });
        stream.on('end', () => {
          file = {
            fileName: info.filename ?? '',
            mimeType: info.mimeType ?? 'application/octet-stream',
            body: Buffer.concat(chunks),
          };
          done();
        });
      });
    });
    parser.on('filesLimit', () => {
      failure ??= new ValidationError('Only one file may be uploaded');
    });
    parser.on('error', () => reject(new ValidationError('Malformed multipart request')));
    parser.on('close', () => {
      void (pending ?? Promise.resolve()).then(() => {
        if (failure) reject(failure);
        else if (!file) reject(new ValidationError('A file part named "file" is required'));
        else resolve({ file, fields });
      });
    });
    req.pipe(parser);
  });
}

/** Parse a JSON-encoded multipart text field (e.g. `metadata`). */
export function jsonField(fields: Record<string, string>, name: string): unknown {
  const raw = fields[name];
  if (raw === undefined || raw === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ValidationError(`Field "${name}" must be JSON`);
  }
}
