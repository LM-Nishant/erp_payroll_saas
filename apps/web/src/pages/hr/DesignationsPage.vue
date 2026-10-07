<script setup lang="ts">
import {
  EMPLOYMENT_TYPES,
  type ApiListResponse,
  type DesignationDto,
  type EmployeeCodeSequenceDto,
} from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label, useHrOptions } from './useHrOptions';

/** Designation / position master and per-institution employee code numbering. */
const auth = useAuthStore();
const { institutions, departments, loadBase, loadForInstitution } = useHrOptions();
const items = ref<DesignationDto[]>([]);
const sequences = ref<EmployeeCodeSequenceDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    items.value = (
      await apiFetch<ApiListResponse<DesignationDto>>('/api/v1/designations?pageSize=100')
    ).data;
    if (auth.can('employee.create')) {
      sequences.value = (
        await apiFetch<{ data: EmployeeCodeSequenceDto[] }>('/api/v1/employees/code-sequences')
      ).data;
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});

const instName = (id: string | null) =>
  id ? (institutions.value.find((i) => i.id === id)?.name ?? id) : null;
const scopeOf = (d: DesignationDto) =>
  d.institutionId ? instName(d.institutionId) : d.groupId ? 'Group' : 'Organization';

// Create / edit designation
const dialog = reactive({
  open: false,
  id: null as string | null,
  code: '',
  name: '',
  institutionId: null as string | null,
  departmentId: null as string | null,
  category: null as string | null,
  level: null as number | null,
});
async function openDialog(d?: DesignationDto) {
  await loadForInstitution(d?.institutionId ?? null);
  Object.assign(dialog, {
    open: true,
    id: d?.id ?? null,
    code: d?.code ?? '',
    name: d?.name ?? '',
    institutionId: d?.institutionId ?? null,
    departmentId: d?.departmentId ?? null,
    category: d?.category ?? null,
    level: d?.level ?? null,
  });
}
async function save() {
  const body = {
    code: dialog.code.trim(),
    name: dialog.name.trim(),
    category: dialog.category,
    departmentId: dialog.departmentId,
    level: dialog.level === null || (dialog.level as unknown) === '' ? null : Number(dialog.level),
  };
  try {
    await apiFetch(dialog.id ? `/api/v1/designations/${dialog.id}` : '/api/v1/designations', {
      method: dialog.id ? 'PATCH' : 'POST',
      body: JSON.stringify(dialog.id ? body : { ...body, institutionId: dialog.institutionId }),
    });
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Numbering
const seq = reactive({
  open: false,
  institutionId: null as string | null,
  prefix: '',
  padding: 4,
  nextNumber: null as number | null,
});
function openSeq(s?: EmployeeCodeSequenceDto) {
  Object.assign(seq, {
    open: true,
    institutionId: s?.institutionId ?? null,
    prefix: s?.prefix ?? '',
    padding: s?.padding ?? 4,
    nextNumber: s?.nextNumber ?? null,
  });
}
async function saveSeq() {
  try {
    await apiFetch('/api/v1/employees/code-sequences', {
      method: 'PUT',
      body: JSON.stringify({
        institutionId: seq.institutionId,
        prefix: seq.prefix.trim(),
        padding: Number(seq.padding),
        ...(seq.nextNumber ? { nextNumber: Number(seq.nextNumber) } : {}),
      }),
    });
    seq.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Scope', key: 'scope', sortable: false },
  { title: 'Department', key: 'department', sortable: false },
  { title: 'Category', key: 'category' },
  { title: 'Level', key: 'level' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const categories = EMPLOYMENT_TYPES.map((value) => ({ value, title: label(value) }));
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Designations</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('designation.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openDialog()"
    >
      New designation
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading">
    <template #[`item.scope`]="{ item }">{{ scopeOf(item) }}</template>
    <template #[`item.department`]="{ item }">{{ item.department?.name ?? 'All' }}</template>
    <template #[`item.category`]="{ item }">
      {{ item.category ? label(item.category) : '—' }}
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="auth.can('designation.manage')"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openDialog(item)"
      />
    </template>
  </v-data-table>

  <template v-if="auth.can('employee.create')">
    <div class="d-flex align-center mt-8 mb-2">
      <h3 class="text-h6">Employee code numbering</h3>
      <v-spacer />
      <v-btn v-if="auth.can('designation.manage')" size="small" variant="tonal" @click="openSeq()">
        Configure
      </v-btn>
    </div>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Scope</th>
          <th>Prefix</th>
          <th>Padding</th>
          <th>Next code</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sequences" :key="s.id">
          <td>{{ instName(s.institutionId) ?? 'Organization default' }}</td>
          <td>{{ s.prefix }}</td>
          <td>{{ s.padding }}</td>
          <td>{{ s.preview }}</td>
          <td class="text-right">
            <v-btn
              v-if="auth.can('designation.manage')"
              size="small"
              variant="text"
              icon="mdi-pencil"
              @click="openSeq(s)"
            />
          </td>
        </tr>
        <tr v-if="!sequences.length">
          <td colspan="5" class="text-medium-emphasis">
            Default numbering: institution code prefix (e.g. ENG-0001).
          </td>
        </tr>
      </tbody>
    </v-table>
  </template>

  <v-dialog v-model="dialog.open" max-width="520">
    <v-card :title="dialog.id ? 'Edit designation' : 'New designation'">
      <v-card-text>
        <v-text-field v-model="dialog.code" label="Code *" />
        <v-text-field v-model="dialog.name" label="Name *" />
        <v-autocomplete
          v-if="!dialog.id"
          v-model="dialog.institutionId"
          :items="institutions"
          item-title="name"
          item-value="id"
          label="Institution (empty = organization-wide)"
          clearable
          @update:model-value="
            (id: string | null) => {
              dialog.departmentId = null;
              loadForInstitution(id);
            }
          "
        />
        <v-autocomplete
          v-model="dialog.departmentId"
          :items="departments"
          item-title="name"
          item-value="id"
          label="Department (empty = all departments)"
          :disabled="!dialog.institutionId"
          clearable
        />
        <v-select v-model="dialog.category" :items="categories" label="Category" clearable />
        <v-text-field v-model.number="dialog.level" type="number" label="Level" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!dialog.code || !dialog.name" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="seq.open" max-width="480">
    <v-card title="Employee code numbering">
      <v-card-text>
        <v-autocomplete
          v-model="seq.institutionId"
          :items="institutions"
          item-title="name"
          item-value="id"
          label="Institution (empty = organization default)"
          clearable
        />
        <v-text-field v-model="seq.prefix" label="Prefix" />
        <v-text-field v-model.number="seq.padding" type="number" label="Digits" />
        <v-text-field v-model.number="seq.nextNumber" type="number" label="Next number" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="seq.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="saveSeq">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
