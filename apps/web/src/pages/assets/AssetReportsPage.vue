<script setup lang="ts">
import { ASSET_REPORT_TYPES } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { label, useAssetOptions } from './assetUi';

interface Report {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
}
const { institutions, categories, loadBase } = useAssetOptions();
const form = reactive({
  type: 'register',
  institutionId: '',
  categoryId: '',
  asOf: new Date().toISOString().slice(0, 10),
});
const report = ref<Report | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

const params = (format: string) => {
  const p = new URLSearchParams({ type: form.type, format });
  if (form.institutionId) p.set('institutionId', form.institutionId);
  if (form.categoryId) p.set('categoryId', form.categoryId);
  if (form.asOf) p.set('asOf', form.asOf);
  return p;
};
async function preview() {
  loading.value = true;
  error.value = null;
  try {
    report.value = (
      await apiFetch<{ data: Report }>(`/api/v1/assets/reports?${params('json')}`)
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function download(format: 'csv' | 'xlsx' | 'pdf') {
  try {
    await apiDownload(`/api/v1/assets/reports?${params(format)}`, `asset-${form.type}.${format}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(loadBase);
</script>

<template>
  <h2 class="text-h5 mb-4">Asset reports</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense>
    <v-col cols="12" md="3"
      ><v-select
        v-model="form.type"
        :items="ASSET_REPORT_TYPES.map((t) => ({ title: label(t), value: t }))"
        label="Report"
        density="compact"
    /></v-col>
    <v-col cols="12" md="3"
      ><v-autocomplete
        v-model="form.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        density="compact"
        clearable
    /></v-col>
    <v-col cols="12" md="3"
      ><v-autocomplete
        v-model="form.categoryId"
        :items="categories"
        item-title="name"
        item-value="id"
        label="Category"
        density="compact"
        clearable
    /></v-col>
    <v-col cols="12" md="3"
      ><v-text-field v-model="form.asOf" type="date" label="As of" density="compact"
    /></v-col>
  </v-row>
  <div class="d-flex ga-2 mb-4">
    <v-btn color="primary" :loading="loading" @click="preview">Preview</v-btn>
    <v-btn variant="tonal" prepend-icon="mdi-file-delimited" @click="download('csv')">CSV</v-btn>
    <v-btn variant="tonal" prepend-icon="mdi-file-excel" @click="download('xlsx')">Excel</v-btn>
    <v-btn variant="tonal" prepend-icon="mdi-file-pdf-box" @click="download('pdf')">PDF</v-btn>
  </div>
  <v-card v-if="report">
    <v-card-title>{{ report.title }}</v-card-title>
    <v-card-subtitle v-if="report.subtitle">{{ report.subtitle }}</v-card-subtitle>
    <v-table density="compact" fixed-header height="560">
      <thead>
        <tr>
          <th v-for="c in report.columns" :key="c">{{ c }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in report.rows.slice(0, 500)" :key="i">
          <td v-for="(v, j) in r" :key="j">{{ v }}</td>
        </tr>
      </tbody>
    </v-table>
    <v-card-text v-if="report.rows.length > 500" class="text-caption"
      >Showing 500 of {{ report.rows.length }} rows — download for the full report.</v-card-text
    >
  </v-card>
</template>
