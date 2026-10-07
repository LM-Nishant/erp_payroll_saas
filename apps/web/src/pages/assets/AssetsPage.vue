<script setup lang="ts">
import { ASSET_CONDITIONS, ASSET_STATUSES } from '@erp/shared';
import type { ApiListResponse, AssetDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { ASSET_STATUS_COLORS, clean, label, money, useAssetOptions, opts } from './assetUi';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { institutions, categories, departments, campuses, loadBase, loadForInstitution } =
  useAssetOptions();
const items = ref<AssetDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const selected = ref<string[]>([]);
const filters = reactive({
  search: '',
  institutionId: '',
  categoryId: '',
  status: (route.query.status as string) ?? '',
});
const headers = [
  { title: 'Tag', key: 'assetTag' },
  { title: 'Name', key: 'name' },
  { title: 'Category', key: 'category.name' },
  { title: 'Institution', key: 'institution.name' },
  { title: 'Location', key: 'location' },
  { title: 'Custodian', key: 'custodian.displayName' },
  { title: 'Status', key: 'status' },
  { title: 'Book value', key: 'bookValue', align: 'end' as const },
];

const formOpen = ref(false);
const blank = () => ({
  institutionId: '',
  campusId: '',
  departmentId: '',
  categoryId: '',
  assetTag: '',
  name: '',
  make: '',
  model: '',
  serialNo: '',
  vendor: '',
  invoiceNo: '',
  purchaseDate: '',
  purchaseCost: 0,
  warrantyExpiry: '',
  location: '',
  condition: 'NEW',
});
const form = reactive(blank());

function query() {
  const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  return p;
}
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<AssetDto>>(`/api/v1/assets?${query()}`);
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function create() {
  try {
    const r = await apiFetch<{ data: AssetDto }>('/api/v1/assets', {
      method: 'POST',
      body: JSON.stringify(
        clean({
          ...form,
          assetTag: form.assetTag || undefined,
          purchaseCost: Number(form.purchaseCost),
        }),
      ),
    });
    formOpen.value = false;
    Object.assign(form, blank());
    await router.push({ name: 'assets-detail', params: { id: r.data.id } });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function printLabels() {
  try {
    const p = new URLSearchParams();
    if (selected.value.length) p.set('assetIds', selected.value.join(','));
    else if (filters.institutionId) {
      p.set('institutionId', filters.institutionId);
      if (filters.categoryId) p.set('categoryId', filters.categoryId);
    } else {
      error.value = 'Select assets or filter by institution to print labels';
      return;
    }
    await apiDownload(`/api/v1/assets/labels?${p}`, 'asset-labels.pdf');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function openRow(_e: unknown, row: { item: AssetDto }) {
  void router.push({ name: 'assets-detail', params: { id: row.item.id } });
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
watch([page, () => filters.institutionId, () => filters.categoryId, () => filters.status], load);
watch(
  () => form.institutionId,
  (id) => loadForInstitution(id),
);
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
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Assets</h2>
    <v-spacer />
    <v-btn variant="text" prepend-icon="mdi-qrcode" class="mr-2" @click="printLabels"
      >Print labels{{ selected.length ? ` (${selected.length})` : '' }}</v-btn
    >
    <v-btn
      v-if="auth.can('asset.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="formOpen = true"
      >New asset</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="3"
      ><v-text-field
        v-model="filters.search"
        label="Search tag / name / serial"
        density="compact"
        hide-details
    /></v-col>
    <v-col cols="12" md="3"
      ><v-autocomplete
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="12" md="3"
      ><v-autocomplete
        v-model="filters.categoryId"
        :items="categories"
        item-title="name"
        item-value="id"
        label="Category"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="12" md="3"
      ><v-select
        v-model="filters.status"
        :items="ASSET_STATUSES.map((s) => ({ title: label(s), value: s }))"
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
    :items-per-page="25"
    :loading="loading"
    item-value="id"
    show-select
    hover
    @update:page="page = $event"
    @click:row="openRow"
  >
    <template #[`item.status`]="{ item }"
      ><v-chip size="small" :color="ASSET_STATUS_COLORS[item.status]">{{
        label(item.status)
      }}</v-chip></template
    >
    <template #[`item.bookValue`]="{ item }">{{ money(item.bookValue) }}</template>
  </v-data-table-server>

  <v-dialog v-model="formOpen" max-width="760">
    <v-card>
      <v-card-title>New asset</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" md="6"
            ><v-autocomplete
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution *"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-autocomplete
              v-model="form.categoryId"
              :items="categories"
              item-title="name"
              item-value="id"
              label="Category *"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-select
              v-model="form.campusId"
              :items="campuses"
              item-title="name"
              item-value="id"
              label="Campus"
              clearable
          /></v-col>
          <v-col cols="12" md="6"
            ><v-select
              v-model="form.departmentId"
              :items="departments"
              item-title="name"
              item-value="id"
              label="Department"
              clearable
          /></v-col>
          <v-col cols="12" md="8"><v-text-field v-model="form.name" label="Name *" /></v-col>
          <v-col cols="12" md="4"
            ><v-text-field v-model="form.assetTag" label="Tag (auto if blank)"
          /></v-col>
          <v-col cols="12" md="4"><v-text-field v-model="form.make" label="Make" /></v-col>
          <v-col cols="12" md="4"><v-text-field v-model="form.model" label="Model" /></v-col>
          <v-col cols="12" md="4"><v-text-field v-model="form.serialNo" label="Serial no" /></v-col>
          <v-col cols="12" md="4"><v-text-field v-model="form.vendor" label="Vendor" /></v-col>
          <v-col cols="12" md="4"
            ><v-text-field v-model="form.invoiceNo" label="Invoice no"
          /></v-col>
          <v-col cols="12" md="4"
            ><v-text-field v-model="form.purchaseDate" type="date" label="Purchase date"
          /></v-col>
          <v-col cols="12" md="4"
            ><v-text-field v-model.number="form.purchaseCost" type="number" label="Cost (₹)"
          /></v-col>
          <v-col cols="12" md="4"
            ><v-text-field v-model="form.warrantyExpiry" type="date" label="Warranty expiry"
          /></v-col>
          <v-col cols="12" md="4"
            ><v-select v-model="form.condition" :items="opts(ASSET_CONDITIONS)" label="Condition"
          /></v-col>
          <v-col cols="12"
            ><v-text-field v-model="form.location" label="Location (building / room)"
          /></v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="formOpen = false">Cancel</v-btn>
        <v-btn color="primary" @click="create">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
