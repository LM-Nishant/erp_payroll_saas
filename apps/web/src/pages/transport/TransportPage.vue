<script setup lang="ts">
import type {
  TransportBoardingRowDto,
  TransportDashboardDto,
  TransportReportDto,
  TransportRouteDto,
  TransportTripDto,
} from '@erp/shared';
import {
  TRANSPORT_FARE_FREQUENCIES,
  TRANSPORT_INCIDENT_SEVERITIES,
  TRANSPORT_PASSENGER_TYPES,
  TRANSPORT_STAFF_ROLES,
  TRANSPORT_TRIP_DIRECTIONS,
  TRANSPORT_TRIP_TYPES,
  VEHICLE_MAINTENANCE_KINDS,
  VEHICLE_TYPES,
} from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import ResourceTable, { type ResourceField } from '@/components/ResourceTable.vue';
import { useAuthStore } from '@/stores/auth';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TABS = [
  { key: 'dashboard', title: 'Dashboard' },
  { key: 'vehicles', title: 'Vehicles' },
  { key: 'drivers', title: 'Drivers' },
  { key: 'routes', title: 'Routes & stops' },
  { key: 'allocations', title: 'Allocations' },
  { key: 'trips', title: 'Trips & logs' },
  { key: 'maintenance', title: 'Maintenance' },
  { key: 'reports', title: 'Reports' },
] as const;

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const tab = computed({
  get: () => (route.params.tab as string) || 'dashboard',
  set: (t: string) => void router.replace({ params: { tab: t } }),
});
const API = '/api/v1/transport';
const error = ref<string | null>(null);
const canManage = computed(() => auth.can('transport.manage'));
const canAllocate = computed(() => auth.can('transport.allocate'));
const today = new Date().toISOString().slice(0, 10);
const docsPath = computed(() => `${route.path.split('/transport')[0]}/documents`);

