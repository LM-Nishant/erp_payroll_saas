import type { ApiListResponse } from '@erp/shared';
import { onMounted, ref, watch, type Ref } from 'vue';
import { apiFetch } from '@/api/client';

/** Page sizes offered by server-paged tables (the API caps pageSize at 100; no "All"). */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100].map((value) => ({
  value,
  title: String(value),
}));

export type QueryValue = string | number | boolean | null | undefined;

export interface ServerListOptions {
  /** Initial page size (default 25). */
  pageSize?: number;
  /** Filter params; any change resets to page 1 and reloads. */
  params?: () => Record<string, QueryValue>;
  /** When it returns false the list is cleared instead of fetched (e.g. a required filter). */
  enabled?: () => boolean;
  /** Load on mount (default true). Set false when the page triggers the first load itself. */
  immediate?: boolean;
  /** Share an existing error ref with the page; otherwise one is created. */
  error?: Ref<string | null>;
  /** Custom failure handler (default: put the message in `error`). */
  onError?: (e: unknown) => void;
  /** Debounce for the search box in ms (default 300). */
  debounceMs?: number;
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/**
 * Backend-paginated list state for `<v-data-table-server>`: sends page, pageSize, search and the
 * page's filters to a `{data, meta:{total}}` endpoint. Search is debounced; filter/search/page-size
 * changes reset to page 1. Stale responses (out-of-order) are ignored.
 */
export function useServerList<T>(
  endpoint: string | (() => string),
  options: ServerListOptions = {},
) {
  const items = ref<T[]>([]) as Ref<T[]>;
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(options.pageSize ?? 25);
  const search = ref('');
  const loading = ref(false);
  const error = options.error ?? ref<string | null>(null);
  let seq = 0;

  async function load() {
    const id = ++seq;
    if (options.enabled && !options.enabled()) {
      items.value = [];
      total.value = 0;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const base = typeof endpoint === 'function' ? endpoint() : endpoint;
      const q = buildQuery({
        ...(options.params?.() ?? {}),
        page: page.value,
        pageSize: pageSize.value,
        search: search.value.trim(),
      });
      const r = await apiFetch<ApiListResponse<T>>(`${base}${base.includes('?') ? '&' : '?'}${q}`);
      if (id !== seq) return;
      items.value = r.data;
      total.value = r.meta?.total ?? r.data.length;
      // The current page emptied (e.g. after deleting its last row): step back to the last page.
      const last = Math.max(1, Math.ceil(total.value / pageSize.value));
      if (!r.data.length && page.value > last) page.value = last;
    } catch (e) {
      if (id !== seq) return;
      if (options.onError) options.onError(e);
      else error.value = (e as Error).message;
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  /** Go back to page 1 and reload (filters changed). */
  function reset() {
    if (page.value !== 1) page.value = 1;
    else void load();
  }

  watch(page, () => void load());
  watch(pageSize, reset);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(search, () => {
    clearTimeout(timer);
    timer = setTimeout(reset, options.debounceMs ?? 300);
  });
  if (options.params) watch(options.params, reset, { deep: true });
  if (options.immediate !== false) onMounted(() => void load());

  return { items, total, page, pageSize, search, loading, error, load, reset };
}
