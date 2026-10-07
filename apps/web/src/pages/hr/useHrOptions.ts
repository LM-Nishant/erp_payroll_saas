import type { ApiListResponse, DesignationDto } from '@erp/shared';
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

/** Lookup lists for HR forms; every list is already scope-filtered by the API. */
export function useHrOptions() {
  const institutions = ref<Option[]>([]);
  const designations = ref<DesignationDto[]>([]);
  const departments = ref<Option[]>([]);
  const campuses = ref<Option[]>([]);

  async function loadBase() {
    [institutions.value, designations.value] = await Promise.all([
      list<Option>('/api/v1/institutions?pageSize=100'),
      list<DesignationDto>('/api/v1/designations?pageSize=100&status=ACTIVE'),
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

  return { institutions, designations, departments, campuses, loadBase, loadForInstitution };
}

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  ONBOARDING: 'info',
  ACTIVE: 'success',
  ON_NOTICE: 'warning',
  EXITED: 'error',
};

export const label = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const todayIso = () => new Date().toISOString().slice(0, 10);
