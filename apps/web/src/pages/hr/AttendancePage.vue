<script setup lang="ts">
import {
  type ApiListResponse,
  type AttendanceImportResultDto,
  type AttendancePeriodLockDto,
  type AttendancePolicyDto,
  type AttendanceRecordDto,
  type AttendanceRegularizationDto,
  type AttendanceSummaryDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import EmployeePicker from '@/components/EmployeePicker.vue';
import { useAuthStore } from '@/stores/auth';
import { ATTENDANCE_COLORS, REQUEST_COLORS, currentMonth, hhmm, monthRange } from './timeOffice';
import { label, useHrOptions } from './useHrOptions';

/**
 * Attendance register: derived daily records, HR corrections, regularizations, period locks,
 * biometric imports, institution policy and the payroll attendance summary (Layer 7).
 */
const auth = useAuthStore();
const { institutions, loadBase } = useHrOptions();
const tab = ref('register');
const institutionId = ref<string | null>(null);
const month = ref(currentMonth());
const range = computed(() => monthRange(month.value));
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const loading = ref(false);

const run = async (fn: () => Promise<void>) => {
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  }
};
const instQuery = () => (institutionId.value ? `&institutionId=${institutionId.value}` : '');

// Register
const records = ref<AttendanceRecordDto[]>([]);
const total = ref(0);
const page = ref(1);
const itemsPerPage = ref(25);
const employeeId = ref<string | null>(null);
async function loadRecords() {
  loading.value = true;
  const employee = employeeId.value ? `&employeeId=${employeeId.value}` : '';
  await run(async () => {
    const res = await apiFetch<ApiListResponse<AttendanceRecordDto>>(
      `/api/v1/attendance/records?from=${range.value.from}&to=${range.value.to}&page=${page.value}&pageSize=${itemsPerPage.value}${instQuery()}${employee}`,
    );
    records.value = res.data;
    total.value = res.meta.total;
  });
  loading.value = false;
}
async function recompute() {
  await run(async () => {
    const res = await apiFetch<{ data: { employees: number } }>('/api/v1/attendance/recompute', {
      method: 'POST',
      body: JSON.stringify({ ...range.value, institutionId: institutionId.value }),
    });
    notice.value = `Recomputed ${res.data.employees} employees`;
    await loadRecords();
  });
}

const override = reactive({
  open: false,
  employeeId: '',
  date: '',
  status: null as string | null,
  reason: '',
});
function openOverride(r: AttendanceRecordDto) {
  Object.assign(override, {
    open: true,
    employeeId: r.employeeId,
    date: r.date,
    status: r.overrideStatus,
    reason: '',
  });
}
async function saveOverride() {
  await run(async () => {
    await apiFetch('/api/v1/attendance/override', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: override.employeeId,
        date: override.date,
        status: override.status,
        reason: override.reason.trim(),
      }),
    });
    override.open = false;
    await loadRecords();
  });
}

// Regularizations
const regularizations = ref<AttendanceRegularizationDto[]>([]);
async function loadRegularizations() {
  await run(async () => {
    regularizations.value = (
      await apiFetch<ApiListResponse<AttendanceRegularizationDto>>(
        '/api/v1/attendance/regularizations?pageSize=100',
      )
    ).data;
  });
}

