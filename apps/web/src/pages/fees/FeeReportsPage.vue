<script setup lang="ts">
import type { FinanceTableDto } from '@erp/shared';
import { FEE_REPORTS } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import ReportTable from '@/components/ReportTable.vue';
import { errorText, loadClassSections, loadInstitutions, qs, type Option } from './fees';

const LABELS: Record<string, string> = {
  collections: 'Collections',
  dues: 'Dues (class-wise)',
  aging: 'Dues aging',
  head_wise: 'Fee head-wise',
  concessions: 'Concessions',
};
const report = ref<string>('collections');
const table = ref<FinanceTableDto | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const sections = ref<Option[]>([]);
const year = new Date().getFullYear();
const filters = reactive({
  institutionId: '',
  classSectionId: '',
  from: `${year}-04-01`,
  to: new Date().toISOString().slice(0, 10),
});
async function load() {
  loading.value = true;
  error.value = null;
  try {
    table.value = (
      await apiFetch<{ data: FinanceTableDto }>(
        `/api/v1/fees/reports/${report.value}?${qs({ ...filters })}`,
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
      `/api/v1/fees/reports/${report.value}?${qs({ ...filters, format })}`,
      `fee-${report.value}.${format}`,
    );
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  [institutions.value, sections.value] = await Promise.all([
    loadInstitutions(),
    loadClassSections(),
  ]);
  await load();
});
watch([report, () => ({ ...filters })], load, { deep: true });
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Fee reports</h2>
    <v-spacer />
    <v-btn variant="text" @click="exportAs('csv')">CSV</v-btn>
    <v-btn variant="text" @click="exportAs('xlsx')">Excel</v-btn>
    <v-btn variant="text" @click="exportAs('pdf')">PDF</v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="3"
      ><v-select
        v-model="report"
        :items="FEE_REPORTS.map((k) => ({ title: LABELS[k] ?? k, value: k }))"
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
    ><v-col cols="12" md="2"
      ><v-autocomplete
        v-model="filters.classSectionId"
        :items="sections"
        item-title="name"
        item-value="id"
        label="Class section"
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
  <ReportTable :table="table" :loading="loading" />
</template>
