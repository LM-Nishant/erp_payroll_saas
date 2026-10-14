import type { ApiListResponse, OptionalPaginationQuery, PaginationQuery } from '@erp/shared';

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

/** Page window for an opt-in paged list; `undefined` means "return every row". */
export function toOptionalPageWindow(query: OptionalPaginationQuery): Partial<PageWindow> {
  if (query.page === undefined && query.pageSize === undefined) return {};
  return toPageWindow({ page: query.page ?? 1, pageSize: query.pageSize ?? 20 });
}

export function toOptionalListResponse<T>(
  items: T[],
  total: number,
  query: OptionalPaginationQuery,
): ApiListResponse<T> {
  const paged = query.page !== undefined || query.pageSize !== undefined;
  return toListResponse(items, total, {
    page: paged ? (query.page ?? 1) : 1,
    pageSize: paged ? (query.pageSize ?? 20) : Math.max(total, 1),
  });
}
