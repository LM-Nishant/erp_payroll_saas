<script setup lang="ts">
import type { CheckoutDto, FeePaymentDto, StudentFeeSummaryDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { errorText, money } from './fees';

const summaries = ref<StudentFeeSummaryDto[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const selected = ref<Record<string, string[]>>({});
const paying = ref<{ summary: StudentFeeSummaryDto; order: CheckoutDto } | null>(null);
const busy = ref(false);

const openInvoices = (s: StudentFeeSummaryDto) =>
  s.invoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL');
const selectedTotal = (s: StudentFeeSummaryDto) =>
  openInvoices(s)
    .filter((i) => (selected.value[s.student.id] ?? []).includes(i.id))
    .reduce((t, i) => t + i.balance, 0);

async function load() {
  loading.value = true;
  error.value = null;
  const [me, wards] = await Promise.all([
    apiFetch<{ data: StudentFeeSummaryDto }>('/api/v1/fees/me')
      .then((r) => [r.data])
      .catch(() => [] as StudentFeeSummaryDto[]),
    apiFetch<{ data: StudentFeeSummaryDto[] }>('/api/v1/fees/my-wards')
      .then((r) => r.data)
      .catch(() => [] as StudentFeeSummaryDto[]),
  ]);
  const seen = new Set<string>();
  summaries.value = [...me, ...wards].filter((s) =>
    seen.has(s.student.id) ? false : (seen.add(s.student.id), true),
  );
  selected.value = Object.fromEntries(
    summaries.value.map((s) => [s.student.id, openInvoices(s).map((i) => i.id)]),
  );
  if (!summaries.value.length) error.value = 'No fee records found for your account.';
  loading.value = false;
}

async function payNow(s: StudentFeeSummaryDto) {
  busy.value = true;
  error.value = null;
  try {
    const r = await apiFetch<{ data: CheckoutDto }>('/api/v1/fees/checkout', {
      method: 'POST',
      body: JSON.stringify({
        studentId: s.student.id,
        invoiceIds: selected.value[s.student.id] ?? [],
      }),
    });
    paying.value = { summary: s, order: r.data };
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

/** Mock gateway: simulates the hosted checkout returning a signed success callback. */
async function confirmPayment() {
  if (!paying.value?.order.test) return;
  busy.value = true;
  try {
    const r = await apiFetch<{ data: FeePaymentDto }>('/api/v1/fees/checkout/confirm', {
      method: 'POST',
      body: JSON.stringify({
        orderId: paying.value.order.orderId,
        paymentId: paying.value.order.test.paymentId,
        signature: paying.value.order.test.signature,
      }),
    });
    info.value = `Payment successful — receipt ${r.data.number} for ${money(r.data.amount)}.`;
    paying.value = null;
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function download(p: FeePaymentDto) {
  try {
    await apiDownload(`/api/v1/fees/payments/${p.id}/receipt`, `receipt-${p.number}.pdf`);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(load);
</script>
<template>
  <h2 class="text-h5 mb-4">My fees</h2>
  <v-progress-linear v-if="loading" indeterminate class="mb-3" />
  <v-alert v-if="error" type="info" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-card v-for="s in summaries" :key="s.student.id" class="mb-4" variant="outlined">
    <v-card-title
      >{{ s.student.displayName }}
      <span class="text-medium-emphasis text-body-2"
        >· {{ s.student.admissionNo }} · {{ s.student.classSection?.name }}</span
      ></v-card-title
    >
    <v-card-text>
      <v-row dense class="mb-2">
        <v-col v-for="(v, k) in s.totals" :key="k" cols="6" md="3"
          ><v-sheet rounded border class="pa-2"
            ><div class="text-caption text-uppercase">{{ k }}</div>
            <div class="text-h6" :class="{ 'text-error': k === 'overdue' && v > 0 }">
              {{ money(v) }}
            </div></v-sheet
          ></v-col
        >
      </v-row>
      <h4 class="text-subtitle-1 mb-1">Dues</h4>
      <v-table density="compact">
        <thead>
          <tr>
            <th></th>
            <th>Invoice</th>
            <th>Description</th>
            <th>Due date</th>
            <th class="text-right">Amount</th>
            <th class="text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in openInvoices(s)" :key="i.id">
            <td>
              <v-checkbox-btn
                v-model="selected[s.student.id]"
                :value="i.id"
                density="compact"
                :disabled="!s.onlinePaymentEnabled"
              />
            </td>
            <td>{{ i.number }}</td>
            <td>{{ i.description }}</td>
            <td>{{ i.dueDate }}</td>
            <td class="text-right">{{ money(i.netAmount) }}</td>
            <td class="text-right">{{ money(i.balance) }}</td>
          </tr>
          <tr v-if="!openInvoices(s).length">
            <td colspan="6" class="text-medium-emphasis">No dues. Thank you!</td>
          </tr>
        </tbody>
      </v-table>
      <div v-if="openInvoices(s).length" class="d-flex align-center mt-2">
        <span v-if="!s.onlinePaymentEnabled" class="text-medium-emphasis"
          >Online payment is not available; please pay at the fee counter.</span
        >
        <v-spacer />
        <v-btn
          v-if="s.onlinePaymentEnabled"
          color="primary"
          prepend-icon="mdi-credit-card-outline"
          :loading="busy"
          :disabled="!selectedTotal(s)"
          @click="payNow(s)"
          >Pay {{ money(selectedTotal(s)) }} online</v-btn
        >
      </div>
      <h4 class="text-subtitle-1 mt-4 mb-1">Receipts</h4>
      <v-table density="compact">
        <tbody>
          <tr v-for="p in s.payments" :key="p.id">
            <td>{{ p.number }}</td>
            <td>{{ p.paidOn }}</td>
            <td>{{ p.mode }}</td>
            <td class="text-right">{{ money(p.amount) }}</td>
            <td>{{ p.status }}</td>
            <td class="text-right">
              <v-btn size="small" variant="text" prepend-icon="mdi-download" @click="download(p)"
                >PDF</v-btn
              >
            </td>
          </tr>
          <tr v-if="!s.payments.length">
            <td class="text-medium-emphasis">No payments yet.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
  <v-dialog :model-value="!!paying" max-width="480" persistent
    ><v-card v-if="paying"
      ><v-card-title>Online payment</v-card-title
      ><v-card-text>
        <p>
          Paying <strong>{{ money(paying.order.amount) }}</strong> for
          {{ paying.summary.student.displayName }} via {{ paying.order.provider }} (order
          {{ paying.order.providerOrderId }}).
        </p>
        <v-alert v-if="paying.order.test" type="info" variant="tonal" class="mt-3"
          >Test gateway: no real money is charged. Click “Complete payment” to simulate a successful
          checkout.</v-alert
        ></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" :disabled="busy" @click="paying = null">Cancel</v-btn
        ><v-btn
          color="primary"
          :loading="busy"
          :disabled="!paying.order.test"
          @click="confirmPayment"
          >Complete payment</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
