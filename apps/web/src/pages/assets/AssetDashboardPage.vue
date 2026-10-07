<script setup lang="ts">
import type { AssetDashboardDto } from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { ASSET_STATUS_COLORS, label, money, useAssetOptions } from './assetUi';

const { institutions, loadBase } = useAssetOptions();
const institutionId = ref<string | null>(null);
const data = ref<AssetDashboardDto | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const q = institutionId.value ? `?institutionId=${institutionId.value}` : '';
    data.value = (await apiFetch<{ data: AssetDashboardDto }>(`/api/v1/assets/dashboard${q}`)).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

const alerts = computed(() =>
  data.value
    ? [
        {
          title: 'Warranty expiring (30d)',
          value: data.value.warrantyExpiring,
          to: '/assets/maintenance',
          icon: 'mdi-shield-alert',
        },
        {
          title: 'AMC expiring (30d)',
          value: data.value.amcExpiring,
          to: '/assets/maintenance',
          icon: 'mdi-file-sign',
        },
        {
          title: 'Service due (7d)',
          value: data.value.serviceDue,
          to: '/assets/maintenance',
          icon: 'mdi-calendar-clock',
        },
        {
          title: 'Open tickets',
          value: data.value.openMaintenance,
          to: '/assets/maintenance',
          icon: 'mdi-wrench',
        },
        {
          title: 'Unacknowledged handovers',
          value: data.value.pendingAcknowledgements,
          to: '/assets/assignments',
          icon: 'mdi-account-clock',
        },
        {
          title: 'Pending transfers',
          value: data.value.pendingTransfers,
          to: '/assets/assignments',
          icon: 'mdi-swap-horizontal',
        },
        {
          title: 'Pending disposals',
          value: data.value.pendingDisposals,
          to: '/assets/disposal',
          icon: 'mdi-delete-clock',
        },
        {
          title: 'Low stock items',
          value: data.value.lowStockItems,
          to: '/assets/inventory',
          icon: 'mdi-alert',
        },
      ]
    : [],
);

onMounted(async () => {
  await Promise.all([loadBase(), load()]);
});
watch(institutionId, load);
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Asset dashboard</h2>
    <v-spacer />
    <v-autocomplete
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      density="compact"
      clearable
      hide-details
      style="max-width: 320px"
    />
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-progress-linear v-if="loading" indeterminate class="mb-2" />
  <template v-if="data">
    <v-row dense>
      <v-col cols="12" md="4">
        <v-card variant="tonal" color="primary"
          ><v-card-text
            ><div class="text-caption">Assets</div>
            <div class="text-h4">{{ data.totals.count }}</div></v-card-text
          ></v-card
        >
      </v-col>
      <v-col cols="12" md="4">
        <v-card variant="tonal"
          ><v-card-text
            ><div class="text-caption">Purchase cost</div>
            <div class="text-h5">{{ money(data.totals.cost) }}</div></v-card-text
          ></v-card
        >
      </v-col>
      <v-col cols="12" md="4">
        <v-card variant="tonal" color="success"
          ><v-card-text
            ><div class="text-caption">Book value (today)</div>
            <div class="text-h5">{{ money(data.totals.bookValue) }}</div></v-card-text
          ></v-card
        >
      </v-col>
    </v-row>
    <v-row dense class="mt-2">
      <v-col v-for="(count, status) in data.byStatus" :key="status" cols="6" md="2">
        <v-card :to="`/assets/register?status=${status}`">
          <v-card-text class="text-center">
            <v-chip :color="ASSET_STATUS_COLORS[status]" size="small">{{ label(status) }}</v-chip>
            <div class="text-h5 mt-2">{{ count }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-row dense class="mt-2">
      <v-col v-for="a in alerts" :key="a.title" cols="6" md="3">
        <v-card :to="a.to">
          <v-card-text class="d-flex align-center">
            <v-icon :icon="a.icon" :color="a.value ? 'warning' : 'grey'" class="mr-3" />
            <div>
              <div class="text-caption">{{ a.title }}</div>
              <div class="text-h6">{{ a.value }}</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-card class="mt-4">
      <v-card-title>By category</v-card-title>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Category</th>
            <th>Kind</th>
            <th class="text-right">Assets</th>
            <th class="text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in data.byCategory" :key="c.categoryId">
            <td>{{ c.name }}</td>
            <td>{{ label(c.kind) }}</td>
            <td class="text-right">{{ c.count }}</td>
            <td class="text-right">{{ money(c.cost) }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </template>
</template>
