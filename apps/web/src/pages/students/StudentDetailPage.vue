<script setup lang="ts">
import type { StudentDetailDto } from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '@/api/client';
import PreviousSchoolsPanel from '@/components/students/PreviousSchoolsPanel.vue';
import StudentCertificatesPanel from '@/components/students/StudentCertificatesPanel.vue';
import StudentFeesPanel from '@/components/students/StudentFeesPanel.vue';
import StudentHostelPanel from '@/components/students/StudentHostelPanel.vue';
import StudentTransportPanel from '@/components/students/StudentTransportPanel.vue';
import { useAuthStore } from '@/stores/auth';
const route = useRoute();
const auth = useAuthStore();
const student = ref<StudentDetailDto | null>(null);
const error = ref<string | null>(null);
const tab = ref((route.query.tab as string) || 'profile');
const base = computed(() => (route.path.startsWith('/group') ? '/group' : '/institution'));
const showFees = computed(() => auth.can('fee.view') && auth.hasFeature('finance'));
const showHostel = computed(() => auth.can('hostel.view') && auth.hasFeature('hostel'));
const showTransport = computed(() => auth.can('transport.view') && auth.hasFeature('transport'));
const canMessage = computed(
  () => auth.can('message.broadcast') && auth.hasFeature('communication'),
);
const messageLink = computed(() => {
  const s = student.value;
  if (!s) return '';
  const q = new URLSearchParams({
    institutionId: s.institutionId,
    type: 'students',
    ids: s.id,
    recipients: 'guardians',
  });
  return `${base.value}/announcements?${q}`;
});
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
async function saveGuardian() {
  if (!student.value) return;
  await apiFetch(`/api/v1/students/${student.value.id}/guardians`, {
    method: 'POST',
    body: JSON.stringify({
      ...guardian,
      phone: guardian.phone || null,
      email: guardian.email || null,
    }),
  });
  guardianOpen.value = false;
  await load();
}
async function withdraw() {
  if (!student.value) return;
  await apiFetch(`/api/v1/students/${student.value.id}/withdraw`, {
    method: 'POST',
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      reason: 'Updated from student profile',
    }),
  });
  await load();
}
async function graduate() {
  if (!student.value) return;
  await apiFetch(`/api/v1/students/${student.value.id}/graduate`, {
    method: 'POST',
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      reason: 'Updated from student profile',
    }),
  });
  await load();
}
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
        v-if="canMessage"
        variant="tonal"
        color="primary"
        class="mr-2"
        prepend-icon="mdi-message-text-outline"
        :to="messageLink"
        data-testid="message-student"
        >Message</v-btn
      ><v-btn v-if="auth.can('student.lifecycle')" variant="tonal" @click="withdraw">Withdraw</v-btn
      ><v-btn v-if="auth.can('student.lifecycle')" color="primary" @click="graduate"
        >Graduate</v-btn
      >
    </div>
    <v-tabs v-model="tab"
      ><v-tab value="profile">Profile</v-tab><v-tab value="guardians">Guardians</v-tab
      ><v-tab value="enrollments">Enrollment history</v-tab
      ><v-tab value="previous-schools">Previous schools</v-tab
      ><v-tab v-if="auth.can('certificate.view')" value="certificates">Certificates</v-tab
      ><v-tab v-if="showFees" value="fees">Fees</v-tab
      ><v-tab v-if="showHostel" value="hostel">Hostel</v-tab
      ><v-tab v-if="showTransport" value="transport">Transport</v-tab
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
              <td>{{ e.classSectionId }}</td>
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
      ><v-window-item v-if="showFees" value="fees"
        ><StudentFeesPanel :student-id="student.id" :base="base" /></v-window-item
      ><v-window-item v-if="showHostel" value="hostel"
        ><StudentHostelPanel :student-id="student.id" :base="base" /></v-window-item
      ><v-window-item v-if="showTransport" value="transport"
        ><StudentTransportPanel :student-id="student.id" :base="base" /></v-window-item
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
