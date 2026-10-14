<script setup lang="ts">
import type {
  ApiListResponse,
  ClassTeacherDto,
  SubjectAllocationDto,
  SubjectDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { PAGE_SIZE_OPTIONS, useServerList } from '@/lib/serverList';
import { useAuthStore } from '@/stores/auth';
import { teacherOptions, useAcademicOptions } from './useAcademics';

const auth = useAuthStore();
const { sections, load: loadOptions } = useAcademicOptions();
const sectionId = ref('');
const subjects = ref<SubjectDto[]>([]);
const teachers = ref<{ id: string; title: string }[]>([]);
const classTeacher = ref<ClassTeacherDto | null>(null);
const classTeacherId = ref<string | null>(null);
const error = ref<string | null>(null);
const allocations = useServerList<SubjectAllocationDto>('/api/v1/subject-allocations', {
  error,
  pageSize: 50,
  immediate: false,
  enabled: () => !!sectionId.value,
  params: () => ({ classSectionId: sectionId.value }),
});
const { items, total, page, pageSize, loading } = allocations;
const form = reactive({ subjectId: '', teacherUserId: '' });
const canManage = computed(() => auth.can('subject.manage'));
const section = computed(() => sections.value.find((s) => s.id === sectionId.value));
const headers = [
  { title: 'Subject', key: 'subject.name' },
  { title: 'Code', key: 'subject.code' },
  { title: 'Teacher', key: 'teacher.name' },
  { title: 'Email', key: 'teacher.email' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

/** Subjects, class teacher and teacher options of the selected section. */
async function loadSection() {
  if (!sectionId.value) return;
  error.value = null;
  try {
    const [s, ct] = await Promise.all([
      apiFetch<ApiListResponse<SubjectDto>>(
        `/api/v1/subjects?classSectionId=${sectionId.value}&pageSize=100`,
      ),
      apiFetch<{ data: ClassTeacherDto | null }>(
        `/api/v1/subject-allocations/class-teacher/${sectionId.value}`,
      ),
    ]);
    subjects.value = s.data;
    classTeacher.value = ct.data;
    classTeacherId.value = ct.data?.teacherUserId ?? null;
    if (canManage.value && section.value)
      teachers.value = await teacherOptions(section.value.institutionId);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function load() {
  await Promise.all([allocations.load(), loadSection()]);
}
async function allocate() {
  try {
    await apiFetch('/api/v1/subject-allocations', {
      method: 'POST',
      body: JSON.stringify({ classSectionId: sectionId.value, ...form }),
    });
    form.subjectId = '';
    form.teacherUserId = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remove(a: SubjectAllocationDto) {
  try {
    await apiFetch(`/api/v1/subject-allocations/${a.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function saveClassTeacher() {
  try {
    await apiFetch('/api/v1/subject-allocations/class-teacher', {
      method: 'PUT',
      body: JSON.stringify({
        classSectionId: sectionId.value,
        teacherUserId: classTeacherId.value || null,
      }),
    });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(loadOptions);
watch(sectionId, loadSection);
</script>
<template>
  <h2 class="text-h5 mb-4">Subject-teacher allocation</h2>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-autocomplete
    v-model="sectionId"
    :items="sections"
    item-title="name"
    item-value="id"
    label="Class section"
    density="compact"
    class="mb-3"
  />
  <template v-if="sectionId">
    <v-card class="mb-4"
      ><v-card-title class="text-subtitle-1">Class teacher</v-card-title
      ><v-card-text
        ><div v-if="!canManage">
          {{ classTeacher?.teacher?.name ?? 'Not assigned' }}
        </div>
        <div v-else class="d-flex ga-2 align-center">
          <v-autocomplete
            v-model="classTeacherId"
            :items="teachers"
            item-title="title"
            item-value="id"
            label="Class teacher"
            density="compact"
            clearable
            hide-details
          /><v-btn color="primary" @click="saveClassTeacher">Save</v-btn>
        </div></v-card-text
      ></v-card
    >
    <div v-if="canManage" class="d-flex ga-2 align-center mb-3">
      <v-autocomplete
        v-model="form.subjectId"
        :items="subjects"
        item-title="name"
        item-value="id"
        label="Subject"
        density="compact"
        hide-details
      /><v-autocomplete
        v-model="form.teacherUserId"
        :items="teachers"
        item-title="title"
        item-value="id"
        label="Teacher"
        density="compact"
        hide-details
      /><v-btn color="primary" :disabled="!form.subjectId || !form.teacherUserId" @click="allocate"
        >Allocate</v-btn
      >
    </div>
    <v-data-table-server
      v-model:page="page"
      v-model:items-per-page="pageSize"
      :headers="headers"
      :items="items"
      :loading="loading"
      :items-length="total"
      :items-per-page-options="PAGE_SIZE_OPTIONS"
      disable-sort
      ><template #[`item.actions`]="{ item }"
        ><v-btn
          v-if="canManage"
          icon="mdi-delete"
          size="small"
          variant="text"
          color="error"
          @click="remove(item)" /></template
      ><template #bottom
    /></v-data-table-server>
  </template>
</template>
