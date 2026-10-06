<script setup lang="ts">
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONFIDENTIALITY,
  DOCUMENT_UPLOAD_TYPES,
  type ApiListResponse,
  type DocumentCategory,
  type DocumentConfidentiality,
  type DocumentDto,
  type DocumentVersionDto,
  type SignedUrlDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

interface Option {
  id: string;
  name: string;
}

const auth = useAuthStore();
const docs = ref<DocumentDto[]>([]);
const total = ref(0);
const page = ref(1);
const category = ref<DocumentCategory | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const canUpload = computed(() => auth.can('document.upload'));
const accept = Object.keys(DOCUMENT_UPLOAD_TYPES)
  .map((e) => `.${e}`)
  .join(',');
const categories = Object.entries(DOCUMENT_CATEGORIES).map(([value, title]) => ({ value, title }));

const headers = [
  { title: 'Title', key: 'title' },
  { title: 'Category', key: 'category' },
  { title: 'Owner', key: 'owner', sortable: false },
  { title: 'Confidentiality', key: 'confidentiality' },
  { title: 'Version', key: 'version', sortable: false },
  { title: 'Expires', key: 'expiryDate' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: '25' });
    if (category.value) params.set('category', category.value);
    const res = await apiFetch<ApiListResponse<DocumentDto>>(`/api/v1/documents?${params}`);
    docs.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  try {
    institutions.value = (
      await apiFetch<ApiListResponse<Option>>('/api/v1/institutions?pageSize=100')
    ).data;
  } catch {
    institutions.value = [];
  }
});
watch([page, category], load);