async function act(fn: () => Promise<unknown>, reload?: () => unknown) {
  error.value = null;
  try {
    await fn();
    await reload?.();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const post = (path: string, body: unknown = {}) =>
  apiFetch(`${API}${path}`, { method: 'POST', body: JSON.stringify(body) });
const patch = (path: string, body: unknown) =>
  apiFetch(`${API}${path}`, { method: 'PATCH', body: JSON.stringify(body) });
const del = (path: string) => apiFetch(`${API}${path}`, { method: 'DELETE' });
const get = async <T,>(path: string) => (await apiFetch<{ data: T }>(`${API}${path}`)).data;

const institutionField: ResourceField = {
  key: 'institutionId',
  label: 'Institution',
  type: 'ref',
  refEndpoint: '/api/v1/institutions',
  required: true,
};
const vehicleRef = (key = 'vehicleId'): ResourceField => ({
  key,
  label: 'Vehicle',
  type: 'ref',
  refEndpoint: `${API}/vehicles`,
  refTitle: (r) => `${r.regNo} (${r.capacity} seats)`,
});
const routeRef: ResourceField = {
  key: 'routeId',
  label: 'Route',
  type: 'ref',
  refEndpoint: `${API}/routes`,
  refTitle: (r) => `${r.code} · ${r.name}`,
  required: true,
};
const staffRef = (key: string, label: string, role?: string): ResourceField => ({
  key,
  label,
  type: 'ref',
  refEndpoint: `${API}/staff${role ? `?role=${role}` : ''}`,
  refTitle: (r) => `${r.name} (${r.role})`,
});
const employeeTitle = (r: Row) =>
  `${r.displayName ?? `${r.firstName} ${r.lastName ?? ''}`} (${r.employeeCode})`;

// ---- Dashboard / reports -------------------------------------------------------------------
const dashboard = ref<TransportDashboardDto | null>(null);
const report = ref<TransportReportDto | null>(null);
async function loadDashboard() {
  await act(async () => {
    dashboard.value = await get<TransportDashboardDto>('/dashboard');
  });
}
async function loadReport() {
  await act(async () => {
    report.value = await get<TransportReportDto>('/reports');
  });
}
const cards = computed(() => {
  const d = dashboard.value;
  if (!d) return [];
  return [
    {
      label: 'Vehicles (active/total)',
      value: `${d.activeVehicles}/${d.vehicles}`,
      icon: 'mdi-bus',
    },
    { label: 'Drivers & staff', value: d.drivers, icon: 'mdi-card-account-details' },
    { label: 'Routes', value: `${d.routes} (${d.stops} stops)`, icon: 'mdi-map-marker-path' },
    { label: 'Students allocated', value: d.allocatedStudents, icon: 'mdi-account-school' },
    { label: 'Staff allocated', value: d.allocatedStaff, icon: 'mdi-account-tie' },
    { label: 'Seat utilisation', value: `${d.seatUtilisationPercent}%`, icon: 'mdi-seat' },
    { label: 'Trips today', value: d.tripsToday, icon: 'mdi-routes' },
    { label: 'Open incidents', value: d.openIncidents, icon: 'mdi-alert' },
  ];
});

// ---- Routes & stops ------------------------------------------------------------------------
const routeDetail = ref<TransportRouteDto | null>(null);
const stopForm = reactive({ name: '', sequence: 1, pickupTime: '', dropTime: '', distanceKm: '' });
const broadcast = reactive({
  open: false,
  routeId: '',
  kind: 'DELAY',
  message: '',
  delayMinutes: 15,
});
async function openRoute(id: string) {
  await act(async () => {
    routeDetail.value = await get<TransportRouteDto>(`/routes/${id}`);
    stopForm.sequence = (routeDetail.value.stops?.length ?? 0) + 1;
  });
}
async function addStop() {
  if (!routeDetail.value) return;
  const id = routeDetail.value.id;
  await act(
    () =>
      post(`/routes/${id}/stops`, {
        name: stopForm.name,
        sequence: Number(stopForm.sequence),
        pickupTime: stopForm.pickupTime || null,
        dropTime: stopForm.dropTime || null,
        distanceKm: stopForm.distanceKm ? Number(stopForm.distanceKm) : null,
      }),
    () => openRoute(id),
  );
  stopForm.name = '';
}
async function removeStop(stopId: string) {
  if (!routeDetail.value) return;
  const id = routeDetail.value.id;
  await act(
    () => del(`/stops/${stopId}`),
    () => openRoute(id),
  );
}
function openBroadcast(routeId: string) {
  broadcast.routeId = routeId;
  broadcast.message = '';
  broadcast.open = true;
}
async function sendBroadcast() {
  await act(() =>
    post(`/routes/${broadcast.routeId}/broadcast`, {
      kind: broadcast.kind,
      message: broadcast.message,
      delayMinutes: broadcast.kind === 'DELAY' ? Number(broadcast.delayMinutes) : null,
    }),
  );
  if (!error.value) broadcast.open = false;
}

// ---- Allocations ---------------------------------------------------------------------------
const allocate = reactive({
  open: false,
  passengerType: 'STUDENT',
  personId: null as string | null,
  routeId: '',
  stopId: '',
  tripType: 'BOTH',
  effectiveFrom: today,
  fareAmount: '',
});
const allocRoutes = ref<{ value: string; title: string }[]>([]);
const allocStops = ref<{ value: string; title: string }[]>([]);
const people = ref<{ value: string; title: string }[]>([]);
async function searchPeople(search = '') {
  const isStudent = allocate.passengerType === 'STUDENT';
  const r = await apiFetch<{ data: Row[] }>(
    `/api/v1/${isStudent ? 'students' : 'employees'}?pageSize=50${
      search ? `&search=${encodeURIComponent(search)}` : ''
    }`,
  );
  people.value = r.data.map((p) => ({
    value: String(p.id),
    title: isStudent ? `${p.displayName} (${p.admissionNo})` : employeeTitle(p),
  }));
}
async function openAllocate() {
  allocate.open = true;
  await act(async () => {
    const r = await apiFetch<{ data: TransportRouteDto[] }>(`${API}/routes?pageSize=100`);
    allocRoutes.value = r.data.map((x) => ({ value: x.id, title: `${x.code} · ${x.name}` }));
    await searchPeople();
  });
}
watch(
  () => allocate.routeId,
  async (id) => {
    allocStops.value = [];
    allocate.stopId = '';
    if (!id) return;
    const r = await get<TransportRouteDto>(`/routes/${id}`);
    allocStops.value = (r.stops ?? []).map((s) => ({
      value: s.id,
      title: `${s.sequence}. ${s.name} ${s.pickupTime ?? ''}${
        s.effectiveFare != null ? ` · ₹${s.effectiveFare}` : ''
      }`,
    }));
  },
);
watch(
  () => allocate.passengerType,
  () => {
    allocate.personId = null;
    void searchPeople();
  },
);
const allocTable = ref<{ reload: () => Promise<void> } | null>(null);
async function saveAllocation() {
  const isStudent = allocate.passengerType === 'STUDENT';
  await act(
    () =>
      post('/allocations', {
        passengerType: allocate.passengerType,
        studentId: isStudent ? allocate.personId : null,
        employeeId: isStudent ? null : allocate.personId,
        routeId: allocate.routeId,
        stopId: allocate.stopId,
        tripType: allocate.tripType,
        effectiveFrom: allocate.effectiveFrom,
        fareAmount: allocate.fareAmount ? Number(allocate.fareAmount) : null,
      }),
    () => allocTable.value?.reload(),
  );
  if (!error.value) allocate.open = false;
}
const chargePeriod = ref(today.slice(0, 7));

// ---- Trips: boarding ------------------------------------------------------------------------
const boarding = reactive({
  open: false,
  trip: null as TransportTripDto | null,
  rows: [] as TransportBoardingRowDto[],
});
async function openBoarding(t: TransportTripDto) {
  await act(async () => {
    boarding.rows = await get<TransportBoardingRowDto[]>(`/trips/${t.id}/boarding`);
    boarding.trip = t;
    boarding.open = true;
  });
}
async function saveBoarding() {
  if (!boarding.trip || !boarding.rows.length) return;
  const id = boarding.trip.id;
  await act(() =>
    apiFetch(`${API}/trips/${id}/boarding`, {
      method: 'PUT',
      body: JSON.stringify({
        entries: boarding.rows.map((r) => ({
          allocationId: r.allocationId,
          status: r.status ?? 'ABSENT',
        })),
      }),
    }),
  );
  if (!error.value) boarding.open = false;
}
const tripsSub = ref('trips');

watch(
  tab,
  (t) => {
    if (t === 'dashboard') void loadDashboard();
    if (t === 'reports') void loadReport();
  },
  { immediate: true },
);
</script>

<template>
  <h2 class="text-h5 mb-2">Transport</h2>
  <v-tabs v-model="tab" class="mb-4" show-arrows>
    <v-tab v-for="t in TABS" :key="t.key" :value="t.key">{{ t.title }}</v-tab>
  </v-tabs>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>

  <!-- Dashboard -->
  <template v-if="tab === 'dashboard'">
    <v-row>
      <v-col v-for="c in cards" :key="c.label" cols="12" sm="6" md="3">
        <v-card>
          <v-card-text class="d-flex align-center ga-3">
            <v-icon :icon="c.icon" size="32" color="primary" />
            <div>
              <div class="text-h6">{{ c.value }}</div>
              <div class="text-caption">{{ c.label }}</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-row v-if="dashboard">
      <v-col cols="12" md="7">
        <v-card title="Expiring documents (next 60 days)">
          <v-table density="compact">
            <tbody>
              <tr v-for="(d, i) in dashboard.expiringDocuments" :key="i">
                <td>{{ d.label }}</td>
                <td>{{ d.kind }}</td>
                <td>{{ d.expiresOn }}</td>
              </tr>
              <tr v-if="!dashboard.expiringDocuments.length">
                <td>Nothing expiring soon.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
      <v-col cols="12" md="5">
        <v-card title="Service due">
          <v-table density="compact">
            <tbody>
              <tr v-for="s in dashboard.serviceDue" :key="s.vehicleId">
                <td>{{ s.regNo }}</td>
                <td>{{ s.nextServiceDate }}</td>
              </tr>
              <tr v-if="!dashboard.serviceDue.length">
                <td>No services due.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-col>
    </v-row>
  </template>

  <!-- Vehicles -->
  <ResourceTable
    v-else-if="tab === 'vehicles'"
    :endpoint="`${API}/vehicles`"
    :create-endpoint="`${API}/vehicles`"
    create-label="New vehicle"
    create-permission="transport.manage"
    :status-options="['ACTIVE', 'MAINTENANCE', 'INACTIVE']"
    :headers="[
      { title: 'Reg no', key: 'regNo' },
      { title: 'Type', key: 'vehicleType' },
      { title: 'Seats', key: 'capacity' },
      { title: 'Insurance', key: 'insuranceExpiry' },
      { title: 'Fitness', key: 'fitnessExpiry' },
      { title: 'Permit', key: 'permitExpiry' },
      { title: 'Next service', key: 'nextServiceDate' },
      { title: 'Status', key: 'status' },
      { title: '', key: 'actions', sortable: false },
    ]"
    :fields="[
      institutionField,
      { key: 'regNo', label: 'Registration no', required: true },
      { key: 'vehicleType', label: 'Type', type: 'select', options: VEHICLE_TYPES, default: 'BUS' },
      { key: 'make', label: 'Make / model' },
      { key: 'capacity', label: 'Seating capacity', type: 'number', required: true },
      { key: 'insuranceExpiry', label: 'Insurance expiry', type: 'date' },
      { key: 'fitnessExpiry', label: 'Fitness expiry', type: 'date' },
      { key: 'permitExpiry', label: 'Permit expiry', type: 'date' },
      { key: 'pollutionExpiry', label: 'PUC expiry', type: 'date' },
      { key: 'nextServiceDate', label: 'Next service', type: 'date' },
      { key: 'odometerKm', label: 'Odometer (km)', type: 'number' },
    ]"
  >
    <template #toolbar>
      <v-btn variant="text" prepend-icon="mdi-file-document" :to="docsPath">Documents</v-btn>
    </template>
    <template #[`item.actions`]="{ item, reload }">
      <template v-if="canManage">
        <v-btn
          v-if="(item as Row).status === 'ACTIVE'"
          size="small"
          variant="text"
          @click="
            act(() => patch(`/vehicles/${(item as Row).id}`, { status: 'MAINTENANCE' }), reload)
          "
          >To maintenance</v-btn
        >
        <v-btn
          v-else
          size="small"
          variant="text"
          @click="act(() => patch(`/vehicles/${(item as Row).id}`, { status: 'ACTIVE' }), reload)"
          >Activate</v-btn
        >
      </template>
    </template>
  </ResourceTable>

  <!-- Drivers -->
  <ResourceTable
    v-else-if="tab === 'drivers'"
    :endpoint="`${API}/staff`"
    :create-endpoint="`${API}/staff`"
    create-label="New driver / staff"
    create-permission="transport.manage"
    :headers="[
      { title: 'Name', key: 'name' },
      { title: 'Role', key: 'role' },
      { title: 'Phone', key: 'phone' },
      { title: 'Licence', key: 'licenceNo' },
      { title: 'Licence expiry', key: 'licenceExpiry' },
      { title: 'Vehicle', key: 'vehicleRegNo' },
      { title: 'Status', key: 'status' },
    ]"
    :fields="[
      institutionField,
      {
        key: 'role',
        label: 'Role',
        type: 'select',
        options: TRANSPORT_STAFF_ROLES,
        default: 'DRIVER',
      },
      { key: 'name', label: 'Name', required: true },
      { key: 'phone', label: 'Phone' },
      {
        key: 'employeeId',
        label: 'Linked employee',
        type: 'ref',
        refEndpoint: '/api/v1/employees',
        refTitle: employeeTitle,
      },
      { key: 'licenceNo', label: 'Licence no' },
      { key: 'licenceExpiry', label: 'Licence expiry', type: 'date' },
      vehicleRef(),
    ]"
  />

  <!-- Routes -->
  <template v-else-if="tab === 'routes'">
    <ResourceTable
      :endpoint="`${API}/routes`"
      :create-endpoint="`${API}/routes`"
      create-label="New route"
      create-permission="transport.manage"
      :headers="[
        { title: 'Code', key: 'code' },
        { title: 'Name', key: 'name' },
        { title: 'Vehicle', key: 'vehicle' },
        { title: 'Driver', key: 'driver' },
        { title: 'Stops', key: 'stopCount' },
        { title: 'Allocated', key: 'activeAllocations' },
        { title: 'Status', key: 'status' },
        { title: '', key: 'actions', sortable: false },
      ]"
      :fields="[
        institutionField,
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        vehicleRef(),
        staffRef('driverId', 'Driver', 'DRIVER'),
        staffRef('attendantId', 'Attendant / conductor'),
        { key: 'distanceKm', label: 'Distance (km)', type: 'number' },
      ]"
    >
      <template #[`item.vehicle`]="{ item }">{{ (item as Row).vehicle?.regNo ?? '—' }}</template>
      <template #[`item.driver`]="{ item }">{{ (item as Row).driver?.name ?? '—' }}</template>
      <template #[`item.actions`]="{ item }">
        <v-btn size="small" variant="text" @click="openRoute((item as Row).id)">Stops</v-btn>
        <v-btn v-if="canManage" size="small" variant="text" @click="openBroadcast((item as Row).id)"
          >Notify parents</v-btn
        >
      </template>
    </ResourceTable>
    <v-card
      v-if="routeDetail"
      class="mt-4"
      :title="`${routeDetail.code} · ${routeDetail.name} — stops`"
    >
      <v-table density="compact">
        <thead>
          <tr>
            <th>#</th>
            <th>Stop</th>
            <th>Pickup</th>
            <th>Drop</th>
            <th>Km</th>
            <th>Fare</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in routeDetail.stops ?? []" :key="s.id">
            <td>{{ s.sequence }}</td>
            <td>{{ s.name }}</td>
            <td>{{ s.pickupTime ?? '—' }}</td>
            <td>{{ s.dropTime ?? '—' }}</td>
            <td>{{ s.distanceKm ?? '—' }}</td>
            <td>{{ s.effectiveFare ?? '—' }}</td>
            <td>
              <v-btn
                v-if="canManage"
                size="x-small"
                variant="text"
                icon="mdi-delete"
                @click="removeStop(s.id)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text v-if="canManage">
        <v-row dense>
          <v-col cols="12" md="1">
            <v-text-field v-model="stopForm.sequence" label="#" type="number" density="compact" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field v-model="stopForm.name" label="Stop name" density="compact" />
          </v-col>
          <v-col cols="6" md="2">
            <v-text-field
              v-model="stopForm.pickupTime"
              label="Pickup"
              type="time"
              density="compact"
            />
          </v-col>
          <v-col cols="6" md="2">
            <v-text-field v-model="stopForm.dropTime" label="Drop" type="time" density="compact" />
          </v-col>
          <v-col cols="6" md="2">
            <v-text-field
              v-model="stopForm.distanceKm"
              label="Km"
              type="number"
              density="compact"
            />
          </v-col>
          <v-col cols="6" md="1"><v-btn color="primary" @click="addStop">Add</v-btn></v-col>
        </v-row>
      </v-card-text>
    </v-card>
    <ResourceTable
      class="mt-6"
      title="Fare slabs (by distance)"
      :searchable="false"
      :endpoint="`${API}/fare-slabs`"
      :create-endpoint="`${API}/fare-slabs`"
      create-label="New fare slab"
      create-permission="transport.manage"
      :headers="[
        { title: 'Name', key: 'name' },
        { title: 'From km', key: 'minKm' },
        { title: 'To km', key: 'maxKm' },
        { title: 'Amount', key: 'amount' },
        { title: 'Frequency', key: 'frequency' },
      ]"
      :fields="[
        institutionField,
        { key: 'name', label: 'Name', required: true },
        { key: 'minKm', label: 'From km', type: 'number', default: 0 },
        { key: 'maxKm', label: 'To km', type: 'number', required: true },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        {
          key: 'frequency',
          label: 'Frequency',
          type: 'select',
          options: TRANSPORT_FARE_FREQUENCIES,
          default: 'MONTHLY',
        },
      ]"
    />
    <v-dialog v-model="broadcast.open" max-width="520">
      <v-card title="Notify parents on this route">
        <v-card-text>
          <v-select
            v-model="broadcast.kind"
            :items="['DELAY', 'GENERAL']"
            label="Kind"
            density="compact"
          />
          <v-text-field
            v-if="broadcast.kind === 'DELAY'"
            v-model="broadcast.delayMinutes"
            type="number"
            label="Delay (minutes)"
            density="compact"
          />
          <v-textarea v-model="broadcast.message" label="Message" rows="3" density="compact" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="broadcast.open = false">Cancel</v-btn>
          <v-btn color="primary" @click="sendBroadcast">Send</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>

  <!-- Allocations -->
  <template v-else-if="tab === 'allocations'">
    <ResourceTable
      ref="allocTable"
      :endpoint="`${API}/allocations`"
      :status-options="['ACTIVE', 'ENDED']"
      :headers="[
        { title: 'Passenger', key: 'passengerName' },
        { title: 'Type', key: 'passengerType' },
        { title: 'Route', key: 'route' },
        { title: 'Stop', key: 'stop' },
        { title: 'Trip', key: 'tripType' },
        { title: 'From', key: 'effectiveFrom' },
        { title: 'Fare', key: 'fareAmount' },
        { title: 'Status', key: 'status' },
        { title: '', key: 'actions', sortable: false },
      ]"
    >
      <template #toolbar>
        <v-btn v-if="canAllocate" color="primary" prepend-icon="mdi-plus" @click="openAllocate"
          >Allocate</v-btn
        >
      </template>
      <template #[`item.route`]="{ item }">{{ (item as Row).route.code }}</template>
      <template #[`item.stop`]="{ item }"
        >{{ (item as Row).stop.name }} {{ (item as Row).stop.pickupTime ?? '' }}</template
      >
      <template #[`item.actions`]="{ item, reload }">
        <v-btn
          v-if="canAllocate && (item as Row).status === 'ACTIVE'"
          size="small"
          variant="text"
          @click="
            act(() => post(`/allocations/${(item as Row).id}/end`, { effectiveTo: today }), reload)
          "
          >End</v-btn
        >
      </template>
    </ResourceTable>
    <ResourceTable
      class="mt-6"
      title="Transport charges"
      :searchable="false"
      :endpoint="`${API}/charges`"
      :query="{ period: chargePeriod }"
      :status-options="['PENDING', 'POSTED', 'WAIVED']"
      :headers="[
        { title: 'Passenger', key: 'passengerName' },
        { title: 'Period', key: 'period' },
        { title: 'Amount', key: 'amount' },
        { title: 'Status', key: 'status' },
        { title: 'Fee ref', key: 'externalRef' },
      ]"
    >
      <template #filters>
        <v-text-field
          v-model="chargePeriod"
          label="Period (YYYY-MM)"
          density="compact"
          hide-details
          style="max-width: 160px"
        />
      </template>
      <template #toolbar="{ reload }">
        <v-btn
          v-if="canAllocate"
          variant="tonal"
          @click="act(() => post('/charges/generate', { period: chargePeriod }), reload)"
          >Generate charges</v-btn
        >
      </template>
    </ResourceTable>
    <v-dialog v-model="allocate.open" max-width="640">
      <v-card title="Allocate transport">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="4">
              <v-select
                v-model="allocate.passengerType"
                :items="[...TRANSPORT_PASSENGER_TYPES] as string[]"
                label="Passenger"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="8">
              <v-autocomplete
                v-model="allocate.personId"
                :items="people"
                :label="allocate.passengerType === 'STUDENT' ? 'Student' : 'Employee'"
                no-filter
                density="compact"
                @update:search="(s: string) => searchPeople(s)"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="allocate.routeId"
                :items="allocRoutes"
                label="Route"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="allocate.stopId"
                :items="allocStops"
                label="Stop"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="allocate.tripType"
                :items="[...TRANSPORT_TRIP_TYPES] as string[]"
                label="Trip"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="allocate.effectiveFrom"
                type="date"
                label="From"
                density="compact"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="allocate.fareAmount"
                type="number"
                label="Fare override"
                density="compact"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="allocate.open = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveAllocation">Allocate</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>

  <!-- Trips & logs -->
  <template v-else-if="tab === 'trips'">
    <v-btn-toggle v-model="tripsSub" mandatory density="compact" class="mb-3">
      <v-btn value="trips">Trips</v-btn>
      <v-btn value="incidents">Incidents</v-btn>
      <v-btn value="fuel">Fuel log</v-btn>
    </v-btn-toggle>
    <ResourceTable
      v-if="tripsSub === 'trips'"
      :searchable="false"
      :endpoint="`${API}/trips`"
      :create-endpoint="`${API}/trips`"
      create-label="New trip"
      create-permission="transport.manage"
      :status-options="['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']"
      :headers="[
        { title: 'Date', key: 'tripDate' },
        { title: 'Route', key: 'route' },
        { title: 'Direction', key: 'direction' },
        { title: 'Vehicle', key: 'vehicle' },
        { title: 'Status', key: 'status' },
        { title: 'Delay (min)', key: 'delayMinutes' },
        { title: 'Boarded', key: 'boarded' },
        { title: '', key: 'actions', sortable: false },
      ]"
      :fields="[
        routeRef,
        { key: 'tripDate', label: 'Date', type: 'date', default: today },
        {
          key: 'direction',
          label: 'Direction',
          type: 'select',
          options: TRANSPORT_TRIP_DIRECTIONS,
          default: 'PICKUP',
        },
        { key: 'notes', label: 'Notes', type: 'textarea', cols: 12 },
      ]"
    >
      <template #[`item.route`]="{ item }">{{ (item as Row).route.code }}</template>
      <template #[`item.vehicle`]="{ item }">{{ (item as Row).vehicle?.regNo ?? '—' }}</template>
      <template #[`item.actions`]="{ item, reload }">
        <template v-if="canManage">
          <v-btn
            v-if="(item as Row).status === 'SCHEDULED'"
            size="small"
            variant="text"
            @click="
              act(() => patch(`/trips/${(item as Row).id}`, { status: 'IN_PROGRESS' }), reload)
            "
            >Start</v-btn
          >
          <v-btn
            v-if="(item as Row).status === 'IN_PROGRESS'"
            size="small"
            variant="text"
            @click="act(() => patch(`/trips/${(item as Row).id}`, { status: 'COMPLETED' }), reload)"
            >End</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            @click="openBoarding(item as unknown as TransportTripDto)"
            >Boarding</v-btn
          >
        </template>
      </template>
    </ResourceTable>
    <ResourceTable
      v-else-if="tripsSub === 'incidents'"
      :endpoint="`${API}/incidents`"
      :create-endpoint="`${API}/incidents`"
      create-label="Log incident"
      create-permission="transport.manage"
      :status-options="['OPEN', 'RESOLVED']"
      :headers="[
        { title: 'When', key: 'occurredAt' },
        { title: 'Title', key: 'title' },
        { title: 'Severity', key: 'severity' },
        { title: 'Status', key: 'status' },
        { title: 'Resolution', key: 'resolution' },
        { title: '', key: 'actions', sortable: false },
      ]"
      :fields="[
        { ...routeRef, required: false },
        vehicleRef(),
        { key: 'occurredAt', label: 'Occurred at', type: 'datetime', required: true },
        {
          key: 'severity',
          label: 'Severity',
          type: 'select',
          options: TRANSPORT_INCIDENT_SEVERITIES,
          default: 'LOW',
        },
        { key: 'title', label: 'Title', required: true, cols: 12 },
        { key: 'description', label: 'Description', type: 'textarea', cols: 12 },
      ]"
    >
      <template #[`item.actions`]="{ item, reload }">
        <v-btn
          v-if="canManage && (item as Row).status === 'OPEN'"
          size="small"
          variant="text"
          @click="
            act(
              () =>
                patch(`/incidents/${(item as Row).id}`, {
                  status: 'RESOLVED',
                  resolution: 'Resolved',
                }),
              reload,
            )
          "
          >Resolve</v-btn
        >
      </template>
    </ResourceTable>
    <ResourceTable
      v-else
      :searchable="false"
      :endpoint="`${API}/fuel-logs`"
      :create-endpoint="`${API}/fuel-logs`"
      create-label="Add fuel entry"
      create-permission="transport.manage"
      :headers="[
        { title: 'Date', key: 'logDate' },
        { title: 'Vehicle', key: 'vehicleRegNo' },
        { title: 'Litres', key: 'litres' },
        { title: 'Amount', key: 'amount' },
        { title: 'Odometer', key: 'odometerKm' },
        { title: 'Vendor', key: 'vendor' },
      ]"
      :fields="[
        { ...vehicleRef(), required: true },
        { key: 'logDate', label: 'Date', type: 'date', default: today },
        { key: 'litres', label: 'Litres', type: 'number', required: true },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'odometerKm', label: 'Odometer', type: 'number' },
        { key: 'vendor', label: 'Vendor' },
      ]"
    />
    <v-dialog v-model="boarding.open" max-width="640">
      <v-card :title="`Boarding — ${boarding.trip?.route.code} ${boarding.trip?.direction}`">
        <v-table density="compact">
          <tbody>
            <tr v-for="r in boarding.rows" :key="r.allocationId">
              <td>{{ r.passengerName }}</td>
              <td>{{ r.stopName }}</td>
              <td>
                <v-btn-toggle v-model="r.status" density="compact">
                  <v-btn value="BOARDED" color="success">Boarded</v-btn>
                  <v-btn value="ABSENT" color="error">Absent</v-btn>
                </v-btn-toggle>
              </td>
            </tr>
            <tr v-if="!boarding.rows.length">
              <td>No passengers allocated to this route.</td>
            </tr>
          </tbody>
        </v-table>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="boarding.open = false">Close</v-btn>
          <v-btn color="primary" @click="saveBoarding">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>

  <!-- Maintenance -->
  <ResourceTable
    v-else-if="tab === 'maintenance'"
    :searchable="false"
    :endpoint="`${API}/maintenance`"
    :create-endpoint="`${API}/maintenance`"
    create-label="Log service / repair"
    create-permission="transport.manage"
    :headers="[
      { title: 'Date', key: 'serviceDate' },
      { title: 'Vehicle', key: 'vehicleRegNo' },
      { title: 'Kind', key: 'kind' },
      { title: 'Description', key: 'description' },
      { title: 'Cost', key: 'cost' },
      { title: 'Next service', key: 'nextServiceDate' },
    ]"
    :fields="[
      { ...vehicleRef(), required: true },
      { key: 'serviceDate', label: 'Date', type: 'date', default: today },
      {
        key: 'kind',
        label: 'Kind',
        type: 'select',
        options: VEHICLE_MAINTENANCE_KINDS,
        default: 'SERVICE',
      },
      { key: 'cost', label: 'Cost', type: 'number', default: 0 },
      { key: 'description', label: 'Description', required: true, cols: 12 },
      { key: 'odometerKm', label: 'Odometer', type: 'number' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'nextServiceDate', label: 'Next service date', type: 'date' },
    ]"
  />

  <!-- Reports -->
  <template v-else-if="tab === 'reports' && report">
    <v-card title="Route utilisation" class="mb-4">
      <v-table density="compact">
        <thead>
          <tr>
            <th>Route</th>
            <th>Seats</th>
            <th>Allocated</th>
            <th>Monthly fare</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in report.routes" :key="r.routeId">
            <td>{{ r.code }} · {{ r.name }}</td>
            <td>{{ r.capacity }}</td>
            <td>{{ r.allocated }}</td>
            <td>{{ r.monthlyFare }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
    <v-card title="Vehicle running cost" class="mb-4">
      <v-table density="compact">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Trips</th>
            <th>Km</th>
            <th>Fuel (L)</th>
            <th>Fuel cost</th>
            <th>Maintenance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in report.vehicles" :key="v.vehicleId">
            <td>{{ v.regNo }}</td>
            <td>{{ v.trips }}</td>
            <td>{{ v.distanceKm }}</td>
            <td>{{ v.fuelLitres }}</td>
            <td>{{ v.fuelCost }}</td>
            <td>{{ v.maintenanceCost }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
    <v-card title="Charges by period">
      <v-table density="compact">
        <thead>
          <tr>
            <th>Period</th>
            <th>Status</th>
            <th>Count</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in report.charges" :key="c.period + c.status">
            <td>{{ c.period }}</td>
            <td>{{ c.status }}</td>
            <td>{{ c.count }}</td>
            <td>{{ c.amount }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </template>
</template>
