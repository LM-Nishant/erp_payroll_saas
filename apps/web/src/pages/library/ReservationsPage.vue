<script setup lang="ts">
import {
  LIBRARY_RESERVATION_STATUSES,
  type ApiListResponse,
  type LibraryBookDto,
  type LibraryMemberDto,
  type LibraryReservationDto,
  type LibraryReservationStatus,
} from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import LibraryTabs from './LibraryTabs.vue';
import { STATUS_COLOR, fmtDate, qs, useLibraryInstitutions } from './library';

const auth = useAuthStore();
const { institutions, institutionId, loadInstitutions } = useLibraryInstitutions();
const items = ref<LibraryReservationDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<LibraryReservationStatus | null>('WAITING');
const headers = [
  { title: 'Title', key: 'book.title' },
  { title: 'Member', key: 'memberName' },
  { title: 'Type', key: 'memberType' },
  { title: 'Queue', key: 'position' },
  { title: 'Status', key: 'status' },
  { title: 'Held copy', key: 'copy.barcode' },
  { title: 'Hold until', key: 'expiresAt' },
  { title: 'Requested', key: 'createdAt' },
  { title: '', key: 'actions', sortable: false },
];

const formOpen = ref(false);
const form = reactive({
  bookId: '',
  memberType: 'STUDENT' as 'STUDENT' | 'EMPLOYEE',
  memberId: '',
});
const bookSearch = ref('');
const books = ref<LibraryBookDto[]>([]);
const memberSearch = ref('');
const members = ref<LibraryMemberDto[]>([]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<LibraryReservationDto>>(
      `/api/v1/library/reservations?${qs({
        page: page.value,
        pageSize: 25,
        institutionId: institutionId.value,
        status: status.value,
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
async function cancel(r: LibraryReservationDto) {
  if (!confirm(`Cancel ${r.memberName}'s reservation?`)) return;
  try {
    await apiFetch(`/api/v1/library/reservations/${r.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function findBooks() {
  books.value = (
    await apiFetch<ApiListResponse<LibraryBookDto>>(
      `/api/v1/library/books?${qs({ search: bookSearch.value, pageSize: 20 })}`,
    )
  ).data;
}
async function findMembers() {
  const book = books.value.find((b) => b.id === form.bookId);
  members.value = (
    await apiFetch<ApiListResponse<LibraryMemberDto>>(
      `/api/v1/library/members?${qs({
        memberType: form.memberType,
        search: memberSearch.value,
        institutionId: book?.institutionId,
        pageSize: 20,
      })}`,
    )
  ).data;
}
async function create() {
  try {
    await apiFetch('/api/v1/library/reservations', {
      method: 'POST',
      body: JSON.stringify({
        bookId: form.bookId,
        ...(form.memberType === 'STUDENT'
          ? { studentId: form.memberId }
          : { employeeId: form.memberId }),
      }),
    });
    formOpen.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadInstitutions();
  await load();
});
watch([page, institutionId, status], load);
let t1: ReturnType<typeof setTimeout>;
let t2: ReturnType<typeof setTimeout>;
watch(bookSearch, () => {
  clearTimeout(t1);
  t1 = setTimeout(() => void findBooks(), 300);
});
watch([memberSearch, () => form.memberType], () => {
  clearTimeout(t2);
  t2 = setTimeout(() => void findMembers(), 300);
});
</script>
<template>
  <LibraryTabs title="Reservations">
    <template #actions>
      <v-btn
        v-if="auth.can('library.circulate')"
        color="primary"
        prepend-icon="mdi-bookmark-plus"
        @click="formOpen = true"
        >New reservation</v-btn
      >
    </template>
  </LibraryTabs>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="4"
      ><v-select
        v-model="status"
        :items="[...LIBRARY_RESERVATION_STATUSES]"
        label="Status"
        density="compact"
        clearable
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
  <v-data-table-server
    :headers="headers"
    :items="items"
    :items-length="total"
    :page="page"
    :loading="loading"
    item-value="id"
    @update:page="page = $event"
  >
    <template #[`item.status`]="{ item }">
      <v-chip size="small" :color="STATUS_COLOR[item.status]">{{ item.status }}</v-chip>
    </template>
    <template #[`item.expiresAt`]="{ item }">{{ fmtDate(item.expiresAt) }}</template>
    <template #[`item.createdAt`]="{ item }">{{ fmtDate(item.createdAt) }}</template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        v-if="auth.can('library.circulate') && ['WAITING', 'READY'].includes(item.status)"
        size="small"
        variant="text"
        color="error"
        @click="cancel(item)"
        >Cancel</v-btn
      >
    </template>
  </v-data-table-server>

  <v-dialog v-model="formOpen" max-width="560">
    <v-card>
      <v-card-title>New reservation</v-card-title>
      <v-card-text>
        <v-autocomplete
          v-model="form.bookId"
          v-model:search="bookSearch"
          :items="books"
          :item-title="(b: LibraryBookDto) => `${b.title} (${b.availableCopies}/${b.totalCopies})`"
          item-value="id"
          label="Title"
          no-filter
        />
        <v-btn-toggle v-model="form.memberType" mandatory density="compact" class="mb-3">
          <v-btn value="STUDENT">Student</v-btn>
          <v-btn value="EMPLOYEE">Staff</v-btn>
        </v-btn-toggle>
        <v-autocomplete
          v-model="form.memberId"
          v-model:search="memberSearch"
          :items="members"
          :item-title="(m: LibraryMemberDto) => `${m.name} (${m.code ?? '—'})`"
          item-value="id"
          label="Member"
          no-filter
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="formOpen = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!form.bookId || !form.memberId" @click="create"
          >Reserve</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
