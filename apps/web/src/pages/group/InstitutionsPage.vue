<script setup lang="ts">
import type { ApiListResponse } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';

interface Institution {
  id: string;
  name: string;
  code: string;
  type: string;
  groupId: string | null;
  status: string;
}

const items = ref<Institution[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  loading.value = true;
  try {
    const res = await apiFetch<ApiListResponse<Institution>>('/api/v1/institutions?pageSize=100');
    items.value = res.data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Code', key: 'code' },
  { title: 'Type', key: 'type' },
  { title: 'Status', key: 'status' },
];
</script>

<template>
  <h2 class="text-h5 mb-4">Institutions</h2>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-data-table :items="items" :headers="headers" :loading="loading" />
</template>
