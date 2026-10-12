<script setup lang="ts">
import type { ApiListResponse, InventoryItemDto, InventoryTransactionDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import EmployeePicker from '@/components/EmployeePicker.vue';
import { useAuthStore } from '@/stores/auth';
import { clean, money, useAssetOptions } from './assetUi';

const auth = useAuthStore();
const { institutions, loadBase } = useAssetOptions();
const items = ref<InventoryItemDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const route = useRoute();
// `?lowStock=true` is the deep link of the low-stock notification.
const filters = reactive({
  institutionId: '',
  lowStock: route.query.lowStock === 'true' ? 'true' : '',
  search: '',
});
const headers = [
  { title: 'SKU', key: 'sku' },
  { title: 'Item', key: 'name' },
  { title: 'Category', key: 'category' },
  { title: 'Location', key: 'location' },
  { title: 'On hand', key: 'quantity', align: 'end' as const },
  { title: 'Reorder at', key: 'reorderLevel', align: 'end' as const },
  { title: '', key: 'actions', sortable: false },
];
const newOpen = ref(false);
const newForm = reactive({
  institutionId: '',
  sku: '',
  name: '',
  category: '',
  unit: 'pcs',
  reorderLevel: 0,
  unitCost: '' as number | string,
  location: '',
  openingQuantity: 0,
});
const current = ref<InventoryItemDto | null>(null);
const txns = ref<InventoryTransactionDto[]>([]);
// Stock posting errors (e.g. issuing more than on hand) are shown inside the stock dialog.
const txnError = ref<string | null>(null);
const txn = reactive({
  type: 'OUT',
  quantity: 1,
  reference: '',
  issuedToEmployeeId: null as string | null,
  notes: '',
});

async function load() {
  loading.value = true;
  try {
    const p = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const r = await apiFetch<ApiListResponse<InventoryItemDto>>(`/api/v1/assets/inventory?${p}`);
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
    await apiFetch('/api/v1/assets/inventory', {
      method: 'POST',
      body: JSON.stringify({
        ...clean(newForm),
        reorderLevel: Number(newForm.reorderLevel),
        openingQuantity: Number(newForm.openingQuantity),
        unitCost: newForm.unitCost === '' ? null : Number(newForm.unitCost),
      }),
    });
    newOpen.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function openItem(item: InventoryItemDto) {
  current.value = item;
  txnError.value = null;
  txns.value = (
    await apiFetch<ApiListResponse<InventoryTransactionDto>>(
      `/api/v1/assets/inventory/${item.id}/transactions?pageSize=50`,
    )
  ).data;
}
async function transact() {
  if (!current.value) return;
  txnError.value = null;
  try {
    const r = await apiFetch<{ data: { item: InventoryItemDto } }>(
      `/api/v1/assets/inventory/${current.value.id}/transactions`,
      {
        method: 'POST',
        body: JSON.stringify({ ...clean(txn), quantity: Number(txn.quantity) }),
      },
    );
    await openItem(r.data.item);
    await load();
  } catch (e) {
    txnError.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
watch([page, () => filters.institutionId, () => filters.lowStock], load);
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
    <h2 class="text-h5">Consumables & inventory</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('asset.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="newOpen = true"
      >New item</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="4"
      ><v-text-field v-model="filters.search" label="Search" density="compact" hide-details
    /></v-col>
    <v-col cols="12" md="4"
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
    <v-col cols="12" md="4"
      ><v-checkbox
        :model-value="filters.lowStock === 'true'"
        label="Below reorder level"
        density="compact"
        hide-details
        @update:model-value="filters.lowStock = $event ? 'true' : ''"
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
    @update:page="page = $event"
  >
    <template #[`item.quantity`]="{ item }"
      ><v-chip size="small" :color="item.lowStock ? 'error' : 'success'"
        >{{ item.quantity }} {{ item.unit }}</v-chip
      ></template
    >
    <template #[`item.actions`]="{ item }"
      ><v-btn size="small" variant="text" @click="openItem(item)">Stock</v-btn></template
    >
  </v-data-table-server>

  <v-dialog :model-value="!!current" max-width="760" @update:model-value="current = null">
    <v-card v-if="current" :title="`${current.sku} · ${current.name}`">
      <v-card-text>
        <v-alert
          v-if="txnError"
          type="error"
          density="compact"
          class="mb-3"
          closable
          @click:close="txnError = null"
          >{{ txnError }}</v-alert
        >
        <p class="mb-3">
          On hand <b>{{ current.quantity }} {{ current.unit }}</b> · reorder at
          {{ current.reorderLevel }} · unit cost {{ money(current.unitCost) }}
        </p>
        <v-row v-if="auth.can('asset.manage')" dense>
          <v-col cols="3"
            ><v-select
              v-model="txn.type"
              :items="['IN', 'OUT', 'ADJUST']"
              label="Type"
              density="compact"
          /></v-col>
          <v-col cols="3"
            ><v-text-field
              v-model="txn.quantity"
              type="number"
              :label="txn.type === 'ADJUST' ? 'Counted balance' : 'Quantity'"
              density="compact"
          /></v-col>
          <v-col cols="6"
            ><v-text-field v-model="txn.reference" label="Reference" density="compact"
          /></v-col>
          <v-col v-if="txn.type === 'OUT'" cols="6"
            ><EmployeePicker v-model="txn.issuedToEmployeeId" label="Issued to" density="compact"
          /></v-col>
          <v-col cols="4"
            ><v-text-field v-model="txn.notes" label="Notes" density="compact"
          /></v-col>
          <v-col cols="2"><v-btn color="primary" @click="transact">Post</v-btn></v-col>
        </v-row>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Balance</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in txns" :key="t.id">
              <td>{{ t.date }}</td>
              <td>{{ t.type }}</td>
              <td class="text-right">{{ t.quantity }}</td>
              <td class="text-right">{{ t.balanceAfter }}</td>
              <td>{{ t.reference }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-dialog>
  <v-dialog v-model="newOpen" max-width="640">
    <v-card title="New inventory item">
      <v-card-text>
        <v-row dense>
          <v-col cols="12"
            ><v-autocomplete
              v-model="newForm.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution"
          /></v-col>
          <v-col cols="4"><v-text-field v-model="newForm.sku" label="SKU" /></v-col>
          <v-col cols="8"><v-text-field v-model="newForm.name" label="Name" /></v-col>
          <v-col cols="4"><v-text-field v-model="newForm.category" label="Category" /></v-col>
          <v-col cols="4"><v-text-field v-model="newForm.unit" label="Unit" /></v-col>
          <v-col cols="4"
            ><v-text-field v-model="newForm.unitCost" type="number" label="Unit cost"
          /></v-col>
          <v-col cols="4"
            ><v-text-field v-model="newForm.openingQuantity" type="number" label="Opening qty"
          /></v-col>
          <v-col cols="4"
            ><v-text-field v-model="newForm.reorderLevel" type="number" label="Reorder level"
          /></v-col>
          <v-col cols="4"><v-text-field v-model="newForm.location" label="Store location" /></v-col>
        </v-row>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="newOpen = false">Cancel</v-btn
        ><v-btn color="primary" @click="create">Create</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
