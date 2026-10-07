import type { ApiListResponse } from '@erp/shared';
import { ref } from 'vue';
import { apiFetch } from '@/api/client';

export interface InstitutionOption {
  id: string;
  name: string;
  code: string;
}

/** Institutions the caller can see (each institution runs its own library). */
export function useLibraryInstitutions() {
  const institutions = ref<InstitutionOption[]>([]);
  const institutionId = ref<string>('');
  async function loadInstitutions() {
    try {
      const r = await apiFetch<ApiListResponse<InstitutionOption>>(
        '/api/v1/institutions?pageSize=100',
      );
      institutions.value = r.data;
      if (!institutionId.value && r.data.length === 1) institutionId.value = r.data[0]!.id;
    } catch {
      institutions.value = [];
    }
  }
  return { institutions, institutionId, loadInstitutions };
}

export const money = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10) : '—');

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) p.set(k, String(v));
  return p.toString();
}

export const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: 'success',
  ISSUED: 'primary',
  RESERVED: 'warning',
  LOST: 'error',
  DAMAGED: 'error',
  WITHDRAWN: 'grey',
  RETURNED: 'success',
  WAITING: 'info',
  READY: 'warning',
  FULFILLED: 'success',
  CANCELLED: 'grey',
  EXPIRED: 'grey',
  PENDING: 'warning',
  COLLECTED: 'success',
  WAIVED: 'grey',
  POSTED: 'info',
};

/** Library sub-navigation shown at the top of the staff pages. */
export const LIBRARY_TABS = [
  { title: 'Dashboard', path: '' },
  { title: 'Catalogue', path: 'catalogue' },
  { title: 'Copies', path: 'copies' },
  { title: 'Issue / Return', path: 'desk' },
  { title: 'Reservations', path: 'reservations' },
  { title: 'Members', path: 'members' },
  { title: 'Overdues & fines', path: 'fines' },
  { title: 'Reports', path: 'reports' },
  { title: 'Settings', path: 'settings' },
];
