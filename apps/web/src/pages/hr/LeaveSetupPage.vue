<script setup lang="ts">
import {
  ACCRUAL_FREQUENCIES,
  EMPLOYMENT_TYPES,
  SANDWICH_MODES,
  type AccrualFrequency,
  type ApiListResponse,
  type EmploymentType,
  type LeaveNoticeTier,
  type LeavePolicyDto,
  type LeavePolicyRuleDto,
  type LeaveTypeDto,
  type SandwichMode,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';
import { label, todayIso, useHrOptions, type Option } from './useHrOptions';

/**
 * Leave types (organization masters) and policies per organization / group / institution ×
 * employment type — entitlements plus optional application rules (notice, sandwich, limits).
 */
const auth = useAuthStore();
const terms = useTerms();
const { institutions, loadBase } = useHrOptions();
const groups = ref<Option[]>([]);
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
  if (auth.can('group.view')) {
    groups.value = await apiFetch<ApiListResponse<Option>>('/api/v1/groups?pageSize=100')
      .then((r) => r.data)
      .catch(() => []);
  }
});

const typeCode = (id: string) => types.value.find((t) => t.id === id)?.code ?? id;
const scopeName = (p: Pick<LeavePolicyDto, 'groupId' | 'institutionId'>) =>
  p.institutionId
    ? `${terms.value.institution}: ${institutions.value.find((i) => i.id === p.institutionId)?.name ?? p.institutionId}`
    : p.groupId
      ? `${terms.value.group}: ${groups.value.find((g) => g.id === p.groupId)?.name ?? p.groupId}`
      : 'Organization default';
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
type PolicyScope = 'ORGANIZATION' | 'GROUP' | 'INSTITUTION';
/** Tri-state for optional boolean overrides: null = inherit. */
type Tri = boolean | null;
interface RuleRow {
  leaveTypeId: string;
  accrualFrequency: AccrualFrequency;
  annualQuota: number;
  proRataOnJoining: boolean;
  maxCarryForward: number | null;
  advanced: boolean;
  sandwichMode: SandwichMode | null;
  sandwichMinDays: number | null;
  sandwichAdjacent: Tri;
  minNoticeDays: number | null;
  noticeTiers: LeaveNoticeTier[];
  maxAdvanceDays: number | null;
  allowBackdated: Tri;
  backdatedMaxDays: number | null;
  minDaysPerRequest: number | null;
  maxConsecutiveDays: number | null;
  maxRequestsPerMonth: number | null;
  maxDaysPerMonth: number | null;
  notClubbableWith: string[];
}
const policyDialog = reactive({
  open: false,
  id: null as string | null,
  name: '',
  scope: 'ORGANIZATION' as PolicyScope,
  groupId: null as string | null,
  institutionId: null as string | null,
  employmentType: null as EmploymentType | null,
  active: true,
  rules: [] as RuleRow[],
});
const hasOverrides = (r: Partial<LeavePolicyRuleDto>) =>
  r.sandwichMode != null ||
  r.sandwichMinDays != null ||
  r.sandwichAdjacent != null ||
  r.minNoticeDays != null ||
  !!r.noticeTiers?.length ||
  r.maxAdvanceDays != null ||
  r.allowBackdated != null ||
  r.backdatedMaxDays != null ||
  r.minDaysPerRequest != null ||
  r.maxConsecutiveDays != null ||
  r.maxRequestsPerMonth != null ||
  r.maxDaysPerMonth != null ||
  !!r.notClubbableWith?.length;
