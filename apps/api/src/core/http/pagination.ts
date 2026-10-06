import type { ApiListResponse, PaginationQuery } from '@erp/shared';

export interface PageWindow {
  skip: number;
  take: number;
}

export function toPageWindow(query: Pick<PaginationQuery, 'page' | 'pageSize'>): PageWindow {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function toListResponse<T>(
  items: T[],
  total: number,
  query: Pick<PaginationQuery, 'page' | 'pageSize'>,
): ApiListResponse<T> {
  return { data: items, meta: { page: query.page, pageSize: query.pageSize, total } };
}
