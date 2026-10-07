<script setup lang="ts">
import {
  ASSET_CONDITIONS,
  ASSET_DISPOSAL_METHODS,
  ASSET_MAINTENANCE_PRIORITIES,
  ASSET_MAINTENANCE_TYPES,
  ASSET_RETURN_STATUSES,
} from '@erp/shared';
import type {
  AssetAssignmentDto,
  AssetAttributeDef,
  AssetDepreciationScheduleDto,
  AssetDisposalDto,
  AssetDto,
  AssetMaintenanceDto,
  AssetTransferDto,
  SignedUrlDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { apiDownload, apiFetch } from '@/api/client';
import EmployeePicker from '@/components/EmployeePicker.vue';
import { useAuthStore } from '@/stores/auth';
import { ASSET_STATUS_COLORS, clean, label, money, useAssetOptions, opts } from './assetUi';

type AssetDetail = AssetDto & {
  activeAssignment: AssetAssignmentDto | null;
  assignments: AssetAssignmentDto[];
  maintenance: AssetMaintenanceDto[];
  transfers: AssetTransferDto[];
  disposals: AssetDisposalDto[];
  categoryAttributes: AssetAttributeDef[];
};

const props = defineProps<{ id: string }>();
const auth = useAuthStore();
const { institutions, departments, campuses, loadBase, loadForInstitution } = useAssetOptions();
const asset = ref<AssetDetail | null>(null);
const schedule = ref<AssetDepreciationScheduleDto | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const tab = ref('details');
const dialog = ref<'' | 'checkout' | 'checkin' | 'transfer' | 'ticket' | 'dispose' | 'edit'>('');

const today = new Date().toISOString().slice(0, 10);
const checkout = reactive({
  targetType: 'EMPLOYEE',
  employeeId: null as string | null,
  departmentId: '',
  location: '',
  expectedReturnDate: '',
  accessories: '',
  notes: '',
});
const checkin = reactive({
  returnStatus: 'RETURNED',
  condition: 'GOOD',
  recoveryAmount: '',
  notes: '',
});
const transfer = reactive({
  toInstitutionId: '',
  toCampusId: '',
  toDepartmentId: '',
  toLocation: '',
  reason: '',
});
const ticket = reactive({
  type: 'REPAIR',
  priority: 'MEDIUM',
  title: '',
  description: '',
  vendor: '',
  scheduledDate: '',
});
const dispose = reactive({
  method: 'SCRAPPED',
  disposalDate: today,
  saleValue: '',
  buyer: '',
  reason: '',
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edit = reactive<Record<string, any>>({});

const api = (path: string, method: string, body?: unknown) =>
  apiFetch<{ data: unknown }>(`/api/v1/assets/${props.id}${path}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function load() {
  error.value = null;
  try {
    asset.value = (await apiFetch<{ data: AssetDetail }>(`/api/v1/assets/${props.id}`)).data;
    schedule.value = (
      await apiFetch<{ data: AssetDepreciationScheduleDto }>(
        `/api/v1/assets/${props.id}/depreciation`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function run(fn: () => Promise<unknown>, msg: string) {
  error.value = null;
  try {
    await fn();
    dialog.value = '';
    notice.value = msg;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const doCheckout = () =>
  run(
    () =>
      api('/checkout', 'POST', {
        ...clean({ ...checkout, accessories: undefined }),
        accessories: checkout.accessories
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    'Asset checked out',
  );
const doCheckin = () =>
  run(
    () =>
      api('/checkin', 'POST', {
        ...clean(checkin),
        recoveryAmount: checkin.recoveryAmount ? Number(checkin.recoveryAmount) : null,
      }),
    'Asset checked in',
  );
const doTransfer = () => run(() => api('/transfer', 'POST', clean(transfer)), 'Transfer requested');
const doTicket = () =>
  run(
    () =>
      apiFetch('/api/v1/assets/maintenance', {
        method: 'POST',
        body: JSON.stringify(clean({ ...ticket, assetId: props.id })),
      }),
    'Maintenance ticket created',
  );
const doDispose = () =>
  run(
    () =>
      apiFetch('/api/v1/assets/disposals', {
        method: 'POST',
        body: JSON.stringify({
          ...clean(dispose),
          assetId: props.id,
          saleValue: dispose.saleValue ? Number(dispose.saleValue) : null,
        }),
      }),
    'Disposal requested',
  );
function openEdit() {
  const a = asset.value!;
  Object.assign(edit, {
    name: a.name,
    make: a.make ?? '',
    model: a.model ?? '',
    serialNo: a.serialNo ?? '',
    vendor: a.vendor ?? '',
    invoiceNo: a.invoiceNo ?? '',
    purchaseDate: a.purchaseDate ?? '',
    purchaseCost: a.purchaseCost,
    warrantyExpiry: a.warrantyExpiry ?? '',
    amcVendor: a.amcVendor ?? '',
    amcExpiry: a.amcExpiry ?? '',
    serviceIntervalDays: a.serviceIntervalDays ?? '',
    nextServiceDate: a.nextServiceDate ?? '',
    location: a.location ?? '',
    condition: a.condition,
    notes: a.notes ?? '',
    attributes: { ...(a.attributes ?? {}) },
  });
  dialog.value = 'edit';
}
const doEdit = () =>
  run(
    () =>
      api('', 'PATCH', {
        ...clean({ ...edit, attributes: undefined }),
        purchaseCost: Number(edit.purchaseCost),
        serviceIntervalDays: edit.serviceIntervalDays ? Number(edit.serviceIntervalDays) : null,
        attributes: edit.attributes,
      }),
    'Asset updated',
  );
const markLost = () => run(() => api('', 'PATCH', { status: 'LOST' }), 'Asset marked lost');

const invoiceFile = ref<File | null>(null);
async function uploadInvoice() {
  if (!invoiceFile.value) return;
  const fd = new FormData();
  fd.append('file', invoiceFile.value);
  await run(
    () => apiFetch(`/api/v1/assets/${props.id}/invoice`, { method: 'POST', body: fd }),
    'Invoice uploaded',
  );
  invoiceFile.value = null;
}
async function openUrl(path: string) {
  try {
    const r = await apiFetch<{ data: SignedUrlDto }>(path);
    window.open(r.data.url, '_blank');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const labelPdf = () =>
  apiDownload(`/api/v1/assets/labels?assetIds=${props.id}`, `${asset.value?.assetTag}-label.pdf`);

const facts = computed(() => {
  const a = asset.value;
  if (!a) return [];
  return [
    ['Category', a.category?.name],
    ['Make / model', [a.make, a.model].filter(Boolean).join(' ')],
    ['Serial no', a.serialNo],
    ['Institution', a.institution?.name],
    ['Campus', a.campus?.name],
    ['Department', a.department?.name],
    ['Location', a.location],
    ['Condition', label(a.condition)],
    ['Custodian', a.custodian ? `${a.custodian.displayName} (${a.custodian.employeeCode})` : null],
    ['Vendor', a.vendor],
    ['Invoice no', a.invoiceNo],
    ['Purchase date', a.purchaseDate],
    ['Purchase cost', money(a.purchaseCost)],
    ['Book value', money(a.bookValue)],
    ['Warranty expiry', a.warrantyExpiry],
    ['AMC', [a.amcVendor, a.amcExpiry].filter(Boolean).join(' · until ')],
    ['Next service', a.nextServiceDate],
    ['Last verified', a.lastVerifiedAt?.slice(0, 10)],
    ...a.categoryAttributes.map((d) => [d.label, String(a.attributes?.[d.key] ?? '')]),
    ['Notes', a.notes],
  ].filter(([, v]) => v) as [string, string][];
});
const live = computed(() => asset.value && !['DISPOSED'].includes(asset.value.status));

onMounted(async () => {
  await Promise.all([load(), loadBase()]);
});
async function pickInstitution(id: string) {
  transfer.toInstitutionId = id;
  transfer.toCampusId = '';
  transfer.toDepartmentId = '';
  await loadForInstitution(id);
}
async function openCheckout() {
  await loadForInstitution(asset.value?.institutionId);
  dialog.value = 'checkout';
}
</script>

<template>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-snackbar
    :model-value="!!notice"
    :timeout="2500"
    color="success"
    @update:model-value="notice = null"
    >{{ notice }}</v-snackbar
  >
  <template v-if="asset">
    <div class="d-flex align-center mb-4 flex-wrap ga-2">
      <v-btn icon="mdi-arrow-left" variant="text" to="/assets/register" />
      <div>
        <h2 class="text-h5">{{ asset.assetTag }} · {{ asset.name }}</h2>
        <v-chip size="small" :color="ASSET_STATUS_COLORS[asset.status]">{{
          label(asset.status)
        }}</v-chip>
      </div>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-qrcode" @click="labelPdf">Label</v-btn>
      <template v-if="live">
        <v-btn
          v-if="asset.status === 'IN_STOCK' && auth.can('asset.assign')"
          color="primary"
          prepend-icon="mdi-account-arrow-right"
          @click="openCheckout"
          >Check out</v-btn
        >
        <v-btn
          v-if="asset.activeAssignment && auth.can('asset.assign')"
          color="primary"
          prepend-icon="mdi-account-arrow-left"
          @click="dialog = 'checkin'"
          >Check in</v-btn
        >
        <v-btn
          v-if="asset.status === 'IN_STOCK' && auth.can('asset.assign')"
          variant="tonal"
          prepend-icon="mdi-swap-horizontal"
          @click="dialog = 'transfer'"
          >Transfer</v-btn
        >
        <v-btn
          v-if="auth.can('asset.maintain')"
          variant="tonal"
          prepend-icon="mdi-wrench"
          @click="dialog = 'ticket'"
          >Maintenance</v-btn
        >
        <v-btn
          v-if="auth.can('asset.manage')"
          variant="tonal"
          prepend-icon="mdi-pencil"
          @click="openEdit"
          >Edit</v-btn
        >
        <v-menu v-if="auth.can('asset.dispose') || auth.can('asset.manage')">
          <template #activator="{ props: p }"
            ><v-btn v-bind="p" icon="mdi-dots-vertical" variant="text"
          /></template>
          <v-list density="compact">
            <v-list-item
              v-if="auth.can('asset.dispose') && asset.status !== 'ASSIGNED'"
              title="Dispose / write off"
              @click="dialog = 'dispose'"
            />
            <v-list-item
              v-if="auth.can('asset.manage') && asset.status !== 'LOST'"
              title="Mark lost"
              @click="markLost"
            />
          </v-list>
        </v-menu>
      </template>
    </div>

    <v-tabs v-model="tab" class="mb-3">
      <v-tab value="details">Details</v-tab>
      <v-tab value="custody">Custody ({{ asset.assignments.length }})</v-tab>
      <v-tab value="maintenance">Maintenance ({{ asset.maintenance.length }})</v-tab>
      <v-tab value="depreciation">Depreciation</v-tab>
      <v-tab value="history">Transfers & disposal</v-tab>
    </v-tabs>
    <v-window v-model="tab">
      <v-window-item value="details">
        <v-row>
          <v-col cols="12" md="8">
            <v-table density="compact">
              <tbody>
                <tr v-for="[k, v] in facts" :key="k">
                  <th style="width: 220px">{{ k }}</th>
                  <td>{{ v }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-col>
          <v-col cols="12" md="4">
            <v-card variant="outlined">
              <v-card-title>Purchase invoice</v-card-title>
              <v-card-text>
                <v-btn
                  v-if="asset.invoiceDocumentId"
                  variant="tonal"
                  prepend-icon="mdi-file-download"
                  class="mb-3"
                  @click="openUrl(`/api/v1/assets/${asset.id}/invoice`)"
                  >Download invoice</v-btn
                >
                <template v-if="auth.can('asset.manage')">
                  <v-file-input
                    v-model="invoiceFile"
                    label="Upload invoice (PDF / image)"
                    accept=".pdf,.png,.jpg,.jpeg"
                    density="compact"
                  />
                  <v-btn :disabled="!invoiceFile" color="primary" @click="uploadInvoice"
                    >Upload</v-btn
                  >
                </template>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-window-item>
      <v-window-item value="custody">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Assigned</th>
              <th>To</th>
              <th>Acknowledged</th>
              <th>Returned</th>
              <th>Return status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in asset.assignments" :key="a.id">
              <td>{{ a.assignedAt }}</td>
              <td>
                {{
                  a.employee
                    ? `${a.employee.displayName} (${a.employee.employeeCode})`
                    : (a.location ?? label(a.targetType))
                }}
              </td>
              <td>
                {{ a.acknowledgedAt?.slice(0, 10) ?? (a.status === 'ACTIVE' ? 'Pending' : '—') }}
              </td>
              <td>{{ a.returnedAt ?? '—' }}</td>
              <td>{{ a.returnStatus ? label(a.returnStatus) : '' }}</td>
              <td>
                <v-btn
                  v-if="a.handoverDocumentId"
                  size="small"
                  variant="text"
                  @click="openUrl(`/api/v1/assets/assignments/${a.id}/handover`)"
                  >Handover form</v-btn
                >
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>
      <v-window-item value="maintenance">
        <v-table density="compact">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Type</th>
              <th>Title</th>
              <th>Status</th>
              <th>Vendor</th>
              <th>Completed</th>
              <th class="text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in asset.maintenance" :key="m.id">
              <td>{{ m.ticketNo }}</td>
              <td>{{ label(m.type) }}</td>
              <td>{{ m.title }}</td>
              <td>
                <v-chip size="small" :color="ASSET_STATUS_COLORS[m.status]">{{
                  label(m.status)
                }}</v-chip>
              </td>
              <td>{{ m.vendor }}</td>
              <td>{{ m.completedAt ?? '' }}</td>
              <td class="text-right">{{ money(m.cost) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>
      <v-window-item value="depreciation">
        <template v-if="schedule">
          <p class="mb-2">
            Method <b>{{ schedule.method }}</b>
            <span v-if="schedule.rate != null"> · rate {{ schedule.rate }}%</span>
            <span v-if="schedule.usefulLifeYears"> · life {{ schedule.usefulLifeYears }} yrs</span>
            · residual {{ money(schedule.residualValue) }} · accumulated
            {{ money(schedule.accumulatedDepreciation) }} · book value
            <b>{{ money(schedule.bookValue) }}</b>
          </p>
          <v-table density="compact">
            <thead>
              <tr>
                <th>Year</th>
                <th>Period</th>
                <th class="text-right">Opening</th>
                <th class="text-right">Depreciation</th>
                <th class="text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in schedule.rows" :key="r.year">
                <td>{{ r.year }}</td>
                <td>{{ r.fromDate }} → {{ r.toDate }}</td>
                <td class="text-right">{{ money(r.openingValue) }}</td>
                <td class="text-right">{{ money(r.depreciation) }}</td>
                <td class="text-right">{{ money(r.closingValue) }}</td>
              </tr>
            </tbody>
          </v-table>
        </template>
      </v-window-item>
      <v-window-item value="history">
        <h3 class="text-subtitle-1 mb-1">Transfers</h3>
        <v-table density="compact" class="mb-4">
          <tbody>
            <tr v-for="t in asset.transfers" :key="t.id">
              <td>{{ t.createdAt.slice(0, 10) }}</td>
              <td>{{ t.fromLocation ?? '' }} → {{ t.toLocation ?? '' }}</td>
              <td>{{ t.reason }}</td>
              <td>
                <v-chip size="small">{{ label(t.status) }}</v-chip>
              </td>
            </tr>
            <tr v-if="!asset.transfers.length">
              <td>No transfers</td>
            </tr>
          </tbody>
        </v-table>
        <h3 class="text-subtitle-1 mb-1">Disposal</h3>
        <v-table density="compact">
          <tbody>
            <tr v-for="d in asset.disposals" :key="d.id">
              <td>{{ d.disposalDate }}</td>
              <td>{{ label(d.method) }}</td>
              <td>Book {{ money(d.bookValue) }} · sale {{ money(d.saleValue) }}</td>
              <td>{{ d.reason }}</td>
              <td>
                <v-chip size="small" :color="ASSET_STATUS_COLORS[d.status]">{{
                  label(d.status)
                }}</v-chip>
              </td>
            </tr>
            <tr v-if="!asset.disposals.length">
              <td>No disposal requests</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>
    </v-window>

    <v-dialog
      :model-value="dialog === 'checkout'"
      max-width="640"
      @update:model-value="dialog = ''"
    >
      <v-card title="Check out asset">
        <v-card-text>
          <v-btn-toggle v-model="checkout.targetType" mandatory density="compact" class="mb-3">
            <v-btn value="EMPLOYEE">Employee</v-btn>
            <v-btn value="DEPARTMENT">Department</v-btn>
            <v-btn value="LOCATION">Room / location</v-btn>
          </v-btn-toggle>
          <EmployeePicker v-if="checkout.targetType === 'EMPLOYEE'" v-model="checkout.employeeId" />
          <v-select
            v-if="checkout.targetType === 'DEPARTMENT'"
            v-model="checkout.departmentId"
            :items="departments"
            item-title="name"
            item-value="id"
            label="Department"
          />
          <v-text-field v-model="checkout.location" label="Location" />
          <v-text-field v-model="checkout.expectedReturnDate" type="date" label="Expected return" />
          <v-text-field v-model="checkout.accessories" label="Accessories (comma separated)" />
          <v-textarea v-model="checkout.notes" label="Notes" rows="2" />
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="dialog = ''">Cancel</v-btn
          ><v-btn color="primary" @click="doCheckout">Check out</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
    <v-dialog :model-value="dialog === 'checkin'" max-width="520" @update:model-value="dialog = ''">
      <v-card title="Check in asset">
        <v-card-text>
          <v-select
            v-model="checkin.returnStatus"
            :items="opts(ASSET_RETURN_STATUSES)"
            label="Return status"
          />
          <v-select v-model="checkin.condition" :items="opts(ASSET_CONDITIONS)" label="Condition" />
          <v-text-field
            v-model="checkin.recoveryAmount"
            type="number"
            label="Recovery amount (₹)"
          />
          <v-textarea v-model="checkin.notes" label="Notes" rows="2" />
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="dialog = ''">Cancel</v-btn
          ><v-btn color="primary" @click="doCheckin">Check in</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
    <v-dialog
      :model-value="dialog === 'transfer'"
      max-width="560"
      @update:model-value="dialog = ''"
    >
      <v-card title="Transfer asset">
        <v-card-text>
          <v-autocomplete
            :model-value="transfer.toInstitutionId"
            :items="institutions"
            item-title="name"
            item-value="id"
            label="To institution"
            @update:model-value="pickInstitution"
          />
          <v-select
            v-model="transfer.toCampusId"
            :items="campuses"
            item-title="name"
            item-value="id"
            label="Campus"
            clearable
          />
          <v-select
            v-model="transfer.toDepartmentId"
            :items="departments"
            item-title="name"
            item-value="id"
            label="Department"
            clearable
          />
          <v-text-field v-model="transfer.toLocation" label="New location" />
          <v-textarea v-model="transfer.reason" label="Reason" rows="2" />
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="dialog = ''">Cancel</v-btn
          ><v-btn color="primary" @click="doTransfer">Request transfer</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
    <v-dialog :model-value="dialog === 'ticket'" max-width="560" @update:model-value="dialog = ''">
      <v-card title="New maintenance ticket">
        <v-card-text>
          <v-select v-model="ticket.type" :items="opts(ASSET_MAINTENANCE_TYPES)" label="Type" />
          <v-select
            v-model="ticket.priority"
            :items="opts(ASSET_MAINTENANCE_PRIORITIES)"
            label="Priority"
          />
          <v-text-field v-model="ticket.title" label="Title" />
          <v-textarea v-model="ticket.description" label="Description" rows="2" />
          <v-text-field v-model="ticket.vendor" label="Vendor" />
          <v-text-field v-model="ticket.scheduledDate" type="date" label="Scheduled" />
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="dialog = ''">Cancel</v-btn
          ><v-btn color="primary" @click="doTicket">Create</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
    <v-dialog :model-value="dialog === 'dispose'" max-width="560" @update:model-value="dialog = ''">
      <v-card title="Dispose / write off">
        <v-card-text>
          <v-select v-model="dispose.method" :items="opts(ASSET_DISPOSAL_METHODS)" label="Method" />
          <v-text-field v-model="dispose.disposalDate" type="date" label="Date" />
          <v-text-field v-model="dispose.saleValue" type="number" label="Sale value (₹)" />
          <v-text-field v-model="dispose.buyer" label="Buyer / recipient" />
          <v-textarea v-model="dispose.reason" label="Reason" rows="2" />
          <p class="text-caption">
            Book value today: {{ money(asset.bookValue) }}. Goes for approval.
          </p>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="dialog = ''">Cancel</v-btn
          ><v-btn color="error" @click="doDispose">Submit</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
    <v-dialog :model-value="dialog === 'edit'" max-width="760" @update:model-value="dialog = ''">
      <v-card title="Edit asset">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="6"><v-text-field v-model="edit.name" label="Name" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="edit.make" label="Make" /></v-col>
            <v-col cols="12" md="3"><v-text-field v-model="edit.model" label="Model" /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.serialNo" label="Serial no"
            /></v-col>
            <v-col cols="12" md="4"><v-text-field v-model="edit.vendor" label="Vendor" /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.invoiceNo" label="Invoice no"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.purchaseDate" type="date" label="Purchase date"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.purchaseCost" type="number" label="Cost"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.warrantyExpiry" type="date" label="Warranty expiry"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.amcVendor" label="AMC vendor"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.amcExpiry" type="date" label="AMC expiry"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field
                v-model="edit.serviceIntervalDays"
                type="number"
                label="Service every (days)"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.nextServiceDate" type="date" label="Next service"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-select v-model="edit.condition" :items="opts(ASSET_CONDITIONS)" label="Condition"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="edit.location" label="Location"
            /></v-col>
            <v-col v-for="d in asset.categoryAttributes" :key="d.key" cols="12" md="4">
              <v-select
                v-if="d.type === 'select'"
                v-model="(edit.attributes as Record<string, string | null>)[d.key]"
                :items="d.options ?? []"
                :label="d.label"
              />
              <v-checkbox
                v-else-if="d.type === 'boolean'"
                v-model="(edit.attributes as Record<string, unknown>)[d.key]"
                :label="d.label"
              />
              <v-text-field
                v-else
                v-model="(edit.attributes as Record<string, unknown>)[d.key]"
                :type="d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'"
                :label="d.label"
              />
            </v-col>
            <v-col cols="12"><v-textarea v-model="edit.notes" label="Notes" rows="2" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn variant="text" @click="dialog = ''">Cancel</v-btn
          ><v-btn color="primary" @click="doEdit">Save</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
  </template>
</template>
