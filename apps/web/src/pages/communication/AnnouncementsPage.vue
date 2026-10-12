<script setup lang="ts">
import {
  MESSAGE_CHANNELS,
  type ApiListResponse,
  type AudiencePreviewDto,
  type AudienceRecipients,
  type AudienceType,
  type CampaignDto,
  type MessageChannel,
  type MessageTemplateDto,
} from '@erp/shared';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import SearchMultiPicker from './SearchMultiPicker.vue';

interface Named {
  id: string;
  name: string;
  code?: string;
  institutionId?: string;
  programId?: string;
}

const auth = useAuthStore();
const route = useRoute();

const CHANNEL_LABEL: Record<MessageChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};
const TYPE_LABEL: Record<AudienceType, string> = {
  institution: 'Whole institution',
  department: 'Department(s)',
  program: 'Class / program(s)',
  class_section: 'Class section(s)',
  students: 'Specific students',
  staff: 'Specific staff',
};
const RECIPIENT_LABEL: Record<AudienceRecipients, string> = {
  guardians: 'Parents / guardians',
  students: 'Students',
  both: 'Students + guardians',
  staff: 'Staff',
};
const STATUS_COLOR: Record<CampaignDto['status'], string> = {
  SCHEDULED: 'info',
  QUEUED: 'secondary',
  SENDING: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'grey',
  FAILED: 'error',
};
const VARIABLES = ['name', 'studentName', 'kind'];

const channels = computed(() => MESSAGE_CHANNELS.filter((c) => auth.hasFeature(c)));
const canSchedule = computed(() => auth.can('message.schedule'));

const institutions = ref<Named[]>([]);
const departments = ref<Named[]>([]);
const programs = ref<Named[]>([]);
const sections = ref<Named[]>([]);
const templates = ref<MessageTemplateDto[]>([]);
const campaigns = ref<CampaignDto[]>([]);
const studentInitial = ref<Array<{ id: string; title: string }>>([]);
const pickerKey = ref(0);

const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '');
const form = reactive({
  institutionId: q('institutionId'),
  channel: (channels.value[0] ?? 'email') as MessageChannel,
  type: ((q('type') as AudienceType) || 'institution') as AudienceType,
  ids: q('ids') ? q('ids').split(',') : ([] as string[]),
  recipients: ((q('recipients') as AudienceRecipients) || 'guardians') as AudienceRecipients,
  mode: 'text' as 'text' | 'template',
  templateKey: null as string | null,
  name: `Announcement ${new Date().toISOString().slice(0, 10)}`,
  subject: '',
  body: '',
  schedule: false,
  scheduledAt: '',
});
const preview = ref<AudiencePreviewDto | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const recipientOptions = computed<AudienceRecipients[]>(() => {
  if (form.type === 'staff') return ['staff'];
  if (form.type === 'institution' || form.type === 'department') {
    return ['guardians', 'students', 'both', 'staff'];
  }
  return ['guardians', 'students', 'both'];
});
const inInstitution = (rows: Named[]) =>
  rows.filter((r) => !r.institutionId || r.institutionId === form.institutionId);
const programIds = computed(() => new Set(inInstitution(programs.value).map((p) => p.id)));
const idOptions = computed(() => {
  if (form.type === 'department') return inInstitution(departments.value);
  if (form.type === 'program') return inInstitution(programs.value);
  if (form.type === 'class_section') {
    const prog = new Map(programs.value.map((p) => [p.id, p.name]));
    return sections.value
      .filter((s) => s.programId && programIds.value.has(s.programId))
      .map((s) => {
        const p = prog.get(s.programId!) ?? '';
        return { ...s, name: s.name.startsWith(p) ? s.name : `${p} - ${s.name}` };
      });
  }
  return [];
});
const channelTemplates = computed(() =>
  templates.value.filter((t) => t.channel === form.channel && t.isActive),
);
const active = computed(() =>
  campaigns.value.some((c) => ['SCHEDULED', 'QUEUED', 'SENDING'].includes(c.status)),
);

function audience() {
  return {
    institutionId: form.institutionId,
    type: form.type,
    ids: form.type === 'institution' ? [] : form.ids,
    recipients: form.recipients,
  };
}
function content() {
  return form.mode === 'template' && form.templateKey
    ? { templateKey: form.templateKey }
    : {
        body: form.body,
        ...(form.channel === 'email' && form.subject ? { subject: form.subject } : {}),
      };
}

