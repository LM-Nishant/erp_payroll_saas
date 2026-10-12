<script setup lang="ts">
import type { ApiListResponse, HostelAllocationDto } from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { money } from '@/pages/fees/fees';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ studentId: string; base: string }>();
const auth = useAuthStore();
const rows = ref<HostelAllocationDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const current = computed(() => rows.value.find((r) => r.status === 'ACTIVE') ?? null);

onMounted(async () => {
  loading.value = true;
  try {
    rows.value = (
      await apiFetch<ApiListResponse<HostelAllocationDto>>(
        `/api/v1/hostel/allocations?studentId=${props.studentId}&pageSize=100`,
      )
    ).data.sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div data-testid="student-hostel">
    <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate class="mb-2" />
    <v-card v-if="current" variant="tonal" color="primary" class="mb-3">
      <v-card-text>
        <div class="text-overline">Current allocation</div>
        <div class="text-h6">
          {{ current.hostel.name }} · Room {{ current.room.roomNo }} · Bed {{ current.bed.bedNo }}
        </div>
        <div>
          Floor {{ current.room.floor }} · since {{ current.fromDate }} · Rent ₹{{
            money(current.monthlyRent)
          }}/month<span v-if="current.messPlan">
            · Mess: {{ current.messPlan.name }} (₹{{ money(current.messPlan.monthlyFee) }})</span
          >
        </div>
      </v-card-text>
    </v-card>
    <v-alert v-else-if="!loading && !error" type="info" variant="tonal" class="mb-3">
      Not allocated to a hostel.
    </v-alert>
    <div class="d-flex mb-2">
      <h3 class="text-subtitle-1">History</h3>
      <v-spacer />
      <v-btn
        v-if="auth.can('hostel.allocate')"
        size="small"
        variant="tonal"
        prepend-icon="mdi-open-in-new"
        :to="`${base}/hostel/allocations`"
      >
        Manage allocations
      </v-btn>
    </div>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Hostel</th>
          <th>Room</th>
          <th>Bed</th>
          <th>From</th>
          <th>To</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.hostel.name }}</td>
          <td>{{ r.room.roomNo }}</td>
          <td>{{ r.bed.bedNo }}</td>
          <td>{{ r.fromDate }}</td>
          <td>{{ r.toDate || '—' }}</td>
          <td>{{ r.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="6" class="text-medium-emphasis">No hostel history.</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>
