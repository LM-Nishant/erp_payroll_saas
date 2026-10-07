<script setup lang="ts">
import { EMPLOYMENT_TYPES, type EmployeeDto } from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { ApiError, apiFetch } from '@/api/client';
import EmployeePicker from '@/components/EmployeePicker.vue';
import { label, useHrOptions } from './useHrOptions';

/** Create / edit an employee. Assignment fields are editable only while the record is DRAFT. */
const props = defineProps<{ employee?: EmployeeDto | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [employee: EmployeeDto] }>();

const { institutions, designations, departments, campuses, loadBase, loadForInstitution } =
  useHrOptions();
const isEdit = computed(() => Boolean(props.employee));
const assignmentEditable = computed(() => !props.employee || props.employee.status === 'DRAFT');
const saving = ref(false);
const error = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const blank = () => ({
  employeeCode: '',
  firstName: '',
  middleName: '',
  lastName: '',
  institutionId: null as string | null,
  campusId: null as string | null,
  departmentId: null as string | null,
  designationId: null as string | null,
  reportingManagerId: null as string | null,
  employmentType: 'TEACHING' as (typeof EMPLOYMENT_TYPES)[number],
  status: 'DRAFT' as 'DRAFT' | 'ONBOARDING' | 'ACTIVE',
  workEmail: '',
  workPhone: '',
  dateOfJoining: '',
  probationEndDate: '',
  noticePeriodDays: null as number | null,
});
const form = reactive(blank());

watch(open, async (isOpen) => {
  if (!isOpen) return;
  error.value = null;
  fieldErrors.value = {};
  Object.assign(form, blank());
  const e = props.employee;
  if (e) {
    Object.assign(form, {
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      middleName: e.middleName ?? '',
      lastName: e.lastName ?? '',
      institutionId: e.institutionId,
      campusId: e.campusId,
      departmentId: e.departmentId,
      designationId: e.designationId,
      reportingManagerId: e.reportingManagerId,
      employmentType: e.employmentType,
      workEmail: e.workEmail ?? '',
      workPhone: e.workPhone ?? '',
      dateOfJoining: e.dateOfJoining ?? '',
      probationEndDate: e.probationEndDate ?? '',
      noticePeriodDays: e.noticePeriodDays,
    });
  }
  await loadBase();
  await loadForInstitution(form.institutionId);
});
watch(
  () => form.institutionId,
  async (id, prev) => {
    if (prev !== undefined && id !== prev && open.value) {
      form.departmentId = null;
      form.campusId = null;
    }
    await loadForInstitution(id);
  },
);

const opt = (v: string) => (v.trim() ? v.trim() : null);

async function save() {
  saving.value = true;
  error.value = null;
  fieldErrors.value = {};
  const core = {
    firstName: form.firstName.trim(),
    middleName: opt(form.middleName),
    lastName: opt(form.lastName),
    employmentType: form.employmentType,
    workEmail: opt(form.workEmail),
    workPhone: opt(form.workPhone),
    dateOfJoining: opt(form.dateOfJoining),
    probationEndDate: opt(form.probationEndDate),
    noticePeriodDays: form.noticePeriodDays,
  };
  const assignment = assignmentEditable.value
    ? {
        institutionId: form.institutionId ?? undefined,
        campusId: form.campusId,
        departmentId: form.departmentId,
        designationId: form.designationId,
        reportingManagerId: form.reportingManagerId,
      }
    : {};
  try {
    const res = isEdit.value
      ? await apiFetch<{ data: EmployeeDto }>(`/api/v1/employees/${props.employee!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...core,
            ...assignment,
            ...(form.employeeCode.trim() && form.employeeCode !== props.employee!.employeeCode
              ? { employeeCode: form.employeeCode.trim() }
              : {}),
          }),
        })
      : await apiFetch<{ data: EmployeeDto }>('/api/v1/employees', {
          method: 'POST',
          body: JSON.stringify({
            ...core,
            ...assignment,
            status: form.status,
            ...(form.employeeCode.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
          }),
        });
    emit('saved', res.data);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
    const issues =
      (e instanceof ApiError
        ? (e.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues
        : undefined) ?? [];
    fieldErrors.value = Object.fromEntries(issues.map((i) => [i.path, i.message]));
  } finally {
    saving.value = false;
  }
}

const types = EMPLOYMENT_TYPES.map((value) => ({ value, title: label(value) }));
const statuses = ['DRAFT', 'ONBOARDING', 'ACTIVE'].map((value) => ({ value, title: label(value) }));
</script>

<template>
  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card :title="isEdit ? 'Edit employee' : 'New employee'">
      <v-card-text>
        <v-alert v-if="error" type="error" density="compact" class="mb-4">{{ error }}</v-alert>
        <v-alert
          v-if="isEdit && !assignmentEditable"
          type="info"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          Institution, department and designation changes go through a movement (transfer /
          promotion) so the history stays intact.
        </v-alert>
        <v-row dense>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="form.employeeCode"
              label="Employee code"
              :hint="isEdit ? '' : 'Leave empty to generate from the numbering sequence'"
              persistent-hint
              :error-messages="fieldErrors.employeeCode"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select v-model="form.employmentType" :items="types" label="Employment type" />
          </v-col>
          <v-col v-if="!isEdit" cols="12" md="4">
            <v-select v-model="form.status" :items="statuses" label="Initial status" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="form.firstName"
              label="First name *"
              :error-messages="fieldErrors.firstName"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field v-model="form.middleName" label="Middle name" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field v-model="form.lastName" label="Last name" />
          </v-col>
          <v-col cols="12" md="6">
            <v-autocomplete
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution *"
              :disabled="!assignmentEditable"
              :error-messages="fieldErrors.institutionId"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-autocomplete
              v-model="form.campusId"
              :items="campuses"
              item-title="name"
              item-value="id"
              label="Campus"
              clearable
              :disabled="!assignmentEditable"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-autocomplete
              v-model="form.departmentId"
              :items="departments"
              item-title="name"
              item-value="id"
              label="Department"
              clearable
              :disabled="!assignmentEditable"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-autocomplete
              v-model="form.designationId"
              :items="designations"
              item-title="name"
              item-value="id"
              label="Designation"
              clearable
              :disabled="!assignmentEditable"
            />
          </v-col>
          <v-col cols="12" md="6">
            <EmployeePicker
              v-model="form.reportingManagerId"
              label="Reporting manager"
              :disabled="!assignmentEditable"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.workEmail"
              label="Work email"
              :error-messages="fieldErrors.workEmail"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.workPhone" label="Work phone" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field v-model="form.dateOfJoining" type="date" label="Date of joining" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field v-model="form.probationEndDate" type="date" label="Probation ends" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model.number="form.noticePeriodDays"
              type="number"
              label="Notice period (days)"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="!form.firstName || !form.institutionId"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
