<script setup lang="ts">
import type {
  ApiListResponse,
  CreatedOrganizationDto,
  OrganizationStatus,
  PlanDto,
  PlatformOrganizationDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const canManage = computed(() => auth.can('platform.organization.manage'));

const items = ref<PlatformOrganizationDto[]>([]);
const total = ref(0);
const search = ref('');
const status = ref<OrganizationStatus | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({ pageSize: '100' });
    if (search.value.trim()) params.set('search', search.value.trim());
    if (status.value) params.set('status', status.value);
    const res = await apiFetch<ApiListResponse<PlatformOrganizationDto>>(
      `/api/v1/platform/organizations?${params}`,
    );
    items.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
});
watch(status, load);
onMounted(load);

// --- Create organization -----------------------------------------------------------------

const plans = ref<PlanDto[]>([]);
const dialog = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const slugEdited = ref(false);
const emptyForm = () => ({
  name: '',
  slug: '',
  kind: 'EDUCATION' as 'EDUCATION' | 'COMPANY',
  planId: plans.value[0]?.id ?? '',
  subscriptionStatus: 'TRIAL' as 'TRIAL' | 'ACTIVE',
  ownerName: '',
  ownerEmail: '',
  ownerRole: 'group_owner' as 'group_owner' | 'institution_owner',
});
const form = reactive(emptyForm());

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

watch(
  () => form.name,
  (name) => {
    if (!slugEdited.value) form.slug = slugify(name);
  },
);

async function openCreate() {
  formError.value = null;
  dialog.value = true;
  if (plans.value.length === 0) {
    try {
      plans.value = (await apiFetch<{ data: PlanDto[] }>('/api/v1/platform/plans')).data.filter(
        (p) => p.status === 'ACTIVE',
      );
    } catch (e) {
      formError.value = (e as Error).message;
    }
  }
  Object.assign(form, emptyForm());
  slugEdited.value = false;
}

const required = (v: string) => Boolean(v?.trim()) || 'Required';
const slugRule = (v: string) =>
  /^[a-z0-9][a-z0-9-]{0,63}$/.test(v) || 'Lowercase letters, digits and "-" only';
const emailRule = (v: string) => /^\S+@\S+\.\S+$/.test(v) || 'Invalid e-mail';
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
// Vuetify may call item-title with the raw model value before plans load.
const planLabel = (p: PlanDto | string) =>
  typeof p === 'string' || !p?.currency
    ? String(typeof p === 'string' ? p : '')
    : `${p.name} — ${money(p.priceCents, p.currency)}/${p.billingInterval === 'MONTHLY' ? 'mo' : 'yr'}`;

async function create() {
  saving.value = true;
  formError.value = null;
  try {
    const res = await apiFetch<{ data: CreatedOrganizationDto }>('/api/v1/platform/organizations', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        slug: form.slug,
        kind: form.kind,
        planId: form.planId,
        subscriptionStatus: form.subscriptionStatus,
        owner: { name: form.ownerName, email: form.ownerEmail, role: form.ownerRole },
      }),
    });
    dialog.value = false;
    notice.value = `Created ${res.data.name}. Invite sent to ${res.data.owner.email}.`;
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

const statusColor = (s: OrganizationStatus) =>
  s === 'ACTIVE' ? 'success' : s === 'SUSPENDED' ? 'warning' : 'default';

const openRow = (_: unknown, row: { item: PlatformOrganizationDto }) =>
  router.push(`/platform/organizations/${row.item.id}`);

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Slug', key: 'slug' },
  { title: 'Status', key: 'status' },
  { title: 'Created', key: 'createdAt' },
];
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Organizations</h2>
    <v-spacer />
    <v-select
      v-model="status"
      :items="['ACTIVE', 'SUSPENDED', 'ARCHIVED']"
      label="Status"
      density="compact"
      clearable
      hide-details
      style="max-width: 180px"
    />
    <v-text-field
      v-model="search"
      density="compact"
      prepend-inner-icon="mdi-magnify"
      label="Search"
      hide-details
      style="max-width: 280px"
    />
    <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate">
      New organization
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-alert v-if="notice" type="success" closable class="mb-4" @click:close="notice = null">
    {{ notice }}
  </v-alert>
  <v-data-table
    :items="items"
    :headers="headers"
    :loading="loading"
    :items-length="total"
    hover
    @click:row="openRow"
  >
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="statusColor(item.status)">{{ item.status }}</v-chip>
    </template>
    <template #[`item.createdAt`]="{ item }">
      {{ new Date(item.createdAt).toLocaleDateString() }}
    </template>
  </v-data-table>

  <v-dialog v-model="dialog" max-width="640">
    <v-card title="New organization">
      <v-form @submit.prevent="create">
        <v-card-text>
          <v-alert v-if="formError" type="error" class="mb-4">{{ formError }}</v-alert>
          <v-text-field v-model="form.name" label="Organization name" :rules="[required]" />
          <v-text-field
            v-model="form.slug"
            label="Slug (login identifier)"
            :rules="[required, slugRule]"
            hint="Used at login; cannot be changed later"
            persistent-hint
            @update:model-value="slugEdited = true"
          />
          <v-select
            v-model="form.kind"
            :items="[
              { value: 'EDUCATION', title: 'Education (school / college / group)' },
              { value: 'COMPANY', title: 'Company (HRMS & payroll)' },
            ]"
            label="Organization type"
            class="mt-4"
          />
          <div class="d-flex ga-4 mt-4">
            <v-select
              v-model="form.planId"
              :items="plans"
              :item-title="planLabel"
              item-value="id"
              label="Plan"
              :rules="[required]"
            />
            <v-select
              v-model="form.subscriptionStatus"
              :items="['TRIAL', 'ACTIVE']"
              label="Subscription"
              style="max-width: 160px"
            />
          </div>
          <div class="text-subtitle-2 mb-2">First owner (receives an e-mail invite)</div>
          <div class="d-flex ga-4">
            <v-text-field v-model="form.ownerName" label="Owner name" :rules="[required]" />
            <v-text-field
              v-model="form.ownerEmail"
              label="Owner e-mail"
              type="email"
              :rules="[required, emailRule]"
            />
          </div>
          <v-select
            v-model="form.ownerRole"
            :items="[
              { title: 'Group owner (full tenant access)', value: 'group_owner' },
              { title: 'Institution owner', value: 'institution_owner' },
            ]"
            label="Owner role"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" type="submit" :loading="saving">Create</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
