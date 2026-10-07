import type { ApiListResponse, StudentAttendanceStatus } from '@erp/shared';
import { ref } from 'vue';
import { apiFetch } from '@/api/client';

export interface Option {
  id: string;
  name: string;
  code?: string;
}
export interface SectionOption extends Option {
  institutionId: string;
  programId: string;
  academicYear?: string | null;
}
export interface ProgramOption extends Option {
  institutionId: string;
  departmentId: string;
}

export const DAYS = [
  { value: 1, title: 'Mon' },
  { value: 2, title: 'Tue' },
  { value: 3, title: 'Wed' },
  { value: 4, title: 'Thu' },
  { value: 5, title: 'Fri' },
  { value: 6, title: 'Sat' },
];

export const STATUS_CODE: Record<StudentAttendanceStatus, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  LATE: 'L',
  LEAVE: 'LV',
  HALF_DAY: 'H',
};
export const STATUS_COLOR: Record<StudentAttendanceStatus, string> = {
  PRESENT: 'success',
  ABSENT: 'error',
  LATE: 'warning',
  LEAVE: 'info',
  HALF_DAY: 'secondary',
};

export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => today().slice(0, 7);

async function pages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await apiFetch<ApiListResponse<T>>(`${path}${sep}pageSize=100&page=${page}`);
    out.push(...r.data);
    if (out.length >= r.meta.total || r.data.length === 0) break;
  }
  return out;
}

/** Scope-filtered lookups (the API only returns rows the user may see). */
export function useAcademicOptions() {
  const institutions = ref<Option[]>([]);
  const programs = ref<ProgramOption[]>([]);
  const sections = ref<SectionOption[]>([]);
  const error = ref<string | null>(null);

  async function load() {
    try {
      [institutions.value, programs.value, sections.value] = await Promise.all([
        pages<Option>('/api/v1/institutions'),
        pages<ProgramOption>('/api/v1/programs'),
        pages<SectionOption>('/api/v1/class-sections'),
      ]);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  return { institutions, programs, sections, error, load };
}

export async function teacherOptions(institutionId: string) {
  if (!institutionId) return [];
  const r = await apiFetch<{ data: { id: string; name: string; email: string }[] }>(
    `/api/v1/subject-allocations/teacher-options?institutionId=${institutionId}`,
  );
  return r.data.map((t) => ({ ...t, title: `${t.name} (${t.email})` }));
}