/** Opens a short-lived signed URL (every issuance is audited server-side). */
async function download(doc: DocumentDto, versionId?: string) {
  try {
    const res = await apiFetch<{ data: SignedUrlDto }>(`/api/v1/documents/${doc.id}/download-url`, {
      method: 'POST',
      body: JSON.stringify(versionId ? { versionId } : {}),
    });
    window.open(res.data.url, '_blank', 'noopener');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Upload dialog
const uploadOpen = ref(false);
const uploadFile = ref<File | File[] | null>(null);
const form = reactive({
  ownerKey: 'organization',
  title: '',
  category: 'other' as DocumentCategory,
  confidentiality: 'INTERNAL' as DocumentConfidentiality,
  expiryDate: '',
});
const owners = computed(() => [
  { title: 'Organization', value: 'organization' },
  ...institutions.value.map((i) => ({
    title: `Institution: ${i.name}`,
    value: `institution:${i.id}`,
  })),
]);
const pickFile = (f: File | File[] | null) => (Array.isArray(f) ? f[0] : f) ?? null;

async function submitUpload() {
  const file = pickFile(uploadFile.value);
  if (!file) return;
  const [ownerType, ownerId] = form.ownerKey.split(':');
  const metadata = {
    ownerType,
    ...(ownerId ? { ownerId } : {}),
    title: form.title || file.name,
    category: form.category,
    confidentiality: form.confidentiality,
    ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
  };
  const body = new FormData();
  body.append('metadata', JSON.stringify(metadata));
  body.append('file', file);
  try {
    await apiFetch('/api/v1/documents/files', { method: 'POST', body });
    uploadOpen.value = false;
    uploadFile.value = null;
    form.title = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// Versions dialog
const versionsDoc = ref<DocumentDto | null>(null);
const versions = ref<DocumentVersionDto[]>([]);
const newVersion = ref<File | File[] | null>(null);
async function openVersions(doc: DocumentDto) {
  versionsDoc.value = doc;
  versions.value = (
    await apiFetch<ApiListResponse<DocumentVersionDto>>(`/api/v1/documents/${doc.id}/versions`)
  ).data;
}
async function uploadVersion() {
  const file = pickFile(newVersion.value);
  if (!file || !versionsDoc.value) return;
  const body = new FormData();
  body.append('file', file);
  try {
    await apiFetch(`/api/v1/documents/${versionsDoc.value.id}/versions`, { method: 'POST', body });
    newVersion.value = null;
    await Promise.all([openVersions(versionsDoc.value), load()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function restore(version: DocumentVersionDto) {
  if (!versionsDoc.value) return;
  try {
    await apiFetch(`/api/v1/documents/${versionsDoc.value.id}/versions/${version.id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ reason: `Restore version ${version.versionNumber}` }),
    });
    await Promise.all([openVersions(versionsDoc.value), load()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function remove(doc: DocumentDto) {
  if (!window.confirm(`Delete "${doc.title}"? It is kept for the retention period.`)) return;
  try {
    await apiFetch(`/api/v1/documents/${doc.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const formatSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Documents</h2>
    <v-spacer />
    <v-select
      v-model="category"
      :items="categories"
      label="Category"
      clearable
      density="compact"
      hide-details
      style="max-width: 260px"
      class="mr-2"
    />
    <v-btn v-if="canUpload" color="primary" prepend-icon="mdi-upload" @click="uploadOpen = true">
      Upload
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = null">
    {{ error }}
  </v-alert>

  <v-data-table-server
    v-model:page="page"
    :headers="headers"
    :items="docs"
    :items-length="total"
    :loading="loading"
    items-per-page="25"
    :items-per-page-options="[25]"
  >
    <template #[`item.owner`]="{ item }">{{ item.ownerType }}</template>
    <template #[`item.confidentiality`]="{ item }">
      <v-chip size="x-small">{{ item.confidentiality }}</v-chip>
    </template>
    <template #[`item.version`]="{ item }">
      <span v-if="item.currentVersion">
        v{{ item.currentVersion.versionNumber }} · {{ formatSize(item.currentVersion.sizeBytes) }}
      </span>
    </template>
    <template #[`item.expiryDate`]="{ item }">{{ item.expiryDate ?? '—' }}</template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="item.allowedActions.includes('download')"
        icon="mdi-download"
        size="small"
        variant="text"
        title="Download"
        @click="download(item)"
      />
      <v-btn
        icon="mdi-history"
        size="small"
        variant="text"
        title="Versions"
        @click="openVersions(item)"
      />
      <v-btn
        v-if="item.allowedActions.includes('delete')"
        icon="mdi-delete"
        size="small"
        variant="text"
        title="Delete"
        @click="remove(item)"
      />
    </template>
  </v-data-table-server>

  <v-dialog v-model="uploadOpen" max-width="560">
    <v-card title="Upload document">
      <v-card-text>
        <v-file-input v-model="uploadFile" :accept="accept" label="File" show-size />
        <v-text-field v-model="form.title" label="Title (defaults to file name)" />
        <v-select v-model="form.ownerKey" :items="owners" label="Belongs to" />
        <v-select v-model="form.category" :items="categories" label="Category" />
        <v-select
          v-model="form.confidentiality"
          :items="[...DOCUMENT_CONFIDENTIALITY]"
          label="Confidentiality"
        />
        <v-text-field v-model="form.expiryDate" type="date" label="Expiry date (optional)" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="uploadOpen = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!uploadFile" @click="submitUpload">
          Upload
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog :model-value="!!versionsDoc" max-width="720" @update:model-value="versionsDoc = null">
    <v-card v-if="versionsDoc" :title="`Versions — ${versionsDoc.title}`">
      <v-card-text>
        <v-table density="compact">
          <thead>
            <tr>
              <th>#</th>
              <th>File</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in versions" :key="v.id">
              <td>
                v{{ v.versionNumber }}
                <v-chip v-if="v.isCurrent" size="x-small" color="primary">current</v-chip>
              </td>
              <td>{{ v.fileName }}</td>
              <td>{{ formatSize(v.sizeBytes) }}</td>
              <td>{{ new Date(v.createdAt).toLocaleString() }} · {{ v.uploadedByName ?? '—' }}</td>
              <td class="text-right">
                <v-btn
                  v-if="versionsDoc.allowedActions.includes('download')"
                  icon="mdi-download"
                  size="small"
                  variant="text"
                  @click="download(versionsDoc, v.id)"
                />
                <v-btn
                  v-if="!v.isCurrent && versionsDoc.allowedActions.includes('upload_version')"
                  icon="mdi-restore"
                  size="small"
                  variant="text"
                  title="Restore as new version"
                  @click="restore(v)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <div
          v-if="versionsDoc.allowedActions.includes('upload_version')"
          class="d-flex align-center mt-4"
        >
          <v-file-input
            v-model="newVersion"
            :accept="accept"
            label="Upload new version"
            density="compact"
            hide-details
          />
          <v-btn class="ml-2" color="primary" :disabled="!newVersion" @click="uploadVersion">
            Upload
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
