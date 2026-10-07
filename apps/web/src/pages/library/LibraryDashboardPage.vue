<script setup lang="ts">
import type { LibraryDashboardDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import LibraryTabs from './LibraryTabs.vue';
import { fmtDate, money, qs, useLibraryInstitutions } from './library';

const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const data = ref<LibraryDashboardDto | null>(null);
const error = ref<string | null>(null);
async function load() {
  error.value = null;
  try {
    data.value = (
      await apiFetch<{ data: LibraryDashboardDto }>(
        `/api/v1/library/dashboard?${qs({ institutionId: institutionId.value })}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadInstitutions();
  await load();
});
watch(institutionId, load);
const tiles = (d: LibraryDashboardDto) => [
  { label: 'Titles', value: d.titles, icon: 'mdi-bookshelf' },
  { label: 'Copies', value: d.copies, icon: 'mdi-book-multiple' },
  { label: 'Available', value: d.available, icon: 'mdi-book-check' },
  { label: 'Issued', value: d.issued, icon: 'mdi-book-arrow-right' },
  { label: 'Overdue', value: d.overdue, icon: 'mdi-alarm', color: 'error' },
  { label: 'Reservations waiting', value: d.reservationsWaiting, icon: 'mdi-bookmark-multiple' },
  { label: 'Ready for pickup', value: d.reservationsReady, icon: 'mdi-bookmark-check' },
  {
    label: 'Pending fines',
    value: `${d.pendingFines} · ${money(d.pendingFineAmount)}`,
    icon: 'mdi-cash',
    color: 'warning',
  },
  { label: 'Issued today', value: d.issuedToday, icon: 'mdi-arrow-right-bold' },
  { label: 'Returned today', value: d.returnedToday, icon: 'mdi-arrow-left-bold' },
];
</script>
<template>
  <LibraryTabs title="Library">
    <template #actions>
      <v-select
        v-if="institutions.length > 1"
        v-model="institutionId"
        :items="[{ id: '', name: 'All libraries' }, ...institutions]"
        item-title="name"
        item-value="id"
        label="Library"
        density="compact"
        hide-details
        style="max-width: 320px"
      />
    </template>
  </LibraryTabs>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <template v-if="data">
    <v-row dense>
      <v-col v-for="t in tiles(data)" :key="t.label" cols="6" md="3" lg="2">
        <v-card variant="tonal" :color="t.color">
          <v-card-text>
            <div class="d-flex align-center">
              <v-icon :icon="t.icon" class="mr-2" />
              <span class="text-caption">{{ t.label }}</span>
            </div>
            <div class="text-h6 mt-1">{{ t.value }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-card class="mt-4">
      <v-card-title>Recent circulation</v-card-title>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Title</th>
            <th>Barcode</th>
            <th>Member</th>
            <th>Issued</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in data.recentLoans" :key="l.id">
            <td>{{ l.book?.title }}</td>
            <td>{{ l.copy?.barcode }}</td>
            <td>{{ l.memberName }}</td>
            <td>{{ fmtDate(l.issuedAt) }}</td>
            <td>{{ fmtDate(l.dueDate) }}</td>
            <td>
              <v-chip size="small" :color="l.overdue ? 'error' : undefined">{{
                l.overdue ? 'OVERDUE' : l.status
              }}</v-chip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </template>
</template>
