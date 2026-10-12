<script setup lang="ts">
import type { ApiListResponse, TransportAllocationDto } from '@erp/shared';
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { money } from '@/pages/fees/fees';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ studentId: string; base: string }>();
const auth = useAuthStore();
const rows = ref<TransportAllocationDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const current = computed(() => rows.value.find((r) => r.status === 'ACTIVE') ?? null);

onMounted(async () => {
  loading.value = true;
  try {
    rows.value = (
      await apiFetch<ApiListResponse<TransportAllocationDto>>(
        `/api/v1/transport/allocations?studentId=${props.studentId}&pageSize=100`,
      )
    ).data.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div data-testid="student-transport">
    <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate class="mb-2" />
    <v-card v-if="current" variant="tonal" color="primary" class="mb-3">
      <v-card-text>
        <div class="text-overline">Current route</div>
        <div class="text-h6">
          {{ current.route.name }} ({{ current.route.code }}) · {{ current.stop.name }}
        </div>
        <div>
          Vehicle {{ current.vehicle?.regNo ?? 'not assigned' }} · {{ current.tripType }}
          <span v-if="current.stop.pickupTime"> · Pickup {{ current.stop.pickupTime }}</span>
          <span v-if="current.stop.dropTime"> · Drop {{ current.stop.dropTime }}</span>
          · since {{ current.effectiveFrom }} · Fare ₹{{ money(current.fareAmount) }}
        </div>
      </v-card-text>
    </v-card>
    <v-alert v-else-if="!loading && !error" type="info" variant="tonal" class="mb-3">
      Not using school transport.
    </v-alert>
    <div class="d-flex mb-2">
      <h3 class="text-subtitle-1">History</h3>
      <v-spacer />
      <v-btn
        v-if="auth.can('transport.allocate')"
        size="small"
        variant="tonal"
        prepend-icon="mdi-open-in-new"
        :to="`${base}/transport/allocations`"
      >
        Manage allocations
      </v-btn>
    </div>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Route</th>
          <th>Stop</th>
          <th>Vehicle</th>
          <th>Trip</th>
          <th>From</th>
          <th>To</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.route.name }}</td>
          <td>{{ r.stop.name }}</td>
          <td>{{ r.vehicle?.regNo ?? '—' }}</td>
          <td>{{ r.tripType }}</td>
          <td>{{ r.effectiveFrom }}</td>
          <td>{{ r.effectiveTo || '—' }}</td>
          <td>{{ r.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="7" class="text-medium-emphasis">No transport history.</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>
