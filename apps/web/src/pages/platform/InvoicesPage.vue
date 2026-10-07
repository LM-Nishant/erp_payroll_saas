<script setup lang="ts">
import {
  INVOICE_STATUSES,
  type ApiListResponse,
  type InvoiceStatus,
  type PlatformInvoiceDto,
} from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import {
  fmtDate,
  invoiceStatusColor,
  invoiceStatusLabel,
  money,
} from '@/components/billing/billing';
import InvoiceActions from '@/components/billing/InvoiceActions.vue';
import InvoiceStatusDialog from '@/components/billing/InvoiceStatusDialog.vue';

/** Platform: invoices across all organizations; verify UPI payments here. */
const invoices = ref<PlatformInvoiceDto[]>([]);
const total = ref(0);
const page = ref(1);
const status = ref<InvoiceStatus | null>('PAYMENT_SUBMITTED');
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    if (status.value) q.set('status', status.value);
    const res = await apiFetch<ApiListResponse<PlatformInvoiceDto>>(
      `/api/v1/platform/invoices?${q}`,
    );
    invoices.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(status, () => {
  page.value = 1;
  void load();
});
watch(page, load);

const statusItems = INVOICE_STATUSES.map((s) => ({ value: s, title: invoiceStatusLabel(s) }));
const headers = [
  { title: 'Organization', key: 'organization' },
  { title: 'Number', key: 'number' },
  { title: 'Period', key: 'periodStart' },
  { title: 'Amount', key: 'amountCents' },
  { title: 'Due', key: 'dueAt' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

const action = ref<'PAID' | 'OPEN' | 'VOID' | null>(null);
const selected = ref<PlatformInvoiceDto | null>(null);
const dialog = ref(false);
function act(inv: PlatformInvoiceDto, a: 'PAID' | 'OPEN' | 'VOID') {
  selected.value = inv;
  action.value = a;
  dialog.value = true;
}
async function pdf(inv: PlatformInvoiceDto) {
  try {
    await apiDownload(
      `/api/v1/platform/organizations/${inv.organization.id}/invoices/${inv.id}/pdf`,
      `${inv.number}.pdf`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Invoices</h2>
    <v-spacer />
    <v-select
      v-model="status"
      :items="statusItems"
      label="Status"
      clearable
      density="compact"
      hide-details
      style="max-width: 240px"
    />
  </div>
  <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-snackbar :model-value="!!notice" color="success" @update:model-value="notice = null">
    {{ notice }}
  </v-snackbar>
  <v-card>
    <v-data-table-server
      v-model:page="page"
      :items="invoices"
      :items-length="total"
      :items-per-page="25"
      :headers="headers"
      :loading="loading"
      density="compact"
      :items-per-page-options="[25]"
    >
      <template #[`item.organization`]="{ item }">
        <router-link :to="`/platform/organizations/${item.organization.id}`">
          {{ item.organization.name }}
        </router-link>
      </template>
      <template #[`item.periodStart`]="{ item }">
        {{ fmtDate(item.periodStart) }} – {{ fmtDate(item.periodEnd) }}
      </template>
      <template #[`item.amountCents`]="{ item }">{{
        money(item.amountCents, item.currency)
      }}</template>
      <template #[`item.dueAt`]="{ item }">{{ fmtDate(item.dueAt) }}</template>
      <template #[`item.status`]="{ item }">
        <v-chip size="small" :color="invoiceStatusColor(item.status)">
          {{ invoiceStatusLabel(item.status) }}
        </v-chip>
        <div v-if="item.submittedReference && item.status !== 'PAID'" class="text-caption">
          UTR {{ item.submittedReference }}
        </div>
      </template>
      <template #[`item.actions`]="{ item }">
        <InvoiceActions :invoice="item" @pdf="pdf(item)" @act="(a) => act(item, a)" />
      </template>
    </v-data-table-server>
  </v-card>
  <InvoiceStatusDialog
    v-if="selected"
    v-model="dialog"
    :organization-id="selected.organization.id"
    :invoice="selected"
    :action="action"
    @saved="
      (inv) => {
        notice = `Invoice ${inv.number} updated`;
        load();
      }
    "
  />
</template>
