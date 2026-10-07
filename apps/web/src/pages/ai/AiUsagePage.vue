<script setup lang="ts">
import type { AiUsageDashboardDto, AiUsageLogDto, ApiListResponse } from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';

const dash = ref<AiUsageDashboardDto | null>(null);
const logs = ref<AiUsageLogDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<'OK' | 'ERROR' | 'LIMITED' | null>(null);

const limitPercent = computed(() => {
  const t = dash.value?.tokens;
  if (!t || t.limit === null || t.limit === 0) return null;
  return Math.min(100, Math.round((t.used / t.limit) * 100));
});
const maxDayTokens = computed(() =>
  Math.max(1, ...(dash.value?.byDay ?? []).map((d) => d.totalTokens)),
);

async function loadDashboard() {
  try {
    dash.value = (await apiFetch<{ data: AiUsageDashboardDto }>('/api/v1/ai/usage')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function loadLogs() {
  loading.value = true;
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) });
    if (status.value) q.set('status', status.value);
    const res = await apiFetch<ApiListResponse<AiUsageLogDto>>(`/api/v1/ai/usage/logs?${q}`);
    logs.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => Promise.all([loadDashboard(), loadLogs()]));
watch([page, pageSize, status], loadLogs);

const headers = [
  { title: 'When', key: 'createdAt' },
  { title: 'User', key: 'userName' },
  { title: 'Feature', key: 'feature' },
  { title: 'Model', key: 'model' },
  { title: 'Tokens', key: 'totalTokens', align: 'end' as const },
  { title: 'Latency', key: 'latencyMs', align: 'end' as const },
  { title: 'Status', key: 'status' },
  { title: 'Prompt (redacted)', key: 'promptPreview' },
];
const statusColor = (s: string) => (s === 'OK' ? 'success' : s === 'LIMITED' ? 'warning' : 'error');
</script>

<template>
  <h1 class="text-h5 mb-4">AI usage</h1>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>

  <template v-if="dash">
    <v-row>
      <v-col cols="12" sm="6" md="3">
        <v-card>
          <v-card-text>
            <div class="text-caption">Tokens this period (plan limit)</div>
            <div class="text-h6">
              {{ dash.tokens.used.toLocaleString() }} /
              {{ dash.tokens.limit === null ? '∞' : dash.tokens.limit.toLocaleString() }}
            </div>
            <v-progress-linear
              v-if="limitPercent !== null"
              :model-value="limitPercent"
              :color="limitPercent > 85 ? 'error' : 'primary'"
            />
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card>
          <v-card-text>
            <div class="text-caption">Requests ({{ dash.from }} → {{ dash.to }})</div>
            <div class="text-h6">{{ dash.totals.requests }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card>
          <v-card-text>
            <div class="text-caption">Tokens in range</div>
            <div class="text-h6">{{ dash.totals.totalTokens.toLocaleString() }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card>
          <v-card-text>
            <div class="text-caption">Errors · avg latency</div>
            <div class="text-h6">{{ dash.totals.errors }} · {{ dash.totals.avgLatencyMs }} ms</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="4">
        <v-card title="By feature">
          <v-table density="compact">
            <tbody>
              <tr v-for="f in dash.byFeature" :key="f.feature">
                <td>{{ f.feature }}</td>
                <td class="text-right">{{ f.requests }} req</td>
                <td class="text-right">{{ f.totalTokens.toLocaleString() }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card title="By user">
          <v-table density="compact">
            <tbody>
              <tr v-for="u in dash.byUser" :key="u.userId ?? 'system'">
                <td>{{ u.userName ?? 'System' }}</td>
                <td class="text-right">{{ u.requests }} req</td>
                <td class="text-right">{{ u.totalTokens.toLocaleString() }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card title="By day">
          <v-card-text>
            <div v-for="d in dash.byDay" :key="d.date" class="d-flex align-center mb-1">
              <span class="text-caption" style="width: 90px">{{ d.date }}</span>
              <v-progress-linear
                :model-value="(d.totalTokens / maxDayTokens) * 100"
                height="10"
                class="mx-2"
              />
              <span class="text-caption">{{ d.totalTokens }}</span>
            </div>
            <div v-if="!dash.byDay.length" class="text-medium-emphasis">No usage yet.</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </template>

  <v-card class="mt-4">
    <v-card-title class="d-flex align-center">
      Request log
      <v-spacer />
      <v-select
        v-model="status"
        :items="['OK', 'ERROR', 'LIMITED']"
        label="Status"
        clearable
        density="compact"
        hide-details
        style="max-width: 180px"
      />
    </v-card-title>
    <v-data-table-server
      v-model:page="page"
      v-model:items-per-page="pageSize"
      :headers="headers"
      :items="logs"
      :items-length="total"
      :loading="loading"
      density="compact"
    >
      <template #[`item.createdAt`]="{ item }">
        {{ new Date(item.createdAt).toLocaleString() }}
      </template>
      <template #[`item.userName`]="{ item }">{{ item.userName ?? 'System' }}</template>
      <template #[`item.latencyMs`]="{ item }">{{ item.latencyMs }} ms</template>
      <template #[`item.status`]="{ item }">
        <v-chip size="x-small" :color="statusColor(item.status)">{{ item.status }}</v-chip>
      </template>
      <template #[`item.promptPreview`]="{ item }">
        <span class="text-caption">{{ item.promptPreview }}</span>
      </template>
    </v-data-table-server>
  </v-card>
</template>
