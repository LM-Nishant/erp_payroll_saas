<script setup lang="ts">
import {
  STUDENT_ATTENDANCE_STATUSES,
  type AttendanceRegisterDto,
  type BellPeriodDto,
  type SectionAttendanceDto,
  type StudentAttendanceStatus,
} from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { STATUS_CODE, STATUS_COLOR, thisMonth, today, useAcademicOptions } from './useAcademics';

const auth = useAuthStore();
const route = useRoute();
const { sections, load: loadOptions } = useAcademicOptions();
const tab = ref('mark');
const sectionId = ref((route.query.classSectionId as string) ?? '');
const section = computed(() => sections.value.find((s) => s.id === sectionId.value));
const date = ref(today());
const periodId = ref<string | null>(null);
const periods = ref<BellPeriodDto[]>([]);
const sheet = ref<SectionAttendanceDto | null>(null);
const statuses = ref<Record<string, StudentAttendanceStatus>>({});
const notify = ref(true);
const month = ref(thisMonth());
const register = ref<AttendanceRegisterDto | null>(null);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const canMark = computed(
  () => auth.can('student_attendance.mark') || auth.can('student_attendance.manage'),
);

async function loadPeriods() {
  periods.value = [];
  if (!section.value) return;
  try {
    periods.value = (
      await apiFetch<{ data: BellPeriodDto[] }>(
        `/api/v1/timetable/periods?institutionId=${section.value.institutionId}`,
      )
    ).data.filter((p) => !p.isBreak);
  } catch {
    periods.value = [];
  }
}
async function loadSheet() {
  sheet.value = null;
  if (!sectionId.value || !date.value) return;
  error.value = null;
  try {
    const p = new URLSearchParams({ classSectionId: sectionId.value, date: date.value });
    if (periodId.value) p.set('periodId', periodId.value);
    sheet.value = (
      await apiFetch<{ data: SectionAttendanceDto }>(`/api/v1/student-attendance/section?${p}`)
    ).data;
    statuses.value = Object.fromEntries(
      sheet.value.rows.map((r) => [r.studentId, r.status ?? 'PRESENT']),
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function markAll(status: StudentAttendanceStatus) {
  for (const k of Object.keys(statuses.value)) statuses.value[k] = status;
}
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const s of Object.values(statuses.value)) c[s] = (c[s] ?? 0) + 1;
  return c;
});
async function save() {
  error.value = null;
  try {
    await apiFetch('/api/v1/student-attendance', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: sectionId.value,
        date: date.value,
        periodId: periodId.value || null,
        notifyGuardians: notify.value,
        records: Object.entries(statuses.value).map(([studentId, status]) => ({
          studentId,
          status,
        })),
      }),
    });
    info.value = 'Attendance saved';
    await loadSheet();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadRegister() {
  register.value = null;
  if (!sectionId.value || !month.value) return;
  try {
    register.value = (
      await apiFetch<{ data: AttendanceRegisterDto }>(
        `/api/v1/student-attendance/register?classSectionId=${sectionId.value}&month=${month.value}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadOptions();
  await Promise.all([loadPeriods(), loadSheet()]);
});
watch(sectionId, async () => {
  periodId.value = null;
  await loadPeriods();
  await (tab.value === 'mark' ? loadSheet() : loadRegister());
});
watch([date, periodId], loadSheet);
watch([month, tab], () => tab.value === 'register' && loadRegister());
</script>
<template>
  <h2 class="text-h5 mb-4">Student attendance</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-autocomplete
    v-model="sectionId"
    :items="sections"
    item-title="name"
    item-value="id"
    label="Class section"
    density="compact"
    class="mb-2"
  />
  <v-tabs v-model="tab" class="mb-3"
    ><v-tab value="mark">Daily / period</v-tab
    ><v-tab value="register">Monthly register</v-tab></v-tabs
  >
  <v-window v-model="tab">
    <v-window-item value="mark">
      <v-row dense
        ><v-col cols="12" md="4"
          ><v-text-field v-model="date" type="date" label="Date" density="compact" /></v-col
        ><v-col cols="12" md="4"
          ><v-select
            v-model="periodId"
            :items="periods"
            item-title="name"
            item-value="id"
            label="Period (blank = daily)"
            density="compact"
            clearable /></v-col
        ><v-col cols="12" md="4"
          ><v-checkbox v-model="notify" label="Notify guardians of absentees" density="compact"
        /></v-col>
      </v-row>
      <template v-if="sheet">
        <v-alert v-if="!sheet.editable" type="info" variant="tonal" class="mb-2"
          >Read-only: outside the edit window or not allocated to this section.</v-alert
        >
        <div v-if="sheet.editable && canMark" class="d-flex ga-2 mb-2 align-center flex-wrap">
          <v-btn size="small" @click="markAll('PRESENT')">All present</v-btn
          ><v-btn size="small" @click="markAll('ABSENT')">All absent</v-btn>
          <v-chip
            v-for="(n, s) in counts"
            :key="s"
            size="small"
            :color="STATUS_COLOR[s as StudentAttendanceStatus]"
            >{{ s }}: {{ n }}</v-chip
          >
          <v-spacer /><v-btn color="primary" @click="save">Save attendance</v-btn>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Roll</th>
              <th>Student</th>
              <th>Admission no</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sheet.rows" :key="r.studentId">
              <td>{{ r.rollNo }}</td>
              <td>{{ r.displayName }}</td>
              <td>{{ r.admissionNo }}</td>
              <td>
                <v-btn-toggle
                  v-model="statuses[r.studentId]"
                  density="compact"
                  mandatory
                  :disabled="!sheet.editable || !canMark"
                  ><v-btn
                    v-for="s in STUDENT_ATTENDANCE_STATUSES"
                    :key="s"
                    :value="s"
                    :color="STATUS_COLOR[s]"
                    size="small"
                    >{{ STATUS_CODE[s] }}</v-btn
                  ></v-btn-toggle
                >
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </v-window-item>
    <v-window-item value="register">
      <v-text-field
        v-model="month"
        type="month"
        label="Month"
        density="compact"
        style="max-width: 220px"
      />
      <div v-if="register" style="overflow-x: auto">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Roll</th>
              <th>Student</th>
              <th v-for="d in register.days" :key="d" class="px-1 text-center">
                {{ d.slice(8) }}
              </th>
              <th>Present</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in register.students" :key="s.studentId">
              <td>{{ s.rollNo }}</td>
              <td class="text-no-wrap">{{ s.displayName }}</td>
              <td v-for="d in register.days" :key="d" class="px-1 text-center">
                <span v-if="s.marks[d]" :class="`text-${STATUS_COLOR[s.marks[d]!]}`">{{
                  STATUS_CODE[s.marks[d]!]
                }}</span>
              </td>
              <td>{{ s.summary.present }}/{{ s.summary.workingDays }}</td>
              <td>
                <v-chip size="small" :color="s.summary.percentage >= 75 ? 'success' : 'error'"
                  >{{ s.summary.percentage }}%</v-chip
                >
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-window-item>
  </v-window>
</template>
