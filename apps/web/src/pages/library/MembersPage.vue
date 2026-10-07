<script setup lang="ts">
import type { ApiListResponse, LibraryMemberDto, LibraryMemberSummaryDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import LibraryTabs from './LibraryTabs.vue';
import MemberLibraryCard from './MemberLibraryCard.vue';
import { money, qs, useLibraryInstitutions } from './library';

const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const memberType = ref<'STUDENT' | 'EMPLOYEE'>('STUDENT');
const search = ref('');
const items = ref<LibraryMemberDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const detail = ref<LibraryMemberSummaryDto | null>(null);
const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Code', key: 'code' },
  { title: 'Class', key: 'classSection' },
  { title: 'On loan', key: 'activeLoans' },
  { title: 'Overdue', key: 'overdueLoans' },
  { title: 'Pending fines', key: 'pendingFines' },
];
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<LibraryMemberDto>>(
      `/api/v1/library/members?${qs({
        page: page.value,
        pageSize: 25,
        memberType: memberType.value,
        institutionId: institutionId.value,
        search: search.value,
      })}`,
    );
    items.value = r.data;
    total.value = r.meta.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function open(_e: unknown, row: { item: LibraryMemberDto }) {
  try {
    detail.value = (
      await apiFetch<{ data: LibraryMemberSummaryDto }>(
        `/api/v1/library/members/${row.item.memberType.toLowerCase()}/${row.item.id}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadInstitutions();
  await load();
});
watch([page, institutionId, memberType], load);
let timer: ReturnType<typeof setTimeout>;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
});
</script>
<template>
  <LibraryTabs title="Members" />
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="3">
      <v-btn-toggle v-model="memberType" mandatory density="compact" color="primary">
        <v-btn value="STUDENT">Students</v-btn>
        <v-btn value="EMPLOYEE">Staff</v-btn>
      </v-btn-toggle>
    </v-col>
    <v-col cols="12" md="5"
      ><v-text-field
        v-model="search"
        label="Search name / code"
        density="compact"
        prepend-inner-icon="mdi-magnify"
        hide-details
    /></v-col>
    <v-col v-if="institutions.length > 1" cols="12" md="4"
      ><v-select
        v-model="institutionId"
        :items="institutions"
        item-title="name"
        item-value="id"
        label="Library"
        density="compact"
        clearable
        hide-details
    /></v-col>
  </v-row>
  <p class="text-caption mb-2">
    All active students and employees are library members automatically; limits come from the
    membership policy per member type (Settings).
  </p>
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    item-value="id"
    hover
    @update:page="page = $event"
    @click:row="open"
  >
    <template #[`item.overdueLoans`]="{ item }">
      <span :class="item.overdueLoans ? 'text-error' : ''">{{ item.overdueLoans }}</span>
    </template>
    <template #[`item.pendingFines`]="{ item }">{{ money(item.pendingFines) }}</template>
  </v-data-table-server>
  <v-dialog :model-value="!!detail" max-width="900" @update:model-value="detail = null">
    <v-card v-if="detail">
      <v-card-text><MemberLibraryCard :member="detail" /></v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="detail = null">Close</v-btn></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
