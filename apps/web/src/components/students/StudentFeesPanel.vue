<script setup lang="ts">
import type { StudentFeeSummaryDto } from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { money } from '@/pages/fees/fees';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ studentId: string; base: string }>();
const auth = useAuthStore();
const summary = ref<StudentFeeSummaryDto | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const STATUS_COLOR: Record<string, string> = {
  PAID: 'success',
  PARTIALLY_PAID: 'warning',
  OVERDUE: 'error',
  CANCELLED: 'grey',
};
const statusColor = (s: string) => STATUS_COLOR[s] ?? 'info';
const invoices = computed(() => summary.value?.invoices ?? []);
const payments = computed(() => summary.value?.payments ?? []);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    summary.value = (
      await apiFetch<{ data: StudentFeeSummaryDto }>(
        `/api/v1/fees/students/${props.studentId}/summary`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function receipt(p: { id: string; number: string }) {
  try {
    await apiDownload(`/api/v1/fees/payments/${p.id}/receipt`, `receipt-${p.number}.pdf`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
</script>

<template>
  <div data-testid="student-fees">
    <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate class="mb-2" />
    <template v-if="summary">
      <div class="d-flex flex-wrap ga-2 mb-3 align-center">
        <v-chip prepend-icon="mdi-file-document-outline">
          Billed ₹{{ money(summary.totals.billed) }}
        </v-chip>
        <v-chip color="success" prepend-icon="mdi-cash-check">
          Paid ₹{{ money(summary.totals.paid) }}
        </v-chip>
        <v-chip color="warning" prepend-icon="mdi-cash-clock" data-testid="fees-due">
          Due ₹{{ money(summary.totals.balance) }}
        </v-chip>
        <v-chip v-if="summary.totals.overdue > 0" color="error" prepend-icon="mdi-alert">
          Overdue ₹{{ money(summary.totals.overdue) }}
        </v-chip>
        <v-spacer />
        <v-btn
          v-if="auth.can('fee.collect')"
          size="small"
          color="primary"
          prepend-icon="mdi-cash-register"
          :to="`${base}/fees/collect?studentId=${studentId}`"
        >
          Collect fee
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-open-in-new"
          :to="`${base}/fees/invoices`"
        >
          All invoices
        </v-btn>
      </div>
      <h3 class="text-subtitle-1 mb-1">Invoices</h3>
      <v-table density="compact" class="mb-4">
        <thead>
          <tr>
            <th>Number</th>
            <th>Description</th>
            <th>Due date</th>
            <th class="text-right">Amount</th>
            <th class="text-right">Paid</th>
            <th class="text-right">Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in invoices" :key="i.id">
            <td>{{ i.number }}</td>
            <td>{{ i.description || i.sourceType }}</td>
            <td>{{ i.dueDate }}</td>
            <td class="text-right">{{ money(i.netAmount) }}</td>
            <td class="text-right">{{ money(i.paidAmount) }}</td>
            <td class="text-right">{{ money(i.balance) }}</td>
            <td>
              <v-chip size="x-small" :color="statusColor(i.status)">{{ i.status }}</v-chip>
            </td>
          </tr>
          <tr v-if="!invoices.length">
            <td colspan="7" class="text-medium-emphasis">No invoices yet.</td>
          </tr>
        </tbody>
      </v-table>
      <h3 class="text-subtitle-1 mb-1">Payments &amp; receipts</h3>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Paid on</th>
            <th>Mode</th>
            <th class="text-right">Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id">
            <td>{{ p.number }}</td>
            <td>{{ p.paidOn }}</td>
            <td>{{ p.mode }}</td>
            <td class="text-right">{{ money(p.amount) }}</td>
            <td>{{ p.status }}</td>
            <td class="text-right">
              <v-btn
                size="small"
                variant="text"
                icon="mdi-download"
                title="Download receipt"
                @click="receipt(p)"
              />
            </td>
          </tr>
          <tr v-if="!payments.length">
            <td colspan="6" class="text-medium-emphasis">No payments yet.</td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </div>
</template>
