<script setup lang="ts">
import type { ApiListResponse, ExpenseDto, LedgerAccountDto, VendorDto } from '@erp/shared';
import { PAYMENT_MODES } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errorText, loadInstitutions, money, qs, todayStr, type Option } from '../fees/fees';

const auth = useAuthStore();
const canManage = computed(() => auth.can('finance.manage'));
const tab = ref('expenses');
const items = ref<ExpenseDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const vendors = ref<VendorDto[]>([]);
const accounts = ref<LedgerAccountDto[]>([]);
const expenseAccounts = computed(() =>
  accounts.value.filter((a) => a.type === 'EXPENSE' && !a.isGroup && a.active),
);
const filters = reactive({ institutionId: '', vendorId: '', from: '', to: '' });
const headers = [
  { title: 'Number', key: 'number' },
  { title: 'Date', key: 'expenseDate' },
  { title: 'Vendor', key: 'vendorName' },
  { title: 'Expense head', key: 'expenseAccountName' },
  { title: 'Description', key: 'description' },
  { title: 'Mode', key: 'mode' },
  { title: 'Amount', key: 'amount', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<ExpenseDto>>(
      `/api/v1/finance/expenses?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function loadVendors() {
  vendors.value = (
    await apiFetch<ApiListResponse<VendorDto>>('/api/v1/finance/vendors?pageSize=100').catch(
      () => ({ data: [] as VendorDto[] }),
    )
  ).data;
}
const dialog = ref(false);
const form = reactive({
  institutionId: '',
  expenseDate: todayStr(),
  vendorId: null as string | null,
  expenseAccountId: '',
  amount: 0,
  mode: 'BANK_TRANSFER',
  reference: '',
  description: '',
});
function openCreate() {
  Object.assign(form, {
    institutionId: institutions.value[0]?.id ?? '',
    expenseDate: todayStr(),
    vendorId: null,
    expenseAccountId: expenseAccounts.value[0]?.id ?? '',
    amount: 0,
    mode: 'BANK_TRANSFER',
    reference: '',
    description: '',
  });
  dialog.value = true;
}
async function save() {
  try {
    await apiFetch('/api/v1/finance/expenses', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        amount: Number(form.amount),
        reference: form.reference || null,
      }),
    });
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function cancel(x: ExpenseDto) {
  const reason = prompt(`Reason for cancelling ${x.number}?`);
  if (!reason) return;
  try {
    await apiFetch(`/api/v1/finance/expenses/${x.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
const vendorDialog = ref(false);
const vendorForm = reactive({ code: '', name: '', gstin: '', phone: '', email: '', address: '' });
async function saveVendor() {
  try {
    const body = Object.fromEntries(
      Object.entries(vendorForm).map(([k, v]) => [
        k,
        v === '' && k !== 'code' && k !== 'name' ? null : v,
      ]),
    );
    await apiFetch('/api/v1/finance/vendors', { method: 'POST', body: JSON.stringify(body) });
    vendorDialog.value = false;
    Object.assign(vendorForm, { code: '', name: '', gstin: '', phone: '', email: '', address: '' });
    await loadVendors();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  institutions.value = await loadInstitutions();
  accounts.value = (
    await apiFetch<{ data: LedgerAccountDto[] }>('/api/v1/finance/accounts').catch(() => ({
      data: [] as LedgerAccountDto[],
    }))
  ).data;
  await Promise.all([load(), loadVendors()]);
});
watch([page, () => ({ ...filters })], load, { deep: true });
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Expenses &amp; vendor payments</h2>
    <v-spacer />
    <template v-if="canManage"
      ><v-btn v-if="tab === 'expenses'" color="primary" prepend-icon="mdi-plus" @click="openCreate"
        >Record expense</v-btn
      ><v-btn v-else color="primary" prepend-icon="mdi-plus" @click="vendorDialog = true"
        >New vendor</v-btn
      ></template
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-tabs v-model="tab" class="mb-3"
    ><v-tab value="expenses">Expenses</v-tab><v-tab value="vendors">Vendors</v-tab></v-tabs
  >
  <template v-if="tab === 'expenses'">
    <v-row dense class="mb-2"
      ><v-col cols="12" md="4"
        ><v-select
          v-model="filters.institutionId"
          :items="institutions"
          item-title="name"
          item-value="id"
          label="Institution"
          clearable
          density="compact"
          hide-details /></v-col
      ><v-col cols="12" md="4"
        ><v-select
          v-model="filters.vendorId"
          :items="vendors"
          item-title="name"
          item-value="id"
          label="Vendor"
          clearable
          density="compact"
          hide-details /></v-col
      ><v-col cols="6" md="2"
        ><v-text-field
          v-model="filters.from"
          label="From"
          type="date"
          density="compact"
          hide-details /></v-col
      ><v-col cols="6" md="2"
        ><v-text-field
          v-model="filters.to"
          label="To"
          type="date"
          density="compact"
          hide-details /></v-col
    ></v-row>
    <v-data-table-server
      :headers="headers"
      :items="items"
      :items-length="total"
      :page="page"
      :loading="loading"
      item-value="id"
      @update:page="page = $event"
    >
      <template #[`item.amount`]="{ item }">{{ money(item.amount) }}</template>
      <template #[`item.status`]="{ item }"
        ><v-chip size="small">{{ item.status }}</v-chip></template
      >
      <template #[`item.actions`]="{ item }"
        ><v-btn
          v-if="canManage && item.status !== 'CANCELLED'"
          size="small"
          variant="text"
          icon="mdi-cancel"
          title="Cancel"
          @click="cancel(item)"
      /></template>
    </v-data-table-server>
  </template>
  <v-table v-else density="compact">
    <thead>
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>GSTIN</th>
        <th>Phone</th>
        <th>Email</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="v in vendors" :key="v.id">
        <td>{{ v.code }}</td>
        <td>{{ v.name }}</td>
        <td>{{ v.gstin }}</td>
        <td>{{ v.phone }}</td>
        <td>{{ v.email }}</td>
      </tr>
    </tbody>
  </v-table>

  <v-dialog v-model="dialog" max-width="640"
    ><v-card
      ><v-card-title>Record expense</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="12" md="6"
            ><v-select
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution" /></v-col
          ><v-col cols="12" md="6"
            ><v-text-field v-model="form.expenseDate" label="Date" type="date" /></v-col
          ><v-col cols="12" md="6"
            ><v-select
              v-model="form.vendorId"
              :items="vendors"
              item-title="name"
              item-value="id"
              label="Vendor (optional)"
              clearable /></v-col
          ><v-col cols="12" md="6"
            ><v-autocomplete
              v-model="form.expenseAccountId"
              :items="expenseAccounts"
              :item-title="(a: LedgerAccountDto) => `${a.code} ${a.name}`"
              item-value="id"
              label="Expense head" /></v-col
          ><v-col cols="4"
            ><v-text-field v-model.number="form.amount" label="Amount" type="number" /></v-col
          ><v-col cols="4"
            ><v-select
              v-model="form.mode"
              :items="[...PAYMENT_MODES] as string[]"
              label="Paid by" /></v-col
          ><v-col cols="4"><v-text-field v-model="form.reference" label="Reference" /></v-col
          ><v-col cols="12"
            ><v-text-field
              v-model="form.description"
              label="Description" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="dialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="save">Save</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="vendorDialog" max-width="560"
    ><v-card
      ><v-card-title>New vendor</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="4"><v-text-field v-model="vendorForm.code" label="Code" /></v-col
          ><v-col cols="8"><v-text-field v-model="vendorForm.name" label="Name" /></v-col
          ><v-col cols="6"><v-text-field v-model="vendorForm.gstin" label="GSTIN" /></v-col
          ><v-col cols="6"><v-text-field v-model="vendorForm.phone" label="Phone" /></v-col
          ><v-col cols="12"><v-text-field v-model="vendorForm.email" label="Email" /></v-col
          ><v-col cols="12"
            ><v-text-field
              v-model="vendorForm.address"
              label="Address" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="vendorDialog = false">Cancel</v-btn
        ><v-btn color="primary" @click="saveVendor">Create</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
