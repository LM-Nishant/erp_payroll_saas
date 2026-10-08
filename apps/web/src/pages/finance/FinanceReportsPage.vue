<script setup lang="ts">
import type { FinanceTableDto, LedgerAccountDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import ReportTable from '@/components/ReportTable.vue';
import { errorText, loadInstitutions, qs, type Option } from '../fees/fees';

const LABELS: Record<string, string> = {
  day_book: 'Day book',
  ledger: 'Ledger',
  trial_balance: 'Trial balance',
  income_expenditure: 'Income & expenditure',
};
const route = useRoute();
const report = ref<string>((route.meta.report as string) ?? 'trial_balance');
const table = ref<FinanceTableDto | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const accounts = ref<LedgerAccountDto[]>([]);
const postable = computed(() => accounts.value.filter((a) => !a.isGroup));
const year = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const filters = reactive({
  institutionId: '',
  accountId: '',
  from: `${year}-04-01`,
  to: new Date().toISOString().slice(0, 10),
});
const needsAccount = computed(() => report.value === 'ledger');
const params = () => ({ ...filters, accountId: needsAccount.value ? filters.accountId : '' });
async function load() {
  error.value = null;
  if (needsAccount.value && !filters.accountId) {
    table.value = null;
    return;
  }
  loading.value = true;
  try {
    table.value = (
      await apiFetch<{ data: FinanceTableDto }>(
        `/api/v1/finance/reports/${report.value}?${qs(params())}`,
      )
    ).data;
  } catch (e) {
    error.value = errorText(e);
    table.value = null;
  } finally {
    loading.value = false;
  }
}
async function exportAs(format: 'csv' | 'xlsx' | 'pdf') {
  try {
    await apiDownload(
      `/api/v1/finance/reports/${report.value}?${qs({ ...params(), format })}`,
      `${report.value}.${format}`,
    );
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
  await load();
});
watch(
  () => route.meta.report,
  (r) => {
    if (r) report.value = r as string;
  },
);
watch([report, () => ({ ...filters })], load, { deep: true });
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">{{ LABELS[report] ?? 'Finance reports' }}</h2>
    <v-spacer />
    <v-btn variant="text" :disabled="!table" @click="exportAs('csv')">CSV</v-btn>
    <v-btn variant="text" :disabled="!table" @click="exportAs('xlsx')">Excel</v-btn>
    <v-btn variant="text" :disabled="!table" @click="exportAs('pdf')">PDF</v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="3"
      ><v-select
        v-model="report"
        :items="Object.entries(LABELS).map(([value, title]) => ({ value, title }))"
        label="Report"
        density="compact"
        hide-details /></v-col
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
    ><v-col v-if="needsAccount" cols="12" md="2"
      ><v-autocomplete
        v-model="filters.accountId"
        :items="postable"
        :item-title="(a: LedgerAccountDto) => `${a.code} ${a.name}`"
        item-value="id"
        label="Account"
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
  <v-alert v-if="needsAccount && !filters.accountId" type="info" variant="tonal"
    >Choose an account to view its ledger.</v-alert
  >
  <ReportTable :table="table" :loading="loading" />
</template>
