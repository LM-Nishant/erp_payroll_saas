import type { EmployeeSensitiveInput, EmployeeSensitiveMaskedDto } from '@erp/shared';
import type { EmployeeProfile, Prisma } from '@prisma/client';
import { DbNull } from '../../core/db/helpers';
import { blindIndex, decryptFields, encryptFields, maskValue } from '../../core/secrets';
import { EMPTY_MASKED } from './employees.mappers';

/**
 * Sensitive employee fields (statutory ids + bank account). The whole set is ONE encrypted JSON
 * blob per profile (AAD `org:employee:<id>`); only masks and blind indexes are stored in clear.
 * Clear values must never reach audit logs, events, or default API responses.
 */
export interface SensitiveValues {
  pan?: string;
  aadhaar?: string;
  uan?: string;
  esicNumber?: string;
  pfNumber?: string;
  bankAccount?: {
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName?: string | null;
    branch?: string | null;
  };
}

const binding = (employeeId: string) => `employee:${employeeId}`;

export function maskSensitive(v: SensitiveValues): EmployeeSensitiveMaskedDto {
  return {
    pan: v.pan ? maskValue(v.pan) : null,
    aadhaar: v.aadhaar ? maskValue(v.aadhaar) : null,
    uan: v.uan ? maskValue(v.uan) : null,
    esicNumber: v.esicNumber ? maskValue(v.esicNumber) : null,
    pfNumber: v.pfNumber ? maskValue(v.pfNumber) : null,
    bankAccount: v.bankAccount
      ? {
          accountHolderName: v.bankAccount.accountHolderName,
          accountNumber: maskValue(v.bankAccount.accountNumber),
          ifsc: v.bankAccount.ifsc,
          bankName: v.bankAccount.bankName ?? null,
          branch: v.bankAccount.branch ?? null,
        }
      : null,
  };
}

export function maskedOf(profile: Pick<EmployeeProfile, 'sensitiveMasked'> | null) {
  return {
    ...EMPTY_MASKED,
    ...((profile?.sensitiveMasked ?? {}) as Partial<EmployeeSensitiveMaskedDto>),
  };
}

export async function decryptSensitive(
  organizationId: string,
  employeeId: string,
  profile: Pick<
    EmployeeProfile,
    'sensitiveCiphertext' | 'sensitiveWrappedKey' | 'sensitiveKeyVersion'
  > | null,
): Promise<SensitiveValues> {
  if (!profile?.sensitiveCiphertext || !profile.sensitiveWrappedKey) return {};
  return decryptFields<SensitiveValues>(organizationId, binding(employeeId), {
    ciphertext: profile.sensitiveCiphertext,
    wrappedKey: profile.sensitiveWrappedKey,
    keyVersion: profile.sensitiveKeyVersion ?? 1,
  });
}

export const panIndexOf = (organizationId: string, pan: string) =>
  blindIndex(organizationId, 'employee.pan', pan);
export const aadhaarIndexOf = (organizationId: string, aadhaar: string) =>
  blindIndex(organizationId, 'employee.aadhaar', aadhaar);

/**
 * Merge a sensitive patch (`null` clears, omitted keeps) into the current values and return the
 * profile columns to write plus the names of the changed fields (for the audit log).
 */
export async function sealSensitivePatch(
  organizationId: string,
  employeeId: string,
  current: SensitiveValues,
  patch: EmployeeSensitiveInput,
): Promise<{ data: Prisma.EmployeeProfileUncheckedUpdateInput; changed: string[] }> {
  const next: SensitiveValues = { ...current };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch) as [keyof SensitiveValues, unknown][]) {
    if (value === undefined) continue;
    const before = JSON.stringify(current[key] ?? null);
    if (value === null) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
    if (JSON.stringify(next[key] ?? null) !== before) changed.push(key);
  }
  const hasAny = Object.keys(next).length > 0;
  const sealed = hasAny
    ? await encryptFields(organizationId, binding(employeeId), { ...next })
    : null;
  return {
    changed,
    data: {
      sensitiveCiphertext: sealed?.ciphertext ?? null,
      sensitiveWrappedKey: sealed?.wrappedKey ?? null,
      sensitiveKeyVersion: sealed?.keyVersion ?? null,
      sensitiveKeyProvider: sealed?.keyProvider ?? null,
      sensitiveMasked: hasAny ? (maskSensitive(next) as unknown as Prisma.InputJsonValue) : DbNull,
      panIndex: next.pan ? panIndexOf(organizationId, next.pan) : null,
      aadhaarIndex: next.aadhaar ? aadhaarIndexOf(organizationId, next.aadhaar) : null,
    },
  };
}
