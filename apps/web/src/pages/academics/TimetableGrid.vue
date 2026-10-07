<script setup lang="ts">
import type { BellPeriodDto, TimetableEntryDto } from '@erp/shared';
import { computed } from 'vue';
import { DAYS } from './useAcademics';

const props = defineProps<{
  periods: BellPeriodDto[];
  entries: TimetableEntryDto[];
  clickable?: boolean;
  showSection?: boolean;
}>();
const emit = defineEmits<{ cell: [day: number, periodId: string] }>();
const byCell = computed(() => {
  const m = new Map<string, TimetableEntryDto[]>();
  for (const e of props.entries) {
    const k = `${e.dayOfWeek}:${e.periodId}`;
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return m;
});
const days = computed(() =>
  DAYS.filter(
    (d) => d.value <= 5 || props.entries.some((e) => e.dayOfWeek === d.value) || props.clickable,
  ),
);
</script>
<template>
  <v-alert v-if="!periods.length" type="info" variant="tonal"
    >No bell schedule defined for this institution yet.</v-alert
  >
  <v-table v-else density="compact" class="timetable-grid">
    <thead>
      <tr>
        <th>Day</th>
        <th v-for="p in periods" :key="p.id">
          {{ p.name }}<br /><span class="text-caption">{{ p.startTime }}–{{ p.endTime }}</span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="d in days" :key="d.value">
        <th>{{ d.title }}</th>
        <td
          v-for="p in periods"
          :key="p.id"
          :class="{ 'bg-grey-lighten-3': p.isBreak, 'cursor-pointer': clickable && !p.isBreak }"
          @click="!p.isBreak && emit('cell', d.value, p.id)"
        >
          <span v-if="p.isBreak" class="text-caption text-medium-emphasis">Break</span>
          <div v-for="e in byCell.get(`${d.value}:${p.id}`) ?? []" v-else :key="e.id" class="py-1">
            <div class="font-weight-medium">{{ e.subject?.name ?? '—' }}</div>
            <div v-if="showSection && e.classSection" class="text-caption">
              {{ e.classSection.name }}
            </div>
            <div class="text-caption">
              <template v-if="e.substitute"
                ><s>{{ e.teacher?.name }}</s> → {{ e.substitute.name }}</template
              ><template v-else>{{ e.teacher?.name }}</template
              ><template v-if="e.room"> · {{ e.room }}</template>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>
<style scoped>
.timetable-grid td {
  vertical-align: top;
  min-width: 110px;
}
</style>
