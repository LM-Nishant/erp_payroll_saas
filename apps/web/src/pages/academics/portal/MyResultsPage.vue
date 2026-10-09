<script setup lang="ts">
import type { ExamResultDto, OwnResultsDto } from '@erp/shared';
import { onMounted, ref, watch } from 'vue';
import { apiDownload, apiFetch, isNotLinked } from '@/api/client';
import { useWard } from './useWard';
import WardPicker from './WardPicker.vue';

const { wards, studentId, loadWards, withStudent } = useWard();
const data = ref<OwnResultsDto | null>(null);
const error = ref<string | null>(null);
const notLinked = ref(false);
async function load() {
  try {
    data.value = (
      await apiFetch<{ data: OwnResultsDto }>(withStudent('/api/v1/exams/my-results'))
    ).data;
  } catch (e) {
    if (isNotLinked(e)) notLinked.value = true;
    else error.value = (e as Error).message;
  }
}
async function download(r: ExamResultDto) {
  try {
    await apiDownload(
      `/api/v1/exams/my-results/${r.termId}/report-card/${r.studentId}`,
      `report-card-${r.term?.name ?? r.termId}.pdf`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await loadWards().catch(() => undefined);
  await load();
});
watch(studentId, load);
</script>
<template>
  <h2 class="text-h5 mb-4">
    Results<span v-if="data"> · {{ data.student.displayName }}</span>
  </h2>
  <WardPicker v-model="studentId" :wards="wards" />
  <v-alert v-if="notLinked" type="info" variant="tonal" class="mb-4"
    >Your account is not linked to a student record.</v-alert
  >
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <template v-else-if="data">
    <v-chip v-if="data.cgpa !== null" color="primary" class="mb-3">CGPA {{ data.cgpa }}</v-chip>
    <p v-if="!data.results.length" class="text-medium-emphasis">No published results yet.</p>
    <v-card v-for="r in data.results" :key="r.id" class="mb-3">
      <v-card-title class="d-flex align-center ga-2"
        >{{ r.term?.name
        }}<v-chip size="small" :color="r.passed ? 'success' : 'error'">{{
          r.passed ? 'PASS' : 'FAIL'
        }}</v-chip
        ><v-spacer /><v-btn size="small" prepend-icon="mdi-file-pdf-box" @click="download(r)"
          >Report card</v-btn
        ></v-card-title
      >
      <v-card-subtitle
        >{{ r.totalMarks }}/{{ r.maxTotal }} · {{ r.percentage }}% · Grade {{ r.grade }} · GPA
        {{ r.gpa }} · Rank {{ r.rank }}</v-card-subtitle
      >
      <v-card-text>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Marks</th>
              <th>Max</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in r.subjects" :key="s.subjectId">
              <td>{{ s.name }}</td>
              <td :class="{ 'text-error': !s.passed }">{{ s.isAbsent ? 'Absent' : s.marks }}</td>
              <td>{{ s.maxMarks }}</td>
              <td>{{ s.grade }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </template>
</template>
