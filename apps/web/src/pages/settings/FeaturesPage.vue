<script setup lang="ts">
import type {
  ApiListResponse,
  EffectiveFeaturesDto,
  FeatureKey,
  FeatureStateDto,
  FeaturesOverviewDto,
} from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

interface InstitutionRow {
  id: string;
  name: string;
}

const auth = useAuthStore();
const overview = ref<FeaturesOverviewDto | null>(null);
const institutions = ref<InstitutionRow[]>([]);
/** null = organization level */
const institutionId = ref<string | null>(null);
const states = ref<FeatureStateDto[]>([]);
const error = ref<string | null>(null);
const saving = ref<FeatureKey | null>(null);
const canManage = computed(() => auth.can('feature.manage'));

async function load() {
  error.value = null;
  try {
    overview.value = (await apiFetch<{ data: FeaturesOverviewDto }>('/api/v1/features')).data;
    if (institutionId.value) {
      states.value = (
        await apiFetch<{ data: EffectiveFeaturesDto }>(
          `/api/v1/features/effective?institutionId=${institutionId.value}`,
        )
      ).data.features;
    } else {
      states.value = overview.value.features;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  institutions.value = (
    await apiFetch<ApiListResponse<InstitutionRow>>('/api/v1/institutions?pageSize=100')
  ).data;
  await load();
});
watch(institutionId, load);

/** Toggle = set an override at the selected level (cannot enable an unlicensed module). */
async function toggle(state: FeatureStateDto, enabled: boolean) {
  saving.value = state.key;
  try {
    await apiFetch('/api/v1/features/overrides', {
      method: 'PUT',
      body: JSON.stringify({
        scopeType: institutionId.value ? 'INSTITUTION' : 'ORGANIZATION',
        ...(institutionId.value ? { targetId: institutionId.value } : {}),
        featureKey: state.key,
        enabled,
      }),
    });
    await Promise.all([load(), auth.loadMe()]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = null;
  }
}

async function reset(state: FeatureStateDto) {
  const level = institutionId.value ? 'INSTITUTION' : 'ORGANIZATION';
  const override = overview.value?.overrides.find(
    (o) =>
      o.featureKey === state.key &&
      o.scopeType === level &&
      (level === 'ORGANIZATION' || o.targetId === institutionId.value),
  );
  if (!override) return;
  await apiFetch(`/api/v1/features/overrides/${override.id}`, { method: 'DELETE' });
  await Promise.all([load(), auth.loadMe()]);
}

const levelItems = computed(() => [
  { title: 'Organization (default for all institutions)', value: null },
  ...institutions.value.map((i) => ({ title: i.name, value: i.id })),
]);
</script>

<template>
  <h2 class="text-h5 mb-4">Modules</h2>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-select
    v-model="institutionId"
    :items="levelItems"
    label="Level"
    class="mb-4"
    style="max-width: 480px"
  />
  <v-table density="comfortable">
    <thead>
      <tr>
        <th>Module</th>
        <th>Licensed</th>
        <th>Enabled</th>
        <th>Source</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr v-for="s in states" :key="s.key">
        <td>
          <strong>{{ s.key }}</strong>
          <div class="text-caption">{{ s.description }}</div>
        </td>
        <td>
          <v-icon :color="s.licensed ? 'success' : 'grey'">
            {{ s.licensed ? 'mdi-check-circle' : 'mdi-lock' }}
          </v-icon>
        </td>
        <td>
          <v-switch
            :model-value="s.enabled"
            :disabled="!canManage || !s.licensed || saving === s.key"
            hide-details
            density="compact"
            color="primary"
            @update:model-value="(v) => toggle(s, Boolean(v))"
          />
        </td>
        <td>{{ s.source }}</td>
        <td>
          <v-btn
            v-if="canManage && s.source === (institutionId ? 'INSTITUTION' : 'ORGANIZATION')"
            size="small"
            variant="text"
            @click="reset(s)"
          >
            Inherit
          </v-btn>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>
