<script setup lang="ts">
import {
  COMPANY_EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPES,
  type ApiListResponse,
  type EmployeeTypeDto,
  type EmploymentType,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';
import { label } from './useHrOptions';

/** Organization-defined employee types (e.g. Permanent, Probationer, Consultant). */
const auth = useAuthStore();
const terms = useTerms();
const items = ref<EmployeeTypeDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    items.value = (
      await apiFetch<ApiListResponse<EmployeeTypeDto>>('/api/v1/employee-types?pageSize=100')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const categories = computed(() =>
  (terms.value.isCompany ? COMPANY_EMPLOYMENT_TYPES : EMPLOYMENT_TYPES).map((value) => ({
    value,
    title: label(value),
  })),
);

const dialog = reactive({
  open: false,
  id: null as string | null,
  code: '',
  name: '',
  category: null as EmploymentType | null,
  description: '',
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
});
function openDialog(t?: EmployeeTypeDto) {
  Object.assign(dialog, {
    open: true,
    id: t?.id ?? null,
    code: t?.code ?? '',
    name: t?.name ?? '',
    category: t?.category ?? (terms.value.isCompany ? 'FULL_TIME' : 'TEACHING'),
    description: t?.description ?? '',
    status: t?.status ?? 'ACTIVE',
  });
}
async function save() {
  try {
    await apiFetch(dialog.id ? `/api/v1/employee-types/${dialog.id}` : '/api/v1/employee-types', {
      method: dialog.id ? 'PATCH' : 'POST',
      body: JSON.stringify({
        code: dialog.code.trim(),
        name: dialog.name.trim(),
        category: dialog.category,
        description: dialog.description.trim() || null,
        status: dialog.status,
      }),
    });
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove(t: EmployeeTypeDto) {
  if (!confirm(`Delete employee type ${t.name}?`)) return;
  try {
    await apiFetch(`/api/v1/employee-types/${t.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Category', key: 'category' },
  { title: 'Employees', key: 'employeeCount' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Employee types</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('designation.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openDialog()"
    >
      New employee type
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading">
    <template #[`item.category`]="{ item }">{{ label(item.category) }}</template>
    <template #[`item.actions`]="{ item }">
      <template v-if="auth.can('designation.manage')">
        <v-btn size="small" variant="text" icon="mdi-pencil" @click="openDialog(item)" />
        <v-btn
          size="small"
          variant="text"
          icon="mdi-delete"
          :disabled="item.employeeCount > 0"
          @click="remove(item)"
        />
      </template>
    </template>
  </v-data-table>

  <v-dialog v-model="dialog.open" max-width="480">
    <v-card :title="dialog.id ? 'Edit employee type' : 'New employee type'">
      <v-card-text>
        <v-text-field v-model="dialog.code" label="Code * (e.g. PERM)" />
        <v-text-field v-model="dialog.name" label="Name * (e.g. Permanent)" />
        <v-select
          v-model="dialog.category"
          :items="categories"
          label="Category *"
          hint="Used by statutory rules and attendance policies"
          persistent-hint
        />
        <v-textarea v-model="dialog.description" label="Description" rows="2" class="mt-2" />
        <v-select v-model="dialog.status" :items="['ACTIVE', 'INACTIVE']" label="Status" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          :disabled="!dialog.code || !dialog.name || !dialog.category"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
