import type { ApiListResponse, EmployeeDto, SignedUrlDto } from '@erp/shared';
import { apiFetch } from '@/api/client';

/** Shared helpers for the payroll pages. */
export const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const RUN_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  COMPUTING: 'info',
  COMPUTED: 'info',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'primary',
  FINALIZED: 'success',
  REOPENED: 'secondary',
  CANCELLED: 'error',
};

/** Opens a short-lived signed URL issued by a payroll download endpoint (audited server-side). */
export async function openSignedUrl(path: string) {
  const res = await apiFetch<{ data: SignedUrlDto }>(path, { method: 'POST', body: '{}' });
  window.open(res.data.url, '_blank', 'noopener');
}

export async function searchEmployees(search: string): Promise<EmployeeDto[]> {
  const params = new URLSearchParams({ pageSize: '50' });
  if (search.trim()) params.set('search', search.trim());
  return (await apiFetch<ApiListResponse<EmployeeDto>>(`/api/v1/employees?${params}`)).data;
}

export const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export const lastOfMonth = (start: string) => {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${start.slice(0, 7)}-${String(last).padStart(2, '0')}`;
};
