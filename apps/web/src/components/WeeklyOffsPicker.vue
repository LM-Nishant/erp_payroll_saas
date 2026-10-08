<script setup lang="ts">
import type { WeeklyOffRule } from '@erp/shared';
import { computed } from 'vue';

/**
 * Visual weekly-off editor: per weekday "Working" / "Off every week" / "Off on selected weeks"
 * (nth occurrence in the month, e.g. 2nd + 4th Saturday), plus common presets.
 */
const model = defineModel<WeeklyOffRule[]>({ required: true });

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKS = [
  { value: 1, title: '1st' },
  { value: 2, title: '2nd' },
  { value: 3, title: '3rd' },
  { value: 4, title: '4th' },
  { value: 5, title: '5th' },
];
type Mode = 'WORKING' | 'EVERY' | 'WEEKS';
const MODES = [
  { value: 'WORKING', title: 'Working day' },
  { value: 'EVERY', title: 'Off every week' },
  { value: 'WEEKS', title: 'Off on selected weeks' },
];
const PRESETS: { title: string; rules: WeeklyOffRule[] }[] = [
  { title: 'Sunday', rules: [{ weekday: 0 }] },
  { title: 'Saturday + Sunday', rules: [{ weekday: 0 }, { weekday: 6 }] },
  { title: 'Sunday + 2nd & 4th Saturday', rules: [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }] },
  {
    title: 'Sunday + 1st, 3rd & 5th Saturday',
    rules: [{ weekday: 0 }, { weekday: 6, weeks: [1, 3, 5] }],
  },
  { title: 'No weekly off', rules: [] },
];

const ruleOf = (weekday: number) => model.value.find((r) => r.weekday === weekday);
const modeOf = (weekday: number): Mode => {
  const r = ruleOf(weekday);
  return !r ? 'WORKING' : r.weeks?.length ? 'WEEKS' : 'EVERY';
};
const put = (weekday: number, rule: WeeklyOffRule | null) => {
  const rest = model.value.filter((r) => r.weekday !== weekday);
  model.value = (rule ? [...rest, rule] : rest).sort((a, b) => a.weekday - b.weekday);
};
function setMode(weekday: number, mode: Mode) {
  if (mode === 'WORKING') put(weekday, null);
  else if (mode === 'EVERY') put(weekday, { weekday });
  else put(weekday, { weekday, weeks: ruleOf(weekday)?.weeks ?? [2, 4] });
}
function setWeeks(weekday: number, weeks: number[]) {
  const sorted = [...weeks].sort((a, b) => a - b);
  put(weekday, sorted.length ? { weekday, weeks: sorted } : null);
}
const same = (a: WeeklyOffRule[], b: WeeklyOffRule[]) =>
  JSON.stringify(a.map((r) => [r.weekday, r.weeks ?? []]).sort()) ===
  JSON.stringify(b.map((r) => [r.weekday, r.weeks ?? []]).sort());
const nth = (w: number) => WEEKS[w - 1]?.title ?? String(w);
const summary = computed(() =>
  model.value.length
    ? model.value
        .map((r) =>
          r.weeks?.length
            ? `${r.weeks.map(nth).join(', ')} ${DAYS[r.weekday]}`
            : `every ${DAYS[r.weekday]}`,
        )
        .join(' + ')
    : 'No weekly off',
);
</script>

<template>
  <div>
    <div class="text-caption text-medium-emphasis mb-1">Quick presets</div>
    <div class="d-flex flex-wrap ga-1 mb-3">
      <v-chip
        v-for="p in PRESETS"
        :key="p.title"
        size="small"
        :color="same(model, p.rules) ? 'primary' : undefined"
        :variant="same(model, p.rules) ? 'flat' : 'outlined'"
        @click="model = p.rules.map((r) => ({ ...r }))"
      >
        {{ p.title }}
      </v-chip>
    </div>
    <v-table density="compact">
      <tbody>
        <tr v-for="d in ORDER" :key="d">
          <td style="width: 110px">{{ DAYS[d] }}</td>
          <td style="width: 220px">
            <v-select
              :model-value="modeOf(d)"
              :items="MODES"
              density="compact"
              variant="plain"
              hide-details
              @update:model-value="setMode(d, $event as Mode)"
            />
          </td>
          <td>
            <v-chip-group
              v-if="modeOf(d) === 'WEEKS'"
              :model-value="ruleOf(d)?.weeks ?? []"
              multiple
              column
              selected-class="text-primary"
              @update:model-value="setWeeks(d, $event as number[])"
            >
              <v-chip
                v-for="w in WEEKS"
                :key="w.value"
                :value="w.value"
                size="small"
                filter
                variant="outlined"
              >
                {{ w.title }}
              </v-chip>
            </v-chip-group>
          </td>
        </tr>
      </tbody>
    </v-table>
    <div class="text-caption mt-1">
      Weekly off: <strong>{{ summary }}</strong>
      <span class="text-medium-emphasis">
        (weeks = occurrence in the month, e.g. the 2nd Saturday is the second Saturday of that
        month)
      </span>
    </div>
  </div>
</template>
