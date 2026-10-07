<script setup lang="ts">
import type { ApiListResponse, EmployeeDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';

/** Pick an employee by name or employee code; the model value is the employee id. */
const props = withDefaults(
  defineProps<{
    label?: string;
    institutionId?: string | null;
    density?: 'default' | 'comfortable' | 'compact';
    hideDetails?: boolean;
    clearable?: boolean;
    disabled?: boolean;
  }>(),
  {
    label: 'Employee',
    institutionId: null,
    density: 'default',
    hideDetails: false,
    clearable: true,
    disabled: false,
  },
);
const model = defineModel<string | null>({ default: null });
const emit = defineEmits<{ select: [EmployeeDto | null] }>();

const items = ref<EmployeeDto[]>([]);
const search = ref('');
const loading = ref(false);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function load(term: string) {
  const mine = ++seq;
  loading.value = true;
  try {
    const params = new URLSearchParams({ pageSize: '25' });
    if (term.trim()) params.set('search', term.trim());
    if (props.institutionId) params.set('institutionId', props.institutionId);
    const res = await apiFetch<ApiListResponse<EmployeeDto>>(`/api/v1/employees?${params}`);
    if (mine !== seq) return;
    const selected = items.value.find((e) => e.id === model.value);
    items.value =
      selected && !res.data.some((e) => e.id === selected.id) ? [selected, ...res.data] : res.data;
  } catch {
    if (mine === seq) items.value = [];
  } finally {
    if (mine === seq) loading.value = false;
  }
}

const title = (e: EmployeeDto) => `${e.displayName} (${e.employeeCode})`;

watch(search, (term) => {
  const current = items.value.find((e) => e.id === model.value);
  if (current && term === title(current)) return;
  clearTimeout(timer);
  timer = setTimeout(() => void load(term ?? ''), 250);
});
watch(
  () => props.institutionId,
  () => void load(''),
);
watch(model, (id) => emit('select', items.value.find((e) => e.id === id) ?? null));
/** Make sure a preselected id is shown by name even when it is outside the first page. */
async function ensureSelected(id: string | null) {
  if (!id || items.value.some((e) => e.id === id)) return;
  try {
    const res = await apiFetch<{ data: EmployeeDto }>(`/api/v1/employees/${id}`);
    if (!items.value.some((e) => e.id === id)) items.value = [res.data, ...items.value];
  } catch {
    /* not visible to the caller */
  }
}
watch(model, (id) => void ensureSelected(id));
onMounted(async () => {
  await load('');
  await ensureSelected(model.value);
});
</script>

<template>
  <v-autocomplete
    v-model="model"
    v-model:search="search"
    :items="items"
    :item-title="title"
    item-value="id"
    :label="label"
    :loading="loading"
    :density="density"
    :hide-details="hideDetails"
    :clearable="clearable"
    :disabled="disabled"
    placeholder="Type a name or employee code"
    no-filter
  >
    <template #item="{ props: itemProps, item }">
      <v-list-item
        v-bind="itemProps"
        :subtitle="
          [item.raw.designation?.name, item.raw.department?.name, item.raw.institution?.name]
            .filter(Boolean)
            .join(' · ')
        "
      />
    </template>
  </v-autocomplete>
</template>
