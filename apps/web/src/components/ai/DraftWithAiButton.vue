<script setup lang="ts">
import type { AiDraftDto, AiDraftKind } from '@erp/shared';
import { AI_DRAFT_KINDS } from '@erp/shared';
import { computed, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/**
 * "Draft with AI" helper: asks the AI gateway for a subject + body and emits it to the parent
 * (communication template, HR letter…). Hidden unless the `ai` module is enabled and the user
 * holds `ai.use`.
 */
const props = withDefaults(
  defineProps<{
    kind?: AiDraftKind;
    variables?: Record<string, string | number>;
    label?: string;
  }>(),
  { kind: 'generic', variables: () => ({}), label: 'Draft with AI' },
);
const emit = defineEmits<{ drafted: [draft: { subject: string; body: string }] }>();

const auth = useAuthStore();
const visible = computed(() => auth.hasFeature('ai') && auth.can('ai.use'));
const dialog = ref(false);
const kind = ref<AiDraftKind>(props.kind);
const tone = ref<'formal' | 'friendly' | 'neutral'>('formal');
const instructions = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const kinds = AI_DRAFT_KINDS.map((k) => ({ value: k, title: k.replace(/_/g, ' ') }));

function start() {
  kind.value = props.kind;
  error.value = null;
  dialog.value = true;
}

async function generate() {
  loading.value = true;
  error.value = null;
  try {
    const variables = Object.fromEntries(
      Object.entries(props.variables).filter(([, v]) => v !== '' && v !== null && v !== undefined),
    );
    const draft = (
      await apiFetch<{ data: AiDraftDto }>('/api/v1/ai/drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: kind.value,
          tone: tone.value,
          instructions: instructions.value,
          ...(Object.keys(variables).length ? { variables } : {}),
        }),
      })
    ).data;
    emit('drafted', { subject: draft.subject, body: draft.body });
    dialog.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <template v-if="visible">
    <v-btn
      variant="tonal"
      color="secondary"
      size="small"
      prepend-icon="mdi-robot-outline"
      @click="start"
    >
      {{ label }}
    </v-btn>
    <v-dialog v-model="dialog" max-width="560">
      <v-card title="Draft with AI">
        <v-card-text>
          <v-alert v-if="error" type="error" density="compact" class="mb-2">{{ error }}</v-alert>
          <v-select v-model="kind" :items="kinds" label="Document type" />
          <v-select v-model="tone" :items="['formal', 'friendly', 'neutral']" label="Tone" />
          <v-textarea
            v-model="instructions"
            label="What should it say?"
            placeholder="e.g. Announce that school will be closed on Friday for Diwali"
            rows="3"
            auto-grow
          />
          <div class="text-caption text-medium-emphasis">
            Review the draft before using it — AI output can be wrong. Missing facts are left as
            placeholders in double braces.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="loading"
            :disabled="!instructions.trim()"
            @click="generate"
          >
            Generate
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>
</template>
