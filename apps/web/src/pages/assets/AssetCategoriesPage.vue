<script setup lang="ts">
import { ASSET_CATEGORY_KINDS, DEPRECIATION_METHODS } from '@erp/shared';
import type { ApiListResponse, AssetAttributeDef, AssetCategoryDto } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { clean, label, useAssetOptions, opts } from './assetUi';

const auth = useAuthStore();
const { institutions, loadBase } = useAssetOptions();
const items = ref<AssetCategoryDto[]>([]);
const error = ref<string | null>(null);
const open = ref(false);
const editing = ref<AssetCategoryDto | null>(null);
const blank = () => ({
  institutionId: '' as string | null,
  code: '',
  name: '',
  kind: 'IT',
  description: '',
  depreciationMethod: 'SLM',
  depreciationRate: '' as string | number,
  usefulLifeYears: '' as string | number,
  residualPercent: 5,
  tagPrefix: '',
  tagPadding: 5,
  attributes: [] as AssetAttributeDef[],
});
const form = reactive(blank());
const headers = [
  { title: 'Code', key: 'code' },
  { title: 'Name', key: 'name' },
  { title: 'Kind', key: 'kind' },
  { title: 'Depreciation', key: 'depreciationMethod' },
  { title: 'Tag series', key: 'tagPrefix' },
  { title: 'Assets', key: 'assetCount', align: 'end' as const },
  { title: '', key: 'actions', sortable: false },
];

