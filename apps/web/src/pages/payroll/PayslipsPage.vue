<script setup lang="ts">
import type { ApiListResponse, EmployeeDto, Form16RecordDto, PayslipDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label, useHrOptions } from '@/pages/hr/useHrOptions';
import { money, openSignedUrl, searchEmployees } from './payroll';

/** Published payslips across runs, plus Form 16 records (upload / generate / publish). */
const auth = useAuthStore();
const { institutions, loadBase } = useHrOptions();
const institutionId = ref<string | null>(null);
const tab = ref('payslips');
const payslips = ref<PayslipDto[]>([]);
const total = ref(0);
const page = ref(1);
const form16 = ref<Form16RecordDto[]>([]);
const error = ref<string | null>(null);
const canForm16 = computed(() => auth.can('form16.manage'));
const canRegenerateSlips = computed(() => auth.can('payroll.lock'));
const notice = ref<string | null>(null);

async function load() {
  error.value = null;
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: '50' });
    if (institutionId.value) q.set('institutionId', institutionId.value);
    if (tab.value === 'payslips') {
      const res = await apiFetch<ApiListResponse<PayslipDto>>(`/api/v1/payroll/payslips?${q}`);
      payslips.value = res.data;
      total.value = res.meta.total;
    } else if (canForm16.value) {
      form16.value = (
        await apiFetch<ApiListResponse<Form16RecordDto>>(`/api/v1/payroll/form16?pageSize=100`)
      ).data;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
watch([institutionId, page, tab], load);

async function open(path: string) {
  try {
    await openSignedUrl(path);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const employees = ref<EmployeeDto[]>([]);
const empSearch = ref('');
watch(empSearch, async (s) => {
  employees.value = await searchEmployees(s).catch(() => []);
});
const f16 = reactive({
  open: false,
  employeeId: null as string | null,
  financialYear: '2025-26',
  file: null as File | File[] | null,
});
async function saveForm16(generate: boolean) {
  try {
    if (generate) {
      await apiFetch('/api/v1/payroll/form16/generate', {
        method: 'POST',
        body: JSON.stringify({ employeeId: f16.employeeId, financialYear: f16.financialYear }),
      });
    } else {
      const file = Array.isArray(f16.file) ? f16.file[0] : f16.file;
      if (!file || !f16.employeeId) return;
      const body = new FormData();
      body.append('employeeId', f16.employeeId);
      body.append('financialYear', f16.financialYear);
      body.append('file', file);
      await apiFetch('/api/v1/payroll/form16', { method: 'POST', body });
    }
    f16.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function publish(r: Form16RecordDto) {
  try {
    await apiFetch(`/api/v1/payroll/form16/${r.id}/publish`, { method: 'POST', body: '{}' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** Re-render a saved PDF with the current logo / branding (stored as a new version). */
async function regenerate(path: string, what: string) {
  if (!confirm(`Regenerate this ${what} PDF with the current logo and branding?`)) return;
  error.value = null;
  try {
    await apiFetch(path, { method: 'POST', body: '{}' });
    notice.value = `${what[0]!.toUpperCase()}${what.slice(1)} PDF regenerated with the current branding.`;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Employee', key: 'employee', sortable: false },
  { title: 'Period', key: 'periodStart' },
  { title: 'Revision', key: 'revision' },
  { title: 'Net', key: 'net', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Payslips &amp; Form 16</h2>
    <v-spacer />
    <v-select
      v-if="tab === 'payslips'"
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      clearable
      density="compact"
      hide-details
      style="max-width: 280px"
    />
    <v-btn v-if="tab === 'form16' && canForm16" color="primary" @click="f16.open = true">
      Add Form 16
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert
    v-if="notice"
    type="success"
    density="compact"
    closable
    class="mb-4"
    @click:close="notice = null"
  >
    {{ notice }}
  </v-alert>
  <v-tabs v-model="tab" class="mb-2">
    <v-tab value="payslips">Payslips</v-tab>
    <v-tab v-if="canForm16" value="form16">Form 16</v-tab>
  </v-tabs>

  <v-data-table-server
    v-if="tab === 'payslips'"
    v-model:page="page"
    :headers="headers"
    :items="payslips"
    :items-length="total"
    items-per-page="50"
  >
    <template #[`item.employee`]="{ item }"
      >{{ item.employeeCode }} · {{ item.employeeName }}</template
    >
    <template #[`item.periodStart`]="{ item }">{{ item.periodStart.slice(0, 7) }}</template>
    <template #[`item.net`]="{ item }">{{ money(item.net) }}</template>
    <template #[`item.status`]="{ item }">{{ label(item.status) }}</template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        icon="mdi-download"
        aria-label="Download PDF"
        size="small"
        variant="text"
        @click="open(`/api/v1/payroll/payslips/${item.id}/download-url`)"
      />
      <v-btn
        v-if="canRegenerateSlips"
        icon="mdi-refresh"
        size="small"
        variant="text"
        title="Regenerate PDF with the current branding"
        aria-label="Regenerate PDF"
        @click="regenerate(`/api/v1/payroll/payslips/${item.id}/regenerate`, 'payslip')"
      />
    </template>
  </v-data-table-server>

  <v-table v-else density="compact">
    <thead>
      <tr>
        <th>Employee</th>
        <th>Financial year</th>
        <th>Status</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in form16" :key="r.id">
        <td>{{ r.employeeCode }}</td>
        <td>{{ r.financialYear }}</td>
        <td>{{ label(r.status) }}</td>
        <td class="text-end">
          <v-btn v-if="r.status === 'DRAFT'" size="small" variant="tonal" @click="publish(r)">
            Publish
          </v-btn>
          <v-btn
            icon="mdi-download"
            aria-label="Download PDF"
            size="small"
            variant="text"
            @click="open(`/api/v1/payroll/form16/${r.id}/download-url`)"
          />
          <v-btn
            v-if="r.generated"
            icon="mdi-refresh"
            size="small"
            variant="text"
            title="Regenerate PDF with the current branding"
            aria-label="Regenerate PDF"
            @click="regenerate(`/api/v1/payroll/form16/${r.id}/regenerate`, 'Form 16')"
          />
        </td>
      </tr>
    </tbody>
  </v-table>

  <v-dialog v-model="f16.open" max-width="520">
    <v-card title="Form 16">
      <v-card-text>
        <v-autocomplete
          v-model="f16.employeeId"
          v-model:search="empSearch"
          :items="employees"
          :item-title="(e: EmployeeDto) => `${e.employeeCode} · ${e.displayName}`"
          item-value="id"
          label="Employee"
          no-filter
        />
        <v-text-field v-model="f16.financialYear" label="Financial year (YYYY-YY)" />
        <v-file-input v-model="f16.file" accept="application/pdf" label="Form 16 PDF" />
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="saveForm16(true)">Generate placeholder</v-btn>
        <v-spacer />
        <v-btn @click="f16.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!f16.file" @click="saveForm16(false)">Upload</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
