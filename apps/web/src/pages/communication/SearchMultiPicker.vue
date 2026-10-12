<script setup lang="ts">
import type { ApiListResponse } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';

/** Multi-select autocomplete over a searchable list endpoint (students / employees). */
const props = defineProps<{
  label: string;
  path: string;
  institutionId: string;
  title: (row: Record<string, unknown>) => string;
  initial?: Array<{ id: string; title: string }>;
}>();
const model = defineModel<string[]>({ default: () => [] });
const items = ref<Array<{ id: string; title: string }>>(props.initial ?? []);
const search = ref('');
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

async function load() {
  const mine = ++seq;
  loading.value = true;
  try {
    const p = new URLSearchParams({ pageSize: '25', institutionId: props.institutionId });
    if (search.value?.trim()) p.set('search', search.value.trim());
    const r = await apiFetch<ApiListResponse<Record<string, unknown>>>(`${props.path}?${p}`);
    if (mine !== seq) return;
    const selected = items.value.filter((i) => model.value.includes(i.id));
    const next = r.data.map((row) => ({ id: String(row.id), title: props.title(row) }));
    items.value = [...selected, ...next.filter((n) => !selected.some((s) => s.id === n.id))];
  } catch {
    if (mine === seq) items.value = items.value.filter((i) => model.value.includes(i.id));
  } finally {
    if (mine === seq) loading.value = false;
  }
}
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 250);
});
watch(() => props.institutionId, load);
onMounted(load);
</script>

<template>
  <v-autocomplete
    v-model="model"
    v-model:search="search"
    :items="items"
    :loading="loading"
    :label="label"
    item-title="title"
    item-value="id"
    multiple
    chips
    closable-chips
    no-filter
    hide-details="auto"
  />
</template>
