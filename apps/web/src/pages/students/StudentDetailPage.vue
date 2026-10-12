<script setup lang="ts">
import type { StudentDetailDto } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import PreviousSchoolsPanel from '@/components/students/PreviousSchoolsPanel.vue';
import StudentCertificatesPanel from '@/components/students/StudentCertificatesPanel.vue';
import { useAuthStore } from '@/stores/auth';
const route = useRoute();
const auth = useAuthStore();
const student = ref<StudentDetailDto | null>(null);
const error = ref<string | null>(null);
const tab = ref('profile');
const guardianOpen = ref(false);
const guardian = reactive({
  name: '',
  relation: 'GUARDIAN',
  phone: '',
  email: '',
  isPrimary: false,
  canPickup: true,
});
async function load() {
  try {
    student.value = (
      await apiFetch<{ data: StudentDetailDto }>(`/api/v1/students/${route.params.id}`)
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
/** Runs a profile action, surfacing API errors (e.g. a validation or 409) in the page alert. */
async function run(fn: () => Promise<unknown>) {
  error.value = null;
  try {
    await fn();
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  }
}
async function saveGuardian() {
  if (!student.value) return;
  const id = student.value.id;
  const ok = await run(() =>
    apiFetch(`/api/v1/students/${id}/guardians`, {
      method: 'POST',
      body: JSON.stringify({
        ...guardian,
        phone: guardian.phone || null,
        email: guardian.email || null,
      }),
    }),
  );
  if (!ok) return;
  guardianOpen.value = false;
  await load();
}
async function changeLifecycle(action: 'withdraw' | 'graduate') {
  if (!student.value) return;
  const id = student.value.id;
  const ok = await run(() =>
    apiFetch(`/api/v1/students/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        reason: 'Updated from student profile',
      }),
    }),
  );
  if (ok) await load();
}
/** Withdraw / graduate apply only to students still on the rolls. */
const canChangeLifecycle = computed(
  () =>
    auth.can('student.lifecycle') &&
    !!student.value &&
    ['ACTIVE', 'INACTIVE'].includes(student.value.status),
);
onMounted(load);
</script>
<template>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <div v-if="student">
    <div class="d-flex align-center mb-4">
      <div>
        <h2 class="text-h5">{{ student.displayName }}</h2>
        <div class="text-medium-emphasis">
          {{ student.admissionNo }} · {{ student.classSection?.name }} · Roll
          {{ student.rollNo || '—' }}
        </div>
      </div>
      <v-spacer /><v-btn
        v-if="canChangeLifecycle"
        variant="tonal"
        @click="changeLifecycle('withdraw')"
        >Withdraw</v-btn
      ><v-btn v-if="canChangeLifecycle" color="primary" @click="changeLifecycle('graduate')"
        >Graduate</v-btn
      >
    </div>
    <v-tabs v-model="tab"
      ><v-tab value="profile">Profile</v-tab><v-tab value="guardians">Guardians</v-tab
      ><v-tab value="enrollments">Enrollment history</v-tab
      ><v-tab value="previous-schools">Previous schools</v-tab
      ><v-tab v-if="auth.can('certificate.view')" value="certificates">Certificates</v-tab
      ><v-tab value="login">Login access</v-tab></v-tabs
    ><v-window v-model="tab" class="mt-4"
      ><v-window-item value="profile"
        ><v-card
          ><v-card-text
            ><v-row
              ><v-col cols="12" md="4"><strong>Status</strong><br />{{ student.status }}</v-col
              ><v-col cols="12" md="4"
                ><strong>DOB</strong><br />{{ student.dateOfBirth || '—' }}</v-col
              ><v-col cols="12" md="4"
                ><strong>Contact</strong><br />{{ student.phone || student.email || '—' }}</v-col
              ><v-col cols="12"
                ><strong>Previous school</strong><br />{{ student.previousSchool || '—' }}</v-col
              ></v-row
            ></v-card-text
          ></v-card
        ></v-window-item
      ><v-window-item value="guardians"
        ><div class="d-flex mb-2">
          <v-spacer /><v-btn
            v-if="auth.can('guardian.manage')"
            prepend-icon="mdi-plus"
            @click="guardianOpen = true"
            >Add guardian</v-btn
          >
        </div>
        <v-table
          ><thead>
            <tr>
              <th>Name</th>
              <th>Relation</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Login</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in student.guardians" :key="g.id">
              <td>{{ g.guardian.name }}</td>
              <td>{{ g.relation }}</td>
              <td>{{ g.guardian.phone }}</td>
              <td>{{ g.guardian.email }}</td>
              <td>{{ g.guardian.userId ? 'Linked' : 'Not linked' }}</td>
            </tr>
          </tbody></v-table
        ></v-window-item
      ><v-window-item value="enrollments"
        ><v-table
          ><thead>
            <tr>
              <th>Year</th>
              <th>Class</th>
              <th>Roll</th>
              <th>From</th>
              <th>To</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in student.enrollments" :key="e.id">
              <td>{{ e.academicYear }}</td>
              <td>{{ e.classSectionName ?? '—' }}</td>
              <td>{{ e.rollNo }}</td>
              <td>{{ e.fromDate }}</td>
              <td>{{ e.toDate || '—' }}</td>
              <td>{{ e.status }}</td>
            </tr>
          </tbody></v-table
        ></v-window-item
      ><v-window-item value="previous-schools"
        ><PreviousSchoolsPanel
          owner="students"
          :owner-id="student.id"
          :can-edit="auth.can('student.update')"
          @changed="load" /></v-window-item
      ><v-window-item v-if="auth.can('certificate.view')" value="certificates"
        ><StudentCertificatesPanel :student-id="student.id" @changed="load" /></v-window-item
      ><v-window-item value="login"
        ><v-card
          ><v-card-text
            >User id:
            {{
              student.userId ||
              'No student login linked yet. Create a user with role student from Users, then link through API.'
            }}</v-card-text
          ></v-card
        ></v-window-item
      ></v-window
    ><v-dialog v-model="guardianOpen" max-width="520"
      ><v-card
        ><v-card-title>Add guardian</v-card-title
        ><v-card-text
          ><v-text-field v-model="guardian.name" label="Name" /><v-select
            v-model="guardian.relation"
            :items="['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']"
            label="Relation" /><v-text-field v-model="guardian.phone" label="Phone" /><v-text-field
            v-model="guardian.email"
            label="Email" /><v-checkbox
            v-model="guardian.isPrimary"
            label="Primary guardian" /><v-checkbox
            v-model="guardian.canPickup"
            label="Can pick up" /></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="guardianOpen = false">Cancel</v-btn
          ><v-btn color="primary" @click="saveGuardian">Save</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
  </div>
</template>
