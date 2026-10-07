<script setup lang="ts">
import type {
  ApiListResponse,
  LibraryBookDto,
  LibraryCopyDto,
  LibraryLoanDto,
  LibraryReservationDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiBlob, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { STATUS_COLOR, fmtDate } from './library';

type BookDetail = LibraryBookDto & { copies: LibraryCopyDto[] };
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));
const book = ref<BookDetail | null>(null);
const loans = ref<LibraryLoanDto[]>([]);
const reservations = ref<LibraryReservationDto[]>([]);
const error = ref<string | null>(null);
const coverUrl = ref<string | null>(null);
const addOpen = ref(false);
const add = reactive({ count: 1, shelf: '', rack: '', price: '' as string | number });
const editCopy = ref<LibraryCopyDto | null>(null);
const editForm = reactive({ shelf: '', rack: '', status: 'AVAILABLE', condition: '', notes: '' });

async function loadCover() {
  if (!book.value?.coverDocumentId) return;
  try {
    if (coverUrl.value) URL.revokeObjectURL(coverUrl.value);
    coverUrl.value = URL.createObjectURL(await apiBlob(`/api/v1/library/books/${id.value}/cover`));
  } catch {
    coverUrl.value = null;
  }
}
async function load() {
  error.value = null;
  try {
    book.value = (await apiFetch<{ data: BookDetail }>(`/api/v1/library/books/${id.value}`)).data;
    const [l, r] = await Promise.all([
      apiFetch<ApiListResponse<LibraryLoanDto>>(
        `/api/v1/library/loans?bookId=${id.value}&pageSize=20`,
      ),
      apiFetch<ApiListResponse<LibraryReservationDto>>(
        `/api/v1/library/reservations?bookId=${id.value}&pageSize=50`,
      ),
    ]);
    loans.value = l.data;
    reservations.value = r.data.filter((x) => x.status === 'WAITING' || x.status === 'READY');
    await loadCover();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function addCopies() {
  try {
    await apiFetch('/api/v1/library/copies', {
      method: 'POST',
      body: JSON.stringify({
        bookId: id.value,
        count: Number(add.count) || 1,
        shelf: add.shelf || null,
        rack: add.rack || null,
        price: add.price === '' ? null : Number(add.price),
      }),
    });
    addOpen.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function openEdit(c: LibraryCopyDto) {
  editCopy.value = c;
  Object.assign(editForm, {
    shelf: c.shelf ?? '',
    rack: c.rack ?? '',
    status: c.status,
    condition: c.condition ?? '',
    notes: c.notes ?? '',
  });
}
async function saveCopy() {
  if (!editCopy.value) return;
  const manual = ['AVAILABLE', 'LOST', 'DAMAGED', 'WITHDRAWN'];
  try {
    await apiFetch(`/api/v1/library/copies/${editCopy.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        shelf: editForm.shelf || null,
        rack: editForm.rack || null,
        condition: editForm.condition || null,
        notes: editForm.notes || null,
        ...(manual.includes(editForm.status) && editForm.status !== editCopy.value.status
          ? { status: editForm.status }
          : {}),
      }),
    });
    editCopy.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function labels() {
  try {
    const blob = await apiBlob('/api/v1/library/labels', {
      method: 'POST',
      body: JSON.stringify({ bookId: id.value }),
    });
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function uploadCover(files: File | File[]) {
  const file = Array.isArray(files) ? files[0] : files;
  if (!file) return;
  const body = new FormData();
  body.set('file', file);
  try {
    await apiFetch(`/api/v1/library/books/${id.value}/cover`, { method: 'POST', body });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove() {
  if (!confirm('Withdraw all copies and delete this title?')) return;
  try {
    await apiFetch(`/api/v1/library/books/${id.value}`, { method: 'DELETE' });
    router.back();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
</script>
<template>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <template v-if="book">
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.back()" />
      <h2 class="text-h5">{{ book.title }}</h2>
      <v-chip class="ml-2" size="small">{{ book.itemType }}</v-chip>
      <v-spacer />
      <template v-if="auth.can('library.manage')">
        <v-btn variant="text" prepend-icon="mdi-barcode" @click="labels">Labels PDF</v-btn>
        <v-btn variant="text" prepend-icon="mdi-plus" @click="addOpen = true">Add copies</v-btn>
        <v-btn variant="text" color="error" prepend-icon="mdi-delete" @click="remove">Delete</v-btn>
      </template>
    </div>
    <v-row>
      <v-col cols="12" md="3">
        <v-card>
          <v-img v-if="coverUrl" :src="coverUrl" height="260" cover />
          <div
            v-else
            class="d-flex align-center justify-center bg-grey-lighten-3"
            style="height: 260px"
          >
            <v-icon icon="mdi-book-open-page-variant" size="64" />
          </div>
          <v-card-text v-if="auth.can('library.manage')">
            <v-file-input
              label="Upload cover"
              accept="image/*"
              density="compact"
              hide-details
              @update:model-value="uploadCover"
            />
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="9">
        <v-card>
          <v-card-text>
            <v-row dense>
              <v-col cols="12" md="6"><b>Authors:</b> {{ book.authors.join(', ') || '—' }}</v-col>
              <v-col cols="12" md="6"><b>ISBN:</b> {{ book.isbn || '—' }}</v-col>
              <v-col cols="12" md="6"><b>Publisher:</b> {{ book.publisher || '—' }}</v-col>
              <v-col cols="12" md="6"
                ><b>Edition / year:</b> {{ book.edition || '—' }} /
                {{ book.publicationYear || '—' }}</v-col
              >
              <v-col cols="12" md="6"><b>Category:</b> {{ book.category || '—' }}</v-col>
              <v-col cols="12" md="6"><b>Language:</b> {{ book.language || '—' }}</v-col>
              <v-col cols="12" md="6"><b>Call number:</b> {{ book.callNumber || '—' }}</v-col>
              <v-col cols="12" md="6"
                ><b>Library:</b> {{ book.institution?.name ?? book.institutionId }}</v-col
              >
              <v-col v-if="book.url" cols="12"
                ><b>Link:</b>
                <a :href="book.url" target="_blank" rel="noopener">{{ book.url }}</a></v-col
              >
              <v-col v-if="book.tags.length" cols="12">
                <v-chip v-for="t in book.tags" :key="t" size="small" class="mr-1">{{ t }}</v-chip>
              </v-col>
              <v-col v-if="book.description" cols="12">{{ book.description }}</v-col>
            </v-row>
          </v-card-text>
        </v-card>
        <v-card class="mt-4">
          <v-card-title
            >Copies ({{ book.availableCopies }} available / {{ book.totalCopies }})</v-card-title
          >
          <v-table density="compact">
            <thead>
              <tr>
                <th>Accession no</th>
                <th>Barcode</th>
                <th>Shelf / rack</th>
                <th>Condition</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in book.copies" :key="c.id">
                <td>{{ c.accessionNo }}</td>
                <td>{{ c.barcode }}</td>
                <td>{{ c.shelf || '—' }} / {{ c.rack || '—' }}</td>
                <td>{{ c.condition || '—' }}</td>
                <td>
                  <v-chip size="small" :color="STATUS_COLOR[c.status]">{{ c.status }}</v-chip>
                </td>
                <td class="text-right">
                  <v-btn
                    v-if="auth.can('library.manage')"
                    icon="mdi-pencil"
                    size="small"
                    variant="text"
                    @click="openEdit(c)"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
        <v-card v-if="reservations.length" class="mt-4">
          <v-card-title>Reservation queue</v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="r in reservations"
              :key="r.id"
              :title="r.memberName"
              :subtitle="`${r.status}${r.position ? ` · #${r.position}` : ''}${r.expiresAt ? ` · hold until ${fmtDate(r.expiresAt)}` : ''}`"
            />
          </v-list>
        </v-card>
        <v-card class="mt-4">
          <v-card-title>Circulation history</v-card-title>
          <v-table density="compact">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Member</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Returned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in loans" :key="l.id">
                <td>{{ l.copy?.barcode }}</td>
                <td>{{ l.memberName }}</td>
                <td>{{ fmtDate(l.issuedAt) }}</td>
                <td>{{ fmtDate(l.dueDate) }}</td>
                <td>{{ fmtDate(l.returnedAt) }}</td>
                <td>
                  <v-chip size="small" :color="l.overdue ? 'error' : STATUS_COLOR[l.status]">{{
                    l.overdue ? 'OVERDUE' : l.status
                  }}</v-chip>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
    </v-row>
  </template>

  <v-dialog v-model="addOpen" max-width="480">
    <v-card>
      <v-card-title>Add copies</v-card-title>
      <v-card-text>
        <v-text-field v-model="add.count" label="Number of copies" type="number" />
        <v-text-field v-model="add.shelf" label="Shelf" />
        <v-text-field v-model="add.rack" label="Rack" />
        <v-text-field v-model="add.price" label="Price" type="number" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="addOpen = false">Cancel</v-btn>
        <v-btn color="primary" @click="addCopies">Add</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog :model-value="!!editCopy" max-width="480" @update:model-value="editCopy = null">
    <v-card v-if="editCopy">
      <v-card-title>Copy {{ editCopy.accessionNo }}</v-card-title>
      <v-card-text>
        <v-text-field v-model="editForm.shelf" label="Shelf" />
        <v-text-field v-model="editForm.rack" label="Rack" />
        <v-text-field v-model="editForm.condition" label="Condition" />
        <v-select
          v-model="editForm.status"
          :items="
            ['ISSUED', 'RESERVED'].includes(editCopy.status)
              ? [editCopy.status]
              : ['AVAILABLE', 'LOST', 'DAMAGED', 'WITHDRAWN']
          "
          label="Status"
        />
        <v-textarea v-model="editForm.notes" label="Notes" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="editCopy = null">Cancel</v-btn>
        <v-btn color="primary" @click="saveCopy">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
