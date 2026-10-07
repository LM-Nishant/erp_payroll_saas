<script setup lang="ts">
import type { MyClassDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const classes = ref<MyClassDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);
onMounted(async () => {
  try {
    classes.value = (
      await apiFetch<{ data: MyClassDto[] }>('/api/v1/subject-allocations/my-classes')
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <h2 class="text-h5 mb-4">My classes</h2>
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <v-progress-linear v-else-if="loading" indeterminate />
  <v-alert v-else-if="!classes.length" type="info" variant="tonal"
    >No class sections are allocated to you yet.</v-alert
  >
  <v-row v-else>
    <v-col v-for="c in classes" :key="c.classSection.id" cols="12" md="6" lg="4">
      <v-card>
        <v-card-title class="d-flex align-center"
          >{{ c.classSection.name }}<v-spacer /><v-chip
            v-if="c.isClassTeacher"
            size="small"
            color="primary"
            >Class teacher</v-chip
          ></v-card-title
        >
        <v-card-subtitle
          >{{ c.studentCount }} students · {{ c.classSection.academicYear }}</v-card-subtitle
        >
        <v-card-text>
          <v-chip v-for="s in c.subjects" :key="s.id" size="small" class="mr-1 mb-1">{{
            s.name
          }}</v-chip>
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="auth.can('student_attendance.mark') || auth.can('student_attendance.manage')"
            size="small"
            prepend-icon="mdi-calendar-check"
            :to="{ path: 'student-attendance', query: { classSectionId: c.classSection.id } }"
            >Attendance</v-btn
          >
          <v-btn
            v-if="auth.can('exam.marks_entry')"
            size="small"
            prepend-icon="mdi-pencil-box"
            :to="{ path: 'marks-entry' }"
            >Marks</v-btn
          >
          <v-btn size="small" prepend-icon="mdi-timetable" :to="{ path: 'timetable' }"
            >Timetable</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
</template>
