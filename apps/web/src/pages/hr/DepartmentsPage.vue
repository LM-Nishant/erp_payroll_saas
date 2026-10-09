<script setup lang="ts">
import type { ApiListResponse, DesignationDto } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';
import { useHrOptions } from './useHrOptions';

interface DepartmentRow {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
}

/** Departments per institution/company, with the designations (roles) defined inside each. */
const auth = useAuthStore();
const terms = useTerms();
const { institutions, loadBase } = useHrOptions();
const institutionId = ref<string | null>(null);
const items = ref<DepartmentRow[]>([]);
const designations = ref<DesignationDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
/** Designations (roles inside a department) are part of the HR module. */
const showRoles = computed(() => auth.hasFeature('hr') && auth.can('designation.view'));

async function load() {
  if (!institutionId.value) return;
  loading.value = true;
  error.value = null;
  try {
    [items.value, designations.value] = await Promise.all([
      apiFetch<ApiListResponse<DepartmentRow>>(
        `/api/v1/departments?pageSize=100&institutionId=${institutionId.value}`,
      ).then((r) => r.data),
      showRoles.value
        ? apiFetch<ApiListResponse<DesignationDto>>('/api/v1/designations?pageSize=100').then(
            (r) => r.data,
          )
        : Promise.resolve([]),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadBase();
  institutionId.value = institutions.value[0]?.id ?? null;
  await load();
});

const rolesOf = (departmentId: string) =>
  designations.value.filter((d) => d.departmentId === departmentId);

const dialog = reactive({
  open: false,
  id: null as string | null,
  code: '',
  name: '',
  description: '',
});
function openDialog(d?: DepartmentRow) {
  Object.assign(dialog, {
    open: true,
    id: d?.id ?? null,
    code: d?.code ?? '',
    name: d?.name ?? '',
    description: d?.description ?? '',
  });
}
async function save() {
  const body = {
    code: dialog.code.trim(),
    name: dialog.name.trim(),
    description: dialog.description.trim() || null,
  };
  try {
    await apiFetch(dialog.id ? `/api/v1/departments/${dialog.id}` : '/api/v1/departments', {
      method: dialog.id ? 'PATCH' : 'POST',
      body: JSON.stringify(dialog.id ? body : { ...body, institutionId: institutionId.value }),
    });
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove(d: DepartmentRow) {
  if (!confirm(`Delete department ${d.name}?`)) return;
  try {
    await apiFetch(`/api/v1/departments/${d.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const role = reactive({
  open: false,
  departmentId: '',
  departmentName: '',
  code: '',
  name: '',
});
function openRole(d: DepartmentRow) {
  Object.assign(role, {
    open: true,
    departmentId: d.id,
    departmentName: d.name,
    code: '',
    name: '',
  });
}
async function saveRole() {
  try {
    await apiFetch('/api/v1/designations', {
      method: 'POST',
      body: JSON.stringify({
        code: role.code.trim(),
        name: role.name.trim(),
        departmentId: role.departmentId,
      }),
    });
    role.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = computed(() => [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  ...(showRoles.value ? [{ title: 'Designations / roles', key: 'roles', sortable: false }] : []),
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]);
</script>

<template>
  <div class="d-flex align-center mb-4 ga-4">
    <h2 class="text-h5">Departments</h2>
    <v-autocomplete
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      :label="terms.institution"
      density="compact"
      hide-details
      style="max-width: 320px"
      @update:model-value="load"
    />
    <v-spacer />
    <v-btn
      v-if="auth.can('department.create')"
      color="primary"
      prepend-icon="mdi-plus"
      :disabled="!institutionId"
      @click="openDialog()"
    >
      New department
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading">
    <template #[`item.roles`]="{ item }">
      <v-chip v-for="r in rolesOf(item.id)" :key="r.id" size="small" class="mr-1 my-1">
        {{ r.name }}
      </v-chip>
      <v-btn
        v-if="auth.can('designation.manage')"
        size="x-small"
        variant="tonal"
        prepend-icon="mdi-plus"
        @click="openRole(item)"
      >
        Add role
      </v-btn>
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="auth.can('department.update')"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openDialog(item)"
      />
      <v-btn
        v-if="auth.can('department.delete')"
        size="small"
        variant="text"
        icon="mdi-delete"
        @click="remove(item)"
      />
    </template>
  </v-data-table>

  <v-dialog v-model="dialog.open" max-width="480">
    <v-card :title="dialog.id ? 'Edit department' : 'New department'">
      <v-card-text>
        <v-text-field v-model="dialog.code" label="Code * (e.g. IT)" />
        <v-text-field v-model="dialog.name" label="Name * (e.g. Information Technology)" />
        <v-textarea v-model="dialog.description" label="Description" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!dialog.code || !dialog.name" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="role.open" max-width="480">
    <v-card :title="`New role in ${role.departmentName}`">
      <v-card-text>
        <v-text-field v-model="role.code" label="Code * (e.g. FE-DEV)" />
        <v-text-field v-model="role.name" label="Name * (e.g. Frontend Developer)" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="role.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!role.code || !role.name" @click="saveRole">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
