<script setup lang="ts">
import {
  TAX_REGIMES,
  type ApiListResponse,
  type EmployeeDto,
  type EmployeeSalaryDto,
  type PayrollComputationDto,
  type SalaryRevisionDto,
  type SalaryStructureDto,
  type TaxRegime,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
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
    [history.value, revisions.value, structures.value] = await Promise.all([
      apiFetch<{ data: EmployeeSalaryDto[] }>(`/api/v1/payroll/employees/${e.id}/salary`).then(
        (r) => r.data,
      ),
      apiFetch<ApiListResponse<SalaryRevisionDto>>(
        `/api/v1/payroll/revisions?employeeId=${e.id}&pageSize=50`,
      ).then((r) => r.data),
      apiFetch<ApiListResponse<SalaryStructureDto>>(
        `/api/v1/payroll/structures?institutionId=${e.institutionId}&status=ACTIVE&pageSize=100`,
      ).then((r) => r.data),
    ]);
  } catch (err) {
    error.value = (err as Error).message;
  }
}
watch(employee, loadEmployee);
const structureName = (id: string | null) =>
  id ? (structures.value.find((s) => s.id === id)?.code ?? id) : '—';

const form = reactive({
  open: false,
  mode: 'assign' as 'assign' | 'revise',
  structureId: null as string | null,
  effectiveFrom: todayIso(),
  annualCtc: null as number | null,
  amountsJson: '{}',
  taxRegime: 'NEW' as TaxRegime,
  reason: '',
});
function openForm(mode: 'assign' | 'revise') {
  const current = history.value[0];
  Object.assign(form, {
    open: true,
    mode,
    structureId: current?.structureId ?? null,
    effectiveFrom: todayIso(),
    annualCtc: current?.annualCtc ?? null,
    amountsJson: JSON.stringify(current?.amounts ?? {}),
    taxRegime: current?.taxRegime ?? 'NEW',
    reason: mode === 'assign' ? 'Salary assignment' : '',
  });
}
async function submit() {
  if (!employee.value) return;
  const body = {
    structureId: form.structureId,
    effectiveFrom: form.effectiveFrom,
    annualCtc: Number(form.annualCtc),
    amounts: JSON.parse(form.amountsJson) as Record<string, number>,
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
    error.value = (e as Error).message;
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
            <td>{{ h.taxRegime }}</td>
          </tr>
          <tr v-if="!history.length">
            <td colspan="5" class="text-medium-emphasis">No salary assigned yet.</td>
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

  <v-dialog v-model="form.open" max-width="600">
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
        <v-text-field
          v-model="form.amountsJson"
          label='Monthly overrides JSON, e.g. {"BASIC":30000}'
        />
        <v-select v-model="form.taxRegime" :items="TAX_REGIMES" label="Tax regime" />
        <v-text-field v-model="form.reason" label="Reason" />
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
