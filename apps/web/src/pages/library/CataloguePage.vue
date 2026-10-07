<script setup lang="ts">
import {
  LIBRARY_ITEM_TYPES,
  type ApiListResponse,
  type LibraryBookDto,
  type LibraryItemType,
} from '@erp/shared';
import type { LibraryImportResultDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import LibraryTabs from './LibraryTabs.vue';
import { qs, useLibraryInstitutions } from './library';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const items = ref<LibraryBookDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const categories = ref<string[]>([]);
const filters = reactive({
  search: '',
  category: '',
  itemType: null as LibraryItemType | null,
  availableOnly: false,
});
const headers = [
  { title: 'Title', key: 'title' },
  { title: 'Authors', key: 'authors' },
  { title: 'ISBN', key: 'isbn' },
  { title: 'Category', key: 'category' },
  { title: 'Type', key: 'itemType' },
  { title: 'Library', key: 'institution.code' },
  { title: 'Available / total', key: 'availableCopies' },
];

const formOpen = ref(false);
const blank = () => ({
  institutionId: '',
  itemType: 'BOOK' as LibraryItemType,
  isbn: '',
  title: '',
  authors: '',
  publisher: '',
  edition: '',
  publicationYear: '' as string | number,
  category: '',
  language: 'English',
  tags: '',
  callNumber: '',
  url: '',
  copies: 1,
  shelf: '',
});
const form = reactive(blank());

const importOpen = ref(false);
const importInstitution = ref('');
const importFile = ref<File | File[] | null>(null);
const importResult = ref<LibraryImportResultDto | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<LibraryBookDto>>(
      `/api/v1/library/books?${qs({
        page: page.value,
        pageSize: 25,
        institutionId: institutionId.value,
        search: filters.search,
        category: filters.category,
        itemType: filters.itemType,
        availableOnly: filters.availableOnly ? 'true' : '',
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
async function loadCategories() {
  try {
    categories.value = (
      await apiFetch<{ data: string[] }>(
        `/api/v1/library/categories?${qs({ institutionId: institutionId.value })}`,
      )
    ).data;
  } catch {
    categories.value = [];
  }
}
const list = (s: string) =>
  s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
async function createBook() {
  try {
    const r = await apiFetch<{ data: LibraryBookDto }>('/api/v1/library/books', {
      method: 'POST',
      body: JSON.stringify({
        institutionId: form.institutionId,
        itemType: form.itemType,
        isbn: form.isbn || null,
        title: form.title,
        authors: list(form.authors),
        publisher: form.publisher || null,
        edition: form.edition || null,
        publicationYear: form.publicationYear ? Number(form.publicationYear) : null,
        category: form.category || null,
        language: form.language || null,
        tags: list(form.tags),
        callNumber: form.callNumber || null,
        url: form.url || null,
        copies: Number(form.copies) || 0,
        shelf: form.shelf || null,
      }),
    });
    formOpen.value = false;
    Object.assign(form, blank());
    await router.push(`${route.path.replace(/\/catalogue$/, '')}/books/${r.data.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function runImport() {
  const file = Array.isArray(importFile.value) ? importFile.value[0] : importFile.value;
  if (!file || !importInstitution.value) return;
  const body = new FormData();
  body.set('institutionId', importInstitution.value);
  body.set('file', file);
  try {
    importResult.value = (
      await apiFetch<{ data: LibraryImportResultDto }>('/api/v1/library/books/import', {
        method: 'POST',
        body,
      })
    ).data;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function openRow(_e: unknown, row: { item: LibraryBookDto }) {
  void router.push(`${route.path.replace(/\/catalogue$/, '')}/books/${row.item.id}`);
}
onMounted(async () => {
  await loadInstitutions();
  await Promise.all([load(), loadCategories()]);
});
watch(
  [
    page,
    institutionId,
    () => filters.category,
    () => filters.itemType,
    () => filters.availableOnly,
  ],
  load,
);
watch(institutionId, loadCategories);
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
  <LibraryTabs title="Catalogue">
    <template #actions>
      <template v-if="auth.can('library.manage')">
        <v-btn variant="text" prepend-icon="mdi-file-upload" @click="importOpen = true"
          >Import</v-btn
        >
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="
            form.institutionId = institutionId || institutions[0]?.id || '';
            formOpen = true;
          "
          >New title</v-btn
        >
      </template>
    </template>
  </LibraryTabs>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="3"
      ><v-text-field
        v-model="filters.search"
        label="Search title, author, ISBN, tag"
        density="compact"
        prepend-inner-icon="mdi-magnify"
        hide-details
    /></v-col>
    <v-col v-if="institutions.length > 1" cols="12" md="3"
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
    <v-col cols="12" md="2"
      ><v-autocomplete
        v-model="filters.category"
        :items="categories"
        label="Category"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="12" md="2"
      ><v-select
        v-model="filters.itemType"
        :items="[...LIBRARY_ITEM_TYPES]"
        label="Type"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="12" md="2"
      ><v-switch
        v-model="filters.availableOnly"
        label="Available only"
        density="compact"
        color="primary"
        hide-details
    /></v-col>
  </v-row>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :items-per-page="25"
    :loading="loading"
    item-value="id"
    hover
    @update:page="page = $event"
    @click:row="openRow"
  >
    <template #[`item.authors`]="{ item }">{{ item.authors.join(', ') }}</template>
    <template #[`item.availableCopies`]="{ item }">
      <v-chip size="small" :color="item.availableCopies ? 'success' : 'error'"
        >{{ item.availableCopies }} / {{ item.totalCopies }}</v-chip
      >
    </template>
  </v-data-table-server>

  <v-dialog v-model="formOpen" max-width="760">
    <v-card>
      <v-card-title>New catalogue title</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" md="6"
            ><v-select
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Library (institution)"
          /></v-col>
          <v-col cols="12" md="3"
            ><v-select v-model="form.itemType" :items="[...LIBRARY_ITEM_TYPES]" label="Type"
          /></v-col>
          <v-col cols="12" md="3"><v-text-field v-model="form.isbn" label="ISBN / ISSN" /></v-col>
          <v-col cols="12"><v-text-field v-model="form.title" label="Title" /></v-col>
          <v-col cols="12" md="6"
            ><v-text-field v-model="form.authors" label="Authors (separate with ;)"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-text-field v-model="form.publisher" label="Publisher"
          /></v-col>
          <v-col cols="6" md="3"><v-text-field v-model="form.edition" label="Edition" /></v-col>
          <v-col cols="6" md="3"
            ><v-text-field v-model="form.publicationYear" label="Year" type="number"
          /></v-col>
          <v-col cols="6" md="3"><v-text-field v-model="form.category" label="Category" /></v-col>
          <v-col cols="6" md="3"><v-text-field v-model="form.language" label="Language" /></v-col>
          <v-col cols="12" md="6"
            ><v-text-field v-model="form.tags" label="Tags (separate with ,)"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-text-field v-model="form.callNumber" label="Call number"
          /></v-col>
          <v-col v-if="form.itemType === 'E_RESOURCE'" cols="12"
            ><v-text-field v-model="form.url" label="Link (URL)"
          /></v-col>
          <v-col cols="6" md="3"
            ><v-text-field v-model="form.copies" label="Copies" type="number"
          /></v-col>
          <v-col cols="6" md="3"><v-text-field v-model="form.shelf" label="Shelf" /></v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="formOpen = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!form.title || !form.institutionId" @click="createBook"
          >Create</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="importOpen" max-width="620">
    <v-card>
      <v-card-title>Import titles (CSV / XLSX)</v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          Columns:
          <code
            >isbn, title, subtitle, authors, publisher, edition, year, category, language, tags,
            call_number, type, url, description, copies, shelf, rack</code
          >. Existing titles (matched by ISBN, or by title when ISBN is empty) are updated and
          topped up to the given number of copies.
        </p>
        <v-select
          v-model="importInstitution"
          :items="institutions"
          item-title="name"
          item-value="id"
          label="Library (institution)"
        />
        <v-file-input v-model="importFile" label="File" accept=".csv,.xlsx" />
        <v-alert v-if="importResult" type="success" variant="tonal">
          Created {{ importResult.created }}, updated {{ importResult.updated }}, copies added
          {{ importResult.copiesCreated }}.
          <div v-for="er in importResult.errors" :key="er.row" class="text-error">
            Row {{ er.row }}: {{ er.message }}
          </div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="importOpen = false">Close</v-btn>
        <v-btn color="primary" :disabled="!importFile || !importInstitution" @click="runImport"
          >Import</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
