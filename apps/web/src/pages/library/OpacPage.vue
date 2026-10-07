<script setup lang="ts">
import {
  LIBRARY_ITEM_TYPES,
  type ApiListResponse,
  type LibraryBookDto,
  type LibraryItemType,
} from '@erp/shared';
import type { MyLibraryDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { qs } from './library';

/** OPAC: catalogue search for students, parents and staff (with self-service reservation). */
const auth = useAuthStore();
const items = ref<LibraryBookDto[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const filters = reactive({ search: '', itemType: null as LibraryItemType | null });
const members = ref<MyLibraryDto['members']>([]);
const reserveFor = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await apiFetch<ApiListResponse<LibraryBookDto>>(
      `/api/v1/library/opac?${qs({
        page: page.value,
        pageSize: 20,
        search: filters.search,
        itemType: filters.itemType,
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
async function loadMembers() {
  if (!auth.can('library.view_own')) return;
  try {
    members.value = (await apiFetch<{ data: MyLibraryDto }>('/api/v1/library/me')).data.members;
    const student = members.value.find((m) => m.studentId);
    reserveFor.value = student?.studentId ?? null;
  } catch {
    members.value = [];
  }
}
async function reserve(b: LibraryBookDto) {
  error.value = null;
  try {
    await apiFetch('/api/v1/library/me/reservations', {
      method: 'POST',
      body: JSON.stringify({
        bookId: b.id,
        ...(reserveFor.value ? { studentId: reserveFor.value } : {}),
      }),
    });
    message.value = `Reserved “${b.title}”. You will be notified when it is ready for pickup.`;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await Promise.all([load(), loadMembers()]);
});
watch([page, () => filters.itemType], load);
let timer: ReturnType<typeof setTimeout>;
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    page.value = 1;
    timer = setTimeout(load, 300);
  },
);
</script>
<template>
  <h2 class="text-h5 mb-4">Library catalogue</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="message" type="success" class="mb-3" closable @click:close="message = null">{{
    message
  }}</v-alert>
  <v-row dense class="mb-2">
    <v-col cols="12" md="6"
      ><v-text-field
        v-model="filters.search"
        label="Search by title, author, ISBN, subject or tag"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        hide-details
    /></v-col>
    <v-col cols="12" md="3"
      ><v-select
        v-model="filters.itemType"
        :items="[...LIBRARY_ITEM_TYPES]"
        label="Type"
        density="compact"
        clearable
        hide-details
    /></v-col>
    <v-col v-if="members.filter((m) => m.studentId).length > 1" cols="12" md="3"
      ><v-select
        v-model="reserveFor"
        :items="members.filter((m) => m.studentId)"
        item-title="name"
        item-value="studentId"
        label="Reserve for"
        density="compact"
        hide-details
    /></v-col>
  </v-row>
  <v-progress-linear v-if="loading" indeterminate />
  <v-row dense>
    <v-col v-for="b in items" :key="b.id" cols="12" md="6" lg="4">
      <v-card height="100%">
        <v-card-title class="text-wrap">{{ b.title }}</v-card-title>
        <v-card-subtitle>{{ b.authors.join(', ') }}</v-card-subtitle>
        <v-card-text>
          <div class="text-body-2">
            {{ [b.publisher, b.edition, b.publicationYear].filter(Boolean).join(' · ') }}
          </div>
          <div class="text-body-2">
            {{ b.category }}<span v-if="b.callNumber"> · {{ b.callNumber }}</span>
            <span v-if="b.institution"> · {{ b.institution.name }}</span>
          </div>
          <v-chip
            v-if="b.itemType !== 'E_RESOURCE'"
            size="small"
            class="mt-2"
            :color="b.availableCopies ? 'success' : 'warning'"
            >{{
              b.availableCopies
                ? `${b.availableCopies} of ${b.totalCopies} available`
                : 'All copies on loan'
            }}</v-chip
          >
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="b.url"
            :href="b.url"
            target="_blank"
            rel="noopener"
            variant="text"
            prepend-icon="mdi-open-in-new"
            >Open</v-btn
          >
          <v-spacer />
          <v-btn
            v-if="members.length && b.itemType !== 'E_RESOURCE' && b.totalCopies"
            variant="text"
            color="primary"
            prepend-icon="mdi-bookmark-plus"
            @click="reserve(b)"
            >Reserve</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
  <v-pagination
    v-if="total > 20"
    v-model="page"
    :length="Math.ceil(total / 20)"
    class="mt-4"
    total-visible="7"
  />
</template>
