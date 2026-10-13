<script setup lang="ts">
import type {
  AttendancePunchDto,
  AttendanceRecordDto,
  AttendanceRegularizationDto,
  LivenessProof,
  MyAttendanceDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiError, apiFetch, isNotLinked } from '@/api/client';
import SelfieCaptureDialog from '@/components/SelfieCaptureDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { label } from './useHrOptions';
import {
  recordStatus,
  REQUEST_COLORS,
  WEEKDAYS,
  currentMonth,
  hhmm,
  monthRange,
  toMinute,
} from './timeOffice';

/** Employee self-service: punch in / out, monthly attendance calendar and regularization. */
const auth = useAuthStore();
const month = ref(currentMonth());
const data = ref<MyAttendanceDto | null>(null);
const regularizations = ref<AttendanceRegularizationDto[]>([]);
const error = ref<string | null>(null);
const notLinked = ref(false);
const notice = ref<string | null>(null);
const run = async (fn: () => Promise<void>) => {
  error.value = null;
  try {
    await fn();
  } catch (e) {
    if (isNotLinked(e)) notLinked.value = true;
    else error.value = (e as Error).message;
  }
};

// Today's punches decide the single punch button: last punch IN -> offer OUT, otherwise IN.
const todayPunches = ref<AttendancePunchDto[]>([]);
const nextDirection = computed<'IN' | 'OUT'>(() =>
  todayPunches.value.at(-1)?.direction === 'IN' ? 'OUT' : 'IN',
);
async function loadToday() {
  if (!auth.can('attendance.punch_own')) return;
  const now = new Date();
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  todayPunches.value = (
    await apiFetch<{ data: MyAttendanceDto }>(`/api/v1/attendance/me?from=${d}&to=${d}`)
  ).data.punches;
}

async function load() {
  const { from, to } = monthRange(month.value);
  await run(async () => {
    await loadToday();
    [data.value, regularizations.value] = await Promise.all([
      apiFetch<{ data: MyAttendanceDto }>(`/api/v1/attendance/me?from=${from}&to=${to}`).then(
        (r) => r.data,
      ),
      auth.can('attendance.regularize_own')
        ? apiFetch<{ data: AttendanceRegularizationDto[] }>(
            '/api/v1/attendance/me/regularizations',
          ).then((r) => r.data)
        : Promise.resolve([]),
    ]);
  });
}
onMounted(load);

const position = () =>
  new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000 });
  });
// Selfie attendance: when the policy requires it, punches carry a selfie matched to the profile photo.
const selfie = reactive({
  open: false,
  direction: 'IN' as 'IN' | 'OUT',
  reference: null as number[] | null,
});
async function startSelfie(direction: 'IN' | 'OUT') {
  await run(async () => {
    const face = (
      await apiFetch<{ data: { hasPhoto: boolean; descriptor: number[] | null } }>(
        '/api/v1/employees/me/face',
      )
    ).data;
    if (!face.descriptor) {
      error.value =
        'Selfie attendance is enabled. Upload a clear, front-facing profile photo under My profile first.';
      return;
    }
    Object.assign(selfie, { open: true, direction, reference: face.descriptor });
  });
}

async function punch(
  direction: 'IN' | 'OUT',
  capture?: { descriptor: number[]; liveness: LivenessProof },
) {
  if (!capture && data.value?.faceMatchRequired) return startSelfie(direction);
  const pos = await position();
  const fields: Record<string, string | number> = {
    source: 'WEB',
    direction,
    ...(pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : {}),
  };
  // Only the face descriptor leaves the browser; the selfie image is never uploaded.
  const body = JSON.stringify(
    capture
      ? { ...fields, faceDescriptor: capture.descriptor, liveness: capture.liveness }
      : fields,
  );
  error.value = null;
  try {
    const res = await apiFetch<{ data: { punch: AttendancePunchDto } }>(
      '/api/v1/attendance/me/punch',
      { method: 'POST', body },
    );
    notice.value = `Punched ${direction.toLowerCase()} at ${new Date(res.data.punch.punchedAt).toLocaleTimeString()}`;
    await load();
  } catch (e) {
    if (e instanceof ApiError && ['SELFIE_REQUIRED', 'LIVENESS_REQUIRED'].includes(e.code))
      return startSelfie(direction);
    error.value = (e as Error).message;
  }
}
const onSelfie = (_file: Blob, descriptor: number[], liveness: LivenessProof) =>
  punch(selfie.direction, { descriptor, liveness });

// Calendar grid (Sunday-first weeks)
const byDate = computed(
  () =>
    new Map((data.value?.records ?? []).map((r) => [r.date, r] as [string, AttendanceRecordDto])),
);
const cells = computed(() => {
  const { from, to } = monthRange(month.value);
  const first = new Date(`${from}T00:00:00Z`);
  const lastDay = Number(to.slice(8));
  const out: ({ date: string; day: number; record?: AttendanceRecordDto } | null)[] = Array.from(
    { length: first.getUTCDay() },
    () => null,
  );
  for (let d = 1; d <= lastDay; d++) {
    const date = `${month.value}-${String(d).padStart(2, '0')}`;
    out.push({ date, day: d, record: byDate.value.get(date) });
  }
  return out;
});

