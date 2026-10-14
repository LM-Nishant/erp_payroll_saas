<script setup lang="ts">
import {
  ROUNDING_MODES,
  SALARY_CALC_TYPES,
  SALARY_COMPONENT_TYPES,
  STATUTORY_CODES,
  type PayrollSettingsDto,
  type SalaryCalcType,
  type SalaryComponentDto,
  type SalaryComponentType,
  type SlabRow,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useAuthStore } from '@/stores/auth';
import { label, useHrOptions } from '@/pages/hr/useHrOptions';

/** Salary component master (org defaults + institution-specific policies) and payroll settings. */
const auth = useAuthStore();
const { institutions, loadBase } = useHrOptions();
const institutionId = ref<string | null>(null);
const settings = ref<PayrollSettingsDto | null>(null);
const error = ref<string | null>(null);
const canManage = computed(() => auth.can('payroll.manage'));
const components = useServerList<SalaryComponentDto>('/api/v1/payroll/components', {
  error,
  pageSize: 50,
  immediate: false,
  params: () => ({ institutionId: institutionId.value ?? undefined }),
});
const { items, total, page, pageSize, loading } = components;

async function loadSettings() {
  try {
    settings.value = institutionId.value
      ? (
          await apiFetch<{ data: PayrollSettingsDto }>(
            `/api/v1/payroll/settings?institutionId=${institutionId.value}`,
          )
        ).data
      : null;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function load() {
  error.value = null;
  await Promise.all([components.load(), loadSettings()]);
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
watch(institutionId, loadSettings);

const instName = (id: string | null) =>
  id ? (institutions.value.find((i) => i.id === id)?.name ?? id) : 'Organization default';

async function seedDefaults() {
  try {
    await apiFetch('/api/v1/payroll/components/seed-defaults', {
      method: 'POST',
      body: JSON.stringify({ institutionId: null }),
    });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const dialog = reactive({
  open: false,
  id: null as string | null,
  institutionId: null as string | null,
  code: '',
  name: '',
  type: 'EARNING' as SalaryComponentType,
  calcType: 'FIXED' as SalaryCalcType,
  amount: null as number | null,
  percentage: null as number | null,
  percentOf: 'BASIC',
  formula: '',
  slabBasis: 'GROSS',
  slabsJson: '[]',
  statutoryCode: null as string | null,
  taxable: true,
  proRated: true,
  rounding: 'NEAREST',
  displayOrder: 100,
  showOnPayslip: true,
});
function openDialog(c?: SalaryComponentDto) {
  Object.assign(dialog, {
    open: true,
    id: c?.id ?? null,
    institutionId: c?.institutionId ?? institutionId.value,
    code: c?.code ?? '',
    name: c?.name ?? '',
    type: c?.type ?? 'EARNING',
    calcType: c?.calcType ?? 'FIXED',
    amount: c?.amount ?? null,
    percentage: c?.percentage ?? null,
    percentOf: c?.percentOf ?? 'BASIC',
    formula: c?.formula ?? '',
    slabBasis: c?.slabBasis ?? 'GROSS',
    slabsJson: JSON.stringify(c?.slabs ?? [], null, 0),
    statutoryCode: c?.statutoryCode ?? null,
    taxable: c?.taxable ?? true,
    proRated: c?.proRated ?? true,
    rounding: c?.rounding ?? 'NEAREST',
    displayOrder: c?.displayOrder ?? 100,
    showOnPayslip: c?.showOnPayslip ?? true,
  });
}
function calcBody() {
  switch (dialog.calcType) {
    case 'FIXED':
      return { amount: dialog.amount === null ? null : Number(dialog.amount) };
    case 'PERCENTAGE':
      return { percentage: Number(dialog.percentage), percentOf: dialog.percentOf };
    case 'FORMULA':
      return { formula: dialog.formula };
    case 'SLAB':
      return { slabBasis: dialog.slabBasis, slabs: JSON.parse(dialog.slabsJson) as SlabRow[] };
    default:
      return {};
  }
}
async function save() {
  try {
    const common = {
      name: dialog.name.trim(),
      calcType: dialog.calcType,
      ...calcBody(),
      statutoryCode: dialog.statutoryCode,
      taxable: dialog.taxable,
      proRated: dialog.proRated,
      rounding: dialog.rounding,
      displayOrder: Number(dialog.displayOrder),
      showOnPayslip: dialog.showOnPayslip,
    };
    await apiFetch(
      dialog.id ? `/api/v1/payroll/components/${dialog.id}` : '/api/v1/payroll/components',
      {
        method: dialog.id ? 'PATCH' : 'POST',
        body: JSON.stringify(
          dialog.id
            ? common
            : {
                ...common,
                institutionId: dialog.institutionId,
                code: dialog.code.trim(),
                type: dialog.type,
              },
        ),
      },
    );
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function toggleStatus(c: SalaryComponentDto) {
  try {
    await apiFetch(`/api/v1/payroll/components/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function saveSettings() {
  if (!settings.value) return;
  try {
    const { id: _id, ...body } = settings.value;
    settings.value = (
      await apiFetch<{ data: PayrollSettingsDto }>('/api/v1/payroll/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const describe = (c: SalaryComponentDto) => {
  switch (c.calcType) {
    case 'FIXED':
      return c.amount === null ? 'Fixed (per employee)' : `Fixed ${c.amount}`;
    case 'PERCENTAGE':
      return `${c.percentage}% of ${c.percentOf}`;
    case 'FORMULA':
      return c.formula ?? '';
    case 'SLAB':
      return `Slab on ${c.slabBasis}`;
    default:
      return `Statutory ${c.statutoryCode ?? ''}`;
  }
};
const headers = [
  { title: 'Order', key: 'displayOrder' },
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Type', key: 'type' },
  { title: 'Calculation', key: 'calc', sortable: false },
  { title: 'Scope', key: 'scope', sortable: false },
  { title: 'Flags', key: 'flags', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const opt = (values: readonly string[]) => values.map((value) => ({ value, title: label(value) }));
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Salary components</h2>
    <v-spacer />
    <v-select
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution policy"
      clearable
      density="compact"
      hide-details
      style="max-width: 280px"
    />
    <v-btn v-if="canManage" variant="tonal" @click="seedDefaults">Seed defaults</v-btn>
    <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openDialog()">
      New component
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>

  <v-card v-if="settings" class="mb-4" title="Payroll settings">
    <v-card-text class="d-flex flex-wrap ga-4 align-center">
      <v-text-field
        v-model="settings.state"
        label="State (PT/LWF)"
        density="compact"
        hide-details
        style="max-width: 140px"
      />
      <v-switch v-model="settings.pfEnabled" label="PF" hide-details color="primary" />
      <v-switch v-model="settings.esiEnabled" label="ESI" hide-details color="primary" />
      <v-switch v-model="settings.ptEnabled" label="PT" hide-details color="primary" />
      <v-switch v-model="settings.tdsEnabled" label="TDS" hide-details color="primary" />
      <v-switch v-model="settings.lwfEnabled" label="LWF" hide-details color="primary" />
      <v-switch
        v-model="settings.requireAttendanceLock"
        label="Require attendance lock"
        hide-details
        color="primary"
      />
      <v-btn v-if="canManage" color="primary" @click="saveSettings">Save settings</v-btn>
    </v-card-text>
  </v-card>

  <v-data-table-server
    v-model:page="page"
    v-model:items-per-page="pageSize"
    :headers="headers"
    :items="items"
    :loading="loading"
    :items-length="total"
    :items-per-page-options="PAGE_SIZE_OPTIONS"
    disable-sort
  >
    <template #[`item.type`]="{ item }">{{ label(item.type) }}</template>
    <template #[`item.calc`]="{ item }">
      <code class="text-caption">{{ describe(item) }}</code>
    </template>
    <template #[`item.scope`]="{ item }">{{ instName(item.institutionId) }}</template>
    <template #[`item.flags`]="{ item }">
      <v-chip v-if="item.taxable" size="x-small" class="mr-1">taxable</v-chip>
      <v-chip v-if="item.proRated" size="x-small" class="mr-1">pro-rated</v-chip>
      <v-chip v-if="!item.showOnPayslip" size="x-small">hidden</v-chip>
    </template>
    <template #[`item.status`]="{ item }">
      <v-chip :color="item.status === 'ACTIVE' ? 'success' : 'default'" size="small">
        {{ label(item.status) }}
      </v-chip>
    </template>
    <template #[`item.actions`]="{ item }">
      <template v-if="canManage">
        <v-btn icon="mdi-pencil" size="small" variant="text" @click="openDialog(item)" />
        <v-btn
          :icon="item.status === 'ACTIVE' ? 'mdi-cancel' : 'mdi-check'"
          :aria-label="item.status === 'ACTIVE' ? 'Deactivate' : 'Activate'"
          :title="item.status === 'ACTIVE' ? 'Deactivate' : 'Activate'"
          size="small"
          variant="text"
          @click="toggleStatus(item)"
        />
      </template>
    </template>
  </v-data-table-server>

  <v-dialog v-model="dialog.open" max-width="720">
    <v-card :title="dialog.id ? 'Edit component' : 'New component'">
      <v-card-text>
        <v-row dense>
          <v-col cols="4">
            <v-text-field v-model="dialog.code" label="Code" :disabled="!!dialog.id" />
          </v-col>
          <v-col cols="8"><v-text-field v-model="dialog.name" label="Name" /></v-col>
          <v-col cols="6">
            <v-select
              v-model="dialog.type"
              :items="opt(SALARY_COMPONENT_TYPES)"
              label="Type"
              :disabled="!!dialog.id"
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="dialog.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution (empty = organization)"
              clearable
              :disabled="!!dialog.id"
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="dialog.calcType"
              :items="opt(SALARY_CALC_TYPES)"
              label="Calculation"
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="dialog.statutoryCode"
              :items="opt(STATUTORY_CODES)"
              label="Statutory code"
              clearable
            />
          </v-col>
          <v-col v-if="dialog.calcType === 'FIXED'" cols="6">
            <v-text-field v-model="dialog.amount" type="number" label="Monthly amount" />
          </v-col>
          <template v-if="dialog.calcType === 'PERCENTAGE'">
            <v-col cols="6">
              <v-text-field v-model="dialog.percentage" type="number" label="Percentage" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="dialog.percentOf" label="Of (CTC, BASIC, GROSS, code)" />
            </v-col>
          </template>
          <v-col v-if="dialog.calcType === 'FORMULA'" cols="12">
            <v-text-field
              v-model="dialog.formula"
              label="Formula"
              hint="Arithmetic, comparisons, min/max/round/if over CTC, BASIC, GROSS, PAYABLE_DAYS, component codes…"
              persistent-hint
            />
          </v-col>
          <template v-if="dialog.calcType === 'SLAB'">
            <v-col cols="4"><v-text-field v-model="dialog.slabBasis" label="Slab basis" /></v-col>
            <v-col cols="8">
              <v-textarea
                v-model="dialog.slabsJson"
                rows="2"
                label='Slabs JSON, e.g. [{"from":0,"to":15000,"amount":0}]'
              />
            </v-col>
          </template>
          <v-col cols="4">
            <v-select v-model="dialog.rounding" :items="opt(ROUNDING_MODES)" label="Rounding" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model="dialog.displayOrder" type="number" label="Display order" />
          </v-col>
          <v-col cols="4" class="d-flex flex-column">
            <v-checkbox v-model="dialog.taxable" label="Taxable" density="compact" hide-details />
            <v-checkbox
              v-model="dialog.proRated"
              label="Pro-rated by payable days"
              density="compact"
              hide-details
            />
            <v-checkbox
              v-model="dialog.showOnPayslip"
              label="Show on payslip"
              density="compact"
              hide-details
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
