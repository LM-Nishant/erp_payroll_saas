<script setup lang="ts">
import type { ApiListResponse, ShiftAssignmentDto, ShiftDto, WeeklyOffRule } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import EmployeePicker from '@/components/EmployeePicker.vue';
import WeeklyOffsPicker from '@/components/WeeklyOffsPicker.vue';
import { useAuthStore } from '@/stores/auth';
import { hhmm, toMinute, weeklyOffsText } from './timeOffice';
import { useHrOptions } from './useHrOptions';

/** Shift definitions per institution and effective-dated employee / department assignments. */
const auth = useAuthStore();
const { institutions, departments, loadBase, loadForInstitution } = useHrOptions();
const institutionId = ref<string | null>(null);
/** All shifts of the institution, for name lookup and the assignment pickers. */
const shiftOptions = ref<ShiftDto[]>([]);
const error = ref<string | null>(null);
const canManage = computed(() => auth.can('shift.manage'));
const listOptions = {
  error,
  immediate: false,
  params: () => ({ institutionId: institutionId.value ?? undefined }),
};
const shiftList = useServerList<ShiftDto>('/api/v1/shifts', listOptions);
const { items: shifts, total, page, pageSize, loading } = shiftList;
const assignmentList = useServerList<ShiftAssignmentDto>('/api/v1/shifts/assignments', listOptions);
const { items: assignments } = assignmentList;