// Locks
const locks = ref<AttendancePeriodLockDto[]>([]);
const unlock = reactive({ open: false, id: '', reason: '' });
async function loadLocks() {
  await run(async () => {
    locks.value = (
      await apiFetch<{ data: AttendancePeriodLockDto[] }>(
        `/api/v1/attendance/locks?pageSize=100${instQuery()}`,
      )
    ).data;
  });
}
async function lockMonth() {
  if (!institutionId.value) return;
  await run(async () => {
    await apiFetch('/api/v1/attendance/locks', {
      method: 'POST',
      body: JSON.stringify({
        institutionId: institutionId.value,
        periodStart: range.value.from,
        periodEnd: range.value.to,
        reason: `Payroll ${month.value}`,
      }),
    });
    await loadLocks();
  });
}
async function saveUnlock() {
  await run(async () => {
    await apiFetch(`/api/v1/attendance/locks/${unlock.id}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ reason: unlock.reason.trim() }),
    });
    unlock.open = false;
    await loadLocks();
  });
}

// Import
const importFile = ref<File | File[] | null>(null);
const imports = ref<AttendanceImportResultDto[]>([]);
async function loadImports() {
  await run(async () => {
    imports.value = (
      await apiFetch<{ data: AttendanceImportResultDto[] }>('/api/v1/attendance/punches/imports')
    ).data;
  });
}
async function upload() {
  const file = Array.isArray(importFile.value) ? importFile.value[0] : importFile.value;
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  await run(async () => {
    const res = await apiFetch<{ data: AttendanceImportResultDto }>(
      '/api/v1/attendance/punches/import',
      { method: 'POST', body: form },
    );
    notice.value = `Imported ${res.data.importedRows}/${res.data.totalRows} rows (${res.data.duplicateRows} duplicates, ${res.data.failedRows} failed)`;
    importFile.value = null;
    await loadImports();
  });
}

// Policy
const policy = ref<AttendancePolicyDto | null>(null);
async function loadPolicy() {
  if (!institutionId.value) return;
  await run(async () => {
    policy.value = (
      await apiFetch<{ data: AttendancePolicyDto }>(
        `/api/v1/attendance/policies/${institutionId.value}`,
      )
    ).data;
  });
}
async function savePolicy() {
  if (!policy.value || !institutionId.value) return;
  const p = policy.value;
  await run(async () => {
    policy.value = (
      await apiFetch<{ data: AttendancePolicyDto }>(
        `/api/v1/attendance/policies/${institutionId.value}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            timezone: p.timezone,
            lateMarksPerHalfDay: p.lateMarksPerHalfDay ? Number(p.lateMarksPerHalfDay) : null,
            absentIsLop: p.absentIsLop,
            allowWebPunch: p.allowWebPunch,
            allowMobilePunch: p.allowMobilePunch,
            requireFaceMatch: p.requireFaceMatch,
          }),
        },
      )
    ).data;
    notice.value = 'Policy saved';
  });
}

// Payroll summary
const summary = ref<AttendanceSummaryDto[]>([]);
async function loadSummary() {
  if (!institutionId.value) return;
  await run(async () => {
    summary.value = (
      await apiFetch<{ data: AttendanceSummaryDto[] }>(
        `/api/v1/attendance/summary?from=${range.value.from}&to=${range.value.to}${instQuery()}`,
      )
    ).data;
  });
}

async function refresh() {
  page.value = 1;
  if (tab.value === 'register') await loadRecords();
  else if (tab.value === 'regularizations') await loadRegularizations();
  else if (tab.value === 'locks') await loadLocks();
  else if (tab.value === 'import') await loadImports();
  else if (tab.value === 'policy') await loadPolicy();
  else if (tab.value === 'summary') await loadSummary();
}
onMounted(async () => {
  await loadBase();
  institutionId.value = institutions.value[0]?.id ?? null;
  await refresh();
});

