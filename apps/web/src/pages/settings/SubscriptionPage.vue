<script setup lang="ts">
import { LIMITS, type ApiListResponse, type InvoiceDto, type SubscriptionDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const subscription = ref<SubscriptionDto | null>(null);
const invoices = ref<InvoiceDto[]>([]);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    subscription.value = (await apiFetch<{ data: SubscriptionDto }>('/api/v1/subscription')).data;
    if (auth.can('billing.view')) {
      invoices.value = (
        await apiFetch<ApiListResponse<InvoiceDto>>('/api/v1/subscription/invoices?pageSize=50')
      ).data;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
});

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
    </v-data-table>
  </v-card>
</template>
