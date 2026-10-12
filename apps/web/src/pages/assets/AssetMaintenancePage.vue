<script setup lang="ts">
import {
  ASSET_CONDITIONS,
  ASSET_MAINTENANCE_PRIORITIES,
  ASSET_MAINTENANCE_STATUSES,
  ASSET_MAINTENANCE_TYPES,
} from '@erp/shared';
import type { ApiListResponse, AssetMaintenanceDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { ASSET_STATUS_COLORS, clean, label, money, useAssetOptions, opts } from './assetUi';

const auth = useAuthStore();
const route = useRoute();
const { institutions, loadBase } = useAssetOptions();
const items = ref<AssetMaintenanceDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
// Notification links deep-link a ticket via `?search=<ticketNo>`.
const initialSearch = typeof route.query.search === 'string' ? route.query.search : '';
const filters = reactive({
  institutionId: '',
  type: '',
  status: '',
  open: initialSearch ? '' : 'true',
  search: initialSearch,
});
const headers = [
  { title: 'Ticket', key: 'ticketNo' },
  { title: 'Asset', key: 'asset' },
  { title: 'Type', key: 'type' },
  { title: 'Priority', key: 'priority' },
  { title: 'Title', key: 'title' },
  { title: 'Scheduled', key: 'scheduledDate' },
  { title: 'Status', key: 'status' },
  { title: 'Cost', key: 'cost', align: 'end' as const },
];
const editing = ref<AssetMaintenanceDto | null>(null);
const form = reactive({
  status: 'IN_PROGRESS',
  vendor: '',
  cost: 0 as number | string,
  underWarranty: false,
  resolution: '',
  completedAt: '',
  nextServiceDate: '',
  condition: '',
});
const newOpen = ref(false);
const newForm = reactive({
  assetTag: '',
  type: 'PREVENTIVE',
  priority: 'MEDIUM',
  title: '',
  vendor: '',
  scheduledDate: '',
});

async function load() {
  loading.value = true;
  try {
    const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const r = await apiFetch<ApiListResponse<AssetMaintenanceDto>>(
      `/api/v1/assets/maintenance?${p}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function openRow(_e: unknown, row: { item: AssetMaintenanceDto }) {
  if (!auth.can('asset.maintain')) return;
  const m = row.item;
  editing.value = m;
  Object.assign(form, {
    status: m.status === 'OPEN' ? 'IN_PROGRESS' : m.status,
    vendor: m.vendor ?? '',
    cost: m.cost,
    underWarranty: m.underWarranty,
    resolution: m.resolution ?? '',
    completedAt: m.completedAt ?? '',
    nextServiceDate: m.nextServiceDate ?? '',
    condition: '',
  });
}
async function save() {
  if (!editing.value) return;
  try {
    await apiFetch(`/api/v1/assets/maintenance/${editing.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...clean({ ...form, cost: undefined, condition: form.condition || undefined }),
        cost: Number(form.cost),
      }),
    });
    editing.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function create() {
  try {
    const found = await apiFetch<ApiListResponse<{ id: string; assetTag: string }>>(
      `/api/v1/assets?assetTag=${encodeURIComponent(newForm.assetTag.trim())}&pageSize=5`,
    );
    const asset = found.data.find((a) => a.assetTag === newForm.assetTag) ?? found.data[0];
    if (!asset) throw new Error(`Asset ${newForm.assetTag} not found`);
    await apiFetch('/api/v1/assets/maintenance', {
      method: 'POST',
      body: JSON.stringify(clean({ ...newForm, assetTag: undefined, assetId: asset.id })),
    });
    newOpen.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
watch([page, () => ({ ...filters })], load, { deep: true });
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Maintenance</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('asset.maintain')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="newOpen = true"
      >New ticket</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="3"
      ><v-text-field
        v-model.trim="filters.search"
        label="Search ticket / asset"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        clearable
        hide-details
        @click:clear="filters.search = ''"
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
    <v-col cols="6" md="2"
      ><v-select
        v-model="filters.type"
        :items="opts(ASSET_MAINTENANCE_TYPES)"
        label="Type"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="6" md="2"
      ><v-select
        v-model="filters.status"
        :items="opts(ASSET_MAINTENANCE_STATUSES)"
        label="Status"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="6" md="2"
      ><v-checkbox
        :model-value="filters.open === 'true'"
        label="Open only"
        density="compact"
        hide-details
        @update:model-value="filters.open = $event ? 'true' : ''"
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
    <template #[`item.asset`]="{ item }"
      ><router-link :to="`/assets/register/${item.assetId}`" @click.stop
        >{{ item.asset?.assetTag }} · {{ item.asset?.name }}</router-link
      ></template
    >
    <template #[`item.type`]="{ item }">{{ label(item.type) }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small" :color="ASSET_STATUS_COLORS[item.status]">{{
        label(item.status)
      }}</v-chip></template
    >
    <template #[`item.cost`]="{ item }">{{ money(item.cost) }}</template>
  </v-data-table-server>

  <v-dialog :model-value="!!editing" max-width="600" @update:model-value="editing = null">
    <v-card v-if="editing" :title="`${editing.ticketNo} · ${editing.title}`">
      <v-card-text>
        <p class="mb-3 text-body-2">{{ editing.description }}</p>
        <v-row dense>
          <v-col cols="6"
            ><v-select
              v-model="form.status"
              :items="opts(ASSET_MAINTENANCE_STATUSES)"
              label="Status"
          /></v-col>
          <v-col cols="6"><v-text-field v-model="form.vendor" label="Vendor" /></v-col>
          <v-col cols="6"
            ><v-text-field v-model="form.cost" type="number" label="Cost (₹)"
          /></v-col>
          <v-col cols="6"
            ><v-checkbox v-model="form.underWarranty" label="Under warranty / AMC"
          /></v-col>
          <v-col cols="6"
            ><v-text-field v-model="form.completedAt" type="date" label="Completed on"
          /></v-col>
          <v-col cols="6"
            ><v-text-field v-model="form.nextServiceDate" type="date" label="Next service"
          /></v-col>
          <v-col cols="6"
            ><v-select
              v-model="form.condition"
              :items="opts(ASSET_CONDITIONS)"
              label="Condition after"
              clearable
          /></v-col>
          <v-col cols="12"
            ><v-textarea v-model="form.resolution" label="Resolution" rows="2"
          /></v-col>
        </v-row>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="editing = null">Close</v-btn
        ><v-btn color="primary" @click="save">Save</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
  <v-dialog v-model="newOpen" max-width="560">
    <v-card title="New maintenance ticket">
      <v-card-text>
        <v-text-field v-model="newForm.assetTag" label="Asset tag" />
        <v-select v-model="newForm.type" :items="opts(ASSET_MAINTENANCE_TYPES)" label="Type" />
        <v-select
          v-model="newForm.priority"
          :items="opts(ASSET_MAINTENANCE_PRIORITIES)"
          label="Priority"
        />
        <v-text-field v-model="newForm.title" label="Title" />
        <v-text-field v-model="newForm.vendor" label="Vendor" />
        <v-text-field v-model="newForm.scheduledDate" type="date" label="Scheduled" />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="newOpen = false">Cancel</v-btn
        ><v-btn color="primary" @click="create">Create</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
