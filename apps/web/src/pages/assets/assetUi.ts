import type { ApiListResponse, AssetCategoryDto } from '@erp/shared';
import { ref } from 'vue';
import { apiFetch } from '@/api/client';

export interface Option {
  id: string;
  name: string;
  code?: string;
}

const list = async <T>(path: string): Promise<T[]> => {
  try {
    return (await apiFetch<ApiListResponse<T>>(path)).data;
  } catch {
    return [];
  }
};

/** Lookup lists shared by the asset pages (already scope-filtered by the API). */
export function useAssetOptions() {
  const institutions = ref<Option[]>([]);
  const categories = ref<AssetCategoryDto[]>([]);
  const departments = ref<Option[]>([]);
  const campuses = ref<Option[]>([]);

  async function loadBase() {
    [institutions.value, categories.value] = await Promise.all([
      list<Option>('/api/v1/institutions?pageSize=100'),
      list<AssetCategoryDto>('/api/v1/assets/categories?pageSize=100'),
    ]);
  }
  async function loadForInstitution(institutionId: string | null | undefined) {
    if (!institutionId) {
      departments.value = [];
      campuses.value = [];
      return;
    }
    [departments.value, campuses.value] = await Promise.all([
      list<Option>(`/api/v1/departments?pageSize=100&institutionId=${institutionId}`),
      list<Option>(`/api/v1/campuses?pageSize=100&institutionId=${institutionId}`),
    ]);
  }
  return { institutions, categories, departments, campuses, loadBase, loadForInstitution };
}

export const ASSET_STATUS_COLORS: Record<string, string> = {
  IN_STOCK: 'info',
  ASSIGNED: 'success',
  UNDER_REPAIR: 'warning',
  LOST: 'error',
  DISPOSED: 'default',
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'default',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  VERIFIED: 'success',
  MISSING: 'error',
  ACTIVE: 'success',
  RETURNED: 'default',
};

export const label = (value: string | null | undefined) =>
  (value ?? '')
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const money = (n: number | null | undefined) => (n == null ? '—' : inr.format(n));

/** Drop empty strings so optional fields go to the API as null / are omitted. */
export function clean<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, v === '' ? null : v]),
  );
}

/** Widen a readonly enum tuple so v-select models stay plain strings. */
export const opts = (values: readonly string[]): string[] => [...values];
