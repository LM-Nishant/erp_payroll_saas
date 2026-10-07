<script setup lang="ts">
import {
  EMPLOYEE_STATUSES,
  type ApiListResponse,
  type EmployeeDto,
  type EmployeeImportJobDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import EmployeeFormDialog from './EmployeeFormDialog.vue';
import { label, STATUS_COLORS, useHrOptions } from './useHrOptions';

/** Employee list. The API returns only employees inside the caller's HR scope. */
const auth = useAuthStore();
const router = useRouter();
const { institutions, departments, loadBase, loadForInstitution } = useHrOptions();

const items = ref<EmployeeDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const filters = reactive({
  search: '',
  institutionId: null as string | null,
  departmentId: null as string | null,
  status: null as string | null,
});

function query(paged = true) {
  const params = new URLSearchParams(paged ? { page: String(page.value), pageSize: '25' } : {});
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.institutionId) params.set('institutionId', filters.institutionId);
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  if (filters.status) params.set('status', filters.status);
  return params;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await apiFetch<ApiListResponse<EmployeeDto>>(`/api/v1/employees?${query()}`);
    items.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      page.value = 1;
      void load();
    }, 300);
  },
);
watch(
  () => filters.institutionId,
  async (id) => {
    filters.departmentId = null;
    await loadForInstitution(id);
  },
);
watch(
  () => [filters.institutionId, filters.departmentId, filters.status],
  () => {
    page.value = 1;
    void load();
  },
);
watch(page, load);

