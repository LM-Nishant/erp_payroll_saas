<script setup lang="ts">
import type { GroupPayrollSummaryDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import { label } from '@/pages/hr/useHrOptions';
import { firstOfMonth, lastOfMonth, money } from './payroll';

/** Group consolidated payroll (§53) — scoped to institutions where the caller holds payroll.report. */
const periodStart = ref(firstOfMonth());
const includeUnapproved = ref(false);
const summary = ref<GroupPayrollSummaryDto | null>(null);
const error = ref<string | null>(null);

const query = (format = 'json') =>
  new URLSearchParams({
    periodStart: periodStart.value,
    periodEnd: lastOfMonth(periodStart.value),
    includeUnapproved: String(includeUnapproved.value),
    format,
  });

async function load() {
  error.value = null;
  try {
    summary.value = (
      await apiFetch<{ data: GroupPayrollSummaryDto }>(
        `/api/v1/payroll/reports/group-summary?${query()}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function exportAs(format: 'csv' | 'xlsx' | 'pdf') {
  try {
    await apiDownload(
      `/api/v1/payroll/reports/group-summary?${query(format)}`,
      `group-payroll-${periodStart.value.slice(0, 7)}.${format}`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Group payroll summary</h2>
    <v-spacer />
    <v-text-field
      v-model="periodStart"
      type="date"
      label="Month"
      density="compact"
      hide-details
      style="max-width: 180px"
    />
    <v-checkbox v-model="includeUnapproved" label="Include unapproved" hide-details />
    <v-btn variant="tonal" @click="load">Refresh</v-btn>
    <v-btn
      v-for="f in ['csv', 'xlsx', 'pdf'] as const"
      :key="f"
      variant="text"
      @click="exportAs(f)"
    >
      {{ f.toUpperCase() }}
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-table v-if="summary" density="compact">
    <thead>
      <tr>
        <th>Institution</th>
        <th>Status</th>
        <th class="text-end">Employees</th>
        <th class="text-end">Gross</th>
        <th class="text-end">Deductions</th>
        <th class="text-end">Net</th>
        <th class="text-end">Employer</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="i in summary.institutions" :key="i.institutionId">
        <td>{{ i.institutionName }}</td>
        <td>{{ label(i.status) }}</td>
        <td class="text-end">{{ i.employeeCount }}</td>
        <td class="text-end">{{ money(i.grossTotal) }}</td>
        <td class="text-end">{{ money(i.deductionTotal) }}</td>
        <td class="text-end">{{ money(i.netTotal) }}</td>
        <td class="text-end">{{ money(i.employerTotal) }}</td>
      </tr>
      <tr class="font-weight-bold">
        <td colspan="2">Total</td>
        <td class="text-end">{{ summary.totals.employeeCount }}</td>
        <td class="text-end">{{ money(summary.totals.grossTotal) }}</td>
        <td class="text-end">{{ money(summary.totals.deductionTotal) }}</td>
        <td class="text-end">{{ money(summary.totals.netTotal) }}</td>
        <td class="text-end">{{ money(summary.totals.employerTotal) }}</td>
      </tr>
    </tbody>
  </v-table>
</template>
