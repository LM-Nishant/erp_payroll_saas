<script setup lang="ts">
import type { ApiListResponse } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';

interface Institution {
  id: string;
  name: string;
  code: string;
  type: string;
  groupId: string | null;
  status: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

const auth = useAuthStore();
const terms = useTerms();
const items = ref<Institution[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await apiFetch<ApiListResponse<Institution>>('/api/v1/institutions?pageSize=100');
    items.value = res.data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const companyTypes = [
  { value: 'COMPANY', title: 'Company' },
  { value: 'BRANCH', title: 'Branch / office' },
];
const educationTypes = ['SCHOOL', 'COLLEGE', 'UNIVERSITY', 'INSTITUTE'].map((value) => ({
  value,
  title: value.charAt(0) + value.slice(1).toLowerCase(),
}));
// Company organizations that license the education module can also run schools/colleges.
const types = computed(() =>
  terms.value.isCompany
    ? auth.hasFeature('education')
      ? [...companyTypes, ...educationTypes]
      : companyTypes
    : educationTypes,
);
const typeLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

const dialog = reactive({
  open: false,
  id: null as string | null,
  name: '',
  code: '',
  type: 'COLLEGE',
  email: '',
  phone: '',
  address: '',
  status: 'ACTIVE',
});
function openDialog(i?: Institution) {
  Object.assign(dialog, {
    open: true,
    id: i?.id ?? null,
    name: i?.name ?? '',
    code: i?.code ?? '',
    type: i?.type ?? types.value[0]!.value,
    email: i?.email ?? '',
    phone: i?.phone ?? '',
    address: i?.address ?? '',
    status: i?.status ?? 'ACTIVE',
  });
}
async function save() {
  error.value = null;
  try {
    await apiFetch(dialog.id ? `/api/v1/institutions/${dialog.id}` : '/api/v1/institutions', {
      method: dialog.id ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name: dialog.name.trim(),
        code: dialog.code.trim(),
        type: dialog.type,
        email: dialog.email.trim() || null,
        phone: dialog.phone.trim() || null,
        address: dialog.address.trim() || null,
        status: dialog.status,
      }),
    });
    dialog.open = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Code', key: 'code' },
  { title: 'Type', key: 'type' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">{{ terms.isCompany ? 'Companies / branches' : 'Institutions' }}</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('institution.create')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openDialog()"
    >
      New {{ terms.isCompany ? 'company / branch' : 'institution' }}
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading">
    <template #[`item.type`]="{ item }">{{ typeLabel(item.type) }}</template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="auth.can('institution.update')"
        size="small"
        variant="text"
        icon="mdi-pencil"
        @click="openDialog(item)"
      />
    </template>
  </v-data-table>

  <v-dialog v-model="dialog.open" max-width="520">
    <v-card :title="`${dialog.id ? 'Edit' : 'New'} ${terms.institution.toLowerCase()}`">
      <v-card-text>
        <v-text-field v-model="dialog.name" label="Name *" />
        <v-text-field v-model="dialog.code" label="Code * (used as employee code prefix)" />
        <v-select v-model="dialog.type" :items="types" label="Type" />
        <v-text-field v-model="dialog.email" label="Email" />
        <v-text-field v-model="dialog.phone" label="Phone" />
        <v-textarea v-model="dialog.address" label="Address" rows="2" />
        <v-select v-model="dialog.status" :items="['ACTIVE', 'INACTIVE']" label="Status" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!dialog.name || !dialog.code" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
