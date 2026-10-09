<script setup lang="ts">
import type { OwnAttendanceDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch, isNotLinked } from '@/api/client';
import { STATUS_CODE, STATUS_COLOR, thisMonth } from '../useAcademics';
import { useWard } from './useWard';
import WardPicker from './WardPicker.vue';

const { wards, studentId, loadWards, withStudent } = useWard();
const month = ref(thisMonth());
const data = ref<OwnAttendanceDto | null>(null);
const error = ref<string | null>(null);
const notLinked = ref(false);
async function load() {
  try {
    data.value = (
      await apiFetch<{ data: OwnAttendanceDto }>(
        withStudent('/api/v1/student-attendance/me', { month: month.value }),
      )
    ).data;
  } catch (e) {
    if (isNotLinked(e)) notLinked.value = true;
    else error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadWards().catch(() => undefined);
  await load();
});
watch([studentId, month], load);
</script>
<template>
  <h2 class="text-h5 mb-4">
    Attendance<span v-if="data"> · {{ data.student.displayName }}</span>
  </h2>
  <WardPicker v-model="studentId" :wards="wards" />
  <v-alert v-if="notLinked" type="info" variant="tonal" class="mb-4"
    >Your account is not linked to a student record.</v-alert
  >
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <template v-else-if="data">
    <v-row class="mb-2">
      <v-col cols="12" md="6">
        <v-card
          ><v-card-title>Overall</v-card-title
          ><v-card-text
            ><div
              class="text-h4"
              :class="data.overall.percentage >= 75 ? 'text-success' : 'text-error'"
            >
              {{ data.overall.percentage }}%
            </div>
            {{ data.overall.present }} present · {{ data.overall.absent }} absent ·
            {{ data.overall.late }} late of {{ data.overall.workingDays }} days</v-card-text
          ></v-card
        >
      </v-col>
      <v-col cols="12" md="6">
        <v-card
          ><v-card-title class="d-flex align-center"
            >Month<v-spacer /><v-text-field
              v-model="month"
              type="month"
              density="compact"
              hide-details
              style="max-width: 200px" /></v-card-title
          ><v-card-text
            ><div class="text-h4">{{ data.summary.percentage }}%</div>
            {{ data.summary.present }} present · {{ data.summary.absent }} absent of
            {{ data.summary.workingDays }} days</v-card-text
          ></v-card
        >
      </v-col>
    </v-row>
    <div class="d-flex flex-wrap ga-1">
      <v-chip v-for="d in data.days" :key="d.date" :color="STATUS_COLOR[d.status]" size="small"
        >{{ d.date.slice(5) }} {{ STATUS_CODE[d.status] }}</v-chip
      >
    </div>
    <p v-if="!data.days.length" class="text-medium-emphasis">No attendance this month.</p>
  </template>
</template>
