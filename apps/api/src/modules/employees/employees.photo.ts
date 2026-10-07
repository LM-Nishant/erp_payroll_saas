import { faceDescriptorSchema } from '@erp/shared';
import type { Employee } from '@prisma/client';
import { audit } from '../../core/audit';
import { assertPermission, currentPrincipal } from '../../core/authz';
import { DbNull } from '../../core/db/helpers';
import { documentEngine } from '../../core/documents';
import { NotFoundError, ValidationError } from '../../core/http/errors';
import type { MultipartFile } from '../../core/http/multipart';
import { parseInput } from '../../core/http/validation';
import type { UploadPolicy } from '../../core/storage';
import { tenantDb } from '../../core/tenancy';
import { loadEmployeeFor, loadVisibleEmployee } from './employees.service';

/*
 * Employee profile photo + face descriptor (selfie punches compare against it). The image is a
 * normal employee document (category `identity`); the 128-float descriptor is computed in the
 * browser (face-api.js) when the photo is uploaded and stored on the employee row.
 */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const imageUploadPolicy = (maxBytes = PHOTO_MAX_BYTES): UploadPolicy => ({
  types: { jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'] },
  maxBytes,
});

/** Parse the optional `faceDescriptor` multipart field (JSON array of 128 numbers). */
export function parseDescriptorField(raw: string | undefined): number[] | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ValidationError('faceDescriptor must be a JSON array');
  }
  return parseInput(faceDescriptorSchema, value);
}

/** Euclidean distance between two descriptors (face-api.js: < ~0.5 means the same person). */
export function faceDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(sum);
}

export function storedDescriptor(e: Pick<Employee, 'faceDescriptor'>): number[] | null {
  const d = e.faceDescriptor;
  return Array.isArray(d) && d.length === 128 && d.every((v) => typeof v === 'number')
    ? (d as number[])
    : null;
}

async function ownEmployeeRow() {
  const principal = currentPrincipal();
  assertPermission(principal, 'employee.view_own');
  if (!principal.userId) throw new NotFoundError('Employee');
  const e = await tenantDb().employee.findFirst({ where: { userId: principal.userId } });
  if (!e) throw new NotFoundError('Employee');
  return e;
}

async function storePhoto(employee: Employee, file: MultipartFile, descriptor: number[] | null) {
  const doc = await documentEngine.attach({
    ownerType: 'employee',
    ownerId: employee.id,
    module: 'hr',
    metadata: {
      title: `Profile photo — ${employee.displayName}`,
      category: 'identity',
      documentType: 'profile_photo',
      confidentiality: 'INTERNAL',
    },
    file,
    policy: imageUploadPolicy(),
    authorization: 'caller',
  });
  await tenantDb().employee.update({
    where: { id: employee.id },
    // A new photo without a descriptor invalidates the old one.
    data: { photoDocumentId: doc.id, faceDescriptor: descriptor ?? DbNull },
  });
  await audit.record({
    action: 'employee.photo_update',
    entityType: 'employee',
    entityId: employee.id,
    before: { photoDocumentId: employee.photoDocumentId },
    after: { photoDocumentId: doc.id, faceDescriptor: !!descriptor },
  });
  return { photoDocumentId: doc.id, hasFaceDescriptor: !!descriptor };
}

async function urlFor(e: Pick<Employee, 'photoDocumentId'>) {
  if (!e.photoDocumentId) return null;
  return documentEngine.currentVersionUrl(e.photoDocumentId, 'inline');
}

export const photoService = {
  async uploadOwn(file: MultipartFile, descriptor: number[] | null) {
    assertPermission(currentPrincipal(), 'employee.update_own');
    return storePhoto(await ownEmployeeRow(), file, descriptor);
  },
  async upload(id: string, file: MultipartFile, descriptor: number[] | null) {
    return storePhoto(await loadEmployeeFor(id, 'employee.update'), file, descriptor);
  },
  async ownUrl() {
    return urlFor(await ownEmployeeRow());
  },
  async url(id: string) {
    return urlFor(await loadVisibleEmployee(id));
  },
  /** The caller's stored descriptor (client-side pre-check before a selfie punch). */
  async ownFace() {
    const e = await ownEmployeeRow();
    return { hasPhoto: !!e.photoDocumentId, descriptor: storedDescriptor(e) };
  },
};
