<script setup lang="ts">
import {
  MESSAGE_CHANNELS,
  PROVIDER_TYPES,
  type ApiListResponse,
  type CommunicationProviderCreatedDto,
  type CommunicationProviderDto,
  type MessageChannel,
  type MessageLogDto,
  type MessageTemplateDto,
  type RenderedMessageDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import DraftWithAiButton from '@/components/ai/DraftWithAiButton.vue';
import { useAuthStore } from '@/stores/auth';

/**
 * Communication settings: delivery providers (credentials are write-only → stored as secrets),
 * message templates (versioned, branded email layout) and the message log.
 */
const auth = useAuthStore();
const canManage = computed(() => auth.can('communication.manage'));
const tab = ref<'providers' | 'templates' | 'logs'>('providers');
const error = ref<string | null>(null);

/* ---------------------------- providers ---------------------------- */
const providers = ref<CommunicationProviderDto[]>([]);
const providerDialog = ref(false);
const createdSecret = ref<string | null>(null);
const pForm = reactive({
  channel: 'email' as MessageChannel,
  providerType: 'smtp',
  name: '',
  priority: 100,
  config: '{}',
  credentials: '',
});
const providerTypes = computed(() => PROVIDER_TYPES[pForm.channel] as readonly string[]);
watch(
  () => pForm.channel,
  () => (pForm.providerType = providerTypes.value[0] ?? 'log'),
);

async function loadProviders() {
  providers.value = (
    await apiFetch<ApiListResponse<CommunicationProviderDto>>(
      '/api/v1/communication/providers?pageSize=100',
    )
  ).data;
}
async function createProvider() {
  error.value = null;
  try {
    const res = await apiFetch<{ data: CommunicationProviderCreatedDto }>(
      '/api/v1/communication/providers',
      {
        method: 'POST',
        body: JSON.stringify({
          channel: pForm.channel,
          providerType: pForm.providerType,
          name: pForm.name,
          priority: pForm.priority,
          config: JSON.parse(pForm.config || '{}') as Record<string, unknown>,
          ...(pForm.credentials ? { credentials: pForm.credentials } : {}),
        }),
      },
    );
    createdSecret.value = res.data.webhookSigningSecret;
    providerDialog.value = false;
    await loadProviders();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    pForm.credentials = '';
  }
}
async function toggleProvider(p: CommunicationProviderDto) {
  await apiFetch(`/api/v1/communication/providers/${p.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: !p.isActive }),
  });
  await loadProviders();
}
async function removeProvider(p: CommunicationProviderDto) {
  if (!confirm(`Delete provider ${p.name}?`)) return;
  await apiFetch(`/api/v1/communication/providers/${p.id}`, { method: 'DELETE' });
  await loadProviders();
}

/* ---------------------------- templates ---------------------------- */
const templates = ref<MessageTemplateDto[]>([]);
const templateDialog = ref(false);
const editing = ref<MessageTemplateDto | null>(null);
const tForm = reactive({
  key: '',
  channel: 'email' as MessageChannel,
  name: '',
  subject: '',
  body: '',
  htmlBody: '',
  sample: '{}',
});
const preview = ref<RenderedMessageDto | null>(null);

async function loadTemplates() {
  templates.value = (
    await apiFetch<ApiListResponse<MessageTemplateDto>>(
      '/api/v1/communication/templates?pageSize=100',
    )
  ).data;
}
function openTemplate(t: MessageTemplateDto | null) {
  editing.value = t;
  preview.value = null;
  Object.assign(tForm, {
    key: t?.key ?? '',
    channel: t?.channel ?? 'email',
    name: t?.name ?? '',
    subject: t?.currentVersion?.subject ?? '',
    body: t?.currentVersion?.body ?? '',
    htmlBody: t?.currentVersion?.htmlBody ?? '',
    sample: '{}',
  });
  templateDialog.value = true;
}
function onTemplateRow(_e: unknown, row: { item: MessageTemplateDto }) {
  openTemplate(row.item);
}
const content = () => ({
  subject: tForm.subject || null,
  body: tForm.body,
  htmlBody: tForm.htmlBody || null,
});
async function saveTemplate() {
  error.value = null;
  try {
    if (editing.value) {
      await apiFetch(`/api/v1/communication/templates/${editing.value.id}/versions`, {
        method: 'POST',
        body: JSON.stringify(content()),
      });
    } else {
      await apiFetch('/api/v1/communication/templates', {
        method: 'POST',
        body: JSON.stringify({
          key: tForm.key,
          channel: tForm.channel,
          name: tForm.name,
          ...content(),
        }),
      });
    }
    templateDialog.value = false;
    await loadTemplates();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function previewTemplate() {
  if (!editing.value) return;
  error.value = null;
  try {
    preview.value = (
      await apiFetch<{ data: RenderedMessageDto }>(
        `/api/v1/communication/templates/${editing.value.id}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({
            variables: JSON.parse(tForm.sample || '{}') as Record<string, unknown>,
          }),
        },
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/* ------------------------------ logs ------------------------------- */
const logs = ref<MessageLogDto[]>([]);
const logTotal = ref(0);
async function loadLogs() {
  const res = await apiFetch<ApiListResponse<MessageLogDto>>(
    '/api/v1/communication/messages?pageSize=100',
  );
  logs.value = res.data;
  logTotal.value = res.meta.total;
}

onMounted(async () => {
  try {
    await Promise.all([loadProviders(), loadTemplates(), loadLogs()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const statusColor: Record<string, string> = {
  QUEUED: 'grey',
  SENT: 'info',
  DELIVERED: 'success',
  FAILED: 'error',
  BOUNCED: 'error',
};
</script>

<template>
  <h2 class="text-h5 mb-4">Communication</h2>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-alert
    v-if="createdSecret"
    type="success"
    class="mb-4"
    closable
    @click:close="createdSecret = null"
  >
    Delivery-callback signing secret (shown once):
    <code>{{ createdSecret }}</code>
  </v-alert>
  <v-tabs v-model="tab" class="mb-4">
    <v-tab value="providers">Providers</v-tab>
    <v-tab value="templates">Templates</v-tab>
    <v-tab value="logs">Message log</v-tab>
  </v-tabs>

  <template v-if="tab === 'providers'">
    <div class="d-flex mb-2">
      <v-spacer />
      <v-btn
        v-if="canManage"
        color="primary"
        prepend-icon="mdi-plus"
        @click="providerDialog = true"
      >
        Add provider
      </v-btn>
    </div>
    <v-data-table
      :items="providers"
      :headers="[
        { title: 'Name', key: 'name' },
        { title: 'Channel', key: 'channel' },
        { title: 'Type', key: 'providerType' },
        { title: 'Priority', key: 'priority' },
        { title: 'Scope', key: 'scopeType' },
        { title: 'Credentials', key: 'hasCredentials' },
        { title: 'Active', key: 'isActive' },
        { title: '', key: 'actions', sortable: false },
      ]"
    >
      <template #[`item.hasCredentials`]="{ item }">{{
        item.hasCredentials ? '••••' : '—'
      }}</template>
      <template #[`item.isActive`]="{ item }">
        <v-switch
          :model-value="item.isActive"
          :disabled="!canManage"
          hide-details
          density="compact"
          @update:model-value="toggleProvider(item)"
        />
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          v-if="canManage"
          size="small"
          variant="text"
          icon="mdi-delete"
          title="Delete"
          @click="removeProvider(item)"
        />
      </template>
    </v-data-table>
  </template>

  <template v-else-if="tab === 'templates'">
    <div class="d-flex mb-2">
      <v-spacer />
      <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openTemplate(null)">
        New template
      </v-btn>
    </div>
    <v-data-table
      :items="templates"
      :headers="[
        { title: 'Key', key: 'key' },
        { title: 'Name', key: 'name' },
        { title: 'Channel', key: 'channel' },
        { title: 'Version', key: 'currentVersion.version' },
        { title: 'Scope', key: 'scopeType' },
      ]"
      hover
      @click:row="onTemplateRow"
    />
  </template>

  <template v-else>
    <v-data-table
      :items="logs"
      :items-length="logTotal"
      :headers="[
        { title: 'When', key: 'createdAt' },
        { title: 'Channel', key: 'channel' },
        { title: 'To', key: 'recipientAddress' },
        { title: 'Subject', key: 'subject' },
        { title: 'Template', key: 'templateKey' },
        { title: 'Provider', key: 'providerType' },
        { title: 'Status', key: 'status' },
        { title: 'Error', key: 'lastError' },
      ]"
    >
      <template #[`item.createdAt`]="{ item }">{{
        new Date(item.createdAt).toLocaleString()
      }}</template>
      <template #[`item.status`]="{ item }">
        <v-chip size="small" :color="statusColor[item.status]">{{ item.status }}</v-chip>
      </template>
    </v-data-table>
  </template>

  <v-dialog v-model="providerDialog" max-width="560">
    <v-card title="Add provider">
      <v-card-text>
        <v-select v-model="pForm.channel" :items="[...MESSAGE_CHANNELS]" label="Channel" />
        <v-select v-model="pForm.providerType" :items="[...providerTypes]" label="Provider" />
        <v-text-field v-model="pForm.name" label="Name" />
        <v-text-field
          v-model.number="pForm.priority"
          type="number"
          label="Priority (lower first)"
        />
        <v-textarea
          v-model="pForm.config"
          label="Config (JSON, e.g. host/port/from)"
          rows="3"
          auto-grow
        />
        <v-text-field
          v-model="pForm.credentials"
          label="Credentials (password / API key — write-only)"
          type="password"
          autocomplete="new-password"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="providerDialog = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!pForm.name" @click="createProvider">
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="templateDialog" max-width="820">
    <v-card :title="editing ? `${editing.key} — new version` : 'New template'">
      <v-card-text>
        <template v-if="!editing">
          <v-text-field v-model="tForm.key" label="Key (e.g. auth.invite)" />
          <v-select v-model="tForm.channel" :items="[...MESSAGE_CHANNELS]" label="Channel" />
          <v-text-field v-model="tForm.name" label="Name" />
        </template>
        <div class="mb-2">
          <DraftWithAiButton
            kind="circular"
            @drafted="
              (d) => {
                tForm.subject = d.subject;
                tForm.body = d.body;
              }
            "
          />
        </div>
        <v-text-field v-if="tForm.channel === 'email'" v-model="tForm.subject" label="Subject" />
        <v-textarea v-model="tForm.body" label="Text body ({{variable}})" rows="4" auto-grow />
        <v-textarea
          v-if="tForm.channel === 'email'"
          v-model="tForm.htmlBody"
          label="HTML body (wrapped in the branded layout)"
          rows="4"
          auto-grow
        />
        <v-textarea
          v-if="editing"
          v-model="tForm.sample"
          label="Sample variables (JSON)"
          rows="2"
          auto-grow
        />
        <v-card v-if="preview" variant="outlined" class="pa-3">
          <div v-if="preview.subject">
            <strong>{{ preview.subject }}</strong>
          </div>
          <pre class="text-body-2" style="white-space: pre-wrap">{{ preview.text }}</pre>
        </v-card>
      </v-card-text>
      <v-card-actions>
        <v-btn v-if="editing" @click="previewTemplate">Preview current version</v-btn>
        <v-spacer />
        <v-btn @click="templateDialog = false">Close</v-btn>
        <v-btn
          v-if="canManage"
          color="primary"
          variant="flat"
          :disabled="!tForm.body"
          @click="saveTemplate"
        >
          {{ editing ? 'Publish version' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
