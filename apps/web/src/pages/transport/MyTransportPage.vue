<script setup lang="ts">
import type { MyTransportDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';

const items = ref<MyTransportDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);
onMounted(async () => {
  try {
    items.value = (await apiFetch<{ data: MyTransportDto[] }>('/api/v1/transport/me')).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <h2 class="text-h5 mb-4">My transport</h2>
  <v-progress-linear v-if="loading" indeterminate />
  <v-alert v-else-if="error" type="error">{{ error }}</v-alert>
  <v-alert v-else-if="!items.length" type="info">No transport details found.</v-alert>
  <v-row v-else>
    <v-col
      v-for="t in items"
      :key="t.studentId ?? t.employeeId ?? t.passengerName"
      cols="12"
      lg="6"
    >
      <v-card>
        <v-card-title>{{ t.passengerName }}</v-card-title>
        <v-card-text v-if="!t.allocation">Not allocated to any transport route.</v-card-text>
        <template v-else>
          <v-card-subtitle>
            {{ t.route?.code }} · {{ t.route?.name }} — {{ t.allocation.tripType }}
          </v-card-subtitle>
          <v-card-text>
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-map-marker"
                :title="t.allocation.stop.name"
                :subtitle="`Pickup ${t.allocation.stop.pickupTime ?? '—'} · Drop ${
                  t.allocation.stop.dropTime ?? '—'
                }`"
              />
              <v-list-item
                v-if="t.vehicle"
                prepend-icon="mdi-bus"
                :title="t.vehicle.regNo"
                :subtitle="`${t.vehicle.vehicleType} · ${t.vehicle.capacity} seats`"
              />
              <v-list-item
                v-if="t.driver"
                prepend-icon="mdi-steering"
                :title="`Driver: ${t.driver.name}`"
                :subtitle="t.driver.phone ?? ''"
              />
              <v-list-item
                v-if="t.attendant"
                prepend-icon="mdi-account-tie"
                :title="`Attendant: ${t.attendant.name}`"
                :subtitle="t.attendant.phone ?? ''"
              />
              <v-list-item
                prepend-icon="mdi-currency-inr"
                :title="`Fare ${t.allocation.fareAmount}`"
                :subtitle="`Since ${t.allocation.effectiveFrom}`"
              />
            </v-list>
            <div class="text-subtitle-2 mt-2">Stops</div>
            <v-table density="compact">
              <tbody>
                <tr
                  v-for="s in t.route?.stops ?? []"
                  :key="s.sequence"
                  :class="{ 'font-weight-bold': s.name === t.allocation.stop.name }"
                >
                  <td>{{ s.sequence }}</td>
                  <td>{{ s.name }}</td>
                  <td>{{ s.pickupTime ?? '—' }}</td>
                  <td>{{ s.dropTime ?? '—' }}</td>
                </tr>
              </tbody>
            </v-table>
            <template v-if="t.latestTrips.length">
              <div class="text-subtitle-2 mt-2">Recent trips</div>
              <v-table density="compact">
                <tbody>
                  <tr v-for="(tr, i) in t.latestTrips" :key="i">
                    <td>{{ tr.tripDate }}</td>
                    <td>{{ tr.direction }}</td>
                    <td>{{ tr.status }}</td>
                    <td>{{ tr.delayMinutes ? `${tr.delayMinutes} min late` : '' }}</td>
                    <td>{{ tr.boarding ?? '' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </template>
          </v-card-text>
        </template>
      </v-card>
    </v-col>
  </v-row>
</template>
