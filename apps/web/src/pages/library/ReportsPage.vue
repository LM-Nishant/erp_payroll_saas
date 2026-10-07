<script setup lang="ts">
import { LIBRARY_REPORTS, type LibraryReportDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import LibraryTabs from './LibraryTabs.vue';
import { qs, useLibraryInstitutions } from './library';

const LABELS: Record<string, string> = {
  issued: 'Books issued',
  overdue: 'Overdue books',
  most_borrowed: 'Most borrowed',
  fines: 'Fines',
};
const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const key = ref<string>('issued');
const range = reactive({ from: '', to: '' });
const report = ref<LibraryReportDto | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const params = () => qs({ institutionId: institutionId.value, from: range.from, to: range.to });
async function load() {
  loading.value = true;
  error.value = null;
  try {
    report.value = (
      await apiFetch<{ data: LibraryReportDto }>(`/api/v1/library/reports/${key.value}?${params()}`)
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function exportAs(format: 'csv' | 'xlsx') {
  try {
    await apiDownload(
      `/api/v1/library/reports/${key.value}?${params()}&format=${format}`,
      `library-${key.value}.${format}`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadInstitutions();
  await load();
});
watch([key, institutionId, () => range.from, () => range.to], load);
</script>
<template>
  <LibraryTabs title="Library reports">
    <template #actions>
      <v-btn variant="text" prepend-icon="mdi-file-delimited" @click="exportAs('csv')">CSV</v-btn>
      <v-btn variant="text" prepend-icon="mdi-file-excel" @click="exportAs('xlsx')">XLSX</v-btn>
    </template>
  </LibraryTabs>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="3">
      <v-select
        v-model="key"
        :items="LIBRARY_REPORTS.map((k) => ({ value: k, title: LABELS[k] ?? k }))"
        label="Report"
        density="compact"
        hide-details
      />
    </v-col>
    <v-col v-if="institutions.length > 1" cols="12" md="3"
      ><v-select
        v-model="institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Library"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col cols="6" md="3"
      ><v-text-field v-model="range.from" type="date" label="From" density="compact" hide-details
    /></v-col>
    <v-col cols="6" md="3"
      ><v-text-field v-model="range.to" type="date" label="To" density="compact" hide-details
    /></v-col>
  </v-row>
  <v-progress-linear v-if="loading" indeterminate />
  <v-card v-if="report">
    <v-card-title>{{ report.title }} ({{ report.rows.length }})</v-card-title>
    <v-table density="compact" fixed-header height="560">
      <thead>
        <tr>
          <th v-for="c in report.columns" :key="c">{{ c }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in report.rows" :key="i">
          <td v-for="(c, j) in r" :key="j">{{ c }}</td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>
