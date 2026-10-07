<script setup lang="ts">
/** Dashboard widgets: holidays, leave, new joiners, work anniversaries and birthdays. */
import type { EmployeeHighlightsDto, HighlightLeaveDto, HighlightPersonDto } from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';

const data = ref<EmployeeHighlightsDto | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    data.value = (
      await apiFetch<{ data: EmployeeHighlightsDto }>('/api/v1/employees/highlights')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const fmt = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, opts);
const weekday = (d: string) => fmt(d, { weekday: 'short' });
const range = (l: HighlightLeaveDto) =>
  l.fromDate === l.toDate ? fmt(l.fromDate) : `${fmt(l.fromDate)} – ${fmt(l.toDate)}`;
const isToday = (d: string) => d === data.value?.asOf;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const subtitle = (p: HighlightPersonDto) =>
  [p.designation, p.department, p.institution].filter(Boolean).join(' · ');

const people = computed(() =>
  data.value
    ? [
        {
          key: 'birthdays',
          title: 'Birthdays',
          icon: 'mdi-cake-variant',
          color: 'pink',
          items: data.value.birthdays,
          empty: 'No birthdays in the next 30 days',
          label: (p: HighlightPersonDto) => (isToday(p.date) ? 'Today 🎉' : fmt(p.date)),
        },
        {
          key: 'anniv',
          title: 'Work anniversaries',
          icon: 'mdi-trophy-award',
          color: 'amber-darken-2',
          items: data.value.workAnniversaries,
          empty: 'No work anniversaries in the next 30 days',
          label: (p: HighlightPersonDto) =>
            `${p.years} yr${p.years === 1 ? '' : 's'} · ${isToday(p.date) ? 'Today' : fmt(p.date)}`,
        },
        {
          key: 'joiners',
          title: 'New joiners',
          icon: 'mdi-account-plus',
          color: 'green',
          items: data.value.newJoiners,
          empty: 'No new joiners in the last 30 days',
          label: (p: HighlightPersonDto) =>
            p.date > data.value!.asOf ? `Joins ${fmt(p.date)}` : `Joined ${fmt(p.date)}`,
        },
      ]
    : [],
);
</script>

<template>
  <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mb-4">
    {{ error }}
  </v-alert>
  <v-row v-if="data" class="mb-2">
    <v-col cols="12" md="6" lg="4">
      <v-card height="100%">
        <v-card-title class="d-flex align-center">
          <v-icon color="primary" class="mr-2">mdi-party-popper</v-icon>Upcoming holidays
        </v-card-title>
        <v-list density="compact">
          <v-list-item v-for="h in data.upcomingHolidays" :key="h.date + h.name">
            <template #prepend>
              <v-avatar color="primary" variant="tonal" rounded size="44" class="mr-2">
                <div class="text-center" style="line-height: 1.1">
                  <div class="text-caption">{{ fmt(h.date, { month: 'short' }) }}</div>
                  <div class="font-weight-bold">{{ fmt(h.date, { day: 'numeric' }) }}</div>
                </div>
              </v-avatar>
            </template>
            <v-list-item-title>{{ h.name }}</v-list-item-title>
            <v-list-item-subtitle>
              {{ weekday(h.date) }}<span v-if="h.type !== 'PUBLIC'"> · Optional</span>
            </v-list-item-subtitle>
          </v-list-item>
          <v-list-item v-if="!data.upcomingHolidays.length" subtitle="No upcoming holidays" />
        </v-list>
      </v-card>
    </v-col>

    <v-col cols="12" md="6" lg="4">
      <v-card height="100%">
        <v-card-title class="d-flex align-center">
          <v-icon color="teal" class="mr-2">mdi-beach</v-icon>Leave
        </v-card-title>
        <v-list density="compact">
          <template v-if="data.myUpcomingLeaves.length">
            <v-list-subheader>My upcoming leave</v-list-subheader>
            <v-list-item
              v-for="l in data.myUpcomingLeaves"
              :key="'m' + l.fromDate + l.leaveType"
              :title="`${l.leaveType} · ${l.days} day${l.days === 1 ? '' : 's'}`"
              :subtitle="range(l)"
            >
              <template #append>
                <v-chip
                  size="x-small"
                  :color="l.status === 'APPROVED' ? 'success' : 'warning'"
                  variant="tonal"
                >
                  {{ l.status === 'APPROVED' ? 'Approved' : 'Pending' }}
                </v-chip>
              </template>
            </v-list-item>
          </template>
          <v-list-subheader>On leave today</v-list-subheader>
          <v-list-item
            v-for="l in data.onLeaveToday"
            :key="'t' + l.employeeId + l.fromDate"
            :title="l.name"
            :subtitle="`${l.leaveType} · until ${fmt(l.toDate)}`"
          />
          <v-list-item v-if="!data.onLeaveToday.length" subtitle="Everyone is in today" />
          <template v-if="data.upcomingTeamLeaves.length">
            <v-list-subheader>Upcoming</v-list-subheader>
            <v-list-item
              v-for="l in data.upcomingTeamLeaves"
              :key="'u' + l.employeeId + l.fromDate"
              :title="l.name"
              :subtitle="`${l.leaveType} · ${range(l)}`"
            />
          </template>
        </v-list>
      </v-card>
    </v-col>

    <v-col v-for="w in people" :key="w.key" cols="12" md="6" lg="4">
      <v-card height="100%">
        <v-card-title class="d-flex align-center">
          <v-icon :color="w.color" class="mr-2">{{ w.icon }}</v-icon
          >{{ w.title }}
        </v-card-title>
        <v-list density="compact">
          <v-list-item v-for="p in w.items" :key="p.employeeId + p.date" :subtitle="subtitle(p)">
            <template #prepend>
              <v-avatar :color="w.color" variant="tonal" size="36">{{ initials(p.name) }}</v-avatar>
            </template>
            <v-list-item-title>{{ p.name }}</v-list-item-title>
            <template #append>
              <span class="text-caption text-medium-emphasis">{{ w.label(p) }}</span>
            </template>
          </v-list-item>
          <v-list-item v-if="!w.items.length" :subtitle="w.empty" />
        </v-list>
      </v-card>
    </v-col>
  </v-row>
</template>
