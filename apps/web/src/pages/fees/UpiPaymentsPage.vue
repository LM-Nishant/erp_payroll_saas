<script setup lang="ts">
import type { ApiListResponse, FeeUpiPaymentDto } from '@erp/shared';
import { UPI_PAYMENT_STATUSES } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { errorText, loadInstitutions, money, qs, type Option } from './fees';

const items = ref<FeeUpiPaymentDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const busyId = ref<string | null>(null);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const filters = reactive({ institutionId: '', status: 'PENDING' });
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'error',
};
const headers = [
  { title: 'Submitted', key: 'submittedAt' },
  { title: 'Paid on', key: 'paidOn' },
  { title: 'Student', key: 'student' },
  { title: 'Invoices', key: 'invoiceNumbers', sortable: false },
  { title: 'UTR', key: 'utr' },
  { title: 'To UPI ID', key: 'upiId' },
  { title: 'Amount', key: 'amount', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<FeeUpiPaymentDto>>(
      `/api/v1/fees/upi/payments?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

async function verify(u: FeeUpiPaymentDto) {
  if (!confirm(`Confirm UTR ${u.utr} for ${money(u.amount)} is in the bank statement?`)) return;
  busyId.value = u.id;
  try {
    const r = await apiFetch<{ data: FeeUpiPaymentDto }>(
      `/api/v1/fees/upi/payments/${u.id}/verify`,
      { method: 'POST', body: '{}' },
    );
    info.value = `Verified — receipt ${r.data.receiptNumber ?? ''} issued for ${money(u.amount)}.`;
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busyId.value = null;
  }
}

const rejecting = ref<FeeUpiPaymentDto | null>(null);
const rejectReason = ref('');
function openReject(u: FeeUpiPaymentDto) {
  rejectReason.value = '';
  rejecting.value = u;
}
async function reject() {
  if (!rejecting.value) return;
  busyId.value = rejecting.value.id;
  try {
    await apiFetch(`/api/v1/fees/upi/payments/${rejecting.value.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: rejectReason.value.trim() }),
    });
    info.value = `UTR ${rejecting.value.utr} rejected; the payer has been notified.`;
    rejecting.value = null;
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busyId.value = null;
  }
}

onMounted(async () => {
  institutions.value = await loadInstitutions();
  await load();
});
watch(
  () => ({ ...filters }),
  () => {
    page.value = 1;
    void load();
  },
);
watch(page, load);
</script>
<template>
  <h2 class="text-h5 mb-1">UPI verifications</h2>
  <p class="text-medium-emphasis mb-4">
    Students and parents pay fees via UPI and report the UTR. Match each UTR with the bank / UPI
    statement, then verify to issue the receipt or reject it with a reason.
  </p>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
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
    ><v-col cols="6" md="3"
      ><v-select
        v-model="filters.status"
        :items="[...UPI_PAYMENT_STATUSES] as string[]"
        label="Status"
        clearable
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
    data-testid="upi-payments"
    @update:page="page = $event"
  >
    <template #[`item.submittedAt`]="{ item }">{{ item.submittedAt.slice(0, 10) }}</template>
    <template #[`item.student`]="{ item }"
      >{{ item.student?.displayName }}
      <span class="text-caption text-medium-emphasis">{{
        item.student?.admissionNo
      }}</span></template
    >
    <template #[`item.invoiceNumbers`]="{ item }">{{
      (item.invoiceNumbers ?? []).join(', ')
    }}</template>
    <template #[`item.amount`]="{ item }">{{ money(item.amount) }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small" :color="STATUS_COLOR[item.status]">{{ item.status }}</v-chip>
      <div v-if="item.receiptNumber" class="text-caption">Receipt {{ item.receiptNumber }}</div>
      <div v-if="item.rejectReason" class="text-caption text-error">
        {{ item.rejectReason }}
      </div></template
    >
    <template #[`item.actions`]="{ item }">
      <template v-if="item.status === 'PENDING'">
        <v-btn
          size="small"
          variant="text"
          color="success"
          :loading="busyId === item.id"
          @click="verify(item)"
          >Verify</v-btn
        >
        <v-btn
          size="small"
          variant="text"
          color="error"
          :disabled="busyId === item.id"
          @click="openReject(item)"
          >Reject</v-btn
        >
      </template>
    </template>
  </v-data-table-server>
  <v-dialog :model-value="!!rejecting" max-width="460" @update:model-value="rejecting = null"
    ><v-card v-if="rejecting"
      ><v-card-title>Reject UTR {{ rejecting.utr }}</v-card-title
      ><v-card-text
        ><v-text-field
          v-model="rejectReason"
          label="Reason (shown to the payer) *"
          :rules="[(v: string) => (v ?? '').trim().length >= 3 || 'At least 3 characters']"
          data-testid="upi-reject-reason" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="rejecting = null">Close</v-btn
        ><v-btn
          color="error"
          :disabled="rejectReason.trim().length < 3"
          :loading="busyId === rejecting.id"
          @click="reject"
          >Reject</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
