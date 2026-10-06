<script setup lang="ts">
import {
  ACCRUAL_FREQUENCIES,
  EMPLOYMENT_TYPES,
  type AccrualFrequency,
  type EmploymentType,
  type LeavePolicyDto,
  type LeaveTypeDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label, todayIso, useHrOptions } from './useHrOptions';

/** Leave types (organization masters) and accrual policies per institution × employment type. */
const auth = useAuthStore();
const { institutions, loadBase } = useHrOptions();
const types = ref<LeaveTypeDto[]>([]);
const policies = ref<LeavePolicyDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const canManage = computed(() => auth.can('leave.manage'));

const run = async (fn: () => Promise<void>) => {
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  }
};
async function load() {
  await run(async () => {
    [types.value, policies.value] = await Promise.all([
      apiFetch<{ data: LeaveTypeDto[] }>('/api/v1/leave/types?includeInactive=true').then(
        (r) => r.data,
      ),
      apiFetch<{ data: LeavePolicyDto[] }>('/api/v1/leave/policies').then((r) => r.data),
    ]);
  });
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});

const typeCode = (id: string) => types.value.find((t) => t.id === id)?.code ?? id;
const instName = (id: string | null) =>
  id ? (institutions.value.find((i) => i.id === id)?.name ?? id) : 'Organization default';
const numOrNull = (v: unknown) => (v === null || v === '' || v === undefined ? null : Number(v));

// Leave type dialog
const blankType = () => ({
  open: false,
  id: null as string | null,
  code: '',
  name: '',
  isPaid: true,
  allowHalfDay: true,
  employmentTypes: [] as EmploymentType[],
  requiresDocument: false,
  documentAfterDays: 0,
  sandwichRule: false,
  encashable: false,
  maxEncashDays: null as number | null,
  maxCarryForward: null as number | null,
  allowNegativeBalance: false,
  active: true,
});
const typeDialog = reactive(blankType());
function openType(t?: LeaveTypeDto) {
  Object.assign(typeDialog, blankType(), {
    open: true,
    ...(t
      ? {
          id: t.id,
          code: t.code,
          name: t.name,
          isPaid: t.isPaid,
          allowHalfDay: t.allowHalfDay,
          employmentTypes: t.employmentTypes ?? [],
          requiresDocument: t.requiresDocument,
          documentAfterDays: t.documentAfterDays,
          sandwichRule: t.sandwichRule,
          encashable: t.encashable,
          maxEncashDays: t.maxEncashDays,
          maxCarryForward: t.maxCarryForward,
          allowNegativeBalance: t.allowNegativeBalance,
          active: t.status === 'ACTIVE',
        }
      : {}),
  });
}
async function saveType() {
  const d = typeDialog;
  const body = {
    name: d.name.trim(),
    allowHalfDay: d.allowHalfDay,
    employmentTypes: d.employmentTypes.length ? d.employmentTypes : null,
    requiresDocument: d.requiresDocument,
    documentAfterDays: Number(d.documentAfterDays) || 0,
    sandwichRule: d.sandwichRule,
    encashable: d.encashable,
    maxEncashDays: numOrNull(d.maxEncashDays),
    maxCarryForward: numOrNull(d.maxCarryForward),
    allowNegativeBalance: d.allowNegativeBalance,
  };
  await run(async () => {
    await apiFetch(d.id ? `/api/v1/leave/types/${d.id}` : '/api/v1/leave/types', {
      method: d.id ? 'PATCH' : 'POST',
      body: JSON.stringify(
        d.id
          ? { ...body, status: d.active ? 'ACTIVE' : 'INACTIVE' }
          : { ...body, code: d.code.trim(), isPaid: d.isPaid },
      ),
    });
    d.open = false;
    await load();
  });
}

// Policy dialog
interface RuleRow {
  leaveTypeId: string;
  accrualFrequency: AccrualFrequency;
  annualQuota: number;
  proRataOnJoining: boolean;
  maxCarryForward: number | null;
}
const policyDialog = reactive({
  open: false,
  id: null as string | null,
  name: '',
  institutionId: null as string | null,
  employmentType: null as EmploymentType | null,
  active: true,
  rules: [] as RuleRow[],
});
function openPolicy(p?: LeavePolicyDto) {
  Object.assign(policyDialog, {
    open: true,
    id: p?.id ?? null,
    name: p?.name ?? '',
    institutionId: p?.institutionId ?? null,
    employmentType: p?.employmentType ?? null,
    active: p ? p.status === 'ACTIVE' : true,
    rules: (p?.rules ?? []).map((r) => ({
      leaveTypeId: r.leaveTypeId,
      accrualFrequency: r.accrualFrequency,
      annualQuota: r.annualQuota,
      proRataOnJoining: r.proRataOnJoining,
      maxCarryForward: r.maxCarryForward,
    })),
  });
}
function addRule() {
  const unused = types.value.find(
    (t) => t.status === 'ACTIVE' && !policyDialog.rules.some((r) => r.leaveTypeId === t.id),
  );
  if (!unused) return;
  policyDialog.rules.push({
    leaveTypeId: unused.id,
    accrualFrequency: 'MONTHLY',
    annualQuota: 12,
    proRataOnJoining: true,
    maxCarryForward: null,
  });
}
async function savePolicy() {
  const d = policyDialog;
  const rules = d.rules.map((r) => ({
    ...r,
    annualQuota: Number(r.annualQuota),
    maxCarryForward: numOrNull(r.maxCarryForward),
  }));
  await run(async () => {
    await apiFetch(d.id ? `/api/v1/leave/policies/${d.id}` : '/api/v1/leave/policies', {
      method: d.id ? 'PATCH' : 'POST',
      body: JSON.stringify(
        d.id
          ? { name: d.name.trim(), rules, status: d.active ? 'ACTIVE' : 'INACTIVE' }
          : {
              name: d.name.trim(),
              institutionId: d.institutionId,
              employmentType: d.employmentType,
              rules,
            },
      ),
    });
    d.open = false;
    await load();
  });
}

