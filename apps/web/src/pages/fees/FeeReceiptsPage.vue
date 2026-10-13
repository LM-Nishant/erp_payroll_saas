<script setup lang="ts">
import type { ApiListResponse, FeePaymentDto } from '@erp/shared';
import { PAYMENT_MODES } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import StudentPicker from './StudentPicker.vue';
import { errorText, loadInstitutions, money, qs, todayStr, type Option } from './fees';

const auth = useAuthStore();
const canRefund = computed(() => auth.can('fee.refund'));
const items = ref<FeePaymentDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const filters = reactive({
  institutionId: '',
  studentId: null as string | null,
  mode: '',
  status: '',
  from: '',
  to: '',
});
const headers = [
  { title: 'Receipt', key: 'number' },
  { title: 'Date', key: 'paidOn' },
  { title: 'Student', key: 'student.displayName' },
  { title: 'Mode', key: 'mode' },
  { title: 'Reference', key: 'reference' },
  { title: 'Amount', key: 'amount', align: 'end' as const },
  { title: 'Refunded', key: 'refundedAmount', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<FeePaymentDto>>(
      `/api/v1/fees/payments?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function download(p: FeePaymentDto) {
  try {
    await apiDownload(`/api/v1/fees/payments/${p.id}/receipt`, `receipt-${p.number}.pdf`);
  } catch (e) {
    error.value = errorText(e);
  }
}
async function cancel(p: FeePaymentDto) {
  const reason = prompt(`Reason for cancelling receipt ${p.number}?`);
  if (!reason) return;
  try {
    await apiFetch(`/api/v1/fees/payments/${p.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
const refundFor = ref<FeePaymentDto | null>(null);
const refund = reactive({
  amount: 0,
  mode: 'UPI',
  reference: '',
  reason: '',
  refundedOn: todayStr(),
});
function openRefund(p: FeePaymentDto) {
  refundFor.value = p;
  Object.assign(refund, {
    amount: Math.round((p.amount - p.refundedAmount) * 100) / 100,
    mode: 'UPI',
    reference: '',
    reason: '',
    refundedOn: todayStr(),
  });
}
async function saveRefund() {
  if (!refundFor.value) return;
  try {
    await apiFetch(`/api/v1/fees/payments/${refundFor.value.id}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        ...refund,
        amount: Number(refund.amount),
        reference: refund.reference.trim(),
      }),
    });
    refundFor.value = null;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  institutions.value = await loadInstitutions();
  await load();
});
watch([page, () => ({ ...filters })], load, { deep: true });
</script>
<template>
  <h2 class="text-h5 mb-4">Receipts</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="3"
      ><v-select
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="3"><StudentPicker v-model="filters.studentId" density="compact" /></v-col
    ><v-col cols="6" md="2"
      ><v-select
        v-model="filters.mode"
        :items="[...PAYMENT_MODES] as string[]"
        label="Mode"
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
    <template #[`item.refundedAmount`]="{ item }">{{ money(item.refundedAmount) }}</template>
    <template #[`item.status`]="{ item }"
      ><v-chip size="small">{{ item.status }}</v-chip></template
    >
    <template #[`item.actions`]="{ item }">
      <v-btn
        size="small"
        variant="text"
        icon="mdi-download"
        title="Receipt PDF"
        @click="download(item)"
      />
      <template v-if="canRefund && item.status !== 'CANCELLED'">
        <v-btn
          v-if="item.amount > item.refundedAmount"
          size="small"
          variant="text"
          icon="mdi-cash-refund"
          title="Refund"
          @click="openRefund(item)"
        />
        <v-btn
          v-if="item.refundedAmount === 0"
          size="small"
          variant="text"
          icon="mdi-cancel"
          title="Cancel receipt"
          @click="cancel(item)"
        />
      </template>
    </template>
  </v-data-table-server>
  <v-dialog :model-value="!!refundFor" max-width="520" @update:model-value="refundFor = null"
    ><v-card v-if="refundFor"
      ><v-card-title>Refund {{ refundFor.number }}</v-card-title
      ><v-card-text
        ><v-row dense
          ><v-col cols="6"
            ><v-text-field v-model.number="refund.amount" label="Amount" type="number" /></v-col
          ><v-col cols="6"
            ><v-text-field v-model="refund.refundedOn" label="Date" type="date" /></v-col
          ><v-col cols="12"
            ><v-alert type="info" variant="tonal" density="compact"
              >Refunds are sent back via <strong>UPI</strong> only. Enter the UTR of the refund
              transfer.</v-alert
            ></v-col
          ><v-col cols="12"
            ><v-text-field
              v-model="refund.reference"
              label="Refund UPI UTR *"
              :rules="[
                (v: string) =>
                  /^[A-Za-z0-9-]{6,64}$/.test((v ?? '').trim()) || 'Enter the 6–64 character UTR',
              ]" /></v-col
          ><v-col cols="12"
            ><v-text-field v-model="refund.reason" label="Reason" /></v-col></v-row></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="refundFor = null">Cancel</v-btn
        ><v-btn
          color="primary"
          :disabled="
            !/^[A-Za-z0-9-]{6,64}$/.test(refund.reference.trim()) || refund.reason.trim().length < 3
          "
          @click="saveRefund"
          >Refund via UPI</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