// Server-paged (date, employee order): column sorting would only reorder the visible page.
const recordHeaders = [
  { title: 'Date', key: 'date' },
  { title: 'Employee', key: 'employee' },
  { title: 'Status', key: 'status' },
  { title: 'In', key: 'firstIn' },
  { title: 'Out', key: 'lastOut' },
  { title: 'Worked', key: 'workedMinutes' },
  { title: 'Late', key: 'lateMinutes' },
  { title: 'OT', key: 'overtimeMinutes' },
  { title: '', key: 'actions', align: 'end' as const },
].map((h) => ({ ...h, sortable: false }));
const summaryHeaders = [
  { title: 'Employee', key: 'employeeCode' },
  { title: 'Payable', key: 'payableDays' },
  { title: 'Present', key: 'presentDays' },
  { title: 'Paid leave', key: 'paidLeaveDays' },
  { title: 'Unpaid leave', key: 'unpaidLeaveDays' },
  { title: 'Absent', key: 'absentDays' },
  { title: 'Late marks', key: 'lateCount' },
  { title: 'LOP', key: 'lopDays' },
  { title: 'Holidays', key: 'holidays' },
  { title: 'Weekly offs', key: 'weeklyOffs' },
  { title: 'OT (h)', key: 'overtimeHours' },
  { title: 'Locked', key: 'locked' },
];
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const overrideStatuses = ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_DUTY'].map((value) => ({
  value,
  title: label(value),
}));
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2 flex-wrap">
    <h2 class="text-h5">Attendance</h2>
    <v-spacer />
    <v-autocomplete
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      density="compact"
      hide-details
      style="max-width: 260px"
      @update:model-value="refresh"
    />
    <v-text-field
      v-model="month"
      type="month"
      label="Month"
      density="compact"
      hide-details
      style="max-width: 180px"
      @change="refresh"
    />
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" closable class="mb-4" @click:close="notice = null">
    {{ notice }}
  </v-alert>

  <v-tabs v-model="tab" class="mb-4" @update:model-value="refresh">
    <v-tab value="register">Register</v-tab>
    <v-tab value="regularizations">Regularizations</v-tab>
    <v-tab value="locks">Period locks</v-tab>
    <v-tab v-if="auth.can('attendance.import')" value="import">Import</v-tab>
    <v-tab value="policy">Policy</v-tab>
    <v-tab value="summary">Payroll summary</v-tab>
  </v-tabs>

  <template v-if="tab === 'register'">
    <div class="d-flex mb-2 ga-2 align-center">
      <EmployeePicker
        v-model="employeeId"
        :institution-id="institutionId"
        density="compact"
        hide-details
        style="max-width: 320px"
        @update:model-value="refresh"
      />
      <v-spacer />
      <v-btn
        v-if="auth.can('attendance.manage')"
        variant="tonal"
        prepend-icon="mdi-refresh"
        @click="recompute"
      >
        Recompute month
      </v-btn>
    </div>
    <v-data-table-server
      v-model:page="page"
      v-model:items-per-page="itemsPerPage"
      :items="records"
      :items-length="total"
      :items-per-page-options="[10, 25, 50, 100]"
      :headers="recordHeaders"
      :loading="loading"
      density="compact"
      @update:page="loadRecords"
      @update:items-per-page="loadRecords"
    >
      <template #[`item.employee`]="{ item }">
        {{ item.employeeCode }} {{ item.employeeName }}
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip :color="ATTENDANCE_COLORS[item.status]" size="small">{{
          label(item.status)
        }}</v-chip>
        <v-icon v-if="item.overrideStatus" size="small" class="ml-1" icon="mdi-pencil-lock" />
        <v-icon v-if="item.locked" size="small" class="ml-1" icon="mdi-lock" />
        <span v-if="item.holidayName" class="text-caption ml-1">{{ item.holidayName }}</span>
      </template>
      <template #[`item.firstIn`]="{ item }">{{ time(item.firstIn) }}</template>
      <template #[`item.lastOut`]="{ item }">{{ time(item.lastOut) }}</template>
      <template #[`item.workedMinutes`]="{ item }">{{ hhmm(item.workedMinutes) }}</template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          v-if="auth.can('attendance.manage')"
          size="small"
          variant="text"
          icon="mdi-pencil"
          @click="openOverride(item)"
        />
      </template>
    </v-data-table-server>
  </template>

  <v-table v-else-if="tab === 'regularizations'" density="compact">
    <thead>
      <tr>
        <th>Employee</th>
        <th>Date</th>
        <th>Requested</th>
        <th>Reason</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in regularizations" :key="r.id">
        <td>{{ r.employeeName ? `${r.employeeName} (${r.employeeCode})` : r.employeeId }}</td>
        <td>{{ r.date }}</td>
        <td>
          {{
            r.requestedStatus
              ? label(r.requestedStatus)
              : `${hhmm(r.inMinute)} – ${hhmm(r.outMinute)}`
          }}
        </td>
        <td>{{ r.reason }}</td>
        <td>
          <v-chip :color="REQUEST_COLORS[r.status]" size="small">{{ label(r.status) }}</v-chip>
        </td>
      </tr>
    </tbody>
  </v-table>

  <template v-else-if="tab === 'locks'">
    <div class="d-flex mb-2">
      <v-spacer />
      <v-btn
        v-if="auth.can('attendance.lock')"
        :disabled="!institutionId"
        variant="tonal"
        prepend-icon="mdi-lock"
        @click="lockMonth"
      >
        Lock {{ month }}
      </v-btn>
    </div>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Period</th>
          <th>Status</th>
          <th>Reason</th>
          <th>Unlock reason</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in locks" :key="l.id">
          <td>{{ l.periodStart }} – {{ l.periodEnd }}</td>
          <td>
            <v-chip :color="l.status === 'LOCKED' ? 'error' : 'default'" size="small">
              {{ label(l.status) }}
            </v-chip>
          </td>
          <td>{{ l.reason ?? '—' }}</td>
          <td>{{ l.unlockReason ?? '—' }}</td>
          <td class="text-right">
            <v-btn
              v-if="l.status === 'LOCKED' && auth.can('attendance.unlock')"
              size="small"
              variant="text"
              @click="Object.assign(unlock, { open: true, id: l.id, reason: '' })"
            >
              Unlock
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>
  </template>

  <template v-else-if="tab === 'import'">
    <p class="text-body-2 mb-2">
      CSV columns: <code>employeeCode, punchedAt (ISO 8601 with offset), direction, deviceId</code>.
      Duplicates are skipped; affected days are recomputed.
    </p>
    <div class="d-flex ga-2 align-center mb-4">
      <v-file-input
        v-model="importFile"
        accept=".csv,text/csv"
        label="Biometric CSV"
        hide-details
      />
      <v-btn :disabled="!importFile" color="primary" @click="upload">Import</v-btn>
    </div>
    <v-table density="compact">
      <tbody>
        <tr v-for="i in imports" :key="i.id">
          <td>{{ new Date(i.createdAt).toLocaleString() }}</td>
          <td>{{ i.fileName ?? i.source }}</td>
          <td>{{ i.importedRows }}/{{ i.totalRows }} imported</td>
          <td>{{ i.duplicateRows }} duplicates, {{ i.failedRows }} failed</td>
        </tr>
      </tbody>
    </v-table>
  </template>

  <v-card v-else-if="tab === 'policy' && policy" max-width="520" variant="outlined">
    <v-card-text>
      <v-text-field v-model="policy.timezone" label="Timezone" />
      <v-text-field
        v-model.number="policy.lateMarksPerHalfDay"
        type="number"
        label="Late marks per half-day deduction (empty = none)"
      />
      <v-checkbox v-model="policy.absentIsLop" label="Absent days are loss of pay" hide-details />
      <v-checkbox v-model="policy.allowWebPunch" label="Allow web punch" hide-details />
      <v-checkbox v-model="policy.allowMobilePunch" label="Allow mobile punch" hide-details />
      <v-checkbox
        v-model="policy.requireFaceMatch"
        label="Require selfie matched to profile photo for self punches"
        hint="Employees must upload a clear profile photo first"
        persistent-hint
      />
    </v-card-text>
    <v-card-actions v-if="auth.can('attendance.manage')">
      <v-spacer />
      <v-btn color="primary" @click="savePolicy">Save</v-btn>
    </v-card-actions>
  </v-card>

  <v-data-table
    v-else-if="tab === 'summary'"
    :items="summary"
    :headers="summaryHeaders"
    density="compact"
  >
    <template #[`item.locked`]="{ item }">
      <v-icon v-if="item.locked" icon="mdi-lock" size="small" />
    </template>
  </v-data-table>

  <v-dialog v-model="override.open" max-width="480">
    <v-card :title="`Correct ${override.date}`">
      <v-card-text>
        <v-select
          v-model="override.status"
          :items="overrideStatuses"
          label="Status (empty = clear correction)"
          clearable
        />
        <v-textarea v-model="override.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="override.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="override.reason.trim().length < 3" @click="saveOverride">
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="unlock.open" max-width="480">
    <v-card title="Unlock attendance period">
      <v-card-text>
        <v-alert type="warning" variant="tonal" class="mb-4">
          Unlocking allows edits to a period that may already be paid. The action is audited.
        </v-alert>
        <v-textarea v-model="unlock.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="unlock.open = false">Cancel</v-btn>
        <v-btn color="error" :disabled="unlock.reason.trim().length < 3" @click="saveUnlock">
          Unlock
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