const toRow = (r?: LeavePolicyRuleDto): Omit<RuleRow, 'leaveTypeId'> => ({
  accrualFrequency: r?.accrualFrequency ?? 'MONTHLY',
  annualQuota: r?.annualQuota ?? 12,
  proRataOnJoining: r?.proRataOnJoining ?? true,
  maxCarryForward: r?.maxCarryForward ?? null,
  advanced: r ? hasOverrides(r) : false,
  sandwichMode: r?.sandwichMode ?? null,
  sandwichMinDays: r?.sandwichMinDays ?? null,
  sandwichAdjacent: r?.sandwichAdjacent ?? null,
  minNoticeDays: r?.minNoticeDays ?? null,
  noticeTiers: (r?.noticeTiers ?? []).map((t) => ({ ...t })),
  maxAdvanceDays: r?.maxAdvanceDays ?? null,
  allowBackdated: r?.allowBackdated ?? null,
  backdatedMaxDays: r?.backdatedMaxDays ?? null,
  minDaysPerRequest: r?.minDaysPerRequest ?? null,
  maxConsecutiveDays: r?.maxConsecutiveDays ?? null,
  maxRequestsPerMonth: r?.maxRequestsPerMonth ?? null,
  maxDaysPerMonth: r?.maxDaysPerMonth ?? null,
  notClubbableWith: [...(r?.notClubbableWith ?? [])],
});
function openPolicy(p?: LeavePolicyDto) {
  Object.assign(policyDialog, {
    open: true,
    id: p?.id ?? null,
    name: p?.name ?? '',
    scope: p?.institutionId ? 'INSTITUTION' : p?.groupId ? 'GROUP' : 'ORGANIZATION',
    groupId: p?.groupId ?? null,
    institutionId: p?.institutionId ?? null,
    employmentType: p?.employmentType ?? null,
    active: p ? p.status === 'ACTIVE' : true,
    rules: (p?.rules ?? []).map((r) => ({ leaveTypeId: r.leaveTypeId, ...toRow(r) })),
  });
}
function addRule() {
  const unused = types.value.find(
    (t) => t.status === 'ACTIVE' && !policyDialog.rules.some((r) => r.leaveTypeId === t.id),
  );
  if (!unused) return;
  policyDialog.rules.push({ leaveTypeId: unused.id, ...toRow() });
}
const scopeValid = computed(
  () =>
    policyDialog.scope === 'ORGANIZATION' ||
    (policyDialog.scope === 'GROUP' ? !!policyDialog.groupId : !!policyDialog.institutionId),
);
async function savePolicy() {
  const d = policyDialog;
  const rules = d.rules.map((r) => ({
    leaveTypeId: r.leaveTypeId,
    accrualFrequency: r.accrualFrequency,
    annualQuota: Number(r.annualQuota),
    proRataOnJoining: r.proRataOnJoining,
    maxCarryForward: numOrNull(r.maxCarryForward),
    sandwichMode: r.sandwichMode,
    sandwichMinDays: numOrNull(r.sandwichMinDays),
    sandwichAdjacent: r.sandwichAdjacent,
    minNoticeDays: numOrNull(r.minNoticeDays),
    noticeTiers: r.noticeTiers.length
      ? r.noticeTiers.map((t) => ({ minDays: Number(t.minDays), noticeDays: Number(t.noticeDays) }))
      : null,
    maxAdvanceDays: numOrNull(r.maxAdvanceDays),
    allowBackdated: r.allowBackdated,
    backdatedMaxDays: r.allowBackdated === false ? null : numOrNull(r.backdatedMaxDays),
    minDaysPerRequest: numOrNull(r.minDaysPerRequest),
    maxConsecutiveDays: numOrNull(r.maxConsecutiveDays),
    maxRequestsPerMonth: numOrNull(r.maxRequestsPerMonth),
    maxDaysPerMonth: numOrNull(r.maxDaysPerMonth),
    notClubbableWith: r.notClubbableWith.length ? r.notClubbableWith : null,
  }));
  await run(async () => {
    await apiFetch(d.id ? `/api/v1/leave/policies/${d.id}` : '/api/v1/leave/policies', {
      method: d.id ? 'PATCH' : 'POST',
      body: JSON.stringify(
        d.id
          ? { name: d.name.trim(), rules, status: d.active ? 'ACTIVE' : 'INACTIVE' }
          : {
              name: d.name.trim(),
              groupId: d.scope === 'GROUP' ? d.groupId : null,
              institutionId: d.scope === 'INSTITUTION' ? d.institutionId : null,
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
const scopes = computed(() => [
  { value: 'ORGANIZATION', title: 'Organization (default)' },
  ...(groups.value.length ? [{ value: 'GROUP', title: terms.value.group }] : []),
  { value: 'INSTITUTION', title: terms.value.institution },
]);
const sandwichModes = computed(() => [
  { value: null, title: 'Inherit leave type default' },
  ...SANDWICH_MODES.map((value) => ({ value, title: label(value) })),
]);
const triState = [
  { value: null, title: 'Inherit' },
  { value: true, title: 'Yes' },
  { value: false, title: 'No' },
];
const ruleSummary = (r: LeavePolicyRuleDto) => {
  const parts: string[] = [];
  const notice = [
    ...(r.minNoticeDays ? [`${r.minNoticeDays}d`] : []),
    ...(r.noticeTiers ?? []).map((t) => `${t.noticeDays}d for ${t.minDays}+`),
  ];
  if (notice.length) parts.push(`notice ${notice.join(' / ')}`);
  if (r.sandwichMode)
    parts.push(
      `sandwich ${label(r.sandwichMode)}${r.sandwichMinDays ? ` ≥${r.sandwichMinDays}d` : ''}`,
    );
  if (r.maxConsecutiveDays != null) parts.push(`max ${r.maxConsecutiveDays}d`);
  if (r.notClubbableWith?.length) parts.push(`no club ${r.notClubbableWith.join('/')}`);
  return parts.length ? ` — ${parts.join(', ')}` : '';
};
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
        <th>Applies to</th>
        <th>Employment type</th>
        <th>Entitlements</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in policies" :key="p.id">
        <td>{{ p.name }}</td>
        <td>{{ scopeName(p) }}</td>
        <td>{{ p.employmentType ? label(p.employmentType) : 'All' }}</td>
        <td>
          {{
            p.rules
              .map(
                (r) =>
                  `${typeCode(r.leaveTypeId)} ${r.annualQuota}/yr (${label(r.accrualFrequency)})${ruleSummary(r)}`,
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

  <v-dialog v-model="policyDialog.open" max-width="960" scrollable>
    <v-card :title="policyDialog.id ? 'Edit policy' : 'New policy'">
      <v-card-text>
        <v-text-field v-model="policyDialog.name" label="Name *" />
        <v-row v-if="!policyDialog.id" dense>
          <v-col cols="12" md="4">
            <v-select v-model="policyDialog.scope" :items="scopes" label="Applies to *" />
          </v-col>
          <v-col cols="12" md="4">
            <v-autocomplete
              v-if="policyDialog.scope === 'GROUP'"
              v-model="policyDialog.groupId"
              :items="groups"
              item-title="name"
              item-value="id"
              :label="`${terms.group} *`"
            />
            <v-autocomplete
              v-else-if="policyDialog.scope === 'INSTITUTION'"
              v-model="policyDialog.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              :label="`${terms.institution} *`"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="policyDialog.employmentType"
              :items="employmentTypes"
              label="Employment type (empty = all)"
              clearable
            />
          </v-col>
          <v-col cols="12">
            <p class="text-caption text-medium-emphasis">
              The most specific active policy applies: {{ terms.institution }} › {{ terms.group }} ›
              Organization (an employment-type match wins within each level).
            </p>
          </v-col>
        </v-row>
        <template v-else>
          <p class="text-body-2 mb-2">Applies to: {{ scopeName(policyDialog) }}</p>
          <v-switch v-model="policyDialog.active" label="Active" hide-details />
        </template>
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
            <template v-for="(r, i) in policyDialog.rules" :key="i">
              <tr>
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
                <td class="text-no-wrap">
                  <v-btn
                    size="small"
                    variant="text"
                    :icon="r.advanced ? 'mdi-chevron-up' : 'mdi-tune'"
                    :title="r.advanced ? 'Hide advanced rules' : 'Advanced rules'"
                    @click="r.advanced = !r.advanced"
                  />
                  <v-btn
                    size="small"
                    variant="text"
                    icon="mdi-delete"
                    @click="policyDialog.rules.splice(i, 1)"
                  />
                </td>
              </tr>
              <tr v-if="r.advanced">
                <td colspan="6" class="pa-3 bg-grey-lighten-5">
                  <div class="text-subtitle-2 mb-1">
                    Advanced rules for {{ typeCode(r.leaveTypeId) }}
                    <span class="text-caption text-medium-emphasis"
                      >(empty = no restriction / inherit)</span
                    >
                  </div>
                  <v-row dense>
                    <v-col cols="12" class="text-caption font-weight-medium">Sandwich</v-col>
                    <v-col cols="12" md="4">
                      <v-select
                        v-model="r.sandwichMode"
                        :items="sandwichModes"
                        label="Count enclosed"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="4">
                      <v-text-field
                        v-model.number="r.sandwichMinDays"
                        type="number"
                        label="Only when leave ≥ (days)"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="4">
                      <v-select
                        v-model="r.sandwichAdjacent"
                        :items="triState"
                        label="Across adjacent requests (Fri + Mon)"
                        density="compact"
                        hide-details
                      />
                    </v-col>

                    <v-col cols="12" class="text-caption font-weight-medium mt-2">
                      Notice (apply in advance)
                    </v-col>
                    <v-col cols="6" md="4">
                      <v-text-field
                        v-model.number="r.minNoticeDays"
                        type="number"
                        label="Minimum notice (days)"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="4">
                      <v-text-field
                        v-model.number="r.maxAdvanceDays"
                        type="number"
                        label="Apply at most (days ahead)"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="12" md="4">
                      <div v-for="(t, ti) in r.noticeTiers" :key="ti" class="d-flex ga-1 mb-1">
                        <v-text-field
                          v-model.number="t.minDays"
                          type="number"
                          label="Leave ≥ days"
                          density="compact"
                          hide-details
                        />
                        <v-text-field
                          v-model.number="t.noticeDays"
                          type="number"
                          label="Notice days"
                          density="compact"
                          hide-details
                        />
                        <v-btn
                          size="small"
                          variant="text"
                          icon="mdi-close"
                          @click="r.noticeTiers.splice(ti, 1)"
                        />
                      </div>
                      <v-btn
                        size="small"
                        variant="text"
                        prepend-icon="mdi-plus"
                        @click="
                          r.noticeTiers.push({
                            minDays: (r.noticeTiers.at(-1)?.minDays ?? 0) + 1,
                            noticeDays: 5,
                          })
                        "
                      >
                        Notice tier by leave length
                      </v-btn>
                    </v-col>
                    <v-col cols="6" md="4">
                      <v-select
                        v-model="r.allowBackdated"
                        :items="triState"
                        label="Allow past-dated requests"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="4">
                      <v-text-field
                        v-model.number="r.backdatedMaxDays"
                        type="number"
                        label="…up to (days back)"
                        :disabled="r.allowBackdated === false"
                        density="compact"
                        hide-details
                      />
                    </v-col>

                    <v-col cols="12" class="text-caption font-weight-medium mt-2">Limits</v-col>
                    <v-col cols="6" md="3">
                      <v-text-field
                        v-model.number="r.minDaysPerRequest"
                        type="number"
                        label="Min days / request"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="3">
                      <v-text-field
                        v-model.number="r.maxConsecutiveDays"
                        type="number"
                        label="Max consecutive days"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="3">
                      <v-text-field
                        v-model.number="r.maxRequestsPerMonth"
                        type="number"
                        label="Max requests / month"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="6" md="3">
                      <v-text-field
                        v-model.number="r.maxDaysPerMonth"
                        type="number"
                        label="Max days / month"
                        density="compact"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="12">
                      <v-select
                        v-model="r.notClubbableWith"
                        :items="types.filter((t) => t.id !== r.leaveTypeId).map((t) => t.code)"
                        label="Cannot be clubbed with"
                        multiple
                        chips
                        density="compact"
                        hide-details
                      />
                    </v-col>
                  </v-row>
                </td>
              </tr>
            </template>
          </tbody>
        </v-table>
        <v-btn size="small" variant="text" prepend-icon="mdi-plus" class="mt-2" @click="addRule">
          Add leave type
        </v-btn>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="policyDialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!policyDialog.name || !scopeValid" @click="savePolicy">
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
