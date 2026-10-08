<script setup lang="ts">
import type { ApiListResponse, StudentDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';

const model = defineModel<string | null>({ default: null });
const props = defineProps<{ label?: string; density?: 'compact' | 'default' }>();
const items = ref<Array<{ id: string; title: string }>>([]);
const search = ref('');
const loading = ref(false);
let timer: ReturnType<typeof setTimeout>;

async function fetchStudents() {
  loading.value = true;
  try {
    const p = new URLSearchParams({ pageSize: '25' });
    if (search.value) p.set('search', search.value);
    const r = await apiFetch<ApiListResponse<StudentDto>>(`/api/v1/students?${p}`);
    const next = r.data.map((s) => ({
      id: s.id,
      title: `${s.displayName} (${s.admissionNo})${s.classSection ? ` · ${s.classSection.name}` : ''}`,
    }));
    const selected = items.value.find((i) => i.id === model.value);
    items.value = selected && !next.some((n) => n.id === selected.id) ? [selected, ...next] : next;
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(fetchStudents, 300);
});
onMounted(fetchStudents);
</script>
<template>
  <v-autocomplete
    v-model="model"
    v-model:search="search"
    :items="items"
    :loading="loading"
    item-title="title"
    item-value="id"
    :label="props.label ?? 'Student'"
    :density="props.density ?? 'default'"
    no-filter
    clearable
    hide-details="auto"
  />
</template>
