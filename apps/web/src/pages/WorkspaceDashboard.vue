<script setup lang="ts">
/** Workspace landing page: shortcuts to every page of the layout the user may open. */
import type { EmployeeDetailDto } from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { MENUS, visibleMenu, type LayoutKey } from '@/navigation/menus';
import { useTerms } from '@/lib/terms';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ layout: Exclude<LayoutKey, 'platform' | 'hr'> }>();
const auth = useAuthStore();
const terms = useTerms();

const shortcuts = computed(() =>
  visibleMenu(MENUS[props.layout], auth.can, auth.hasFeature, auth.me?.organization?.kind).filter(
    (i) => i.to !== `/${props.layout}`,
  ),
);
const title = computed(() => {
  if (props.layout === 'employee') return `Welcome, ${auth.me?.user.name ?? ''}`;
  return props.layout === 'group' ? terms.value.group : terms.value.institution;
});

const self = ref<EmployeeDetailDto | null>(null);
const notLinked = ref(false);
onMounted(async () => {
  if (props.layout !== 'employee') return;
  if (!auth.can('employee.view_own')) {
    notLinked.value = true;
    return;
  }
  try {
    self.value = (await apiFetch<{ data: EmployeeDetailDto }>('/api/v1/employees/me')).data;
  } catch {
    notLinked.value = true;
  }
});
</script>

<template>
  <h2 class="text-h5 mb-1">{{ title }}</h2>
  <p v-if="self" class="text-medium-emphasis mb-4">
    {{ self.employeeCode }} · {{ self.designation?.name ?? 'No designation' }} ·
    {{ self.institution?.name }}<span v-if="self.department"> / {{ self.department.name }}</span>
  </p>
  <p v-else class="text-medium-emphasis mb-4">{{ auth.me?.organization?.name }}</p>
  <v-alert v-if="notLinked" type="info" variant="tonal" class="mb-4">
    Your login is not linked to an employee record, so attendance, leave and payslips are not
    available here. HR can link it from HR → Employees → (employee) → Login access.
  </v-alert>
  <v-row>
    <v-col v-for="s in shortcuts" :key="s.to" cols="12" sm="6" md="4" lg="3">
      <v-card :to="s.to" :prepend-icon="s.icon" :title="s.title" variant="tonal" />
    </v-col>
  </v-row>
</template>
