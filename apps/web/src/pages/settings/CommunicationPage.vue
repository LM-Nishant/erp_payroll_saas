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
  PROVIDER_FORMS,
  type ProviderTestResultDto,
  type ProviderType,
  type RenderedMessageDto,
  type SettingScopeType,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
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
interface Named {
  id: string;
  name: string;
}

/* ---------------------------- providers ---------------------------- */
const route = useRoute();
const providers = ref<CommunicationProviderDto[]>([]);
const providerDialog = ref(false);
const createdSecret = ref<string | null>(null);
const editingProvider = ref<CommunicationProviderDto | null>(null);
const groups = ref<Named[]>([]);
const institutions = ref<Named[]>([]);
const SCOPE_LABEL: Record<SettingScopeType, string> = {
  ORGANIZATION: 'Organization (default for all)',
  GROUP: 'Group',
  INSTITUTION: 'Institution (own sender)',
};
const pForm = reactive({
  scopeType: 'INSTITUTION' as SettingScopeType,
  targetId: '' as string,
  channel: 'email' as MessageChannel,
  providerType: 'smtp' as ProviderType,
  name: '',
  priority: 100,
  config: {} as Record<string, string | number | boolean>,
  extra: {} as Record<string, string | number | boolean>,
  credentials: '',
});
const providerTypes = computed(() => PROVIDER_TYPES[pForm.channel] as readonly ProviderType[]);
const providerForm = computed(() => PROVIDER_FORMS[pForm.providerType]);
const scopeTargets = computed(() =>
  pForm.scopeType === 'GROUP'
    ? groups.value
    : pForm.scopeType === 'INSTITUTION'
      ? institutions.value
      : [],
);
const missingRequired = computed(
  () =>
    !pForm.name ||
    (pForm.scopeType !== 'ORGANIZATION' && !pForm.targetId) ||
    providerForm.value.fields.some(
      (f) => f.required && (pForm.config[f.key] === undefined || pForm.config[f.key] === ''),
    ) ||
    (!editingProvider.value && !!providerForm.value.credentialsRequired && !pForm.credentials),
);
watch(
  () => pForm.channel,
  () => {
    if (editingProvider.value) return;
    pForm.providerType = providerTypes.value[0] ?? 'log';
  },
);
watch(
  () => pForm.providerType,
  () => {
    if (!editingProvider.value) pForm.config = {};
  },
);
const nameOf = (scope: SettingScopeType, id: string) =>
  scope === 'ORGANIZATION'
    ? 'Organization'
    : ((scope === 'GROUP' ? groups.value : institutions.value).find((x) => x.id === id)?.name ??
      scope);

