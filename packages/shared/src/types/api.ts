/** Standard envelope for single-resource responses. */
export interface ApiItemResponse<T> {
  data: T;
}

/** Standard envelope for paginated list responses. */
export interface ApiListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/** Standard error envelope returned by the API for every non-2xx response. */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
