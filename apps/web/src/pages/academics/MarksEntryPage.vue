<script setup lang="ts">
import type { ApiListResponse, ExamMarksSheetDto, ExamScheduleDto, ExamTermDto } from '@erp/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const terms = ref<ExamTermDto[]>([]);
const termId = ref((route.query.termId as string) ?? '');
const papers = ref<ExamScheduleDto[]>([]);
const scheduleId = ref('');
const sheet = ref<ExamMarksSheetDto | null>(null);
const marks = ref<Record<string, { marks: number | null; isAbsent: boolean; remarks: string }>>({});
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const onlyMine = ref(!auth.can('exam.manage'));
const paperTitle = (p: ExamScheduleDto) =>
  `${p.classSection?.name ?? ''} · ${p.subject?.name ?? ''} (${p.examDate}) — ${p.marksStatus}`;

async function loadTerms() {
  try {
    terms.value = (
      await apiFetch<ApiListResponse<ExamTermDto>>('/api/v1/exams/terms?pageSize=100')
    ).data.filter((t) => t.status !== 'DRAFT');
    if (!termId.value) termId.value = terms.value.find((t) => t.status !== 'PUBLISHED')?.id ?? '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadPapers() {
  papers.value = [];
  scheduleId.value = '';
  if (!termId.value) return;
  try {
    papers.value = (
      await apiFetch<{ data: ExamScheduleDto[] }>(
        `/api/v1/exams/terms/${termId.value}/schedules${onlyMine.value ? '?mine=true' : ''}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadSheet() {
  sheet.value = null;
  if (!scheduleId.value) return;
  try {
    sheet.value = (
      await apiFetch<{ data: ExamMarksSheetDto }>(
        `/api/v1/exams/schedules/${scheduleId.value}/marks`,
      )
    ).data;
    marks.value = Object.fromEntries(
      sheet.value.rows.map((r) => [
        r.studentId,
        { marks: r.marks, isAbsent: r.isAbsent, remarks: r.remarks ?? '' },
      ]),
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const stats = computed(() => {
  if (!sheet.value) return null;
  const vals = Object.values(marks.value);
  const entered = vals.filter((v) => v.isAbsent || (v.marks !== null && String(v.marks) !== ''));
  const scores = vals
    .filter((v) => !v.isAbsent && typeof v.marks === 'number')
    .map((v) => v.marks!);
  const pass = scores.filter((m) => m >= sheet.value!.schedule.passMarks).length;
  return {
    entered: entered.length,
    total: vals.length,
    avg: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—',
    pass,
  };
});
async function save() {
  if (!sheet.value) return;
  error.value = null;
  try {
    await apiFetch(`/api/v1/exams/schedules/${scheduleId.value}/marks`, {
      method: 'PUT',
      body: JSON.stringify({
        marks: Object.entries(marks.value).map(([studentId, v]) => ({
          studentId,
          marks: v.isAbsent || v.marks === null || String(v.marks) === '' ? null : Number(v.marks),
          isAbsent: v.isAbsent,
          remarks: v.remarks || null,
        })),
      }),
    });
    info.value = 'Marks saved';
    await loadSheet();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function setLock(locked: boolean) {
  if (locked && !confirm('Lock marks? Further edits will need an exam publisher to unlock.'))
    return;
  try {
    await apiFetch(`/api/v1/exams/schedules/${scheduleId.value}/lock`, {
      method: 'POST',
      body: JSON.stringify({ locked }),
    });
    info.value = locked ? 'Marks locked' : 'Marks unlocked';
    await Promise.all([loadSheet(), loadPapers().then(() => undefined)]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(loadTerms);
watch([termId, onlyMine], loadPapers, { immediate: true });
watch(scheduleId, loadSheet);
</script>
<template>
  <h2 class="text-h5 mb-4">Marks entry</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="info" type="success" class="mb-3" closable @click:close="info = null">{{
    info
  }}</v-alert>
  <v-row dense
    ><v-col cols="12" md="4"
      ><v-select
        v-model="termId"
        :items="terms"
        item-title="name"
        item-value="id"
        label="Exam term"
        density="compact" /></v-col
    ><v-col cols="12" md="6"
      ><v-autocomplete
        v-model="scheduleId"
        :items="papers"
        :item-title="paperTitle"
        item-value="id"
        label="Paper (section · subject)"
        density="compact"
        no-data-text="No papers allocated to you in this term" /></v-col
    ><v-col cols="12" md="2"
      ><v-checkbox v-model="onlyMine" label="Only mine" density="compact" hide-details /></v-col
  ></v-row>
  <template v-if="sheet">
    <div class="d-flex ga-2 align-center mb-2 flex-wrap">
      <v-chip size="small"
        >Max {{ sheet.schedule.maxMarks }} · Pass {{ sheet.schedule.passMarks }}</v-chip
      >
      <v-chip v-if="stats" size="small">Entered {{ stats.entered }}/{{ stats.total }}</v-chip>
      <v-chip v-if="stats" size="small">Average {{ stats.avg }}</v-chip>
      <v-chip v-if="stats" size="small" color="success">Pass {{ stats.pass }}</v-chip>
      <v-chip
        size="small"
        :color="sheet.schedule.marksStatus === 'LOCKED' ? 'success' : 'warning'"
        >{{ sheet.schedule.marksStatus }}</v-chip
      >
      <v-spacer />
      <template v-if="sheet.editable">
        <v-btn color="primary" @click="save">Save marks</v-btn
        ><v-btn color="secondary" prepend-icon="mdi-lock" @click="setLock(true)">Lock</v-btn>
      </template>
      <v-btn
        v-else-if="sheet.schedule.marksStatus === 'LOCKED' && auth.can('exam.publish')"
        prepend-icon="mdi-lock-open"
        @click="setLock(false)"
        >Unlock</v-btn
      >
    </div>
    <v-table density="compact">
      <thead>
        <tr>
          <th>Roll</th>
          <th>Student</th>
          <th style="width: 140px">Marks</th>
          <th>Absent</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sheet.rows" :key="r.studentId">
          <td>{{ r.rollNo }}</td>
          <td>{{ r.displayName }}</td>
          <td>
            <v-text-field
              v-model.number="marks[r.studentId]!.marks"
              type="number"
              :min="0"
              :max="sheet.schedule.maxMarks"
              density="compact"
              hide-details
              :disabled="!sheet.editable || marks[r.studentId]!.isAbsent"
              :error="(marks[r.studentId]!.marks ?? 0) > sheet.schedule.maxMarks"
            />
          </td>
          <td>
            <v-checkbox
              v-model="marks[r.studentId]!.isAbsent"
              density="compact"
              hide-details
              :disabled="!sheet.editable"
            />
          </td>
          <td>
            <v-text-field
              v-model="marks[r.studentId]!.remarks"
              density="compact"
              hide-details
              :disabled="!sheet.editable"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
  </template>
</template>
