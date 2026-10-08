<script setup lang="ts">
/**
 * Generic server-paged list + create dialog used by the transport and hostel workspaces.
 * Fields describe the create form; `ref` fields load options from another list endpoint.
 */
import type { ApiListResponse } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

export interface ResourceField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'ref' | 'textarea' | 'tags';
  options?: readonly string[];
  /** List endpoint for `ref` fields (expects {data:[{id,…}]}). */
  refEndpoint?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refTitle?: (row: Record<string, any>) => string;
  required?: boolean;
  default?: unknown;
  cols?: number;
}
export interface ResourceHeader {
  title: string;
  key: string;
  sortable?: boolean;
}

const props = withDefaults(
  defineProps<{
    title?: string;
    endpoint: string;
    headers: ResourceHeader[];
    fields?: ResourceField[];
    createEndpoint?: string;
    createLabel?: string;
    createPermission?: string;
    query?: Record<string, string | undefined>;
    statusOptions?: readonly string[];
    searchable?: boolean;
  }>(),
  {
    title: undefined,
    createEndpoint: undefined,
    createPermission: undefined,
    query: undefined,
    searchable: true,
    fields: () => [],
    createLabel: 'New',
    statusOptions: () => [],
  },
);
const emit = defineEmits<{ created: [unknown] }>();

const auth = useAuthStore();
const items = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const filters = reactive({ search: '', status: '' });
const dialog = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const form = reactive<Record<string, any>>({});
const refOptions = reactive<Record<string, { value: string; title: string }[]>>({});

const canCreate = computed(
  () => !!props.createEndpoint && (!props.createPermission || auth.can(props.createPermission)),
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    if (filters.search) p.set('search', filters.search);
    if (filters.status) p.set('status', filters.status);
    for (const [k, v] of Object.entries(props.query ?? {})) if (v) p.set(k, v);
    const r = await apiFetch<ApiListResponse<Record<string, unknown>>>(`${props.endpoint}?${p}`);
    items.value = r.data;
    total.value = r.meta?.total ?? r.data.length;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function loadRef(f: ResourceField, search = '') {
  try {
    const sep = f.refEndpoint!.includes('?') ? '&' : '?';
    const q = search ? `&search=${encodeURIComponent(search)}` : '';
    const r = await apiFetch<ApiListResponse<Record<string, unknown>>>(
      `${f.refEndpoint}${sep}pageSize=100${q}`,
    );
    const selected = (refOptions[f.key] ?? []).filter((o) => o.value === form[f.key]);
    refOptions[f.key] = [
      ...selected,
      ...r.data
        .filter((row) => !selected.some((o) => o.value === row.id))
        .map((row) => ({
          value: String(row.id),
          title: f.refTitle ? f.refTitle(row) : String(row.name ?? row.code ?? row.id),
        })),
    ];
  } catch {
    refOptions[f.key] = [];
  }
}
const searchTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function onRefSearch(f: ResourceField, search: string) {
  clearTimeout(searchTimers[f.key]);
  searchTimers[f.key] = setTimeout(() => void loadRef(f, search), 300);
}

async function loadRefs() {
  await Promise.all(
    props.fields
      .filter((f) => f.type === 'ref' && f.refEndpoint)
      .map(async (f) => {
        try {
          const sep = f.refEndpoint!.includes('?') ? '&' : '?';
          const r = await apiFetch<ApiListResponse<Record<string, unknown>>>(
            `${f.refEndpoint}${sep}pageSize=100`,
          );
          refOptions[f.key] = r.data.map((row) => ({
            value: String(row.id),
            title: f.refTitle ? f.refTitle(row) : String(row.name ?? row.code ?? row.id),
          }));
        } catch {
          refOptions[f.key] = [];
        }
      }),
  );
}

function openCreate() {
  for (const f of props.fields) form[f.key] = f.default ?? (f.type === 'tags' ? [] : null);
  formError.value = null;
  dialog.value = true;
  void loadRefs();
}

function payload() {
  const out: Record<string, unknown> = {};
  for (const f of props.fields) {
    const v = form[f.key];
    if (v === null || v === undefined || v === '') continue;
    if (f.type === 'number') out[f.key] = Number(v);
    else if (f.type === 'datetime') out[f.key] = new Date(String(v)).toISOString();
    else out[f.key] = v;
  }
  return out;
}

async function save() {
  saving.value = true;
  formError.value = null;
  try {
    const created = await apiFetch(props.createEndpoint!, {
      method: 'POST',
      body: JSON.stringify(payload()),
    });
    dialog.value = false;
    emit('created', created);
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch([page, () => filters.status, () => JSON.stringify(props.query ?? {})], load);
function cell(item: unknown, key: string) {
  const v = (item as Record<string, unknown>)[key];
  return v === null || v === undefined || v === '' ? '—' : v;
}
defineExpose({ reload: load });
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <h3 v-if="title" class="text-h6">{{ title }}</h3>
      <v-text-field
        v-if="searchable"
        v-model="filters.search"
        density="compact"
        hide-details
        label="Search"
        prepend-inner-icon="mdi-magnify"
        style="max-width: 260px"
        @keyup.enter="load"
      />
      <v-select
        v-if="statusOptions.length"
        v-model="filters.status"
        :items="['', ...statusOptions]"
        density="compact"
        hide-details
        label="Status"
        style="max-width: 180px"
      />
      <slot name="filters" />
      <v-spacer />
      <slot name="toolbar" :reload="load" />
      <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="openCreate">{{
        createLabel
      }}</v-btn>
    </div>
    <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
    <v-data-table-server
      v-model:page="page"
      :headers="headers"
      :items="items"
      :items-length="total"
      :items-per-page="25"
      :loading="loading"
      density="compact"
    >
      <template v-for="h in headers" #[`item.${h.key}`]="{ item }" :key="h.key">
        <slot :name="`item.${h.key}`" :item="item" :reload="load">{{ cell(item, h.key) }}</slot>
      </template>
    </v-data-table-server>

    <v-dialog v-model="dialog" max-width="720">
      <v-card :title="createLabel">
        <v-card-text>
          <v-alert v-if="formError" type="error" class="mb-3">{{ formError }}</v-alert>
          <v-row dense>
            <v-col v-for="f in fields" :key="f.key" cols="12" :md="f.cols ?? 6">
              <v-select
                v-if="f.type === 'select'"
                v-model="form[f.key]"
                :items="[...(f.options ?? [])]"
                :label="f.label"
                density="compact"
              />
              <v-autocomplete
                v-else-if="f.type === 'ref'"
                v-model="form[f.key]"
                :items="refOptions[f.key] ?? []"
                :label="f.label"
                clearable
                no-filter
                density="compact"
                @update:search="(s: string) => onRefSearch(f, s)"
              />
              <v-textarea
                v-else-if="f.type === 'textarea'"
                v-model="form[f.key] as string"
                :label="f.label"
                rows="2"
                density="compact"
              />
              <v-combobox
                v-else-if="f.type === 'tags'"
                v-model="form[f.key] as string[]"
                :label="f.label"
                multiple
                chips
                density="compact"
              />
              <v-text-field
                v-else
                v-model="form[f.key] as string"
                :label="f.label + (f.required ? ' *' : '')"
                :type="
                  f.type === 'number'
                    ? 'number'
                    : f.type === 'date'
                      ? 'date'
                      : f.type === 'datetime'
                        ? 'datetime-local'
                        : 'text'
                "
                density="compact"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
