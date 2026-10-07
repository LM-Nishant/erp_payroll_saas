<script setup lang="ts">
import {
  COMPANY_EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPES,
  type ApiListResponse,
  type SalaryComponentDto,
  type SalaryStructureDto,
  type StructureLine,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';
import { label, todayIso, useHrOptions } from '@/pages/hr/useHrOptions';

/** Salary structures (component templates per institution / grade / employment type) with versions. */
const auth = useAuthStore();
const terms = useTerms();
const { institutions, loadBase } = useHrOptions();
const institutionId = ref<string | null>(null);
const items = ref<SalaryStructureDto[]>([]);
const components = ref<SalaryComponentDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const canManage = computed(() => auth.can('payroll.manage'));

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const q = new URLSearchParams({ pageSize: '100' });
    if (institutionId.value) q.set('institutionId', institutionId.value);
    [items.value, components.value] = await Promise.all([
      apiFetch<ApiListResponse<SalaryStructureDto>>(`/api/v1/payroll/structures?${q}`).then(
        (r) => r.data,
      ),
      apiFetch<ApiListResponse<SalaryComponentDto>>(
        `/api/v1/payroll/components?${q}&status=ACTIVE`,
      ).then((r) => r.data),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
watch(institutionId, load);

const instName = (id: string) => institutions.value.find((i) => i.id === id)?.name ?? id;
/** Statutory components (PF, ESI, PT, TDS…) are applied automatically and never listed. */
const selectable = computed(() => components.value.filter((c) => c.calcType !== 'STATUTORY'));
const componentCodes = computed(() => selectable.value.map((c) => c.code));
const componentItems = computed(() =>
  selectable.value.map((c) => ({ value: c.code, title: `${c.name} (${c.code})` })),
);
const componentByCode = (code: string) => components.value.find((c) => c.code === code);
const latest = (s: SalaryStructureDto) => [...s.versions].sort((a, b) => b.version - a.version)[0];

type CalcChoice = 'DEFAULT' | 'FIXED' | 'PERCENTAGE' | 'FORMULA';
interface LineRow {
  componentCode: string;
  calc: CalcChoice;
  amount: number | null;
  percentage: number | null;
  percentOf: string;
  formula: string;
}
const calcChoices = [
  { value: 'DEFAULT', title: 'Component default' },
  { value: 'FIXED', title: 'Fixed amount' },
  { value: 'PERCENTAGE', title: 'Percentage of' },
  { value: 'FORMULA', title: 'Formula' },
];
const percentOfItems = computed(() => ['CTC', 'GROSS', 'BASIC', ...componentCodes.value]);

function describeDefault(code: string): string {
  const c = componentByCode(code);
  if (!c) return '';
  if (c.calcType === 'FIXED')
    return c.amount != null ? `Fixed ${c.amount}` : 'Fixed (per employee)';
  if (c.calcType === 'PERCENTAGE') return `${c.percentage}% of ${c.percentOf}`;
  if (c.calcType === 'FORMULA') return `= ${c.formula}`;
  return label(c.calcType);
}

function toRow(l: StructureLine): LineRow {
  const calc: CalcChoice =
    l.calcType === 'FIXED' || l.calcType === 'PERCENTAGE' || l.calcType === 'FORMULA'
      ? l.calcType
      : 'DEFAULT';
  return {
    componentCode: l.componentCode,
    calc,
    amount: l.amount ?? null,
    percentage: l.percentage ?? null,
    percentOf: l.percentOf ?? 'CTC',
    formula: l.formula ?? '',
  };
}
function toLine(r: LineRow): StructureLine {
  if (r.calc === 'FIXED')
    return { componentCode: r.componentCode, calcType: 'FIXED', amount: r.amount };
  if (r.calc === 'PERCENTAGE')
    return {
      componentCode: r.componentCode,
      calcType: 'PERCENTAGE',
      percentage: Number(r.percentage),
      percentOf: r.percentOf,
    };
  if (r.calc === 'FORMULA')
    return { componentCode: r.componentCode, calcType: 'FORMULA', formula: r.formula.trim() };
  return { componentCode: r.componentCode };
}

const dialog = reactive({
  open: false,
  saving: false,
  error: null as string | null,
  advanced: false,
  structureId: null as string | null,
  institutionId: null as string | null,
  code: '',
  name: '',
  employmentType: null as string | null,
  grade: '',
  effectiveFrom: todayIso(),
  rows: [] as LineRow[],
  linesJson: '',
  notes: '',
});
const advancedLines = (lines: StructureLine[]) =>
  lines.some((l) => l.calcType === 'SLAB' || l.slabs || l.slabBasis);

function openCreate() {
  Object.assign(dialog, {
    open: true,
    saving: false,
    error: null,
    advanced: false,
    structureId: null,
    institutionId:
      institutionId.value ?? (institutions.value.length === 1 ? institutions.value[0]!.id : null),
    code: '',
    name: '',
    employmentType: null,
    grade: '',
    effectiveFrom: todayIso(),
    rows: componentCodes.value.map((componentCode) => toRow({ componentCode })),
    notes: '',
  });
}
function openVersion(s: SalaryStructureDto) {
  const lines = (latest(s)?.lines ?? []).filter(
    (l) => componentByCode(l.componentCode)?.calcType !== 'STATUTORY',
  );
  Object.assign(dialog, {
    open: true,
    saving: false,
    error: null,
    advanced: advancedLines(lines),
    structureId: s.id,
    institutionId: s.institutionId,
    code: s.code,
    name: s.name,
    effectiveFrom: todayIso(),
    rows: lines.map(toRow),
    linesJson: JSON.stringify(lines, null, 1),
    notes: '',
  });
}
function toggleAdvanced() {
  if (!dialog.advanced) {
    dialog.linesJson = JSON.stringify(dialog.rows.map(toLine), null, 1);
  } else {
    try {
      dialog.rows = (JSON.parse(dialog.linesJson) as StructureLine[]).map(toRow);
    } catch {
      dialog.error = 'Lines JSON is not valid';
      return;
    }
  }
  dialog.advanced = !dialog.advanced;
}
const unusedComponents = computed(() =>
  componentItems.value.filter((i) => !dialog.rows.some((r) => r.componentCode === i.value)),
);
function addRow() {
  const next = unusedComponents.value[0];
  if (next) dialog.rows.push(toRow({ componentCode: next.value }));
}

function validate(lines: StructureLine[]): string | null {
  if (!dialog.structureId) {
    if (!dialog.institutionId)
      return `Select a${terms.value.isCompany ? ' company' : 'n institution'}`;
    if (!/^[A-Z][A-Z0-9_]*$/.test(dialog.code)) return 'Code must be UPPER_SNAKE, e.g. STD_CTC';
    if (!dialog.name.trim()) return 'Name is required';
  }
  if (!dialog.effectiveFrom) return 'Effective from is required';
  if (lines.length === 0) return 'Add at least one component';
  const codes = lines.map((l) => l.componentCode);
  if (new Set(codes).size !== codes.length) return 'Each component can be listed only once';
  const statutory = codes.filter((c) => componentByCode(c)?.calcType === 'STATUTORY');
  if (statutory.length)
    return `${statutory.join(', ')} ${statutory.length > 1 ? 'are' : 'is'} statutory and applied automatically — remove ${statutory.length > 1 ? 'them' : 'it'}`;
  for (const l of lines) {
    if (l.calcType === 'FIXED' && (l.amount == null || Number.isNaN(Number(l.amount))))
      return `${l.componentCode}: enter an amount`;
    if (l.calcType === 'PERCENTAGE' && !(Number(l.percentage) > 0))
      return `${l.componentCode}: enter a percentage`;
    if (l.calcType === 'FORMULA' && !l.formula) return `${l.componentCode}: enter a formula`;
  }
  return null;
}

async function save() {
  dialog.error = null;
  let lines: StructureLine[];
  if (dialog.advanced) {
    try {
      lines = JSON.parse(dialog.linesJson) as StructureLine[];
    } catch {
      dialog.error = 'Lines JSON is not valid';
      return;
    }
  } else {
    lines = dialog.rows.map(toLine);
  }
  dialog.error = validate(lines);
  if (dialog.error) return;
  dialog.saving = true;
  try {
    const version = {
      effectiveFrom: dialog.effectiveFrom,
      lines,
      ...(dialog.notes.trim() ? { notes: dialog.notes.trim() } : {}),
    };
    if (dialog.structureId) {
      await apiFetch(`/api/v1/payroll/structures/${dialog.structureId}/versions`, {
        method: 'POST',
        body: JSON.stringify(version),
      });
    } else {
      await apiFetch('/api/v1/payroll/structures', {
        method: 'POST',
        body: JSON.stringify({
          institutionId: dialog.institutionId,
          code: dialog.code.trim(),
          name: dialog.name.trim(),
          employmentType: dialog.employmentType,
          ...(dialog.grade.trim() ? { grade: dialog.grade.trim() } : {}),
          version,
        }),
      });
    }
    dialog.open = false;
    await load();
  } catch (e) {
    dialog.error = (e as Error).message;
  } finally {
    dialog.saving = false;
  }
}

const expanded = ref<string[]>([]);
const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: terms.value.institution, key: 'institution', sortable: false },
  { title: 'Employment type', key: 'employmentType' },
  { title: 'Grade', key: 'grade' },
  { title: 'Versions', key: 'versions', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const types = computed(() =>
  (terms.value.isCompany ? COMPANY_EMPLOYMENT_TYPES : EMPLOYMENT_TYPES).map((value) => ({
    value,
    title: label(value),
  })),
);
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Salary structures</h2>
    <v-spacer />
    <v-select
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      clearable
      density="compact"
      hide-details
      style="max-width: 280px"
    />
    <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate">
      New structure
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>

  <v-data-table
    v-model:expanded="expanded"
    :headers="headers"
    :items="items"
    :loading="loading"
    item-value="id"
    show-expand
  >
    <template #[`item.institution`]="{ item }">{{ instName(item.institutionId) }}</template>
    <template #[`item.employmentType`]="{ item }">
      {{ item.employmentType ? label(item.employmentType) : 'Any' }}
    </template>
    <template #[`item.versions`]="{ item }">
      v{{ latest(item)?.version }} from {{ latest(item)?.effectiveFrom }}
    </template>
    <template #[`item.status`]="{ item }">
      <v-chip :color="item.status === 'ACTIVE' ? 'success' : 'default'" size="small">
        {{ label(item.status) }}
      </v-chip>
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn v-if="canManage" size="small" variant="text" @click="openVersion(item)">
        New version
      </v-btn>
    </template>
    <template #expanded-row="{ columns, item }">
      <tr>
        <td :colspan="columns.length">
          <div v-for="v in item.versions" :key="v.id" class="py-2">
            <strong>v{{ v.version }}</strong> effective {{ v.effectiveFrom }}
            <span v-if="v.notes" class="text-medium-emphasis">— {{ v.notes }}</span>
            <div class="d-flex flex-wrap ga-1 mt-1">
              <v-chip v-for="l in v.lines" :key="l.componentCode" size="x-small">
                {{ l.componentCode }}{{ l.calcType ? ` · ${label(l.calcType)}` : ''
                }}{{ l.percentage ? ` ${l.percentage}% of ${l.percentOf}` : ''
                }}{{ l.formula ? ` = ${l.formula}` : '' }}{{ l.amount ? ` ${l.amount}` : '' }}
              </v-chip>
            </div>
          </div>
        </td>
      </tr>
    </template>
  </v-data-table>

  <v-dialog v-model="dialog.open" max-width="900" scrollable>
    <v-card :title="dialog.structureId ? `New version of ${dialog.code}` : 'New salary structure'">
      <v-card-text>
        <v-alert
          v-if="dialog.error"
          type="error"
          density="compact"
          closable
          class="mb-3"
          @click:close="dialog.error = null"
        >
          {{ dialog.error }}
        </v-alert>
        <v-row dense>
          <template v-if="!dialog.structureId">
            <v-col cols="12" md="6">
              <v-select
                v-model="dialog.institutionId"
                :items="institutions"
                item-title="name"
                item-value="id"
                :label="terms.institution"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                :model-value="dialog.code"
                label="Code"
                hint="e.g. STD_CTC (capitals, digits, _)"
                persistent-hint
                @update:model-value="
                  (v: string) => (dialog.code = v.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
                "
              />
            </v-col>
            <v-col cols="12" md="6"><v-text-field v-model="dialog.name" label="Name" /></v-col>
            <v-col cols="6" md="3">
              <v-select
                v-model="dialog.employmentType"
                :items="types"
                label="Employment type"
                clearable
                placeholder="Any"
              />
            </v-col>
            <v-col cols="6" md="3"><v-text-field v-model="dialog.grade" label="Grade" /></v-col>
          </template>
          <v-col cols="6">
            <v-text-field v-model="dialog.effectiveFrom" type="date" label="Effective from" />
          </v-col>
          <v-col cols="6"><v-text-field v-model="dialog.notes" label="Notes" /></v-col>
        </v-row>

        <div class="d-flex align-center mt-2 mb-1">
          <div class="text-subtitle-1">Components</div>
          <v-spacer />
          <v-btn size="small" variant="text" @click="toggleAdvanced">
            {{ dialog.advanced ? 'Simple editor' : 'Edit as JSON' }}
          </v-btn>
        </div>
        <div class="text-caption text-medium-emphasis mb-2">
          PF, ESI, PT and TDS are statutory and applied automatically — don't add them here.
        </div>

        <v-textarea
          v-if="dialog.advanced"
          v-model="dialog.linesJson"
          label="Lines (JSON)"
          rows="10"
          class="font-monospace"
          :hint="`Available: ${componentCodes.join(', ')}`"
          persistent-hint
        />
        <template v-else>
          <v-alert v-if="!componentItems.length" type="info" density="compact" class="mb-2">
            No earning components yet — create them under Salary components first.
          </v-alert>
          <v-row v-for="(r, i) in dialog.rows" :key="i" dense align="center">
            <v-col cols="12" md="4">
              <v-select
                v-model="r.componentCode"
                :items="componentItems"
                label="Component"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="r.calc"
                :items="calcChoices"
                label="Calculation"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="10" md="4">
              <div v-if="r.calc === 'DEFAULT'" class="text-body-2 text-medium-emphasis">
                {{ describeDefault(r.componentCode) }}
              </div>
              <v-text-field
                v-else-if="r.calc === 'FIXED'"
                v-model.number="r.amount"
                type="number"
                label="Monthly amount"
                density="compact"
                hide-details
              />
              <div v-else-if="r.calc === 'PERCENTAGE'" class="d-flex ga-2">
                <v-text-field
                  v-model.number="r.percentage"
                  type="number"
                  label="%"
                  density="compact"
                  hide-details
                  style="max-width: 90px"
                />
                <v-combobox
                  v-model="r.percentOf"
                  :items="percentOfItems"
                  label="of"
                  density="compact"
                  hide-details
                />
              </div>
              <v-text-field
                v-else
                v-model="r.formula"
                label="Formula"
                placeholder="max(CTC - BASIC - HRA, 0)"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="2" md="1" class="text-right">
              <v-btn
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                @click="dialog.rows.splice(i, 1)"
              />
            </v-col>
          </v-row>
          <v-btn
            class="mt-2"
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            :disabled="!unusedComponents.length"
            @click="addRow"
          >
            Add component
          </v-btn>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :loading="dialog.saving" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
