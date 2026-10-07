import type { ApiListResponse } from '@erp/shared';
import { apiFetch } from '@/api/client';

export interface Option {
  id: string;
  name: string;
  code?: string;
  institutionId?: string;
}

export const money = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const todayStr = () => new Date().toISOString().slice(0, 10);

export async function listOptions(path: string): Promise<Option[]> {
  try {
    return (await apiFetch<ApiListResponse<Option>>(path)).data;
  } catch {
    return [];
  }
}

export const loadInstitutions = () => listOptions('/api/v1/institutions?pageSize=100');
export const loadClassSections = () => listOptions('/api/v1/class-sections?pageSize=100');

export function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.toString();
}

export const errorText = (e: unknown) => (e as Error).message;
