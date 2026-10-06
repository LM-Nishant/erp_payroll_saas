<script setup lang="ts">
import type { ApiListResponse, PayrollRunDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { label, useHrOptions, type Option } from '@/pages/hr/useHrOptions';
import { RUN_STATUS_COLORS, firstOfMonth, lastOfMonth, money } from './payroll';

/** Payroll runs per institution (and group batches across institutions, §53). */
const auth = useAuthStore();
const router = useRouter();
const { institutions, loadBase } = useHrOptions();
const groups = ref<Option[]>([]);
const institutionId = ref<string | null>(null);
const items = ref<PayrollRunDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const canProcess = computed(() => auth.can('payroll.process'));

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: '20' });
    if (institutionId.value) q.set('institutionId', institutionId.value);
    const res = await apiFetch<ApiListResponse<PayrollRunDto>>(`/api/v1/payroll/runs?${q}`);
    items.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadBase()]);
  groups.value = await apiFetch<ApiListResponse<Option>>('/api/v1/groups?pageSize=100')
    .then((r) => r.data)
    .catch(() => []);
});
watch([institutionId, page], load);

const dialog = reactive({
  open: false,
  mode: 'institution' as 'institution' | 'group',
  institutionId: null as string | null,
  groupId: null as string | null,
  periodStart: firstOfMonth(),
  label: '',
});
async function create() {
  const period = { periodStart: dialog.periodStart, periodEnd: lastOfMonth(dialog.periodStart) };
  const extra = dialog.label.trim() ? { label: dialog.label.trim() } : {};
  try {
    if (dialog.mode === 'institution') {
      const run = (
        await apiFetch<{ data: PayrollRunDto }>('/api/v1/payroll/runs', {
          method: 'POST',
          body: JSON.stringify({ institutionId: dialog.institutionId, ...period, ...extra }),
        })
      ).data;
      dialog.open = false;
      await router.push(`/hr/payroll/runs/${run.id}`);
    } else {
      await apiFetch('/api/v1/payroll/batches', {
        method: 'POST',
        body: JSON.stringify({ groupId: dialog.groupId, ...period, ...extra }),
      });
      dialog.open = false;
      await load();
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function onRow(_e: unknown, row: { item: PayrollRunDto }) {
  void router.push(`/hr/payroll/runs/${row.item.id}`);
}

const headers = [
  { title: 'Label', key: 'label' },
  { title: 'Institution', key: 'institutionName' },
  { title: 'Period', key: 'periodStart' },
  { title: 'Rev', key: 'revision' },
  { title: 'Status', key: 'status' },
  { title: 'Employees', key: 'employeeCount', align: 'end' as const },
  { title: 'Net', key: 'netTotal', align: 'end' as const },
];
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <h2 class="text-h5">Payroll runs</h2>
    <v-spacer />
    <v-select
      v-model="institutionId"
      :items="institutions"
      item-title="name"
      item-value="id"
      label="Institution"
      clearable
      density="compact"
      hide-details
      style="max-width: 280px"
    />
    <v-btn v-if="canProcess" color="primary" prepend-icon="mdi-plus" @click="dialog.open = true">
      New run
    </v-btn>
  </div>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>

  <v-data-table-server
    v-model:page="page"
    :headers="headers"
    :items="items"
    :items-length="total"
    :loading="loading"
    items-per-page="20"
    hover
    @click:row="onRow"
  >
    <template #[`item.periodStart`]="{ item }"
      >{{ item.periodStart }} → {{ item.periodEnd }}</template
    >
    <template #[`item.status`]="{ item }">
      <v-chip :color="RUN_STATUS_COLORS[item.status]" size="small">{{ label(item.status) }}</v-chip>
    </template>
    <template #[`item.netTotal`]="{ item }">{{ money(item.netTotal) }}</template>
  </v-data-table-server>

  <v-dialog v-model="dialog.open" max-width="520">
    <v-card title="New payroll run">
      <v-card-text>
        <v-btn-toggle v-model="dialog.mode" mandatory class="mb-4" color="primary">
          <v-btn value="institution">Institution</v-btn>
          <v-btn value="group">Group batch</v-btn>
        </v-btn-toggle>
        <v-select
          v-if="dialog.mode === 'institution'"
          v-model="dialog.institutionId"
          :items="institutions"
          item-title="name"
          item-value="id"
          label="Institution"
        />
        <v-select
          v-else
          v-model="dialog.groupId"
          :items="groups"
          item-title="name"
          item-value="id"
          label="Group (one run per institution)"
        />
        <v-text-field v-model="dialog.periodStart" type="date" label="Period start" />
        <v-text-field v-model="dialog.label" label="Label (optional)" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="create">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
