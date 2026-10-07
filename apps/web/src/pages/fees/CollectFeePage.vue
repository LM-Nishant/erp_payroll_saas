<script setup lang="ts">
import type { FeePaymentDto, StudentFeeSummaryDto } from '@erp/shared';
import { PAYMENT_MODES } from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import StudentPicker from './StudentPicker.vue';
import { errorText, money, todayStr } from './fees';

const route = useRoute();
const studentId = ref<string | null>((route.query.studentId as string) || null);
const summary = ref<StudentFeeSummaryDto | null>(null);
const error = ref<string | null>(null);
const lastReceipt = ref<FeePaymentDto | null>(null);
const saving = ref(false);
const form = reactive({
  amount: 0,
  paidOn: todayStr(),
  mode: 'CASH',
  reference: '',
  bankName: '',
  remarks: '',
});
const selected = ref<string[]>([]);
const openInvoices = computed(
  () =>
    summary.value?.invoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL') ?? [],
);
const selectedTotal = computed(() =>
  openInvoices.value
    .filter((i) => selected.value.includes(i.id))
    .reduce((s, i) => s + i.balance, 0),
);

async function loadSummary() {
  summary.value = null;
  lastReceipt.value = null;
  selected.value = [];
  if (!studentId.value) return;
  try {
    summary.value = (
      await apiFetch<{ data: StudentFeeSummaryDto }>(
        `/api/v1/fees/students/${studentId.value}/summary`,
      )
    ).data;
    selected.value = openInvoices.value.map((i) => i.id);
    form.amount = Math.round(selectedTotal.value * 100) / 100;
  } catch (e) {
    error.value = errorText(e);
  }
}
watch(studentId, loadSummary, { immediate: true });
watch(selectedTotal, (v) => (form.amount = Math.round(v * 100) / 100));

async function collect() {
  if (!studentId.value) return;
  saving.value = true;
  error.value = null;
  try {
    // Explicit allocation to the ticked invoices (oldest first); any excess stays as advance.
    let remaining = Math.round(Number(form.amount) * 100);
    const allocations = [];
    for (const inv of openInvoices.value.filter((i) => selected.value.includes(i.id))) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.round(inv.balance * 100));
      if (take > 0) allocations.push({ invoiceId: inv.id, amount: take / 100 });
      remaining -= take;
    }
    const r = await apiFetch<{ data: FeePaymentDto }>('/api/v1/fees/payments', {
      method: 'POST',
      body: JSON.stringify({
        studentId: studentId.value,
        amount: Number(form.amount),
        paidOn: form.paidOn,
        mode: form.mode,
        reference: form.reference || null,
        bankName: form.bankName || null,
        remarks: form.remarks || null,
        allocations,
      }),
    });
    const receipt = r.data;
    await loadSummary();
    lastReceipt.value = receipt;
    form.reference = '';
    form.remarks = '';
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
async function download(p: FeePaymentDto) {
  try {
    await apiDownload(`/api/v1/fees/payments/${p.id}/receipt`, `receipt-${p.number}.pdf`);
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>
<template>
  <h2 class="text-h5 mb-4">Collect fee</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-3"
    ><v-col cols="12" md="6"><StudentPicker v-model="studentId" /></v-col
  ></v-row>
  <v-alert v-if="lastReceipt" type="success" class="mb-3"
    >Receipt {{ lastReceipt.number }} recorded for {{ money(lastReceipt.amount) }}.
    <template #append
      ><v-btn variant="text" prepend-icon="mdi-download" @click="download(lastReceipt)"
        >Receipt PDF</v-btn
      ></template
    ></v-alert
  >
  <template v-if="summary">
    <v-row dense class="mb-3">
      <v-col v-for="(v, k) in summary.totals" :key="k" cols="6" md="3"
        ><v-card variant="tonal"
          ><v-card-text
            ><div class="text-caption text-uppercase">{{ k }}</div>
            <div class="text-h6">{{ money(v) }}</div></v-card-text
          ></v-card
        ></v-col
      >
    </v-row>
    <v-row>
      <v-col cols="12" md="7">
        <v-card variant="outlined"
          ><v-card-title>Open invoices</v-card-title
          ><v-table density="compact">
            <thead>
              <tr>
                <th></th>
                <th>Invoice</th>
                <th>Description</th>
                <th>Due</th>
                <th class="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in openInvoices" :key="i.id">
                <td>
                  <v-checkbox-btn v-model="selected" :value="i.id" density="compact" />
                </td>
                <td>{{ i.number }}</td>
                <td>{{ i.description }}</td>
                <td>{{ i.dueDate }}</td>
                <td class="text-right">{{ money(i.balance) }}</td>
              </tr>
              <tr v-if="!openInvoices.length">
                <td colspan="5" class="text-medium-emphasis">No dues — all invoices are paid.</td>
              </tr>
            </tbody></v-table
          ></v-card
        >
      </v-col>
      <v-col cols="12" md="5">
        <v-card variant="outlined"
          ><v-card-title>Payment</v-card-title
          ><v-card-text
            ><v-row dense
              ><v-col cols="6"
                ><v-text-field v-model.number="form.amount" label="Amount" type="number" /></v-col
              ><v-col cols="6"
                ><v-text-field v-model="form.paidOn" label="Date" type="date" /></v-col
              ><v-col cols="6"
                ><v-select
                  v-model="form.mode"
                  :items="[...PAYMENT_MODES] as string[]"
                  label="Mode" /></v-col
              ><v-col cols="6"
                ><v-text-field
                  v-model="form.reference"
                  label="Reference (cheque / UTR / txn)" /></v-col
              ><v-col v-if="form.mode === 'CHEQUE' || form.mode === 'BANK_TRANSFER'" cols="12"
                ><v-text-field v-model="form.bankName" label="Bank" /></v-col
              ><v-col cols="12"
                ><v-text-field v-model="form.remarks" label="Remarks" /></v-col></v-row
          ></v-card-text>
          <v-card-actions
            ><v-spacer /><v-btn
              color="primary"
              :loading="saving"
              :disabled="!form.amount"
              @click="collect"
              >Collect {{ money(form.amount) }}</v-btn
            ></v-card-actions
          ></v-card
        >
      </v-col>
    </v-row>
    <v-card variant="outlined" class="mt-3"
      ><v-card-title>Recent receipts</v-card-title
      ><v-table density="compact">
        <tbody>
          <tr v-for="p in summary.payments" :key="p.id">
            <td>{{ p.number }}</td>
            <td>{{ p.paidOn }}</td>
            <td>{{ p.mode }}</td>
            <td class="text-right">{{ money(p.amount) }}</td>
            <td>{{ p.status }}</td>
            <td class="text-right">
              <v-btn size="small" variant="text" icon="mdi-download" @click="download(p)" />
            </td>
          </tr></tbody></v-table
    ></v-card>
  </template>
</template>
