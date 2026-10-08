<script setup lang="ts">
import type { ApiListResponse } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';
import { useHrOptions } from './hr/useHrOptions';

interface BranchRow {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  address: string | null;
  isMain: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

/** Branches (campuses) of an institution/company. Institution owners and admins manage them. */
const auth = useAuthStore();
const terms = useTerms();
const { institutions, loadBase } = useHrOptions();
const institutionId = ref<string | null>(null);
const items = ref<BranchRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  if (!institutionId.value) return;
  loading.value = true;
  error.value = null;
  try {
    items.value = (
      await apiFetch<ApiListResponse<BranchRow>>(
        `/api/v1/campuses?pageSize=100&institutionId=${institutionId.value}`,
      )
    ).data;
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

const dialog = reactive({
  open: false,
  id: null as string | null,
  code: '',
  name: '',
  address: '',
  isMain: false,
  status: 'ACTIVE' as BranchRow['status'],
});

function openDialog(b?: BranchRow) {
  Object.assign(dialog, {
    open: true,
    id: b?.id ?? null,
    code: b?.code ?? '',
    name: b?.name ?? '',
    address: b?.address ?? '',
    isMain: b?.isMain ?? items.value.length === 0,
    status: b?.status ?? 'ACTIVE',
  });
}

async function save() {
  const body = {
    code: dialog.code.trim(),
    name: dialog.name.trim(),
    address: dialog.address.trim() || null,
    isMain: dialog.isMain,
    status: dialog.status,
  };
  try {
    await apiFetch(dialog.id ? `/api/v1/campuses/${dialog.id}` : '/api/v1/campuses', {
      method: dialog.id ? 'PATCH' : 'POST',
      body: JSON.stringify(dialog.id ? body : { ...body, institutionId: institutionId.value }),
    });
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function remove(b: BranchRow) {
  if (!confirm(`Delete branch "${b.name}"?`)) return;
  try {
    await apiFetch(`/api/v1/campuses/${b.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Address', key: 'address' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4 ga-4">
    <h2 class="text-h5">Branches</h2>
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
      v-if="auth.can('campus.create')"
      color="primary"
      prepend-icon="mdi-plus"
      :disabled="!institutionId"
      @click="openDialog()"
    >
      New branch
    </v-btn>
  </div>
  <v-alert v-if="!loading && institutions.length === 0" type="info" variant="tonal" class="mb-4">
    No {{ terms.institution.toLowerCase() }} is set up yet. Ask your organization owner or platform
    admin to create it, then add its branches here.
  </v-alert>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading">
    <template #[`item.name`]="{ item }">
      {{ item.name }}
      <v-chip v-if="item.isMain" size="x-small" color="primary" class="ml-2">Main</v-chip>
    </template>
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="item.status === 'ACTIVE' ? 'success' : undefined">
        {{ item.status }}
      </v-chip>
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="auth.can('campus.update')"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openDialog(item)"
      />
      <v-btn
        v-if="auth.can('campus.delete')"
        size="small"
        variant="text"
        icon="mdi-delete"
        @click="remove(item)"
      />
    </template>
  </v-data-table>

  <v-dialog v-model="dialog.open" max-width="480">
    <v-card :title="dialog.id ? 'Edit branch' : 'New branch'">
      <v-card-text>
        <v-text-field v-model="dialog.code" label="Code * (e.g. NOIDA)" />
        <v-text-field v-model="dialog.name" label="Name * (e.g. Noida Branch)" />
        <v-textarea v-model="dialog.address" label="Address" rows="2" />
        <v-select
          v-model="dialog.status"
          :items="['ACTIVE', 'INACTIVE']"
          label="Status"
          hide-details
          class="mb-2"
        />
        <v-checkbox v-model="dialog.isMain" label="Main branch" hide-details />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!dialog.code || !dialog.name" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
