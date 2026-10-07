<script setup lang="ts">
import type { ApiListResponse, DefaulterDto } from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errorText, loadClassSections, loadInstitutions, money, qs, type Option } from './fees';

const auth = useAuthStore();
const router = useRouter();
const canManage = computed(() => auth.can('fee.manage'));
const canCollect = computed(() => auth.can('fee.collect'));
const items = ref<DefaulterDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const institutions = ref<Option[]>([]);
const sections = ref<Option[]>([]);
const filters = reactive({ institutionId: '', classSectionId: '', minDays: 1 });
const headers = [
  { title: 'Admission no', key: 'admissionNo' },
  { title: 'Student', key: 'displayName' },
  { title: 'Class', key: 'classSectionName' },
  { title: 'Invoices', key: 'invoiceCount', align: 'end' as const },
  { title: 'Oldest due', key: 'oldestDueDate' },
  { title: 'Days overdue', key: 'daysOverdue', align: 'end' as const },
  { title: 'Bucket', key: 'bucket' },
  { title: 'Balance', key: 'balance', align: 'end' as const },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<DefaulterDto>>(
      `/api/v1/fees/defaulters?${qs({ page: page.value, pageSize: 25, ...filters })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
const scopeBody = () =>
  JSON.stringify({
    ...(filters.institutionId ? { institutionId: filters.institutionId } : {}),
    ...(filters.classSectionId ? { classSectionId: filters.classSectionId } : {}),
    minDays: Number(filters.minDays),
  });
async function sendReminders() {
  try {
    const r = await apiFetch<{ data: { sent: number; defaulters: number } }>(
      '/api/v1/fees/reminders/send',
      { method: 'POST', body: scopeBody() },
    );
    info.value = `Reminders sent to ${r.data.sent} of ${r.data.defaulters} defaulter(s) (recently reminded students are skipped).`;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function applyLate() {
  try {
    const r = await apiFetch<{ data: { updated: number; amount: number } }>(
      '/api/v1/fees/late-fees/apply',
      {
        method: 'POST',
        body: JSON.stringify(filters.institutionId ? { institutionId: filters.institutionId } : {}),
      },
    );
    info.value = `Late fees applied to ${r.data.updated} invoice(s), total ${money(r.data.amount)}.`;
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(async () => {
  [institutions.value, sections.value] = await Promise.all([
    loadInstitutions(),
    loadClassSections(),
  ]);
  await load();
});
watch([page, () => ({ ...filters })], load, { deep: true });
</script>
<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Fee defaulters</h2>
    <v-spacer />
    <template v-if="canManage"
      ><v-btn variant="tonal" class="mr-2" prepend-icon="mdi-timer-alert" @click="applyLate"
        >Apply late fees</v-btn
      ><v-btn color="primary" prepend-icon="mdi-bell-ring" @click="sendReminders"
        >Send reminders</v-btn
      ></template
    >
  </div>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-row dense class="mb-2"
    ><v-col cols="12" md="5"
      ><v-select
        v-model="filters.institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Institution"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="5"
      ><v-autocomplete
        v-model="filters.classSectionId"
        :items="sections"
        item-title="name"
        item-value="id"
        label="Class section"
        clearable
        density="compact"
        hide-details /></v-col
    ><v-col cols="12" md="2"
      ><v-text-field
        v-model.number="filters.minDays"
        label="Min days overdue"
        type="number"
        density="compact"
        hide-details /></v-col
  ></v-row>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    item-value="studentId"
    @update:page="page = $event"
  >
    <template #[`item.balance`]="{ item }">{{ money(item.balance) }}</template>
    <template #[`item.bucket`]="{ item }"
      ><v-chip size="small" :color="item.bucket === '90+' ? 'error' : undefined">{{
        item.bucket
      }}</v-chip></template
    >
    <template #[`item.actions`]="{ item }"
      ><v-btn
        v-if="canCollect"
        size="small"
        variant="text"
        @click="
          router.push({
            path: router.currentRoute.value.path.replace(/defaulters$/, 'collect'),
            query: { studentId: item.studentId },
          })
        "
        >Collect</v-btn
      ></template
    >
  </v-data-table-server>
</template>
