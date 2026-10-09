<script setup lang="ts">
import type { TimetableViewDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch, isNotLinked } from '@/api/client';
import TimetableGrid from '../TimetableGrid.vue';
import { today } from '../useAcademics';
import { useWard } from './useWard';
import WardPicker from './WardPicker.vue';

const { wards, studentId, loadWards, withStudent } = useWard();
const view = ref<(TimetableViewDto & { student: { displayName: string } }) | null>(null);
const todayView = ref<TimetableViewDto | null>(null);
const error = ref<string | null>(null);
const notLinked = ref(false);
async function load() {
  try {
    const [week, day] = await Promise.all([
      apiFetch<{ data: TimetableViewDto & { student: { displayName: string } } }>(
        withStudent('/api/v1/timetable/me'),
      ),
      apiFetch<{ data: TimetableViewDto }>(withStudent('/api/v1/timetable/me', { date: today() })),
    ]);
    view.value = week.data;
    todayView.value = day.data;
  } catch (e) {
    if (isNotLinked(e)) notLinked.value = true;
    else error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadWards().catch(() => undefined);
  await load();
});
watch(studentId, load);
</script>
<template>
  <h2 class="text-h5 mb-4">
    Timetable<span v-if="view"> · {{ view.student.displayName }}</span>
  </h2>
  <WardPicker v-model="studentId" :wards="wards" />
  <v-alert v-if="notLinked" type="info" variant="tonal" class="mb-4"
    >Your account is not linked to a student record.</v-alert
  >
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <template v-else-if="view">
    <h3 class="text-subtitle-1 mb-2">Today (incl. substitutions)</h3>
    <TimetableGrid
      v-if="todayView?.entries.length"
      :periods="todayView.periods"
      :entries="todayView.entries"
      class="mb-4"
    />
    <p v-else class="text-medium-emphasis mb-4">No classes today.</p>
    <h3 class="text-subtitle-1 mb-2">Weekly timetable</h3>
    <TimetableGrid :periods="view.periods" :entries="view.entries" />
  </template>
</template>