async function exportCsv() {
  try {
    await apiDownload(`/api/v1/employees/export?${query(false)}`, 'employees.csv');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Create
const createOpen = ref(false);
function onCreated(e: EmployeeDto) {
  void router.push({ name: 'hr-employee', params: { id: e.id } });
}

// CSV import (queue job + validation report)
const importOpen = ref(false);
const importFile = ref<File | File[] | null>(null);
const dryRun = ref(true);
const job = ref<EmployeeImportJobDto | null>(null);
const importing = ref(false);
const importError = ref<string | null>(null);

async function startImport() {
  const file = (Array.isArray(importFile.value) ? importFile.value[0] : importFile.value) ?? null;
  if (!file) return;
  importing.value = true;
  importError.value = null;
  try {
    const body = new FormData();
    body.append('dryRun', String(dryRun.value));
    body.append('file', file);
    let current = (
      await apiFetch<{ data: EmployeeImportJobDto }>('/api/v1/employees/import', {
        method: 'POST',
        body,
      })
    ).data;
    job.value = current;
    for (let i = 0; i < 60 && ['QUEUED', 'PROCESSING'].includes(current.status); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      current = (
        await apiFetch<{ data: EmployeeImportJobDto }>(`/api/v1/employees/import/${current.id}`)
      ).data;
      job.value = current;
    }
    if (!current.dryRun && current.createdCount > 0) await load();
  } catch (e) {
    importError.value = (e as Error).message;
  } finally {
    importing.value = false;
  }
}
const failedRows = computed(() => (job.value?.report ?? []).filter((r) => r.errors.length > 0));

const headers = [
  { title: 'Code', key: 'employeeCode' },
  { title: 'Name', key: 'displayName' },
  { title: 'Institution', key: 'institution', sortable: false },
  { title: 'Department', key: 'department', sortable: false },
  { title: 'Designation', key: 'designation', sortable: false },
  { title: 'Type', key: 'employmentType' },
  { title: 'Status', key: 'status' },
  { title: 'Joined', key: 'dateOfJoining' },
];
const statuses = EMPLOYEE_STATUSES.map((value) => ({ value, title: label(value) }));
function openRow(_e: unknown, row: { item: EmployeeDto }) {
  void router.push({ name: 'hr-employee', params: { id: row.item.id } });
}
</script>

<template>
  <div class="d-flex align-center flex-wrap ga-2 mb-4">
    <h2 class="text-h5">Employees</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('employee.export')"
      variant="tonal"
      prepend-icon="mdi-download"
      @click="exportCsv"
    >
      Export CSV
    </v-btn>
    <v-btn
      v-if="auth.can('employee.import')"
      variant="tonal"
      prepend-icon="mdi-upload"
      @click="
        job = null;
        importOpen = true;
      "
    >
      Import CSV
    </v-btn>
    <v-btn
      v-if="auth.can('employee.create')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="createOpen = true"
    >
      New employee
    </v-btn>
  </div>
  <v-row dense class="mb-2">
    <v-col cols="12" md="3">
      <v-text-field
        v-model="filters.search"
        density="compact"
        prepend-inner-icon="mdi-magnify"
        label="Search name / code"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="3">
      <v-autocomplete
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        density="compact"
        clearable
        hide-details
      />
    </v-col>
    <v-col cols="12" md="3">
      <v-autocomplete
        v-model="filters.departmentId"
        :items="departments"
        item-title="name"
        item-value="id"
        label="Department"
        density="compact"
        clearable
        hide-details
        :disabled="!filters.institutionId"
      />
    </v-col>
    <v-col cols="12" md="3">
      <v-select
        v-model="filters.status"
        :items="statuses"
        label="Status"
        density="compact"
        clearable
        hide-details
      />
    </v-col>
  </v-row>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-data-table-server
    v-model:page="page"
    :items="items"
    :headers="headers"
    :loading="loading"
    :items-length="total"
    :items-per-page="25"
    hover
    @click:row="openRow"
  >
    <template #[`item.institution`]="{ item }">{{ item.institution?.name ?? '—' }}</template>
    <template #[`item.department`]="{ item }">{{ item.department?.name ?? '—' }}</template>
    <template #[`item.designation`]="{ item }">{{ item.designation?.name ?? '—' }}</template>
    <template #[`item.employmentType`]="{ item }">{{ label(item.employmentType) }}</template>
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="STATUS_COLORS[item.status]">{{ label(item.status) }}</v-chip>
    </template>
  </v-data-table-server>

  <EmployeeFormDialog v-model="createOpen" @saved="onCreated" />

  <v-dialog v-model="importOpen" max-width="720" scrollable>
    <v-card title="Import employees (CSV)">
      <v-card-text>
        <p class="text-body-2 mb-2">
          Rows are validated against the same rules as the form. Statutory ids are encrypted on
          import. Start with a dry run to get a validation report without creating anything.
        </p>
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-file-delimited"
          class="mb-2"
          @click="apiDownload('/api/v1/employees/import/template', 'employee-import-template.csv')"
        >
          Download template
        </v-btn>
        <v-file-input v-model="importFile" accept=".csv,text/csv" label="CSV file" />
        <v-checkbox v-model="dryRun" label="Dry run (validate only)" hide-details />
        <v-alert v-if="importError" type="error" density="compact" class="mt-2">
          {{ importError }}
        </v-alert>
        <template v-if="job">
          <v-alert
            :type="job.status === 'FAILED' ? 'error' : job.errorCount ? 'warning' : 'success'"
            density="compact"
            class="mt-2"
          >
            {{ label(job.status) }} — {{ job.totalRows }} rows, {{ job.createdCount }}
            {{ job.dryRun ? 'valid' : 'created' }}, {{ job.errorCount }} with errors
          </v-alert>
          <v-table v-if="failedRows.length" density="compact" class="mt-2">
            <thead>
              <tr>
                <th>Row</th>
                <th>Code</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in failedRows" :key="r.row">
                <td>{{ r.row }}</td>
                <td>{{ r.employeeCode ?? '—' }}</td>
                <td>
                  <div v-for="(err, i) in r.errors" :key="i">
                    <strong>{{ err.field }}</strong
                    >: {{ err.message }}
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="importOpen = false">Close</v-btn>
        <v-btn color="primary" :loading="importing" :disabled="!importFile" @click="startImport">
          {{ dryRun ? 'Validate' : 'Import' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
