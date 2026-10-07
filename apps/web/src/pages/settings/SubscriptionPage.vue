<script setup lang="ts">
import {
  LIMITS,
  type ApiListResponse,
  type InvoiceDto,
  type InvoiceUpiPaymentDto,
  type SubscriptionDto,
} from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { invoiceStatusColor, invoiceStatusLabel } from '@/components/billing/billing';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const subscription = ref<SubscriptionDto | null>(null);
const invoices = ref<InvoiceDto[]>([]);
const error = ref<string | null>(null);

async function loadInvoices() {
  invoices.value = (
    await apiFetch<ApiListResponse<InvoiceDto>>('/api/v1/subscription/invoices?pageSize=50')
  ).data;
}

onMounted(async () => {
  try {
    subscription.value = (await apiFetch<{ data: SubscriptionDto }>('/api/v1/subscription')).data;
    if (auth.can('billing.view')) await loadInvoices();
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const notice = ref<string | null>(null);
async function downloadPdf(inv: InvoiceDto) {
  try {
    await apiDownload(`/api/v1/subscription/invoices/${inv.id}/pdf`, `${inv.number}.pdf`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// --- Pay via UPI: scan QR / pay to UPI ID, then report the UTR for verification ---------
const payDialog = ref(false);
const payInvoice = ref<InvoiceDto | null>(null);
const upi = ref<InvoiceUpiPaymentDto | null>(null);
const payError = ref<string | null>(null);
const paying = ref(false);
const payForm = reactive({ reference: '', note: '' });
const utrRule = (v: string) =>
  /^[A-Za-z0-9-]{6,64}$/.test(v?.trim() ?? '') || 'Enter the UPI transaction reference (UTR)';

async function openPay(inv: InvoiceDto) {
  payInvoice.value = inv;
  upi.value = null;
  payError.value = null;
  Object.assign(payForm, { reference: '', note: '' });
  payDialog.value = true;
  try {
    upi.value = (
      await apiFetch<{ data: InvoiceUpiPaymentDto }>(`/api/v1/subscription/invoices/${inv.id}/upi`)
    ).data;
  } catch (e) {
    payError.value = (e as Error).message;
  }
}

async function submitPayment() {
  if (!payInvoice.value) return;
  paying.value = true;
  payError.value = null;
  try {
    await apiFetch(`/api/v1/subscription/invoices/${payInvoice.value.id}/payment`, {
      method: 'POST',
      body: JSON.stringify({ reference: payForm.reference.trim(), note: payForm.note || null }),
    });
    payDialog.value = false;
    notice.value = 'Payment submitted. It will be marked paid once verified.';
    await loadInvoices();
  } catch (e) {
    payError.value = (e as Error).message;
  } finally {
    paying.value = false;
  }
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const pct = (used: number, limit: number | null) =>
  limit === null || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);

const invoiceHeaders = [
  { title: 'Number', key: 'number' },
  { title: 'Period', key: 'periodStart' },
  { title: 'Amount', key: 'amountCents' },
  { title: 'Due', key: 'dueAt' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <h2 class="text-h5 mb-4">Subscription</h2>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <template v-if="subscription">
    <v-card class="mb-4">
      <v-card-title>
        {{ subscription.plan.name }}
        <v-chip class="ml-2" size="small" :color="subscription.active ? 'success' : 'error'">
          {{ subscription.status }}
        </v-chip>
      </v-card-title>
      <v-card-text>
        <div v-if="subscription.trialEndsAt">Trial ends {{ date(subscription.trialEndsAt) }}</div>
        <div>
          Current period: {{ date(subscription.currentPeriodStart) }} –
          {{ date(subscription.currentPeriodEnd) }}
        </div>
        <div class="mt-2">
          <v-chip
            v-for="f in subscription.licensedFeatures"
            :key="f"
            class="mr-1 mb-1"
            size="small"
            variant="tonal"
          >
            {{ f }}
          </v-chip>
        </div>
      </v-card-text>
    </v-card>
    <v-card class="mb-4" title="Usage & limits">
      <v-card-text>
        <div v-for="l in subscription.limits" :key="l.key" class="mb-3">
          <div class="d-flex">
            <span>{{ LIMITS[l.key].label }}</span>
            <v-spacer />
            <span>{{ l.used }} / {{ l.limit ?? 'Unlimited' }}</span>
          </div>
          <v-progress-linear
            :model-value="pct(l.used, l.limit)"
            :color="l.limit !== null && l.used >= l.limit ? 'error' : 'primary'"
          />
        </div>
      </v-card-text>
    </v-card>
  </template>
  <v-card v-if="auth.can('billing.view')" title="Invoices">
    <v-data-table :items="invoices" :headers="invoiceHeaders">
      <template #[`item.periodStart`]="{ item }">
        {{ date(item.periodStart) }} – {{ date(item.periodEnd) }}
      </template>
      <template #[`item.amountCents`]="{ item }">
        {{ money(item.amountCents, item.currency) }}
      </template>
      <template #[`item.dueAt`]="{ item }">{{ date(item.dueAt) }}</template>
      <template #[`item.status`]="{ item }">
        <v-chip size="small" :color="invoiceStatusColor(item.status)">
          {{ invoiceStatusLabel(item.status) }}
        </v-chip>
        <div v-if="item.status === 'PAYMENT_SUBMITTED'" class="text-caption">
          UTR {{ item.submittedReference }} — awaiting verification
        </div>
        <div v-else-if="item.status === 'PAID' && item.paymentReference" class="text-caption">
          Ref {{ item.paymentReference }}
        </div>
      </template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex ga-1 justify-end">
          <v-btn
            size="small"
            variant="text"
            icon="mdi-file-pdf-box"
            title="Download invoice"
            @click="downloadPdf(item)"
          />
          <v-btn
            v-if="(item.status === 'OPEN' || item.status === 'OVERDUE') && auth.can('billing.pay')"
            size="small"
            color="primary"
            prepend-icon="mdi-qrcode"
            @click="openPay(item)"
          >
            Pay via UPI
          </v-btn>
        </div>
      </template>
    </v-data-table>
  </v-card>
  <v-snackbar :model-value="!!notice" color="success" @update:model-value="notice = null">
    {{ notice }}
  </v-snackbar>

  <v-dialog v-model="payDialog" max-width="480">
    <v-card v-if="payInvoice" :title="`Pay ${payInvoice.number}`">
      <v-form @submit.prevent="submitPayment">
        <v-card-text>
          <v-alert v-if="payError" type="error" density="compact" class="mb-3">
            {{ payError }}
          </v-alert>
          <div v-if="upi" class="text-center">
            <div class="text-h5 mb-2">{{ money(upi.amountCents, upi.currency) }}</div>
            <img :src="upi.qrDataUrl" alt="UPI QR code" width="220" height="220" />
            <div class="mt-2">
              Pay to <strong>{{ upi.upiId }}</strong> ({{ upi.payeeName }})
            </div>
            <v-btn
              class="mt-2 d-md-none"
              :href="upi.upiUri"
              variant="tonal"
              prepend-icon="mdi-cellphone"
            >
              Open UPI app
            </v-btn>
            <div class="text-caption text-medium-emphasis mt-2">
              Scan with any UPI app (GPay, PhonePe, Paytm, BHIM). After paying, enter the 12-digit
              UTR / transaction ID below.
            </div>
          </div>
          <v-progress-circular v-else-if="!payError" indeterminate class="d-block mx-auto" />
          <template v-if="upi">
            <v-text-field
              v-model="payForm.reference"
              label="UPI transaction ID (UTR)"
              class="mt-4"
              :rules="[utrRule]"
            />
            <v-textarea v-model="payForm.note" label="Note (optional)" rows="2" auto-grow />
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="payDialog = false">Cancel</v-btn>
          <v-btn v-if="upi" color="primary" type="submit" :loading="paying">
            I have paid — submit
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
