<script setup lang="ts">
import {
  EMPLOYMENT_TYPES,
  type ApiListResponse,
  type SalaryComponentDto,
  type SalaryStructureDto,
  type StructureLine,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label, todayIso, useHrOptions } from '@/pages/hr/useHrOptions';

/** Salary structures (component templates per institution / grade / employment type) with versions. */
const auth = useAuthStore();
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
const componentCodes = computed(() => components.value.map((c) => c.code));
const latest = (s: SalaryStructureDto) => [...s.versions].sort((a, b) => b.version - a.version)[0];

/** Lines are edited as JSON so every calc type (fixed / % / formula / slab) is expressible. */
const linesHint =
  '[{"componentCode":"BASIC","calcType":"PERCENTAGE","percentage":50,"percentOf":"CTC"},{"componentCode":"HRA"}]';

const dialog = reactive({
  open: false,
  structureId: null as string | null,
  institutionId: null as string | null,
  code: '',
  name: '',
  employmentType: null as string | null,
  grade: '',
  effectiveFrom: todayIso(),
  linesJson: '',
  notes: '',
});
function openCreate() {
  Object.assign(dialog, {
    open: true,
    structureId: null,
    institutionId: institutionId.value,
    code: '',
    name: '',
    employmentType: null,
    grade: '',
    effectiveFrom: todayIso(),
    linesJson: JSON.stringify(
      componentCodes.value.map((componentCode) => ({ componentCode })),
      null,
      1,
    ),
    notes: '',
  });
}
function openVersion(s: SalaryStructureDto) {
  Object.assign(dialog, {
    open: true,
    structureId: s.id,
    institutionId: s.institutionId,
    code: s.code,
    name: s.name,
    effectiveFrom: todayIso(),
    linesJson: JSON.stringify(latest(s)?.lines ?? [], null, 1),
    notes: '',
  });
}
async function save() {
  try {
    const version = {
      effectiveFrom: dialog.effectiveFrom,
      lines: JSON.parse(dialog.linesJson) as StructureLine[],
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
    error.value = (e as Error).message;
  }
}

const expanded = ref<string[]>([]);
const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Institution', key: 'institution', sortable: false },
  { title: 'Employment type', key: 'employmentType' },
  { title: 'Grade', key: 'grade' },
  { title: 'Versions', key: 'versions', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const types = EMPLOYMENT_TYPES.map((value) => ({ value, title: label(value) }));
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

  <v-dialog v-model="dialog.open" max-width="760">
    <v-card :title="dialog.structureId ? `New version of ${dialog.code}` : 'New salary structure'">
      <v-card-text>
        <v-row dense>
          <template v-if="!dialog.structureId">
            <v-col cols="6">
              <v-select
                v-model="dialog.institutionId"
                :items="institutions"
                item-title="name"
                item-value="id"
                label="Institution"
              />
            </v-col>
            <v-col cols="6"
              ><v-text-field v-model="dialog.code" label="Code (UPPER_SNAKE)"
            /></v-col>
            <v-col cols="6"><v-text-field v-model="dialog.name" label="Name" /></v-col>
            <v-col cols="3">
              <v-select
                v-model="dialog.employmentType"
                :items="types"
                label="Employment type"
                clearable
              />
            </v-col>
            <v-col cols="3"><v-text-field v-model="dialog.grade" label="Grade" /></v-col>
          </template>
          <v-col cols="6">
            <v-text-field v-model="dialog.effectiveFrom" type="date" label="Effective from" />
          </v-col>
          <v-col cols="6"><v-text-field v-model="dialog.notes" label="Notes" /></v-col>
          <v-col cols="12">
            <v-textarea
              v-model="dialog.linesJson"
              label="Lines (JSON)"
              rows="8"
              :hint="`Example: ${linesHint}. Available: ${componentCodes.join(', ')}`"
              persistent-hint
              class="font-monospace"
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
