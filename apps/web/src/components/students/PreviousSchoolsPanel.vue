<script setup lang="ts">
import type { StudentPreviousSchoolDto } from '@erp/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';

/**
 * Previous-school records of a student or an admission application: list, add / edit / delete
 * and upload / download the TC issued by the previous school.
 */
const props = defineProps<{
  owner: 'students' | 'admissions';
  ownerId: string;
  canEdit: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();

const items = ref<StudentPreviousSchoolDto[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const blank = () => ({
  schoolName: '',
  board: '',
  location: '',
  lastClass: '',
  lastAcademicYear: '',
  marksPercent: '' as string | number,
  grade: '',
  tcNumber: '',
  tcDate: '',
  remarks: '',
});
const form = reactive({ open: false, id: null as string | null, ...blank() });
const tcFile = ref<File | File[] | null>(null);
const confirmDelete = ref<StudentPreviousSchoolDto | null>(null);

async function load() {
  try {
    items.value = (
      await apiFetch<{ data: StudentPreviousSchoolDto[] }>(
        `/api/v1/${props.owner}/${props.ownerId}/previous-schools`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function openForm(row?: StudentPreviousSchoolDto) {
  Object.assign(form, blank(), { open: true, id: row?.id ?? null });
  if (row) {
    Object.assign(form, {
      schoolName: row.schoolName,
      board: row.board ?? '',
      location: row.location ?? '',
      lastClass: row.lastClass ?? '',
      lastAcademicYear: row.lastAcademicYear ?? '',
      marksPercent: row.marksPercent ?? '',
      grade: row.grade ?? '',
      tcNumber: row.tcNumber ?? '',
      tcDate: row.tcDate ?? '',
      remarks: row.remarks ?? '',
    });
  }
  tcFile.value = null;
  error.value = null;
}

async function save() {
  busy.value = true;
  error.value = null;
  const opt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const body = {
    schoolName: form.schoolName.trim(),
    board: opt(form.board),
    location: opt(form.location),
    lastClass: opt(form.lastClass),
    lastAcademicYear: opt(form.lastAcademicYear),
    marksPercent: form.marksPercent === '' ? null : Number(form.marksPercent),
    grade: opt(form.grade),
    tcNumber: opt(form.tcNumber),
    tcDate: form.tcDate || null,
    remarks: opt(form.remarks),
  };
  try {
    const saved = form.id
      ? await apiFetch<{ data: StudentPreviousSchoolDto }>(
          `/api/v1/students/previous-schools/${form.id}`,
          { method: 'PATCH', body: JSON.stringify(body) },
        )
      : await apiFetch<{ data: StudentPreviousSchoolDto }>(
          `/api/v1/${props.owner}/${props.ownerId}/previous-schools`,
          { method: 'POST', body: JSON.stringify(body) },
        );
    const file = Array.isArray(tcFile.value) ? tcFile.value[0] : tcFile.value;
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/v1/students/previous-schools/${saved.data.id}/tc-file`, {
        method: 'POST',
        body: fd,
      });
    }
    form.open = false;
    await load();
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirmDelete.value) return;
  try {
    await apiFetch(`/api/v1/students/previous-schools/${confirmDelete.value.id}`, {
      method: 'DELETE',
    });
    confirmDelete.value = null;
    await load();
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function downloadTc(row: StudentPreviousSchoolDto) {
  try {
    await apiDownload(
      `/api/v1/students/previous-schools/${row.id}/tc-file`,
      row.tcFileName ?? 'previous-school-tc',
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(load);
watch(() => props.ownerId, load);
</script>
<template>
  <div>
    <div class="d-flex align-center mb-2">
      <div class="text-subtitle-1">Previous schools</div>
      <v-spacer /><v-btn
        v-if="canEdit"
        prepend-icon="mdi-plus"
        size="small"
        color="primary"
        @click="openForm()"
        >Add previous school</v-btn
      >
    </div>
    <v-alert v-if="error && !form.open" type="error" density="compact" class="mb-2">{{
      error
    }}</v-alert>
    <v-table density="compact" data-testid="previous-schools-table"
      ><thead>
        <tr>
          <th>School</th>
          <th>Board</th>
          <th>Last class</th>
          <th>Year</th>
          <th>Marks</th>
          <th>Old TC no.</th>
          <th>TC file</th>
          <th v-if="canEdit"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!items.length">
          <td :colspan="canEdit ? 8 : 7" class="text-medium-emphasis">
            No previous-school records.
          </td>
        </tr>
        <tr v-for="r in items" :key="r.id">
          <td>
            {{ r.schoolName
            }}<span v-if="r.location" class="text-medium-emphasis"> · {{ r.location }}</span>
          </td>
          <td>{{ r.board || '—' }}</td>
          <td>{{ r.lastClass || '—' }}</td>
          <td>{{ r.lastAcademicYear || '—' }}</td>
          <td>
            {{
              [r.marksPercent != null ? `${r.marksPercent}%` : '', r.grade ?? '']
                .filter(Boolean)
                .join(' ') || '—'
            }}
          </td>
          <td>{{ r.tcNumber || '—' }}{{ r.tcDate ? ` (${r.tcDate})` : '' }}</td>
          <td>
            <v-btn
              v-if="r.tcDocumentId"
              size="small"
              variant="text"
              prepend-icon="mdi-download"
              @click="downloadTc(r)"
              >{{ r.tcFileName || 'Download' }}</v-btn
            ><span v-else class="text-medium-emphasis">—</span>
          </td>
          <td v-if="canEdit" class="text-no-wrap">
            <v-btn
              size="small"
              variant="text"
              icon="mdi-pencil"
              :aria-label="`Edit ${r.schoolName}`"
              @click="openForm(r)"
            /><v-btn
              size="small"
              variant="text"
              color="error"
              icon="mdi-delete-outline"
              :aria-label="`Delete ${r.schoolName}`"
              @click="confirmDelete = r"
            />
          </td>
        </tr></tbody
    ></v-table>
    <v-dialog v-model="form.open" max-width="640"
      ><v-card
        ><v-card-title>{{ form.id ? 'Edit previous school' : 'Add previous school' }}</v-card-title
        ><v-card-text
          ><v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert
          ><v-row dense
            ><v-col cols="12" md="8"
              ><v-text-field v-model="form.schoolName" label="School name" /></v-col
            ><v-col cols="12" md="4"
              ><v-combobox
                v-model="form.board"
                :items="['CBSE', 'ICSE', 'State Board', 'IB', 'IGCSE', 'NIOS']"
                label="Board" /></v-col
            ><v-col cols="12" md="6"
              ><v-text-field v-model="form.location" label="City / location" /></v-col
            ><v-col cols="12" md="3"
              ><v-text-field v-model="form.lastClass" label="Last class" /></v-col
            ><v-col cols="12" md="3"
              ><v-text-field
                v-model="form.lastAcademicYear"
                label="Year"
                placeholder="2025-2026" /></v-col
            ><v-col cols="12" md="3"
              ><v-text-field
                v-model="form.marksPercent"
                label="Marks %"
                type="number"
                min="0"
                max="100" /></v-col
            ><v-col cols="12" md="3"><v-text-field v-model="form.grade" label="Grade" /></v-col
            ><v-col cols="12" md="3"
              ><v-text-field v-model="form.tcNumber" label="Old TC no." /></v-col
            ><v-col cols="12" md="3"
              ><v-text-field v-model="form.tcDate" label="TC date" type="date" /></v-col
            ><v-col cols="12"
              ><v-file-input
                v-model="tcFile"
                label="Upload previous school TC (PDF / image)"
                accept="application/pdf,image/*"
                prepend-icon="mdi-paperclip" /></v-col
            ><v-col cols="12"
              ><v-textarea
                v-model="form.remarks"
                label="Remarks"
                rows="2"
                auto-grow /></v-col></v-row></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="form.open = false">Cancel</v-btn
          ><v-btn color="primary" :loading="busy" :disabled="!form.schoolName.trim()" @click="save"
            >Save</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-dialog
      :model-value="!!confirmDelete"
      max-width="420"
      @update:model-value="confirmDelete = null"
      ><v-card v-if="confirmDelete"
        ><v-card-title>Delete previous school</v-card-title
        ><v-card-text>Remove {{ confirmDelete.schoolName }} from the record?</v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="confirmDelete = null">Cancel</v-btn
          ><v-btn color="error" @click="remove">Delete</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
  </div>
</template>
