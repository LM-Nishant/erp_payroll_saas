<script setup lang="ts">
import {
  TAX_REGIMES,
  type ApiListResponse,
  type EmployeeDto,
  type EmployeeSalaryDto,
  type PayrollComputationDto,
  type SalaryComponentDto,
  type SalaryRevisionDto,
  type SalaryStructureDto,
  type TaxRegime,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ApiError, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label, todayIso } from '@/pages/hr/useHrOptions';
import { firstOfMonth, lastOfMonth, money, searchEmployees } from './payroll';

/** Employee salary assignment, revisions (workflow + arrears) and a payslip preview. */
const auth = useAuthStore();
const employees = ref<EmployeeDto[]>([]);
const search = ref('');
const employee = ref<EmployeeDto | null>(null);
const history = ref<EmployeeSalaryDto[]>([]);
const revisions = ref<SalaryRevisionDto[]>([]);
const structures = ref<SalaryStructureDto[]>([]);
const components = ref<SalaryComponentDto[]>([]);
const preview = ref<PayrollComputationDto | null>(null);
const error = ref<string | null>(null);
const canUpdate = computed(() => auth.can('salary.update'));

async function findEmployees() {
  try {
    employees.value = await searchEmployees(search.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(findEmployees);
watch(search, findEmployees);

async function loadEmployee() {
  preview.value = null;
  if (!employee.value) return;
  const e = employee.value;
  try {
    [history.value, revisions.value, structures.value, components.value] = await Promise.all([
      apiFetch<{ data: EmployeeSalaryDto[] }>(`/api/v1/payroll/employees/${e.id}/salary`).then(
        (r) => r.data,
      ),
      apiFetch<ApiListResponse<SalaryRevisionDto>>(
        `/api/v1/payroll/revisions?employeeId=${e.id}&pageSize=50`,
      ).then((r) => r.data),
      apiFetch<ApiListResponse<SalaryStructureDto>>(
        `/api/v1/payroll/structures?institutionId=${e.institutionId}&status=ACTIVE&pageSize=100`,
      ).then((r) => r.data),
      apiFetch<ApiListResponse<SalaryComponentDto>>(
        `/api/v1/payroll/components?institutionId=${e.institutionId}&status=ACTIVE&pageSize=100`,
      ).then((r) => r.data),
    ]);
  } catch (err) {
    error.value = (err as Error).message;
  }
}
watch(employee, loadEmployee);
const structureName = (id: string | null) =>
  id ? (structures.value.find((s) => s.id === id)?.code ?? id) : '—';

/**
 * Per-employee component set: every structure line + statutory component can be switched off
 * (e.g. PF not applicable), given a fixed monthly amount, and extra components can be added.
 */
interface ComponentRow {
  code: string;
  name: string;
  type: string;
  statutory: boolean;
  extra: boolean;
  applies: boolean;
  amount: string;
}
const isStatutory = (c: SalaryComponentDto) =>
  Boolean(c.statutoryCode) || c.calcType === 'STATUTORY';
/** Institution-level components shadow organization-level ones with the same code. */
const componentsByCode = computed(() => {
  const map = new Map<string, SalaryComponentDto>();
  for (const c of components.value) {
    if (!map.has(c.code) || c.institutionId) map.set(c.code, c);
  }
  return map;
});
const rows = ref<ComponentRow[]>([]);
const addCode = ref<string | null>(null);

function structureCodes(structureId: string | null): string[] {
  const s = structures.value.find((x) => x.id === structureId);
  if (!s) {
    return [...componentsByCode.value.values()].filter((c) => !isStatutory(c)).map((c) => c.code);
  }
  const latest = [...s.versions].sort((a, b) => b.version - a.version)[0];
  return (latest?.lines ?? []).map((l) => l.componentCode);
}
function buildRows(amounts: Record<string, number>, excluded: string[]) {
  const base = structureCodes(form.structureId);
  const statutory = [...componentsByCode.value.values()]
    .filter((c) => isStatutory(c) && !base.includes(c.code))
    .map((c) => c.code);
  const extras = Object.keys(amounts).filter((c) => !base.includes(c) && !statutory.includes(c));
  const row = (code: string, extra: boolean): ComponentRow => {
    const c = componentsByCode.value.get(code);
    return {
      code,
      name: c?.name ?? code,
      type: c?.type ?? '',
      statutory: c ? isStatutory(c) : false,
      extra,
      applies: !excluded.includes(code),
      amount: amounts[code] !== undefined ? String(amounts[code]) : '',
    };
  };
  rows.value = [
    ...base.map((c) => row(c, false)),
    ...extras.map((c) => row(c, true)),
    ...statutory.map((c) => row(c, false)),
  ];
}
const addable = computed(() =>
  [...componentsByCode.value.values()].filter(
    (c) => !isStatutory(c) && !rows.value.some((r) => r.code === c.code),
  ),
);
function addComponent() {
  const c = addCode.value ? componentsByCode.value.get(addCode.value) : undefined;
  if (!c) return;
  const at = rows.value.findIndex((r) => r.statutory);
  const row: ComponentRow = {
    code: c.code,
    name: c.name,
    type: c.type,
    statutory: false,
    extra: true,
    applies: true,
    amount: c.amount !== null ? String(c.amount) : '',
  };
  rows.value.splice(at < 0 ? rows.value.length : at, 0, row);
  addCode.value = null;
}
function removeRow(code: string) {
  rows.value = rows.value.filter((r) => r.code !== code);
}
/** Employee/employer halves of PF, ESI and LWF are switched on and off together. */
function toggle(r: ComponentRow, applies: boolean) {
  r.applies = applies;
  const m = /^(.*)_(EE|ER)$/.exec(r.code);
  if (!r.statutory || !m) return;
  const partner = rows.value.find((x) => x.code === `${m[1]}_${m[2] === 'EE' ? 'ER' : 'EE'}`);
  if (partner) partner.applies = applies;
}

const form = reactive({
  open: false,
  mode: 'assign' as 'assign' | 'revise',
  structureId: null as string | null,
  effectiveFrom: todayIso(),
  annualCtc: null as number | null,
  taxRegime: 'NEW' as TaxRegime,
  reason: '',
});
watch(
  () => form.structureId,
  () => {
    if (!form.open) return;
    const amounts: Record<string, number> = {};
    for (const r of rows.value) if (r.amount !== '') amounts[r.code] = Number(r.amount);
    buildRows(
      amounts,
      rows.value.filter((r) => !r.applies).map((r) => r.code),
    );
  },
);
function openForm(mode: 'assign' | 'revise') {
  const current = history.value[0];
  Object.assign(form, {
    open: true,
    mode,
    structureId: current?.structureId ?? null,
    effectiveFrom: todayIso(),
    annualCtc: current?.annualCtc ?? null,
    taxRegime: current?.taxRegime ?? 'NEW',
    reason: mode === 'assign' ? 'Salary assignment' : '',
  });
  formError.value = null;
  buildRows(current?.amounts ?? {}, current?.excludedComponents ?? []);
}
const formError = ref<string | null>(null);
/** Turns a VALIDATION_ERROR into "field: message" lines so the user sees what to fix. */
function describeError(e: unknown): string {
  const issues = (e instanceof ApiError ? e.details : undefined) as
    { issues?: { path: string; message: string }[] } | undefined;
  if (!issues?.issues?.length) return (e as Error).message;
  return issues.issues.map((i) => `${i.path || 'request'}: ${i.message}`).join('; ');
}
async function submit() {
  if (!employee.value) return;
  formError.value = null;
  if (!form.structureId) {
    formError.value = 'Select a salary structure.';
    return;
  }
  if (!form.annualCtc || Number(form.annualCtc) <= 0) {
    formError.value = 'Enter the annual CTC.';
    return;
  }
  if (!form.reason.trim()) {
    formError.value = 'Enter a reason for this salary change.';
    return;
  }
  const amounts: Record<string, number> = {};
  for (const r of rows.value) {
    if (!r.applies) continue;
    if (r.amount === '') {
      if (r.extra) {
        formError.value = `Enter a monthly amount for ${r.code}.`;
        return;
      }
      continue;
    }
    amounts[r.code] = Number(r.amount);
  }
  const body = {
    structureId: form.structureId,
    effectiveFrom: form.effectiveFrom,
    annualCtc: Number(form.annualCtc),
    amounts,
    excludedComponents: rows.value.filter((r) => !r.applies && !r.extra).map((r) => r.code),
    taxRegime: form.taxRegime,
    reason: form.reason.trim(),
  };
  try {
    if (form.mode === 'assign') {
      await apiFetch(`/api/v1/payroll/employees/${employee.value.id}/salary`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } else {
      await apiFetch('/api/v1/payroll/revisions', {
        method: 'POST',
        body: JSON.stringify({ ...body, employeeId: employee.value.id }),
      });
    }
    form.open = false;
    await loadEmployee();
  } catch (e) {
    formError.value = describeError(e);
  }
}

const period = ref(firstOfMonth());
async function runPreview() {
  if (!employee.value) return;
  try {
    preview.value = (
      await apiFetch<{ data: PayrollComputationDto }>('/api/v1/payroll/salary/preview', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: employee.value.id,
          periodStart: period.value,
          periodEnd: lastOfMonth(period.value),
        }),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Employee salary</h2>
    <v-spacer />
    <v-autocomplete
      v-model="employee"
      v-model:search="search"
      :items="employees"
      :item-title="(e: EmployeeDto) => `${e.employeeCode} · ${e.displayName}`"
      return-object
      label="Employee"
      density="compact"
      hide-details
      no-filter
      style="max-width: 380px"
    />
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>

  <template v-if="employee">
    <v-card class="mb-4" title="Salary history (immutable)">
      <template #append>
        <v-btn v-if="canUpdate" variant="tonal" class="mr-2" @click="openForm('assign')">
          Assign
        </v-btn>
        <v-btn v-if="canUpdate && history.length" color="primary" @click="openForm('revise')">
          Request revision
        </v-btn>
      </template>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Effective from</th>
            <th>Structure</th>
            <th>Annual CTC</th>
            <th>Overrides</th>
            <th>Not applicable</th>
            <th>Regime</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in history" :key="h.id">
            <td>{{ h.effectiveFrom }}</td>
            <td>{{ structureName(h.structureId) }}</td>
            <td>{{ money(h.annualCtc) }}</td>
            <td>
              <code class="text-caption">{{ JSON.stringify(h.amounts) }}</code>
            </td>
            <td>{{ h.excludedComponents.join(', ') || '—' }}</td>
            <td>{{ h.taxRegime }}</td>
          </tr>
          <tr v-if="!history.length">
            <td colspan="6" class="text-medium-emphasis">No salary assigned yet.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-card class="mb-4" title="Revisions">
      <v-table density="compact">
        <thead>
          <tr>
            <th>Effective from</th>
            <th>CTC (previous → new)</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Arrears</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in revisions" :key="r.id">
            <td>{{ r.effectiveFrom }}</td>
            <td>{{ money(r.previousAnnualCtc) }} → {{ money(r.annualCtc) }}</td>
            <td>{{ r.reason }}</td>
            <td>
              <v-chip size="small">{{ label(r.status) }}</v-chip>
            </td>
            <td>{{ money(r.arrearsAmount) }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-card title="Preview">
      <v-card-text class="d-flex ga-2 align-center">
        <v-text-field
          v-model="period"
          type="date"
          label="Period start"
          density="compact"
          hide-details
          style="max-width: 200px"
        />
        <v-btn variant="tonal" @click="runPreview">Compute preview</v-btn>
      </v-card-text>
      <v-table v-if="preview" density="compact">
        <thead>
          <tr>
            <th>Component</th>
            <th>Category</th>
            <th class="text-end">Amount</th>
            <th>Explanation</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in preview.lines" :key="l.code">
            <td>{{ l.code }} · {{ l.name }}</td>
            <td>{{ label(l.category) }}</td>
            <td class="text-end">{{ money(l.amount) }}</td>
            <td class="text-caption">{{ l.explanation }}</td>
          </tr>
          <tr>
            <th colspan="2">
              Gross {{ money(preview.gross) }} · Deductions {{ money(preview.deductions) }}
            </th>
            <th class="text-end">Net {{ money(preview.net) }}</th>
            <th class="text-caption">
              Payable {{ preview.attendance.payableDays }}/{{ preview.attendance.calendarDays }} ·
              LOP {{ preview.attendance.lopDays }}
            </th>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-for="w in preview?.warnings ?? []" :key="w" type="warning" density="compact">
        {{ w }}
      </v-alert>
    </v-card>
  </template>

  <v-dialog v-model="form.open" max-width="760">
    <v-card :title="form.mode === 'assign' ? 'Assign salary' : 'Request salary revision'">
      <v-card-text>
        <v-select
          v-model="form.structureId"
          :items="structures"
          item-title="name"
          item-value="id"
          label="Structure"
        />
        <v-text-field v-model="form.effectiveFrom" type="date" label="Effective from" />
        <v-text-field v-model="form.annualCtc" type="number" label="Annual CTC" />
        <div class="text-subtitle-2 mb-1">Components for this employee</div>
        <div class="text-caption text-medium-emphasis mb-2">
          Untick a component that does not apply (e.g. PF opt-out). Leave the amount empty to use
          the structure's calculation, or enter a fixed monthly amount.
        </div>
        <v-table density="compact" class="mb-2">
          <thead>
            <tr>
              <th>Applies</th>
              <th>Component</th>
              <th>Type</th>
              <th style="width: 170px">Monthly amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.code" :class="{ 'text-disabled': !r.applies }">
              <td>
                <v-checkbox-btn
                  :model-value="r.applies"
                  :aria-label="`${r.code} applies`"
                  @update:model-value="toggle(r, Boolean($event))"
                />
              </td>
              <td>{{ r.code }} · {{ r.name }}</td>
              <td>{{ r.statutory ? 'Statutory' : label(r.type) }}</td>
              <td>
                <span v-if="r.statutory" class="text-caption">As per statutory rules</span>
                <v-text-field
                  v-else
                  v-model="r.amount"
                  type="number"
                  density="compact"
                  hide-details
                  :disabled="!r.applies"
                  :placeholder="r.extra ? 'Required' : 'Auto'"
                />
              </td>
              <td>
                <v-btn
                  v-if="r.extra"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  :aria-label="`Remove ${r.code}`"
                  @click="removeRow(r.code)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <div class="d-flex ga-2 align-center mb-4">
          <v-select
            v-model="addCode"
            :items="addable"
            :item-title="(c: SalaryComponentDto) => `${c.code} · ${c.name}`"
            item-value="code"
            label="Add component"
            density="compact"
            hide-details
          />
          <v-btn variant="tonal" :disabled="!addCode" @click="addComponent">Add</v-btn>
        </div>
        <v-select v-model="form.taxRegime" :items="TAX_REGIMES" label="Tax regime" />
        <v-text-field
          v-model="form.reason"
          label="Reason *"
          :rules="[(v: string) => !!v?.trim() || 'Reason is required']"
        />
        <v-alert v-if="formError" type="error" density="compact" class="mb-2">
          {{ formError }}
        </v-alert>
        <v-alert v-if="form.mode === 'revise'" type="info" density="compact">
          Revisions go through the salary_revision workflow; back-dated revisions create arrears.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="form.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="submit">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
