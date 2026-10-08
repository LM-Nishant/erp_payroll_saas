<script setup lang="ts">
import {
  BRANDING_FIELDS,
  LOGO_UPLOAD_TYPES,
  type ApiListResponse,
  type BrandingField,
  type BrandingProfileDto,
  type ResolvedBrandingDto,
  type SignedUrlDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

interface Option {
  id: string;
  name: string;
}
type Level = { scope: 'organization' | 'groups' | 'institutions'; id?: string };

const auth = useAuthStore();
const groups = ref<Option[]>([]);
const institutions = ref<Option[]>([]);
const levelKey = ref('organization');
const resolved = ref<ResolvedBrandingDto | null>(null);
const form = reactive<Partial<Record<BrandingField, string | null>>>({});
const error = ref<string | null>(null);
const saved = ref(false);
const canManage = computed(() => auth.can('branding.manage'));

/** Editable fields (the logo is uploaded through the document engine, see `uploadLogo`). */
const FIELDS: Array<{ key: BrandingField; label: string; color?: boolean }> = [
  { key: 'displayName', label: 'Display name' },
  { key: 'shortName', label: 'Short name' },
  { key: 'primaryColor', label: 'Primary color', color: true },
  { key: 'secondaryColor', label: 'Secondary color', color: true },
  { key: 'accentColor', label: 'Accent color', color: true },
  { key: 'letterheadText', label: 'Letterhead text' },
  { key: 'footerText', label: 'Footer text' },
  { key: 'address', label: 'Address' },
  { key: 'contactEmail', label: 'Contact email' },
  { key: 'contactPhone', label: 'Contact phone' },
  { key: 'website', label: 'Website' },
  { key: 'customDomain', label: 'Custom domain' },
  { key: 'subdomain', label: 'Subdomain' },
];

const level = computed<Level>(() => {
  const [scope, id] = levelKey.value.split(':');
  return { scope: scope as Level['scope'], id };
});
const profileUrl = computed(() =>
  level.value.id
    ? `/api/v1/branding/${level.value.scope}/${level.value.id}`
    : '/api/v1/branding/organization',
);
const levelQuery = computed(() => {
  if (level.value.scope === 'groups') return `?groupId=${level.value.id}`;
  if (level.value.scope === 'institutions') return `?institutionId=${level.value.id}`;
  return '';
});
const resolvedUrl = computed(() => `/api/v1/branding/resolved${levelQuery.value}`);
const logoUrl = ref<string | null>(null);
const ownLogo = ref(false);
const logoFile = ref<File | File[] | null>(null);
const logoAccept = [...new Set(Object.values(LOGO_UPLOAD_TYPES).flat())].join(',');

/** Short-lived signed URL for the resolved (possibly inherited) logo. */
async function loadLogo() {
  logoUrl.value = null;
  if (!resolved.value?.logoFileId) return;
  try {
    const res = await apiFetch<{ data: SignedUrlDto | null }>(
      `/api/v1/branding/logo-url${levelQuery.value}`,
    );
    logoUrl.value = res.data?.url ?? null;
  } catch {
    logoUrl.value = null;
  }
}

async function uploadLogo() {
  const file = Array.isArray(logoFile.value) ? logoFile.value[0] : logoFile.value;
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  error.value = null;
  try {
    await apiFetch(`${profileUrl.value}/logo`, { method: 'POST', body });
    logoFile.value = null;
    await Promise.all([load(), auth.loadMe()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function removeLogo() {
  error.value = null;
  try {
    await apiFetch(`${profileUrl.value}/logo`, { method: 'DELETE' });
    await Promise.all([load(), auth.loadMe()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function load() {
  error.value = null;
  saved.value = false;
  try {
    const [profile, res] = await Promise.all([
      apiFetch<{ data: BrandingProfileDto }>(profileUrl.value),
      apiFetch<{ data: ResolvedBrandingDto }>(resolvedUrl.value),
    ]);
    for (const f of BRANDING_FIELDS) form[f] = profile.data[f];
    ownLogo.value = Boolean(profile.data.logoFileId);
    resolved.value = res.data;
    await loadLogo();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  const safe = async <T,>(url: string) => {
    try {
      return (await apiFetch<ApiListResponse<T>>(url)).data;
    } catch {
      return [];
    }
  };
  [groups.value, institutions.value] = await Promise.all([
    auth.can('group.view') ? safe<Option>('/api/v1/groups?pageSize=100') : [],
    safe<Option>('/api/v1/institutions?pageSize=100'),
  ]);
  if (auth.me?.branding && auth.me.branding.target.scopeType === 'INSTITUTION') {
    levelKey.value = `institutions:${auth.me.branding.target.id}`;
  }
  await load();
});
watch(levelKey, load);

async function save() {
  error.value = null;
  const body = Object.fromEntries(
    FIELDS.map((f) => [f.key, form[f.key] === '' ? null : (form[f.key] ?? null)]),
  );
  try {
    await apiFetch(profileUrl.value, { method: 'PUT', body: JSON.stringify(body) });
    saved.value = true;
    await Promise.all([load(), auth.loadMe()]);
    saved.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const levels = computed(() => [
  { title: 'Organization defaults', value: 'organization' },
  ...groups.value.map((g) => ({ title: `Group: ${g.name}`, value: `groups:${g.id}` })),
  ...institutions.value.map((i) => ({
    title: `Institution: ${i.name}`,
    value: `institutions:${i.id}`,
  })),
]);
</script>

<template>
  <h2 class="text-h5 mb-4">Branding</h2>
  <v-alert v-if="error" type="error" class="mb-4" closable>{{ error }}</v-alert>
  <v-alert v-if="saved" type="success" class="mb-4" closable>Branding saved</v-alert>
  <v-select v-model="levelKey" :items="levels" label="Level" style="max-width: 480px" />
  <v-row>
    <v-col cols="12" md="7">
      <v-card title="Profile (empty fields inherit)">
        <v-card-text>
          <v-text-field
            v-for="f in FIELDS"
            :key="f.key"
            v-model="form[f.key]"
            :label="f.label"
            :readonly="!canManage"
            :placeholder="resolved?.[f.key] ?? ''"
            persistent-placeholder
            density="compact"
          >
            <template v-if="f.color && (form[f.key] || resolved?.[f.key])" #append-inner>
              <div
                :style="{
                  width: '20px',
                  height: '20px',
                  borderRadius: '4px',
                  background: form[f.key] || resolved?.[f.key] || undefined,
                }"
              />
            </template>
          </v-text-field>
        </v-card-text>
        <v-card-actions v-if="canManage">
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
    <v-col cols="12" md="5">
      <v-card title="Logo" class="mb-4">
        <v-card-text>
          <div class="d-flex align-center">
            <v-img v-if="logoUrl" :src="logoUrl" max-height="64" max-width="160" contain />
            <span v-else class="text-medium-emphasis">No logo</span>
            <v-chip v-if="logoUrl && !ownLogo" class="ml-2" size="x-small">inherited</v-chip>
          </div>
          <template v-if="canManage">
            <v-file-input
              v-model="logoFile"
              :accept="logoAccept"
              label="Upload logo (PNG or JPEG, max 2 MB)"
              density="compact"
              class="mt-4"
              show-size
            />
          </template>
          <p class="text-caption text-medium-emphasis mt-2 mb-0">
            The logo is printed in the top-right corner of every page of generated PDFs (payslips,
            Form 16, letters, receipts, report cards, asset labels, …). PDFs saved before a change
            keep the old logo — use <strong>Regenerate</strong> on a payroll run, the Payslips &amp;
            Form 16 page or a document to refresh them with the current branding (a new version is
            added; history is kept).
          </p>
        </v-card-text>
        <v-card-actions v-if="canManage">
          <v-btn v-if="ownLogo" color="error" variant="text" @click="removeLogo">Remove</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" :disabled="!logoFile" @click="uploadLogo">
            Upload
          </v-btn>
        </v-card-actions>
      </v-card>
      <v-card v-if="resolved" title="Resolved preview">
        <v-sheet :color="resolved.primaryColor ?? undefined" class="pa-4 text-white">
          <v-img
            v-if="logoUrl"
            :src="logoUrl"
            max-height="40"
            max-width="120"
            contain
            class="mb-2"
          />
          <div class="text-h6">{{ resolved.displayName }}</div>
          <div class="text-caption" style="white-space: pre-line">
            {{ resolved.letterheadText }}
          </div>
        </v-sheet>
        <v-card-text>
          <div v-for="f in FIELDS" :key="f.key" class="d-flex text-body-2">
            <span class="text-medium-emphasis">{{ f.label }}</span>
            <v-spacer />
            <span>{{ resolved[f.key] ?? '—' }}</span>
            <v-chip v-if="resolved.sources[f.key]" class="ml-2" size="x-small">
              {{ resolved.sources[f.key] }}
            </v-chip>
          </div>
        </v-card-text>
        <v-sheet :color="resolved.secondaryColor ?? undefined" class="pa-2 text-caption text-white">
          {{ resolved.footerText }}
        </v-sheet>
      </v-card>
    </v-col>
  </v-row>
</template>
