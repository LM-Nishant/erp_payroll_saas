<script setup lang="ts">
import {
  BRANDING_FIELDS,
  type ApiListResponse,
  type BrandingField,
  type BrandingProfileDto,
  type ResolvedBrandingDto,
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

/** Editable fields (logoFileId is set by the file engine). */
const FIELDS: Array<{ key: BrandingField; label: string; color?: boolean }> = [
  { key: 'displayName', label: 'Display name' },
  { key: 'shortName', label: 'Short name' },
  { key: 'logoStorageKey', label: 'Logo storage key' },
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
const resolvedUrl = computed(() => {
  if (level.value.scope === 'groups') return `/api/v1/branding/resolved?groupId=${level.value.id}`;
  if (level.value.scope === 'institutions') {
    return `/api/v1/branding/resolved?institutionId=${level.value.id}`;
  }
  return '/api/v1/branding/resolved';
});

async function load() {
  error.value = null;
  saved.value = false;
  try {
    const [profile, res] = await Promise.all([
      apiFetch<{ data: BrandingProfileDto }>(profileUrl.value),
      apiFetch<{ data: ResolvedBrandingDto }>(resolvedUrl.value),
    ]);
    for (const f of BRANDING_FIELDS) form[f] = profile.data[f];
    resolved.value = res.data;
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
      <v-card v-if="resolved" title="Resolved preview">
        <v-sheet :color="resolved.primaryColor ?? undefined" class="pa-4 text-white">
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