async function loadProviders() {
  providers.value = (
    await apiFetch<ApiListResponse<CommunicationProviderDto>>(
      '/api/v1/communication/providers?pageSize=100',
    )
  ).data;
}
function openProvider(p: CommunicationProviderDto | null) {
  editingProvider.value = p;
  const fields = PROVIDER_FORMS[p?.providerType ?? 'log'].fields.map((f) => f.key);
  const cfg = { ...(p?.config ?? {}) };
  Object.assign(pForm, {
    scopeType:
      p?.scopeType ??
      (route.path.startsWith('/institution') && institutions.value.length
        ? 'INSTITUTION'
        : 'ORGANIZATION'),
    targetId: p?.targetId ?? (institutions.value.length === 1 ? institutions.value[0]!.id : ''),
    channel: p?.channel ?? 'email',
    providerType: p?.providerType ?? 'smtp',
    name: p?.name ?? '',
    priority: p?.priority ?? 100,
    config: Object.fromEntries(Object.entries(cfg).filter(([k]) => fields.includes(k))),
    extra: Object.fromEntries(Object.entries(cfg).filter(([k]) => !fields.includes(k))),
    credentials: '',
  });
  providerDialog.value = true;
}
function configBody() {
  const out: Record<string, string | number | boolean> = { ...pForm.extra };
  for (const f of providerForm.value.fields) {
    const v = pForm.config[f.key];
    if (v === undefined || v === '' || v === null) continue;
    out[f.key] = f.type === 'number' ? Number(v) : f.type === 'boolean' ? !!v : v;
  }
  return out;
}
async function saveProvider() {
  error.value = null;
  try {
    if (editingProvider.value) {
      await apiFetch(`/api/v1/communication/providers/${editingProvider.value.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: pForm.name,
          priority: pForm.priority,
          config: configBody(),
          ...(pForm.credentials ? { credentials: pForm.credentials } : {}),
        }),
      });
    } else {
      const res = await apiFetch<{ data: CommunicationProviderCreatedDto }>(
        '/api/v1/communication/providers',
        {
          method: 'POST',
          body: JSON.stringify({
            scopeType: pForm.scopeType,
            ...(pForm.scopeType !== 'ORGANIZATION' ? { targetId: pForm.targetId } : {}),
            channel: pForm.channel,
            providerType: pForm.providerType,
            name: pForm.name,
            priority: pForm.priority,
            config: configBody(),
            ...(pForm.credentials ? { credentials: pForm.credentials } : {}),
          }),
        },
      );
      createdSecret.value = res.data.webhookSigningSecret;
    }
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

const testDialog = reactive({
  open: false,
  provider: null as CommunicationProviderDto | null,
  to: '',
  busy: false,
  result: null as ProviderTestResultDto | null,
  error: null as string | null,
});
function openTest(p: CommunicationProviderDto) {
  Object.assign(testDialog, {
    open: true,
    provider: p,
    to: p.channel === 'email' ? (auth.me?.user.email ?? '') : '',
    busy: false,
    result: null,
    error: null,
  });
}
async function sendTest() {
  if (!testDialog.provider) return;
  testDialog.busy = true;
  testDialog.error = null;
  testDialog.result = null;
  try {
    testDialog.result = (
      await apiFetch<{ data: ProviderTestResultDto }>(
        `/api/v1/communication/providers/${testDialog.provider.id}/test`,
        { method: 'POST', body: JSON.stringify({ to: testDialog.to }) },
      )
    ).data;
    await loadLogs();
  } catch (e) {
    testDialog.error = (e as Error).message;
  } finally {
    testDialog.busy = false;
  }
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
const logChannel = ref<MessageChannel | null>(null);
const templateSearch = ref<string | null>(null);
async function loadLogs() {
  const q = new URLSearchParams({ pageSize: '100' });
  if (logChannel.value) q.set('channel', logChannel.value);
  const res = await apiFetch<ApiListResponse<MessageLogDto>>(
    `/api/v1/communication/messages?${q.toString()}`,
  );
  logs.value = res.data;
  logTotal.value = res.meta.total;
}

async function options<T>(url: string): Promise<T[]> {
  try {
    return (await apiFetch<ApiListResponse<T>>(url)).data;
  } catch {
    return [];
  }
}

onMounted(async () => {
  try {
    [groups.value, institutions.value] = await Promise.all([
      auth.can('group.view') ? options<Named>('/api/v1/groups?pageSize=100') : [],
      options<Named>('/api/v1/institutions?pageSize=100'),
    ]);
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
        data-testid="add-provider"
        @click="openProvider(null)"
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
        { title: 'Used by', key: 'scopeType' },
        { title: 'Credentials', key: 'hasCredentials' },
        { title: 'Active', key: 'isActive' },
        { title: '', key: 'actions', sortable: false },
      ]"
    >
      <template #[`item.scopeType`]="{ item }">
        <v-chip size="x-small" class="mr-1">{{ item.scopeType }}</v-chip>
        {{ nameOf(item.scopeType, item.targetId) }}
      </template>
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
          prepend-icon="mdi-send-check"
          :data-testid="`test-provider-${item.channel}`"
          @click="openTest(item)"
          >Send test</v-btn
        >
        <v-btn
          v-if="canManage"
          size="small"
          variant="text"
          icon="mdi-pencil"
          title="Edit"
          @click="openProvider(item)"
        />
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
    <div class="d-flex mb-2 ga-2 align-center">
      <v-text-field
        v-model="templateSearch"
        label="Search templates"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        hide-details
        clearable
        style="max-width: 320px"
      />
      <v-spacer />
      <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openTemplate(null)">
        New template
      </v-btn>
    </div>
    <v-data-table
      :items="templates"
      :search="templateSearch ?? ''"
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
    <v-row dense class="mb-2">
      <v-col cols="12" md="3">
        <v-select
          v-model="logChannel"
          :items="[...MESSAGE_CHANNELS]"
          label="Channel filter"
          density="compact"
          clearable
          hide-details
          data-testid="log-channel"
          @update:model-value="loadLogs"
        />
      </v-col>
    </v-row>
    <v-data-table
      :items="logs"
      :items-length="logTotal"
      :headers="[
        { title: 'When', key: 'createdAt' },
        { title: 'Channel', key: 'channel' },
        { title: 'To', key: 'recipientAddress' },
        { title: 'Subject', key: 'subject' },
        { title: 'Template', key: 'templateKey' },
        { title: 'Provider', key: 'providerName' },
        { title: 'Status', key: 'status' },
        { title: 'Error', key: 'lastError' },
      ]"
    >
      <template #[`item.createdAt`]="{ item }">{{
        new Date(item.createdAt).toLocaleString()
      }}</template>
      <template #[`item.providerName`]="{ item }">
        <span v-if="item.providerName">
          {{ item.providerName }}
          <v-chip v-if="item.providerScope" size="x-small" class="ml-1">{{
            item.providerScope
          }}</v-chip>
        </span>
        <span v-else>{{ item.providerType ?? '—' }}</span>
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip size="small" :color="statusColor[item.status]">{{ item.status }}</v-chip>
      </template>
    </v-data-table>
  </template>

  <v-dialog v-model="providerDialog" max-width="640">
    <v-card :title="editingProvider ? `Edit ${editingProvider.name}` : 'Add provider'">
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-select
              v-model="pForm.scopeType"
              :items="
                (['INSTITUTION', 'GROUP', 'ORGANIZATION'] as const).map((value) => ({
                  value,
                  title: SCOPE_LABEL[value],
                }))
              "
              label="Used by"
              :disabled="!!editingProvider"
              data-testid="provider-scope"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select
              v-if="pForm.scopeType !== 'ORGANIZATION'"
              v-model="pForm.targetId"
              :items="scopeTargets"
              item-title="name"
              item-value="id"
              :label="pForm.scopeType === 'GROUP' ? 'Group' : 'Institution'"
              :disabled="!!editingProvider"
              data-testid="provider-target"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select
              v-model="pForm.channel"
              :items="[...MESSAGE_CHANNELS]"
              label="Channel"
              :disabled="!!editingProvider"
              data-testid="provider-channel"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select
              v-model="pForm.providerType"
              :items="providerTypes.map((value) => ({ value, title: PROVIDER_FORMS[value].label }))"
              label="Provider"
              :disabled="!!editingProvider"
              data-testid="provider-type"
            />
          </v-col>
          <v-col cols="12" sm="8">
            <v-text-field v-model="pForm.name" label="Name" data-testid="provider-name" />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model.number="pForm.priority"
              type="number"
              label="Priority (lower first)"
            />
          </v-col>
          <v-col
            v-for="f in providerForm.fields"
            :key="`${pForm.providerType}-${f.key}`"
            cols="12"
            :sm="f.type === 'boolean' ? 12 : 6"
          >
            <v-checkbox
              v-if="f.type === 'boolean'"
              v-model="pForm.config[f.key]"
              :label="f.label"
              hide-details
            />
            <v-text-field
              v-else
              v-model="pForm.config[f.key]"
              :label="f.required ? `${f.label} *` : f.label"
              :type="f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'"
              :placeholder="f.placeholder"
              :hint="f.hint"
              persistent-placeholder
              :data-testid="`provider-config-${f.key}`"
            />
          </v-col>
          <v-col v-if="providerForm.credentialsLabel" cols="12">
            <v-text-field
              v-model="pForm.credentials"
              :label="`${providerForm.credentialsLabel}${providerForm.credentialsRequired && !editingProvider ? ' *' : ''}`"
              :hint="
                editingProvider?.hasCredentials
                  ? 'Stored securely and never shown. Leave blank to keep the current value.'
                  : 'Write-only: stored as an encrypted secret, never shown again.'
              "
              persistent-hint
              type="password"
              autocomplete="new-password"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="providerDialog = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="missingRequired"
          data-testid="save-provider"
          @click="saveProvider"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="testDialog.open" max-width="480">
    <v-card :title="`Send test — ${testDialog.provider?.name ?? ''}`">
      <v-card-text>
        <v-text-field
          v-model="testDialog.to"
          :label="testDialog.provider?.channel === 'email' ? 'Email address' : 'Phone (E.164)'"
          :placeholder="
            testDialog.provider?.channel === 'email' ? 'you@school.edu' : '+919800000000'
          "
          data-testid="test-to"
        />
        <v-alert v-if="testDialog.error" type="error" density="compact">{{
          testDialog.error
        }}</v-alert>
        <v-alert
          v-if="testDialog.result"
          :type="testDialog.result.status === 'FAILED' ? 'error' : 'success'"
          density="compact"
          data-testid="test-result"
        >
          {{ testDialog.result.status }} to {{ testDialog.result.to }}
          <span v-if="testDialog.result.error"> — {{ testDialog.result.error }}</span>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="testDialog.open = false">Close</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="testDialog.busy"
          :disabled="!testDialog.to"
          data-testid="send-test"
          @click="sendTest"
          >Send test</v-btn
        >
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
