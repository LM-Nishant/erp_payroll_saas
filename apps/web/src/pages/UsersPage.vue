<script setup lang="ts">
import type { ApiListResponse, ScopeSummary } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';

interface UserRow {
  id: string;
  email: string;
  name: string;
  membershipStatus: string;
  roles: Array<{ id: string; key: string; name: string; scopes: ScopeSummary[] }>;
}

const items = ref<UserRow[]>([]);
const total = ref(0);
const search = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({ pageSize: '100' });
    if (search.value.trim()) params.set('search', search.value.trim());
    // The server returns only users within the caller's scopes.
    const res = await apiFetch<ApiListResponse<UserRow>>(`/api/v1/users?${params}`);
    items.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
});
onMounted(load);

const scopeLabel = (s: ScopeSummary) =>
  s.type === 'ORGANIZATION' ? 'Organization' : `${s.type.toLowerCase()}: ${s.name ?? s.id}`;

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Email', key: 'email' },
  { title: 'Status', key: 'membershipStatus' },
  { title: 'Roles', key: 'roles', sortable: false },
];
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Users</h2>
    <v-spacer />
    <v-text-field
      v-model="search"
      density="compact"
      prepend-inner-icon="mdi-magnify"
      label="Search"
      hide-details
      style="max-width: 280px"
    />
  </div>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading" :items-length="total">
    <template #[`item.roles`]="{ item }">
      <v-chip v-for="role in item.roles" :key="role.id" size="small" class="mr-1 my-1">
        {{ role.name }}
        <span class="text-medium-emphasis ml-1"
          >({{ role.scopes.map(scopeLabel).join(', ') }})</span
        >
      </v-chip>
    </template>
    <template #[`item.membershipStatus`]="{ item }">
      <v-chip size="small" :color="item.membershipStatus === 'ACTIVE' ? 'success' : 'default'">
        {{ item.membershipStatus }}
      </v-chip>
    </template>
  </v-data-table>
</template>
