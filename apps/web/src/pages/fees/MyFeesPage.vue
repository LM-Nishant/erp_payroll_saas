<script setup lang="ts">
import type { FeePaymentDto, StudentFeeSummaryDto, UpiIntentDto } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { errorText, money, todayStr } from './fees';

const summaries = ref<StudentFeeSummaryDto[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const selected = ref<Record<string, string[]>>({});
const paying = ref<{ summary: StudentFeeSummaryDto; intent: UpiIntentDto } | null>(null);
const utrForm = reactive({ utr: '', paidOn: todayStr(), remarks: '' });
const busy = ref(false);
const UTR = /^[A-Za-z0-9-]{6,64}$/;
const UPI_STATUS_COLOR: Record<string, string> = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'error',
};

const openInvoices = (s: StudentFeeSummaryDto) =>
  s.invoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL');
const pendingInvoiceIds = (s: StudentFeeSummaryDto) =>
  new Set(s.upiPayments.filter((u) => u.status === 'PENDING').flatMap((u) => u.invoiceIds));
const payableInvoices = (s: StudentFeeSummaryDto) => {
  const pending = pendingInvoiceIds(s);
  return openInvoices(s).filter((i) => !pending.has(i.id));
};
const selectedTotal = (s: StudentFeeSummaryDto) =>
  payableInvoices(s)
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
    summaries.value.map((s) => [s.student.id, payableInvoices(s).map((i) => i.id)]),
  );
  if (!summaries.value.length) error.value = 'No fee records found for your account.';
  loading.value = false;
}

async function payNow(s: StudentFeeSummaryDto) {
  busy.value = true;
  error.value = null;
  try {
    const r = await apiFetch<{ data: UpiIntentDto }>('/api/v1/fees/upi/intent', {
      method: 'POST',
      body: JSON.stringify({
        studentId: s.student.id,
        invoiceIds: selected.value[s.student.id] ?? [],
      }),
    });
    Object.assign(utrForm, { utr: '', paidOn: todayStr(), remarks: '' });
    paying.value = { summary: s, intent: r.data };
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

/** The payer reports the UTR from their UPI app; the accountant verifies it and issues the receipt. */
async function submitUtr() {
  if (!paying.value) return;
  busy.value = true;
  try {
    await apiFetch('/api/v1/fees/upi/payments', {
      method: 'POST',
      body: JSON.stringify({
        studentId: paying.value.intent.studentId,
        invoiceIds: paying.value.intent.invoiceIds,
        utr: utrForm.utr.trim(),
        paidOn: utrForm.paidOn,
        remarks: utrForm.remarks.trim() || null,
      }),
    });
    info.value = `UPI payment of ${money(paying.value.intent.amount)} submitted. The receipt is issued once the accounts office verifies UTR ${utrForm.utr.trim().toUpperCase()}.`;
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
                :disabled="!s.upi || pendingInvoiceIds(s).has(i.id)"
              />
            </td>
            <td>{{ i.number }}</td>
            <td>
              {{ i.description }}
              <v-chip
                v-if="pendingInvoiceIds(s).has(i.id)"
                size="x-small"
                color="warning"
                class="ml-1"
                >UPI verification pending</v-chip
              >
            </td>
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
        <span v-if="!s.upi" class="text-medium-emphasis"
          >UPI payment is not set up for this institution yet. Please contact the accounts
          office.</span
        >
        <span v-else class="text-medium-emphasis"
          >Fees are paid via UPI only, to {{ s.upi.upiId }} ({{ s.upi.payeeName }}).</span
        >
        <v-spacer />
        <v-btn
          v-if="s.upi"
          color="primary"
          prepend-icon="mdi-qrcode"
          :loading="busy"
          :disabled="!selectedTotal(s)"
          data-testid="pay-upi"
          @click="payNow(s)"
          >Pay {{ money(selectedTotal(s)) }} via UPI</v-btn
        >
      </div>
      <template v-if="s.upiPayments.length">
        <h4 class="text-subtitle-1 mt-4 mb-1">UPI payments</h4>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Paid on</th>
              <th>UTR</th>
              <th>Invoices</th>
              <th class="text-right">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in s.upiPayments" :key="u.id">
              <td>{{ u.paidOn }}</td>
              <td>{{ u.utr }}</td>
              <td>{{ (u.invoiceNumbers ?? []).join(', ') }}</td>
              <td class="text-right">{{ money(u.amount) }}</td>
              <td>
                <v-chip size="small" :color="UPI_STATUS_COLOR[u.status]">{{
                  u.status === 'PENDING' ? 'Awaiting verification' : u.status
                }}</v-chip>
                <span v-if="u.receiptNumber" class="ml-2 text-caption"
                  >Receipt {{ u.receiptNumber }}</span
                >
                <div v-if="u.rejectReason" class="text-caption text-error">
                  {{ u.rejectReason }}
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
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
  <v-dialog :model-value="!!paying" max-width="520" persistent
    ><v-card v-if="paying"
      ><v-card-title>Pay via UPI</v-card-title
      ><v-card-text>
        <p class="mb-2">
          Pay <strong>{{ money(paying.intent.amount) }}</strong> for
          {{ paying.summary.student.displayName }} to <strong>{{ paying.intent.upiId }}</strong> ({{
            paying.intent.payeeName
          }}).
        </p>
        <div class="text-center">
          <img
            :src="paying.intent.qrDataUrl"
            alt="UPI QR code"
            width="220"
            height="220"
            data-testid="upi-qr"
          />
          <div class="text-caption mb-2">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM…)</div>
          <v-btn
            :href="paying.intent.upiUri"
            variant="tonal"
            prepend-icon="mdi-cellphone"
            class="mb-3"
            >Open UPI app</v-btn
          >
        </div>
        <v-alert type="info" variant="tonal" density="compact" class="mb-3"
          >After paying, enter the 12-digit UTR / UPI reference number shown in your UPI
          app.</v-alert
        >
        <v-text-field
          v-model="utrForm.utr"
          label="UTR / UPI reference no. *"
          :rules="[(v: string) => UTR.test((v ?? '').trim()) || 'Enter the 6–64 character UTR']"
          data-testid="upi-utr"
        />
        <v-text-field v-model="utrForm.paidOn" label="Paid on" type="date" :max="todayStr()" />
        <v-text-field v-model="utrForm.remarks" label="Remarks (optional)" /> </v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" :disabled="busy" @click="paying = null">Cancel</v-btn
        ><v-btn
          color="primary"
          :loading="busy"
          :disabled="!UTR.test(utrForm.utr.trim())"
          data-testid="upi-submit"
          @click="submitUtr"
          >I have paid — submit UTR</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
