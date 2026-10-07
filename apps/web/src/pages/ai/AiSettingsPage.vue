<script setup lang="ts">
import type { AiFeature, AiSettingsDto, AiStatusDto } from '@erp/shared';
import { AI_FEATURES, AI_PROVIDERS } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/**
 * Org-wide AI settings. Credentials are NOT entered here: an OpenAI / Azure OpenAI /
 * OpenAI-compatible key is stored on the Secrets page as kind `ai.openai`.
 */
const auth = useAuthStore();
const canManage = computed(() => auth.can('ai.manage'));
const status = ref<AiStatusDto | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const saved = ref(false);
const form = reactive<Omit<AiSettingsDto, 'updatedAt'>>({
  enabled: true,
  provider: 'mock',
  defaultModel: 'gpt-4o-mini',
  maxTokensPerRequest: 1024,
  temperature: 0.2,
  enabledFeatures: [...AI_FEATURES],
  dataSharing: false,
});
const updatedAt = ref<string | null>(null);

const FEATURE_LABELS: Record<AiFeature, string> = {
  assistant: 'Ask ERP assistant',
  drafting: 'Document & letter drafting',
  payroll_anomaly: 'Payroll anomaly explanation',
  student_insight: 'Student at-risk insights',
  summarizer: 'Resume / JD summarizer',
};
const features = AI_FEATURES.map((f) => ({ value: f, title: FEATURE_LABELS[f] }));

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [s, st] = await Promise.all([
      apiFetch<{ data: AiSettingsDto }>('/api/v1/ai/settings'),
      apiFetch<{ data: AiStatusDto }>('/api/v1/ai/status'),
    ]);
    const { updatedAt: u, ...rest } = s.data;
    Object.assign(form, rest);
    updatedAt.value = u;
    status.value = st.data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function save() {
  saving.value = true;
  error.value = null;
  saved.value = false;
  try {
    await apiFetch('/api/v1/ai/settings', { method: 'PUT', body: JSON.stringify(form) });
    saved.value = true;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <h1 class="text-h5 mb-4">AI settings</h1>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-alert v-if="saved" type="success" class="mb-4" closable>Settings saved.</v-alert>

  <v-row>
    <v-col cols="12" md="7">
      <v-card :loading="loading">
        <v-card-text>
          <v-switch
            v-model="form.enabled"
            :disabled="!canManage"
            label="AI enabled for this organization"
            color="primary"
          />
          <v-select
            v-model="form.provider"
            :items="AI_PROVIDERS"
            :disabled="!canManage"
            label="Provider"
            hint="mock = deterministic demo answers, no data leaves the server"
            persistent-hint
          />
          <v-text-field
            v-model="form.defaultModel"
            :disabled="!canManage"
            label="Default model"
            hint="e.g. gpt-4o-mini; the ai.openai secret metadata can override it"
            persistent-hint
            class="mt-2"
          />
          <v-row class="mt-2">
            <v-col>
              <v-text-field
                v-model.number="form.maxTokensPerRequest"
                type="number"
                :disabled="!canManage"
                label="Max tokens per request"
              />
            </v-col>
            <v-col>
              <v-text-field
                v-model.number="form.temperature"
                type="number"
                step="0.1"
                :disabled="!canManage"
                label="Temperature"
              />
            </v-col>
          </v-row>
          <v-select
            v-model="form.enabledFeatures"
            :items="features"
            :disabled="!canManage"
            label="Enabled AI features"
            multiple
            chips
          />
          <v-switch
            v-model="form.dataSharing"
            :disabled="!canManage"
            color="warning"
            label="Allow sending organization data to the external provider"
            hint="When off, the external provider is never called (the mock provider answers)."
            persistent-hint
          />
        </v-card-text>
        <v-card-actions v-if="canManage">
          <span v-if="updatedAt" class="text-caption text-medium-emphasis ml-2">
            Last updated {{ new Date(updatedAt).toLocaleString() }}
          </span>
          <v-spacer />
          <v-btn color="primary" variant="flat" :loading="saving" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
    <v-col cols="12" md="5">
      <v-card title="Status" class="mb-4">
        <v-list v-if="status" density="compact">
          <v-list-item title="Provider in use" :subtitle="status.effectiveProvider" />
          <v-list-item title="Model" :subtitle="status.model" />
          <v-list-item
            title="ai.openai secret"
            :subtitle="status.secretConfigured ? 'configured' : 'not configured'"
          />
          <v-list-item
            title="Tokens this period"
            :subtitle="`${status.tokens.used.toLocaleString()} / ${
              status.tokens.limit === null ? 'unlimited' : status.tokens.limit.toLocaleString()
            }`"
          />
        </v-list>
      </v-card>
      <v-card title="Use a real OpenAI key">
        <v-card-text>
          <ol class="ml-4">
            <li>
              Open
              <router-link :to="{ name: 'group-secrets' }">Secrets</router-link>
              and add a secret of kind <code>ai.openai</code> with your API key as the value.
            </li>
            <li>
              Optional metadata JSON: <code>{"model": "gpt-4o-mini"}</code>. For Azure OpenAI or
              another OpenAI-compatible endpoint add <code>"baseUrl"</code> (and
              <code>"apiVersion"</code> for Azure).
            </li>
            <li>
              Here, set provider to <code>openai</code> and turn on data sharing. Prompts are PII
              redacted in usage logs and every call consumes the plan's <code>ai_tokens</code>.
            </li>
          </ol>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