watch(
  () => form.type,
  () => {
    form.ids = [];
    if (!recipientOptions.value.includes(form.recipients)) {
      form.recipients = recipientOptions.value[0]!;
    }
  },
);
watch(
  () => form.institutionId,
  (_n, old) => {
    if (old) form.ids = [];
  },
);
watch(
  () => [form.institutionId, form.type, form.ids, form.recipients, form.channel],
  () => (preview.value = null),
  { deep: true },
);

async function all<T>(path: string): Promise<T[]> {
  try {
    const out: T[] = [];
    for (let page = 1; page <= 20; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const r = await apiFetch<ApiListResponse<T>>(`${path}${sep}pageSize=100&page=${page}`);
      out.push(...r.data);
      if (out.length >= r.meta.total || r.data.length === 0) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function loadCampaigns() {
  try {
    campaigns.value = (
      await apiFetch<ApiListResponse<CampaignDto>>('/api/v1/communication/campaigns?pageSize=50')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function runPreview() {
  error.value = null;
  busy.value = true;
  try {
    const body = form.mode === 'template' && !form.templateKey ? {} : content();
    preview.value = (
      await apiFetch<{ data: AudiencePreviewDto }>('/api/v1/communication/audience/preview', {
        method: 'POST',
        body: JSON.stringify({ channel: form.channel, audience: audience(), ...body }),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function send() {
  error.value = null;
  busy.value = true;
  try {
    const created = (
      await apiFetch<{ data: CampaignDto }>('/api/v1/communication/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          channel: form.channel,
          audience: audience(),
          ...content(),
          ...(form.schedule && form.scheduledAt
            ? { scheduledAt: new Date(form.scheduledAt).toISOString() }
            : {}),
        }),
      })
    ).data;
    notice.value =
      created.status === 'SCHEDULED'
        ? `Scheduled "${created.name}" for ${created.totalRecipients} recipient(s).`
        : `Queued "${created.name}" to ${created.totalRecipients} recipient(s).`;
    preview.value = null;
    await loadCampaigns();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function cancel(c: CampaignDto) {
  try {
    await apiFetch(`/api/v1/communication/campaigns/${c.id}/cancel`, { method: 'POST' });
    await loadCampaigns();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const token = (v: string) => `{{${v}}}`;
function insertVariable(v: string) {
  form.body = `${form.body}${token(v)}`;
}
const progress = (c: CampaignDto) =>
  c.totalRecipients ? Math.round(((c.sentCount + c.failedCount) / c.totalRecipients) * 100) : 0;
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  const [inst, depts, progs, secs] = await Promise.all([
    all<Named>('/api/v1/institutions'),
    all<Named>('/api/v1/departments'),
    all<Named>('/api/v1/programs'),
    all<Named>('/api/v1/class-sections'),
  ]);
  // Department / section-scoped users may not list institutions: fall back to their role scopes.
  const known = new Map(inst.map((i) => [i.id, i]));
  for (const r of auth.me?.roles ?? []) {
    for (const sc of r.scopes) {
      if (sc.type === 'INSTITUTION' && sc.id && !known.has(sc.id)) {
        known.set(sc.id, { id: sc.id, name: sc.name ?? sc.id });
      }
    }
  }
  institutions.value = [...known.values()];
  departments.value = depts;
  programs.value = progs;
  sections.value = secs;
  if (!form.institutionId) form.institutionId = institutions.value[0]?.id ?? '';
  if (auth.can('communication.view')) {
    templates.value = await all<MessageTemplateDto>('/api/v1/communication/templates');
  }
  if (form.type === 'students' && form.ids.length) {
    studentInitial.value = await Promise.all(
      form.ids.map(async (id) => {
        try {
          const s = (
            await apiFetch<{ data: { displayName: string; admissionNo: string } }>(
              `/api/v1/students/${id}`,
            )
          ).data;
          return { id, title: `${s.displayName} (${s.admissionNo})` };
        } catch {
          return { id, title: id };
        }
      }),
    );
    pickerKey.value++;
  }
  await loadCampaigns();
  timer = setInterval(() => {
    if (active.value) void loadCampaigns();
  }, 4000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Announcements</h2>
    <v-spacer />
    <v-btn
      variant="text"
      prepend-icon="mdi-refresh"
      data-testid="refresh-campaigns"
      @click="loadCampaigns"
      >Refresh</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" class="mb-3" closable @click:close="notice = null">
    {{ notice }}
  </v-alert>
  <v-alert v-if="!channels.length" type="warning" class="mb-3">
    No messaging channel (email, SMS, WhatsApp) is enabled in your licence.
  </v-alert>

  <v-card class="mb-6" data-testid="compose">
    <v-card-title>Compose</v-card-title>
    <v-card-text>
      <v-row dense>
        <v-col cols="12" md="4">
          <v-select
            v-model="form.institutionId"
            :items="institutions"
            item-title="name"
            item-value="id"
            label="Institution"
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-btn-toggle
            v-model="form.channel"
            mandatory
            color="primary"
            variant="outlined"
            divided
            data-testid="channel"
          >
            <v-btn v-for="c in channels" :key="c" :value="c">{{ CHANNEL_LABEL[c] }}</v-btn>
          </v-btn-toggle>
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field v-model="form.name" label="Campaign name" />
        </v-col>
        <v-col cols="12" md="4">
          <v-select
            v-model="form.type"
            :items="Object.entries(TYPE_LABEL).map(([value, title]) => ({ value, title }))"
            label="Send to"
            data-testid="audience-type"
          />
        </v-col>
        <v-col cols="12" md="5">
          <v-select
            v-if="['department', 'program', 'class_section'].includes(form.type)"
            v-model="form.ids"
            :items="idOptions"
            item-title="name"
            item-value="id"
            :label="TYPE_LABEL[form.type]"
            multiple
            chips
            closable-chips
            data-testid="audience-ids"
          />
          <SearchMultiPicker
            v-else-if="form.type === 'students' && form.institutionId"
            :key="`s${pickerKey}${form.institutionId}`"
            v-model="form.ids"
            label="Students"
            path="/api/v1/students"
            :institution-id="form.institutionId"
            :initial="studentInitial"
            :title="(r) => `${r.displayName} (${r.admissionNo})`"
          />
          <SearchMultiPicker
            v-else-if="form.type === 'staff' && form.institutionId"
            :key="`e${form.institutionId}`"
            v-model="form.ids"
            label="Staff"
            path="/api/v1/employees"
            :institution-id="form.institutionId"
            :title="(r) => `${r.displayName} (${r.employeeCode})`"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="form.recipients"
            :items="recipientOptions.map((value) => ({ value, title: RECIPIENT_LABEL[value] }))"
            label="Recipients"
            data-testid="audience-recipients"
          />
        </v-col>
      </v-row>

      <v-radio-group v-model="form.mode" inline hide-details class="mb-2">
        <v-radio label="Free text" value="text" />
        <v-radio label="Template" value="template" :disabled="!channelTemplates.length" />
      </v-radio-group>
      <v-select
        v-if="form.mode === 'template'"
        v-model="form.templateKey"
        :items="channelTemplates.map((t) => ({ value: t.key, title: `${t.name} (${t.key})` }))"
        label="Message template"
        data-testid="template-select"
      />
      <template v-else>
        <v-text-field v-if="form.channel === 'email'" v-model="form.subject" label="Subject" />
        <v-textarea
          v-model="form.body"
          label="Message"
          rows="4"
          auto-grow
          counter
          data-testid="message-body"
        />
        <div class="d-flex align-center flex-wrap ga-1 mb-2 text-caption">
          Insert variable:
          <v-chip v-for="v in VARIABLES" :key="v" size="small" @click="insertVariable(v)">
            {{ token(v) }}
          </v-chip>
        </div>
      </template>

      <div class="d-flex align-center flex-wrap ga-3">
        <v-checkbox
          v-if="canSchedule"
          v-model="form.schedule"
          label="Schedule for later"
          hide-details
        />
        <v-text-field
          v-if="form.schedule"
          v-model="form.scheduledAt"
          type="datetime-local"
          label="Send at"
          hide-details
          style="max-width: 260px"
        />
      </div>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        variant="tonal"
        prepend-icon="mdi-account-search"
        :loading="busy"
        :disabled="!form.institutionId || !channels.length"
        data-testid="preview-audience"
        @click="runPreview"
        >Preview recipients</v-btn
      >
      <v-btn
        color="primary"
        prepend-icon="mdi-send"
        :loading="busy"
        :disabled="!preview || preview.total === 0 || (form.schedule && !form.scheduledAt)"
        data-testid="send-broadcast"
        @click="send"
        >{{ form.schedule ? 'Schedule' : 'Send now' }}</v-btn
      >
    </v-card-actions>

    <v-card-text v-if="preview" data-testid="audience-preview" class="pt-0">
      <v-divider class="mb-3" />
      <div class="text-subtitle-1 mb-2">
        {{ preview.label }} — <b data-testid="preview-total">{{ preview.total }}</b> recipient(s)
      </div>
      <div class="d-flex flex-wrap ga-2 mb-3">
        <v-chip v-if="preview.byKind.guardian" size="small"
          >{{ preview.byKind.guardian }} guardians</v-chip
        >
        <v-chip v-if="preview.byKind.student" size="small"
          >{{ preview.byKind.student }} students</v-chip
        >
        <v-chip v-if="preview.byKind.staff" size="small">{{ preview.byKind.staff }} staff</v-chip>
        <v-chip
          v-if="preview.skippedCount"
          size="small"
          color="warning"
          data-testid="skipped-count"
        >
          {{ preview.skippedCount }} skipped
        </v-chip>
      </div>
      <v-card v-if="preview.rendered" variant="outlined" class="mb-3">
        <v-card-subtitle class="pt-2">Preview for the first recipient</v-card-subtitle>
        <v-card-text>
          <div v-if="preview.rendered.subject">
            <b>{{ preview.rendered.subject }}</b>
          </div>
          <div style="white-space: pre-wrap" data-testid="rendered-text">
            {{ preview.rendered.text }}
          </div>
        </v-card-text>
      </v-card>
      <v-expansion-panels variant="accordion">
        <v-expansion-panel :title="`Recipients (first ${preview.sample.length})`">
          <v-expansion-panel-text>
            <v-table density="compact">
              <tbody>
                <tr v-for="m in preview.sample" :key="`${m.kind}${m.address}`">
                  <td>{{ m.name }}</td>
                  <td>{{ m.kind }}</td>
                  <td>{{ m.studentName || '' }}</td>
                  <td>{{ m.address }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel
          v-if="preview.skipped.length"
          :title="`Skipped (${preview.skippedCount})`"
          data-testid="skipped-list"
        >
          <v-expansion-panel-text>
            <v-table density="compact">
              <tbody>
                <tr v-for="(m, i) in preview.skipped" :key="i">
                  <td>{{ m.name }}</td>
                  <td>{{ m.kind }}</td>
                  <td>{{ m.studentName || '' }}</td>
                  <td>
                    <v-chip size="x-small" color="warning">{{ m.reason }}</v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </v-card>

  <h3 class="text-h6 mb-2">Sent &amp; scheduled</h3>
  <v-table density="compact" data-testid="campaigns">
    <thead>
      <tr>
        <th>Name</th>
        <th>Channel</th>
        <th>Audience</th>
        <th>Status</th>
        <th style="min-width: 160px">Progress</th>
        <th>Skipped</th>
        <th>When</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr v-for="c in campaigns" :key="c.id">
        <td>{{ c.name }}</td>
        <td>{{ CHANNEL_LABEL[c.channel] }}</td>
        <td>{{ c.audience?.label ?? '—' }}</td>
        <td>
          <v-chip size="x-small" :color="STATUS_COLOR[c.status]">{{ c.status }}</v-chip>
        </td>
        <td>
          <v-progress-linear :model-value="progress(c)" height="6" rounded color="success" />
          <span class="text-caption">
            {{ c.sentCount }} sent · {{ c.failedCount }} failed / {{ c.totalRecipients }}
          </span>
        </td>
        <td>{{ c.skippedCount }}</td>
        <td>{{ when(c.scheduledAt ?? c.createdAt) }}</td>
        <td class="text-right">
          <v-btn
            v-if="['SCHEDULED', 'QUEUED', 'SENDING'].includes(c.status)"
            size="small"
            variant="text"
            color="error"
            @click="cancel(c)"
            >Cancel</v-btn
          >
        </td>
      </tr>
      <tr v-if="!campaigns.length">
        <td colspan="8" class="text-medium-emphasis">No announcements yet.</td>
      </tr>
    </tbody>
  </v-table>
</template>