async function load() {
  try {
    items.value = (
      await apiFetch<ApiListResponse<AssetCategoryDto>>('/api/v1/assets/categories?pageSize=100')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function openForm(c?: AssetCategoryDto) {
  editing.value = c ?? null;
  Object.assign(
    form,
    c
      ? {
          ...c,
          description: c.description ?? '',
          depreciationRate: c.depreciationRate ?? '',
          usefulLifeYears: c.usefulLifeYears ?? '',
          attributes: c.attributes.map((a) => ({ ...a })),
        }
      : blank(),
  );
  open.value = true;
}
async function save() {
  error.value = null;
  const body = {
    ...clean({
      name: form.name,
      kind: form.kind,
      description: form.description,
      depreciationMethod: form.depreciationMethod,
      tagPrefix: form.tagPrefix,
    }),
    depreciationRate: form.depreciationRate === '' ? null : Number(form.depreciationRate),
    usefulLifeYears: form.usefulLifeYears === '' ? null : Number(form.usefulLifeYears),
    residualPercent: Number(form.residualPercent),
    tagPadding: Number(form.tagPadding),
    attributes: form.attributes
      .filter((a) => a.key && a.label)
      .map((a) => ({
        ...a,
        options: a.type === 'select' ? (a.options ?? []) : undefined,
      })),
  };
  try {
    if (editing.value)
      await apiFetch(`/api/v1/assets/categories/${editing.value.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    else
      await apiFetch('/api/v1/assets/categories', {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          code: form.code,
          institutionId: form.institutionId || null,
        }),
      });
    open.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove(c: AssetCategoryDto) {
  if (!confirm(`Delete category ${c.name}?`)) return;
  try {
    await apiFetch(`/api/v1/assets/categories/${c.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const optionsText = (a: AssetAttributeDef) => (a.options ?? []).join(', ');
const setOptions = (a: AssetAttributeDef, v: string) => {
  a.options = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Asset categories</h2>
    <v-spacer />
    <v-btn
      v-if="auth.can('asset.manage')"
      color="primary"
      prepend-icon="mdi-plus"
      @click="openForm()"
      >New category</v-btn
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-data-table :headers="headers" :items="items" item-value="id" density="compact">
    <template #[`item.kind`]="{ item }">{{ label(item.kind) }}</template>
    <template #[`item.depreciationMethod`]="{ item }"
      >{{ item.depreciationMethod }}
      <span v-if="item.depreciationRate != null">{{ item.depreciationRate }}%</span>
      <span v-if="item.usefulLifeYears"> · {{ item.usefulLifeYears }} yrs</span></template
    >
    <template #[`item.tagPrefix`]="{ item }"
      >{{ item.tagPrefix
      }}{{ String(item.tagNextNumber).padStart(item.tagPadding, '0') }} (next)</template
    >
    <template #[`item.actions`]="{ item }">
      <template v-if="auth.can('asset.manage')">
        <v-btn icon="mdi-pencil" size="small" variant="text" @click="openForm(item)" />
        <v-btn icon="mdi-delete" size="small" variant="text" @click="remove(item)" />
      </template>
    </template>
  </v-data-table>

  <v-dialog v-model="open" max-width="820">
    <v-card :title="editing ? `Edit ${editing.name}` : 'New category'">
      <v-card-text>
        <v-row dense>
          <v-col v-if="!editing" cols="12" md="4"
            ><v-text-field v-model="form.code" label="Code"
          /></v-col>
          <v-col cols="12" md="4"><v-text-field v-model="form.name" label="Name" /></v-col>
          <v-col cols="12" md="4"
            ><v-select
              v-model="form.kind"
              :items="ASSET_CATEGORY_KINDS.map((k) => ({ title: label(k), value: k }))"
              label="Kind"
          /></v-col>
          <v-col v-if="!editing" cols="12" md="8"
            ><v-autocomplete
              v-model="form.institutionId"
              :items="institutions"
              item-title="name"
              item-value="id"
              label="Institution (blank = organization-wide)"
              clearable
          /></v-col>
          <v-col cols="12" md="4"
            ><v-select
              v-model="form.depreciationMethod"
              :items="opts(DEPRECIATION_METHODS)"
              label="Depreciation"
          /></v-col>
          <v-col cols="12" md="3"
            ><v-text-field v-model="form.depreciationRate" type="number" label="Rate % (WDV/SLM)"
          /></v-col>
          <v-col cols="12" md="3"
            ><v-text-field v-model="form.usefulLifeYears" type="number" label="Useful life (yrs)"
          /></v-col>
          <v-col cols="12" md="2"
            ><v-text-field v-model="form.residualPercent" type="number" label="Residual %"
          /></v-col>
          <v-col cols="12" md="2"
            ><v-text-field v-model="form.tagPrefix" label="Tag prefix"
          /></v-col>
          <v-col cols="12" md="2"
            ><v-text-field v-model="form.tagPadding" type="number" label="Digits"
          /></v-col>
          <v-col cols="12"
            ><v-textarea v-model="form.description" label="Description" rows="2"
          /></v-col>
        </v-row>
        <div class="d-flex align-center mb-2">
          <h3 class="text-subtitle-1">Custom attributes</h3>
          <v-spacer />
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            @click="form.attributes.push({ key: '', label: '', type: 'text', required: false })"
            >Add</v-btn
          >
        </div>
        <v-row v-for="(a, i) in form.attributes" :key="i" dense>
          <v-col cols="3"><v-text-field v-model="a.key" label="Key" density="compact" /></v-col>
          <v-col cols="3"><v-text-field v-model="a.label" label="Label" density="compact" /></v-col>
          <v-col cols="2"
            ><v-select
              v-model="a.type"
              :items="['text', 'number', 'date', 'boolean', 'select']"
              label="Type"
              density="compact"
          /></v-col>
          <v-col cols="3"
            ><v-text-field
              v-if="a.type === 'select'"
              :model-value="optionsText(a)"
              label="Options (comma)"
              density="compact"
              @update:model-value="setOptions(a, $event)"
          /></v-col>
          <v-col cols="1"
            ><v-btn
              icon="mdi-close"
              size="small"
              variant="text"
              @click="form.attributes.splice(i, 1)"
          /></v-col>
        </v-row>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="open = false">Cancel</v-btn
        ><v-btn color="primary" @click="save">Save</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