async function loadShiftOptions() {
  const q = institutionId.value ? `&institutionId=${institutionId.value}` : '';
  shiftOptions.value = (
    await apiFetch<ApiListResponse<ShiftDto>>(`/api/v1/shifts?pageSize=100${q}`)
  ).data;
}
async function load() {
  error.value = null;
  try {
    await Promise.all([shiftList.load(), assignmentList.load(), loadShiftOptions()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadBase();
  institutionId.value = institutions.value[0]?.id ?? null;
  await Promise.all([load(), loadForInstitution(institutionId.value)]);
});
async function changeInstitution() {
  await Promise.all([loadShiftOptions(), loadForInstitution(institutionId.value)]);
}

const shiftName = (id: string) => shiftOptions.value.find((s) => s.id === id)?.code ?? id;
const deptName = (id: string | null) =>
  id ? (departments.value.find((d) => d.id === id)?.name ?? id) : null;

// Shift dialog
const dialog = reactive({
  open: false,
  id: null as string | null,
  code: '',
  name: '',
  start: '09:00',
  end: '17:30',
  graceInMinutes: 10,
  graceOutMinutes: 10,
  breakMinutes: 30,
  halfDayMinutes: 240,
  fullDayMinutes: 450,
  overtimeAfterMinutes: 0,
  inheritWeeklyOffs: true,
  weeklyOffs: [] as WeeklyOffRule[],
  isDefault: false,
});
function openDialog(s?: ShiftDto) {
  Object.assign(dialog, {
    open: true,
    id: s?.id ?? null,
    code: s?.code ?? '',
    name: s?.name ?? '',
    start: s ? hhmm(s.startMinute) : '09:00',
    end: s ? hhmm(s.endMinute) : '17:30',
    graceInMinutes: s?.graceInMinutes ?? 10,
    graceOutMinutes: s?.graceOutMinutes ?? 10,
    breakMinutes: s?.breakMinutes ?? 30,
    halfDayMinutes: s?.halfDayMinutes ?? 240,
    fullDayMinutes: s?.fullDayMinutes ?? 450,
    overtimeAfterMinutes: s?.overtimeAfterMinutes ?? 0,
    inheritWeeklyOffs: !s || s.weeklyOffs === null,
    weeklyOffs: (s?.weeklyOffs ?? [{ weekday: 0 }]).map((r) => ({ ...r })),
    isDefault: s?.isDefault ?? false,
  });
}
async function save() {
  const body = {
    name: dialog.name.trim(),
    startMinute: toMinute(dialog.start),
    endMinute: toMinute(dialog.end),
    graceInMinutes: Number(dialog.graceInMinutes),
    graceOutMinutes: Number(dialog.graceOutMinutes),
    breakMinutes: Number(dialog.breakMinutes),
    halfDayMinutes: Number(dialog.halfDayMinutes),
    fullDayMinutes: Number(dialog.fullDayMinutes),
    overtimeAfterMinutes: Number(dialog.overtimeAfterMinutes),
    weeklyOffs: dialog.inheritWeeklyOffs ? null : dialog.weeklyOffs,
    isDefault: dialog.isDefault,
  };
  try {
    await apiFetch(dialog.id ? `/api/v1/shifts/${dialog.id}` : '/api/v1/shifts', {
      method: dialog.id ? 'PATCH' : 'POST',
      body: JSON.stringify(
        dialog.id
          ? body
          : { ...body, code: dialog.code.trim(), institutionId: institutionId.value },
      ),
    });
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Assignment dialog
const assign = reactive({
  open: false,
  target: 'department' as 'department' | 'employee',
  employeeId: null as string | null,
  departmentId: null as string | null,
  shiftId: null as string | null,
  rotationShiftIds: [] as string[],
  rotationDays: null as number | null,
  effectiveFrom: '',
  effectiveTo: '',
});
function openAssign() {
  Object.assign(assign, {
    open: true,
    target: 'department',
    employeeId: null,
    departmentId: null,
    shiftId: shiftOptions.value[0]?.id ?? null,
    rotationShiftIds: [],
    rotationDays: null,
    effectiveFrom: '',
    effectiveTo: '',
  });
}
async function saveAssign() {
  const rotation = assign.rotationShiftIds.length >= 2;
  try {
    await apiFetch('/api/v1/shifts/assignments', {
      method: 'POST',
      body: JSON.stringify({
        institutionId: institutionId.value,
        employeeId: assign.target === 'employee' ? assign.employeeId : null,
        departmentId: assign.target === 'department' ? assign.departmentId : null,
        shiftId: rotation ? assign.rotationShiftIds[0] : assign.shiftId,
        rotationShiftIds: rotation ? assign.rotationShiftIds : null,
        rotationDays: rotation ? Number(assign.rotationDays) : null,
        effectiveFrom: assign.effectiveFrom,
        effectiveTo: assign.effectiveTo || null,
      }),
    });
    assign.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function removeAssign(a: ShiftAssignmentDto) {
  if (!confirm('Delete this shift assignment?')) return;
  try {
    await apiFetch(`/api/v1/shifts/assignments/${a.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const shiftHeaders = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Timing', key: 'timing', sortable: false },
  { title: 'Grace in/out', key: 'grace', sortable: false },
  { title: 'Half / full day (min)', key: 'thresholds', sortable: false },
  { title: 'Weekly offs', key: 'weeklyOffs', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const assignmentHeaders = [
  { title: 'Applies to', key: 'appliesTo' },
  { title: 'Shift / rotation', key: 'shiftId' },
  { title: 'From', key: 'effectiveFrom' },
  { title: 'To', key: 'effectiveTo' },
  { title: '', key: 'actions', align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Shifts</h2>
    <v-spacer />
    <v-autocomplete
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      density="compact"
      hide-details
      style="max-width: 280px"
      @update:model-value="changeInstitution"
    />
    <v-btn
      v-if="canManage"
      :disabled="!institutionId"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openDialog()"
    >
      New shift
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table-server
    v-model:page="page"
    v-model:items-per-page="pageSize"
    :items="shifts"
    :headers="shiftHeaders"
    :loading="loading"
    :items-length="total"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    disable-sort
  >
    <template #[`item.code`]="{ item }">
      {{ item.code }}
      <v-chip v-if="item.isDefault" size="x-small" color="primary" class="ml-1">default</v-chip>
    </template>
    <template #[`item.timing`]="{ item }">
      {{ hhmm(item.startMinute) }} – {{ hhmm(item.endMinute) }}
      <v-chip v-if="item.crossesMidnight" size="x-small" class="ml-1">overnight</v-chip>
    </template>
    <template #[`item.grace`]="{ item }">
      {{ item.graceInMinutes }} / {{ item.graceOutMinutes }}
    </template>
    <template #[`item.thresholds`]="{ item }">
      {{ item.halfDayMinutes }} / {{ item.fullDayMinutes }}
    </template>
    <template #[`item.weeklyOffs`]="{ item }">{{ weeklyOffsText(item.weeklyOffs) }}</template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="canManage"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openDialog(item)"
      />
    </template>
  </v-data-table-server>

  <div class="d-flex align-center mt-8 mb-2">
    <h3 class="text-h6">Assignments</h3>
    <v-spacer />
    <v-btn v-if="canManage && shiftOptions.length" size="small" variant="tonal" @click="openAssign">
      Assign shift
    </v-btn>
  </div>
  <v-data-table-server
    v-model:page="assignmentList.page.value"
    v-model:items-per-page="assignmentList.pageSize.value"
    :items-length="assignmentList.total.value"
    :loading="assignmentList.loading.value"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    :items="assignments"
    :headers="assignmentHeaders"
    density="compact"
    disable-sort
  >
    <template #[`item.appliesTo`]="{ item: a }">
      {{
        a.employeeId
          ? `Employee ${a.employeeName ?? a.employeeId}${a.employeeCode ? ` (${a.employeeCode})` : ''}`
          : `Department ${deptName(a.departmentId)}`
      }}
    </template>
    <template #[`item.shiftId`]="{ item: a }">
      <template v-if="a.rotationShiftIds">
        {{ a.rotationShiftIds.map(shiftName).join(' → ') }} (every {{ a.rotationDays }} d)
      </template>
      <template v-else>{{ shiftName(a.shiftId) }}</template>
    </template>
    <template #[`item.effectiveTo`]="{ item: a }">{{ a.effectiveTo ?? '—' }}</template>
    <template #[`item.actions`]="{ item: a }">
      <v-btn
        v-if="canManage"
        size="small"
        variant="text"
        icon="mdi-delete"
        @click="removeAssign(a)"
      />
    </template>
    <template #no-data>
      <span class="text-medium-emphasis">
        No assignments — employees use the institution's default shift.
      </span>
    </template>
  </v-data-table-server>

  <v-dialog v-model="dialog.open" max-width="620">
    <v-card :title="dialog.id ? 'Edit shift' : 'New shift'">
      <v-card-text>
        <v-row dense>
          <v-col cols="4">
            <v-text-field v-model="dialog.code" label="Code *" :disabled="!!dialog.id" />
          </v-col>
          <v-col cols="8"><v-text-field v-model="dialog.name" label="Name *" /></v-col>
          <v-col cols="6"><v-text-field v-model="dialog.start" type="time" label="Start" /></v-col>
          <v-col cols="6">
            <v-text-field
              v-model="dialog.end"
              type="time"
              label="End"
              hint="End before start = overnight shift"
              persistent-hint
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="dialog.graceInMinutes"
              type="number"
              label="Grace in (min)"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="dialog.graceOutMinutes"
              type="number"
              label="Grace out (min)"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model.number="dialog.breakMinutes" type="number" label="Break (min)" />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="dialog.halfDayMinutes"
              type="number"
              label="Half day (min)"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="dialog.fullDayMinutes"
              type="number"
              label="Full day (min)"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="dialog.overtimeAfterMinutes"
              type="number"
              label="Overtime after (min)"
            />
          </v-col>
        </v-row>
        <v-checkbox
          v-model="dialog.inheritWeeklyOffs"
          label="Use calendar weekly offs"
          hide-details
        />
        <WeeklyOffsPicker
          v-if="!dialog.inheritWeeklyOffs"
          v-model="dialog.weeklyOffs"
          class="mt-2"
        />
        <v-checkbox v-model="dialog.isDefault" label="Institution default shift" hide-details />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!dialog.code || !dialog.name" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="assign.open" max-width="540">
    <v-card title="Assign shift">
      <v-card-text>
        <v-btn-toggle v-model="assign.target" mandatory density="compact" class="mb-4">
          <v-btn value="department">Department</v-btn>
          <v-btn value="employee">Employee</v-btn>
        </v-btn-toggle>
        <v-autocomplete
          v-if="assign.target === 'department'"
          v-model="assign.departmentId"
          :items="departments"
          item-title="name"
          item-value="id"
          label="Department *"
        />
        <EmployeePicker
          v-else
          v-model="assign.employeeId"
          :institution-id="institutionId"
          label="Employee *"
        />
        <v-select
          v-model="assign.shiftId"
          :items="shiftOptions"
          item-title="name"
          item-value="id"
          label="Shift"
          :disabled="assign.rotationShiftIds.length >= 2"
        />
        <v-select
          v-model="assign.rotationShiftIds"
          :items="shiftOptions"
          item-title="name"
          item-value="id"
          label="Rotation (optional, in order)"
          multiple
          chips
        />
        <v-text-field
          v-if="assign.rotationShiftIds.length >= 2"
          v-model.number="assign.rotationDays"
          type="number"
          label="Days per shift *"
        />
        <v-text-field v-model="assign.effectiveFrom" type="date" label="Effective from *" />
        <v-text-field v-model="assign.effectiveTo" type="date" label="Effective to" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="assign.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!assign.effectiveFrom" @click="saveAssign">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
