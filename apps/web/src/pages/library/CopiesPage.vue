<script setup lang="ts">
import {
  LIBRARY_COPY_STATUSES,
  type ApiListResponse,
  type LibraryCopyDto,
  type LibraryCopyStatus,
} from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiBlob, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import LibraryTabs from './LibraryTabs.vue';
import { STATUS_COLOR, qs, useLibraryInstitutions } from './library';

const auth = useAuthStore();
const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const items = ref<LibraryCopyDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const selected = ref<string[]>([]);
const filters = reactive({ search: '', status: null as LibraryCopyStatus | null });
const headers = [
  { title: 'Accession no', key: 'accessionNo' },
  { title: 'Barcode', key: 'barcode' },
  { title: 'Title', key: 'book.title' },
  { title: 'Call no', key: 'book.callNumber' },
  { title: 'Shelf', key: 'shelf' },
  { title: 'Rack', key: 'rack' },
  { title: 'Status', key: 'status' },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<LibraryCopyDto>>(
      `/api/v1/library/copies?${qs({
        page: page.value,
        pageSize: 50,
        institutionId: institutionId.value,
        status: filters.status,
        search: filters.search,
      })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function labels() {
  try {
    const body = selected.value.length
      ? { copyIds: selected.value }
      : { institutionId: institutionId.value || institutions.value[0]?.id };
    const blob = await apiBlob('/api/v1/library/labels', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadInstitutions();
  await load();
});
watch([page, institutionId, () => filters.status], load);
let timer: ReturnType<typeof setTimeout>;
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  },
);
</script>
<template>
  <LibraryTabs title="Copies">
    <template #actions>
      <v-btn
        v-if="auth.can('library.manage')"
        variant="text"
        prepend-icon="mdi-barcode"
        @click="labels"
        >{{ selected.length ? `Labels for ${selected.length} selected` : 'Labels PDF' }}</v-btn
      >
    </template>
  </LibraryTabs>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="4"
      ><v-text-field
        v-model="filters.search"
        label="Barcode, accession no or title"
        density="compact"
        prepend-inner-icon="mdi-barcode-scan"
        hide-details
    /></v-col>
    <v-col v-if="institutions.length > 1" cols="12" md="4"
      ><v-select
        v-model="institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Library"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="12" md="4"
      ><v-select
        v-model="filters.status"
        :items="[...LIBRARY_COPY_STATUSES]"
        label="Status"
        density="compact"
        clearable
        hide-details
    /></v-col>
  </v-row>
  <v-data-table-server
    v-model="selected"
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :items-per-page="50"
    :loading="loading"
    item-value="id"
    show-select
    @update:page="page = $event"
  >
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="STATUS_COLOR[item.status]">{{ item.status }}</v-chip>
    </template>
  </v-data-table-server>
</template>
