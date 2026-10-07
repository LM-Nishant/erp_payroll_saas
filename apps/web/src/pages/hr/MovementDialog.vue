<script setup lang="ts">
import type { ApiListResponse, EmployeeDto, EmployeeMovementDto } from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { label, todayIso, useHrOptions } from './useHrOptions';

/**
 * Transfer / promotion / designation, department or reporting change. Effective-dated; routed
 * through the `employee_transfer` workflow when the organization defined one.
 */
const props = defineProps<{ employee: EmployeeDto }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [movement: EmployeeMovementDto] }>();

const { institutions, designations, departments, campuses, loadBase, loadForInstitution } =
  useHrOptions();
const managers = ref<EmployeeDto[]>([]);
const saving = ref(false);
const error = ref<string | null>(null);
const form = reactive({
  type: 'TRANSFER' as
    'TRANSFER' | 'PROMOTION' | 'DESIGNATION_CHANGE' | 'DEPARTMENT_CHANGE' | 'REPORTING_CHANGE',
  effectiveDate: todayIso(),
  toInstitutionId: null as string | null,
  toCampusId: null as string | null,
  toDepartmentId: null as string | null,
  toDesignationId: null as string | null,
  toReportingManagerId: null as string | null,
  reason: '',
});

const showInstitution = computed(() => form.type === 'TRANSFER');
const showDepartment = computed(() => ['TRANSFER', 'DEPARTMENT_CHANGE'].includes(form.type));
const showDesignation = computed(() =>
  ['TRANSFER', 'PROMOTION', 'DESIGNATION_CHANGE'].includes(form.type),
);
const showManager = computed(() => ['TRANSFER', 'REPORTING_CHANGE'].includes(form.type));

watch(open, async (isOpen) => {
  if (!isOpen) return;
  error.value = null;
  Object.assign(form, {
    type: 'TRANSFER',
    effectiveDate: todayIso(),
    toInstitutionId: props.employee.institutionId,
    toCampusId: props.employee.campusId,
    toDepartmentId: props.employee.departmentId,
    toDesignationId: props.employee.designationId,
    toReportingManagerId: props.employee.reportingManagerId,
    reason: '',
  });
  await loadBase();
  await loadForInstitution(form.toInstitutionId);
  try {
    managers.value = (
      await apiFetch<ApiListResponse<EmployeeDto>>('/api/v1/employees?pageSize=100&status=ACTIVE')
    ).data.filter((e) => e.id !== props.employee.id);
  } catch {
    managers.value = [];
  }
});
watch(
  () => form.toInstitutionId,
  async (id, prev) => {
    if (!open.value || prev === undefined || id === prev) return;
    form.toDepartmentId = null;
    form.toCampusId = null;
    await loadForInstitution(id);
  },
);

async function save() {
  saving.value = true;
  error.value = null;
  const body: Record<string, unknown> = {
    type: form.type,
    effectiveDate: form.effectiveDate,
    reason: form.reason.trim(),
  };
  if (showInstitution.value) {
    body.toInstitutionId = form.toInstitutionId;
    body.toCampusId = form.toCampusId;
  }
  if (showDepartment.value) body.toDepartmentId = form.toDepartmentId;
  if (showDesignation.value) body.toDesignationId = form.toDesignationId;
  if (showManager.value) body.toReportingManagerId = form.toReportingManagerId;
  try {
    const res = await apiFetch<{ data: EmployeeMovementDto }>(
      `/api/v1/employees/${props.employee.id}/movements`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    emit('saved', res.data);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

const types = [
  'TRANSFER',
  'PROMOTION',
  'DESIGNATION_CHANGE',
  'DEPARTMENT_CHANGE',
  'REPORTING_CHANGE',
].map((value) => ({ value, title: label(value) }));
const managerTitle = (e: EmployeeDto) => `${e.displayName} (${e.employeeCode})`;
</script>

<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card title="Transfer / movement">
      <v-card-text>
        <v-alert v-if="error" type="error" density="compact" class="mb-4">{{ error }}</v-alert>
        <p class="text-body-2 mb-4">
          Movements are effective-dated: past history keeps the old assignment. Transfers stay
          within the organization; an approval workflow applies when configured.
        </p>
        <v-row dense>
          <v-col cols="12" md="6">
            <v-select v-model="form.type" :items="types" label="Movement type" />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.effectiveDate" type="date" label="Effective date" />
          </v-col>
          <v-col v-if="showInstitution" cols="12" md="6">
            <v-autocomplete
              v-model="form.toInstitutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="To institution"
            />
          </v-col>
          <v-col v-if="showInstitution" cols="12" md="6">
            <v-autocomplete
              v-model="form.toCampusId"
              :items="campuses"
              item-title="name"
              item-value="id"
              label="To campus"
              clearable
            />
          </v-col>
          <v-col v-if="showDepartment" cols="12" md="6">
            <v-autocomplete
              v-model="form.toDepartmentId"
              :items="departments"
              item-title="name"
              item-value="id"
              label="To department"
              clearable
            />
          </v-col>
          <v-col v-if="showDesignation" cols="12" md="6">
            <v-autocomplete
              v-model="form.toDesignationId"
              :items="designations"
              item-title="name"
              item-value="id"
              label="To designation"
              clearable
            />
          </v-col>
          <v-col v-if="showManager" cols="12">
            <v-autocomplete
              v-model="form.toReportingManagerId"
              :items="managers"
              :item-title="managerTitle"
              item-value="id"
              label="Reporting manager"
              clearable
            />
          </v-col>
          <v-col cols="12">
            <v-textarea v-model="form.reason" label="Reason *" rows="2" auto-grow />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="!form.reason.trim()" @click="save">
          Submit
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