// Regularization
const reg = reactive({
  open: false,
  date: '',
  mode: 'times' as 'times' | 'status',
  inTime: '09:00',
  outTime: '17:30',
  requestedStatus: 'ON_DUTY',
  reason: '',
});
function openReg(date: string) {
  Object.assign(reg, { open: true, date, reason: '' });
}
async function saveReg() {
  await run(async () => {
    await apiFetch('/api/v1/attendance/me/regularizations', {
      method: 'POST',
      body: JSON.stringify({
        date: reg.date,
        reason: reg.reason.trim(),
        ...(reg.mode === 'times'
          ? { inMinute: toMinute(reg.inTime), outMinute: toMinute(reg.outTime) }
          : { requestedStatus: reg.requestedStatus }),
      }),
    });
    reg.open = false;
    notice.value = 'Regularization submitted';
    await load();
  });
}
async function cancelReg(id: string) {
  await run(async () => {
    await apiFetch(`/api/v1/attendance/me/regularizations/${id}/cancel`, { method: 'POST' });
    await load();
  });
}
const regStatuses = ['PRESENT', 'HALF_DAY', 'ON_DUTY'].map((value) => ({
  value,
  title: label(value),
}));
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2 flex-wrap">
    <h2 class="text-h5">My attendance</h2>
    <v-spacer />
    <template v-if="auth.can('attendance.punch_own')">
      <v-btn
        :color="nextDirection === 'IN' ? 'success' : 'primary'"
        :prepend-icon="nextDirection === 'IN' ? 'mdi-login' : 'mdi-logout'"
        @click="punch(nextDirection)"
      >
        {{ nextDirection === 'IN' ? 'Punch in' : 'Punch out' }}
      </v-btn>
      <v-chip v-if="data?.faceMatchRequired" size="small" prepend-icon="mdi-face-recognition">
        Selfie required
      </v-chip>
    </template>
    <v-text-field
      v-model="month"
      type="month"
      label="Month"
      density="compact"
      hide-details
      style="max-width: 180px"
      @change="load"
    />
  </div>
  <v-alert v-if="notLinked" type="info" variant="tonal" class="mb-4"
    >Your account is not linked to an employee record. Contact HR.</v-alert
  >
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" closable class="mb-4" @click:close="notice = null">
    {{ notice }}
  </v-alert>

  <div class="calendar">
    <div v-for="w in WEEKDAYS" :key="w" class="text-caption text-medium-emphasis text-center">
      {{ w }}
    </div>
    <template v-for="(c, i) in cells" :key="i">
      <div v-if="!c" />
      <v-card v-else variant="outlined" class="pa-1 cell">
        <div class="d-flex align-center">
          <strong>{{ c.day }}</strong>
          <v-spacer />
          <v-btn
            v-if="auth.can('attendance.regularize_own') && c.record && !c.record.locked"
            size="x-small"
            variant="text"
            color="primary"
            icon="mdi-clock-edit-outline"
            :title="'Regularize'"
            @click="openReg(c.date)"
          />
        </div>
        <template v-if="c.record">
          <v-chip :color="recordStatus(c.record).color" size="x-small">
            {{ recordStatus(c.record).text }}
          </v-chip>
          <div class="text-caption">
            <template v-if="c.record.workedMinutes">{{ hhmm(c.record.workedMinutes) }} h</template>
            <template v-else-if="c.record.holidayName">{{ c.record.holidayName }}</template>
          </div>
        </template>
      </v-card>
    </template>
  </div>

  <template v-if="auth.can('attendance.regularize_own')">
    <h3 class="text-h6 mt-8 mb-2">My regularizations</h3>
    <v-table density="compact">
      <tbody>
        <tr v-for="r in regularizations" :key="r.id">
          <td>{{ r.date }}</td>
          <td>
            {{
              r.requestedStatus
                ? label(r.requestedStatus)
                : `${hhmm(r.inMinute)} – ${hhmm(r.outMinute)}`
            }}
          </td>
          <td>{{ r.reason }}</td>
          <td>
            <v-chip :color="REQUEST_COLORS[r.status]" size="small">{{ label(r.status) }}</v-chip>
          </td>
          <td class="text-right">
            <v-btn
              v-if="r.status === 'PENDING_APPROVAL'"
              size="small"
              variant="text"
              @click="cancelReg(r.id)"
            >
              Withdraw
            </v-btn>
          </td>
        </tr>
        <tr v-if="!regularizations.length">
          <td class="text-medium-emphasis">No regularization requests.</td>
        </tr>
      </tbody>
    </v-table>
  </template>

  <v-dialog v-model="reg.open" max-width="480">
    <v-card :title="`Regularize ${reg.date}`">
      <v-card-text>
        <v-btn-toggle v-model="reg.mode" mandatory density="compact" class="mb-4">
          <v-btn value="times">Correct times</v-btn>
          <v-btn value="status">Request status</v-btn>
        </v-btn-toggle>
        <template v-if="reg.mode === 'times'">
          <v-text-field v-model="reg.inTime" type="time" label="In" />
          <v-text-field v-model="reg.outTime" type="time" label="Out" />
        </template>
        <v-select v-else v-model="reg.requestedStatus" :items="regStatuses" label="Status" />
        <v-textarea v-model="reg.reason" label="Reason *" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="reg.open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="reg.reason.trim().length < 3" @click="saveReg">
          Submit
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <SelfieCaptureDialog
    v-model="selfie.open"
    :title="`Selfie punch ${selfie.direction.toLowerCase()}`"
    :reference="selfie.reference"
    @captured="onSelfie"
  />
</template>

<style scoped>
.calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.cell {
  min-height: 72px;
}
</style>