// Jobs
const accrualAsOf = ref(todayIso());
const yearEnd = ref(new Date().getFullYear() - 1);
async function runAccrual() {
  await run(async () => {
    const res = await apiFetch<{ data: { credited: number } }>('/api/v1/leave/accrual/run', {
      method: 'POST',
      body: JSON.stringify({ asOf: accrualAsOf.value }),
    });
    notice.value = `Accrual complete: ${JSON.stringify(res.data)}`;
  });
}
async function runYearEnd() {
  if (
    !confirm(`Close leave year ${yearEnd.value}? Carry-forward, encashment and lapse are posted.`)
  )
    return;
  await run(async () => {
    const res = await apiFetch<{ data: unknown }>('/api/v1/leave/year-end', {
      method: 'POST',
      body: JSON.stringify({ year: Number(yearEnd.value) }),
    });
    notice.value = `Year-end complete: ${JSON.stringify(res.data)}`;
  });
}

const typeHeaders = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Paid', key: 'isPaid' },
  { title: 'Half day', key: 'allowHalfDay' },
  { title: 'Sandwich', key: 'sandwichRule' },
  { title: 'Carry-forward cap', key: 'maxCarryForward' },
  { title: 'Encash (max)', key: 'encashable' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const employmentTypes = EMPLOYMENT_TYPES.map((value) => ({ value, title: label(value) }));
const frequencies = ACCRUAL_FREQUENCIES.map((value) => ({ value, title: label(value) }));
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Leave setup</h2>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" closable class="mb-4" @click:close="notice = null">
    {{ notice }}
  </v-alert>

  <div class="d-flex align-center mb-2">
    <h3 class="text-h6">Leave types</h3>
    <v-spacer />
    <v-btn
      v-if="canManage"
      size="small"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openType()"
    >
      New leave type
    </v-btn>
  </div>
  <v-data-table :items="types" :headers="typeHeaders" density="compact">
    <template #[`item.isPaid`]="{ item }">{{ yesNo(item.isPaid) }}</template>
    <template #[`item.allowHalfDay`]="{ item }">{{ yesNo(item.allowHalfDay) }}</template>
    <template #[`item.sandwichRule`]="{ item }">{{ yesNo(item.sandwichRule) }}</template>
    <template #[`item.maxCarryForward`]="{ item }">{{
      item.maxCarryForward ?? 'Unlimited'
    }}</template>
    <template #[`item.encashable`]="{ item }">
      {{ item.encashable ? (item.maxEncashDays ?? 'Unlimited') : 'No' }}
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="canManage"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openType(item)"
      />
    </template>
  </v-data-table>

  <div class="d-flex align-center mt-8 mb-2">
    <h3 class="text-h6">Policies</h3>
    <v-spacer />
    <v-btn
      v-if="canManage"
      size="small"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openPolicy()"
    >
      New policy
    </v-btn>
  </div>
  <v-table density="compact">
    <thead>
      <tr>
        <th>Name</th>
        <th>Institution</th>
        <th>Employment type</th>
        <th>Entitlements</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in policies" :key="p.id">
        <td>{{ p.name }}</td>
        <td>{{ instName(p.institutionId) }}</td>
        <td>{{ p.employmentType ? label(p.employmentType) : 'All' }}</td>
        <td>
          {{
            p.rules
              .map(
                (r) =>
                  `${typeCode(r.leaveTypeId)} ${r.annualQuota}/yr (${label(r.accrualFrequency)})`,
              )
              .join(', ')
          }}
        </td>
        <td>{{ label(p.status) }}</td>
        <td class="text-right">
          <v-btn
            v-if="canManage"
            size="small"
            variant="text"
            icon="mdi-pencil"
            @click="openPolicy(p)"
          />
        </td>
      </tr>
    </tbody>
  </v-table>

  <template v-if="canManage">
    <h3 class="text-h6 mt-8 mb-2">Accrual &amp; year-end</h3>
    <p class="text-body-2 mb-2">
      Accrual runs daily automatically and is idempotent per period; run it manually after policy
      changes. Year-end carries forward up to the cap, encashes up to the limit and lapses the rest.
    </p>
    <div class="d-flex ga-2 align-center">
      <v-text-field
        v-model="accrualAsOf"
        type="date"
        label="Accrue as of"
        density="compact"
        hide-details
        style="max-width: 200px"
      />
      <v-btn variant="tonal" @click="runAccrual">Run accrual</v-btn>
      <v-spacer />
      <v-text-field
        v-model.number="yearEnd"
        type="number"
        label="Leave year"
        density="compact"
        hide-details
        style="max-width: 140px"
      />
      <v-btn variant="tonal" color="warning" @click="runYearEnd">Run year-end</v-btn>
    </div>
  </template>

  <v-dialog v-model="typeDialog.open" max-width="620">
    <v-card :title="typeDialog.id ? 'Edit leave type' : 'New leave type'">
      <v-card-text>
        <v-row dense>
          <v-col cols="4">
            <v-text-field v-model="typeDialog.code" label="Code *" :disabled="!!typeDialog.id" />
          </v-col>
          <v-col cols="8"><v-text-field v-model="typeDialog.name" label="Name *" /></v-col>
          <v-col cols="6">
            <v-checkbox
              v-model="typeDialog.isPaid"
              label="Paid leave"
              :disabled="!!typeDialog.id"
              hide-details
            />
          </v-col>
          <v-col cols="6">
            <v-checkbox v-model="typeDialog.allowHalfDay" label="Half day allowed" hide-details />
          </v-col>
          <v-col cols="6">
            <v-checkbox
              v-model="typeDialog.sandwichRule"
              label="Sandwich rule (count enclosed holidays)"
              hide-details
            />
          </v-col>
          <v-col cols="6">
            <v-checkbox
              v-model="typeDialog.allowNegativeBalance"
              label="Allow negative balance"
              hide-details
            />
          </v-col>
          <v-col cols="12">
            <v-select
              v-model="typeDialog.employmentTypes"
              :items="employmentTypes"
              label="Eligible employment types (empty = all)"
              multiple
              chips
            />
          </v-col>
          <v-col cols="6">
            <v-checkbox
              v-model="typeDialog.requiresDocument"
              label="Document required"
              hide-details
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-if="typeDialog.requiresDocument"
              v-model.number="typeDialog.documentAfterDays"
              type="number"
              label="…when longer than (days)"
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="typeDialog.maxCarryForward"
              type="number"
              label="Carry-forward cap (empty = unlimited)"
            />
          </v-col>
          <v-col cols="6">
            <v-checkbox v-model="typeDialog.encashable" label="Encashable" hide-details />
            <v-text-field
              v-if="typeDialog.encashable"
              v-model.number="typeDialog.maxEncashDays"
              type="number"
              label="Max encash days"
            />
          </v-col>
          <v-col v-if="typeDialog.id" cols="12">
            <v-switch v-model="typeDialog.active" label="Active" hide-details />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="typeDialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!typeDialog.code || !typeDialog.name" @click="saveType">
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="policyDialog.open" max-width="820">
    <v-card :title="policyDialog.id ? 'Edit policy' : 'New policy'">
      <v-card-text>
        <v-text-field v-model="policyDialog.name" label="Name *" />
        <template v-if="!policyDialog.id">
          <v-autocomplete
            v-model="policyDialog.institutionId"
            :items="institutions"
            item-title="name"
            item-value="id"
            label="Institution (empty = organization default)"
            clearable
          />
          <v-select
            v-model="policyDialog.employmentType"
            :items="employmentTypes"
            label="Employment type (empty = all)"
            clearable
          />
        </template>
        <v-switch v-else v-model="policyDialog.active" label="Active" hide-details />
        <v-table density="compact">
          <thead>
            <tr>
              <th>Leave type</th>
              <th>Accrual</th>
              <th>Days / year</th>
              <th>Pro-rata on joining</th>
              <th>Carry-forward cap</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in policyDialog.rules" :key="i">
              <td>
                <v-select
                  v-model="r.leaveTypeId"
                  :items="types"
                  item-title="code"
                  item-value="id"
                  density="compact"
                  hide-details
                />
              </td>
              <td>
                <v-select
                  v-model="r.accrualFrequency"
                  :items="frequencies"
                  density="compact"
                  hide-details
                />
              </td>
              <td>
                <v-text-field
                  v-model.number="r.annualQuota"
                  type="number"
                  density="compact"
                  hide-details
                />
              </td>
              <td><v-checkbox v-model="r.proRataOnJoining" density="compact" hide-details /></td>
              <td>
                <v-text-field
                  v-model.number="r.maxCarryForward"
                  type="number"
                  density="compact"
                  hide-details
                  placeholder="type default"
                />
              </td>
              <td>
                <v-btn
                  size="small"
                  variant="text"
                  icon="mdi-delete"
                  @click="policyDialog.rules.splice(i, 1)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-btn size="small" variant="text" prepend-icon="mdi-plus" class="mt-2" @click="addRule">
          Add leave type
        </v-btn>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="policyDialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!policyDialog.name" @click="savePolicy">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
