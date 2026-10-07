<script setup lang="ts">
import {
  FEATURE_KEYS,
  FEATURES,
  LIMIT_KEYS,
  LIMITS,
  SUBSCRIPTION_STATUSES,
  type ApiListResponse,
  type FeatureKey,
  type InvoiceDto,
  type LimitKey,
  type OrganizationStatus,
  type PlanDto,
  type PlanLimits,
  type PlatformOrganizationDetailDto,
  type SubscriptionDto,
  type SubscriptionStatus,
} from '@erp/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiDownload, apiFetch } from '@/api/client';
import { invoiceStatusColor, invoiceStatusLabel } from '@/components/billing/billing';
import InvoiceActions from '@/components/billing/InvoiceActions.vue';
import InvoiceStatusDialog from '@/components/billing/InvoiceStatusDialog.vue';
import NewInvoiceDialog from '@/components/billing/NewInvoiceDialog.vue';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();
const id = computed(() => String(route.params.id));
const base = computed(() => `/api/v1/platform/organizations/${id.value}`);
const canManage = computed(() => auth.can('platform.organization.manage'));
const canBilling = computed(() => auth.can('platform.subscription.manage'));

const org = ref<PlatformOrganizationDetailDto | null>(null);
const subscription = ref<SubscriptionDto | null>(null);
const invoices = ref<InvoiceDto[]>([]);
const plans = ref<PlanDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function loadOrg() {
  org.value = (await apiFetch<{ data: PlatformOrganizationDetailDto }>(base.value)).data;
}

async function loadBilling() {
  if (!canBilling.value) return;
  const [sub, inv] = await Promise.all([
    apiFetch<{ data: SubscriptionDto | null }>(`${base.value}/subscription`),
    apiFetch<ApiListResponse<InvoiceDto>>(`${base.value}/invoices?pageSize=50`),
  ]);
  subscription.value = sub.data;
  invoices.value = inv.data;
  if (auth.can('platform.plan.manage') && plans.value.length === 0) {
    plans.value = (await apiFetch<{ data: PlanDto[] }>('/api/v1/platform/plans')).data;
  }
}

async function run(fn: () => Promise<void>, message?: string) {
  error.value = null;
  try {
    await fn();
    if (message) notice.value = message;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  }
}

onMounted(() => run(async () => void (await Promise.all([loadOrg(), loadBilling()]))));

const reasonRule = (v: string) => (v?.trim().length ?? 0) >= 10 || 'At least 10 characters';
const required = (v: string) => Boolean(v?.trim()) || 'Required';
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const statusColor = (s: OrganizationStatus) =>
  s === 'ACTIVE' ? 'success' : s === 'SUSPENDED' ? 'warning' : 'default';

// --- Rename ------------------------------------------------------------------------------

const renameDialog = ref(false);
const rename = reactive({ name: '', reason: '' });
function openRename() {
  Object.assign(rename, { name: org.value?.name ?? '', reason: '' });
  renameDialog.value = true;
}
async function saveRename() {
  const ok = await run(async () => {
    await apiFetch(base.value, { method: 'PATCH', body: JSON.stringify(rename) });
    await loadOrg();
  }, 'Organization renamed');
  if (ok) renameDialog.value = false;
}

// --- Status ------------------------------------------------------------------------------

const statusDialog = ref(false);
const statusForm = reactive({ status: 'SUSPENDED' as OrganizationStatus, reason: '' });
function openStatus(status: OrganizationStatus) {
  Object.assign(statusForm, { status, reason: '' });
  statusDialog.value = true;
}
async function saveStatus() {
  const ok = await run(async () => {
    await apiFetch(`${base.value}/status`, { method: 'POST', body: JSON.stringify(statusForm) });
    await loadOrg();
  }, `Organization is now ${statusForm.status}`);
  if (ok) statusDialog.value = false;
}

// --- Owners ------------------------------------------------------------------------------

const ownerDialog = ref(false);
const ownerForm = reactive({ name: '', email: '', role: 'group_owner' });
function openOwner() {
  Object.assign(ownerForm, { name: '', email: '', role: 'group_owner' });
  ownerDialog.value = true;
}
async function saveOwner() {
  const ok = await run(async () => {
    await apiFetch(`${base.value}/owners`, { method: 'POST', body: JSON.stringify(ownerForm) });
    await loadOrg();
  }, `Invite sent to ${ownerForm.email}`);
  if (ok) ownerDialog.value = false;
}

// --- Subscription ------------------------------------------------------------------------

const subDialog = ref(false);
const subForm = reactive({
  planId: '',
  status: 'ACTIVE' as SubscriptionStatus,
  addOnFeatures: [] as FeatureKey[],
  limits: {} as Record<LimitKey, string>,
  reason: '',
});
const featureItems = FEATURE_KEYS.map((k) => ({ value: k, title: `${k} — ${FEATURES[k]}` }));

function openSubscription() {
  const s = subscription.value;
  Object.assign(subForm, {
    planId: s?.plan.id ?? plans.value[0]?.id ?? '',
    status: s?.status ?? 'ACTIVE',
    addOnFeatures: [...(s?.addOnFeatures ?? [])],
    limits: Object.fromEntries(
      LIMIT_KEYS.map((k) => {
        const v = s?.limitOverrides[k];
        return [k, v === undefined ? '' : v === null ? 'unlimited' : String(v)];
      }),
    ),
    reason: '',
  });
  subDialog.value = true;
}

const limitRule = (v: string) =>
  !v?.trim() || v.trim() === 'unlimited' || /^\d+$/.test(v.trim()) || 'Number or "unlimited"';

async function saveSubscription() {
  const limitOverrides: PlanLimits = {};
  for (const k of LIMIT_KEYS) {
    const v = subForm.limits[k]?.trim();
    if (!v) continue;
    limitOverrides[k] = v === 'unlimited' ? null : Number(v);
  }
  const ok = await run(async () => {
    await apiFetch(`${base.value}/subscription`, {
      method: 'PUT',
      body: JSON.stringify({
        planId: subForm.planId,
        status: subForm.status,
        addOnFeatures: subForm.addOnFeatures,
        limitOverrides,
        reason: subForm.reason,
      }),
    });
    await loadBilling();
  }, 'Subscription updated');
  if (ok) subDialog.value = false;
}

const limitText = (limit: number | null) => (limit === null ? '∞' : limit.toLocaleString());

const invoiceHeaders = [
  { title: 'Number', key: 'number' },
  { title: 'Period', key: 'periodStart' },
  { title: 'Amount', key: 'amountCents' },
  { title: 'Due', key: 'dueAt' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

// --- Invoices ----------------------------------------------------------------------------

const newInvoiceDialog = ref(false);
const defaultTaxPercent = ref(18);
async function openNewInvoice() {
  await run(async () => {
    const s = await apiFetch<{ data: { defaultTaxRateBps: number } }>(
      '/api/v1/platform/billing-settings',
    );
    defaultTaxPercent.value = s.data.defaultTaxRateBps / 100;
  });
  newInvoiceDialog.value = true;
}
const invoiceAction = ref<'PAID' | 'OPEN' | 'VOID' | null>(null);
const actionInvoice = ref<InvoiceDto | null>(null);
const invoiceActionDialog = ref(false);
function actOnInvoice(inv: InvoiceDto, action: 'PAID' | 'OPEN' | 'VOID') {
  actionInvoice.value = inv;
  invoiceAction.value = action;
  invoiceActionDialog.value = true;
}
const downloadInvoice = (inv: InvoiceDto) =>
  run(() => apiDownload(`${base.value}/invoices/${inv.id}/pdf`, `${inv.number}.pdf`));
</script>

<template>
  <div class="d-flex align-center mb-4 ga-2">
    <v-btn icon="mdi-arrow-left" variant="text" to="/platform/organizations" />
    <h2 class="text-h5">{{ org?.name ?? 'Organization' }}</h2>
    <v-chip v-if="org" size="small" :color="statusColor(org.status)">{{ org.status }}</v-chip>
    <v-spacer />
    <template v-if="org && canManage">
      <v-btn variant="tonal" prepend-icon="mdi-pencil" @click="openRename">Rename</v-btn>
      <v-btn
        v-if="org.status !== 'ACTIVE'"
        color="success"
        variant="tonal"
        @click="openStatus('ACTIVE')"
      >
        Activate
      </v-btn>
      <v-btn
        v-if="org.status === 'ACTIVE'"
        color="warning"
        variant="tonal"
        @click="openStatus('SUSPENDED')"
      >
        Suspend
      </v-btn>
      <v-btn
        v-if="org.status !== 'ARCHIVED'"
        color="error"
        variant="tonal"
        @click="openStatus('ARCHIVED')"
      >
        Archive
      </v-btn>
    </template>
  </div>
  <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-alert v-if="notice" type="success" class="mb-4" closable @click:close="notice = null">
    {{ notice }}
  </v-alert>

  <template v-if="org">
    <v-row>
      <v-col cols="12" md="6">
        <v-card title="Overview" class="mb-4">
          <v-card-text>
            <div><strong>Slug:</strong> {{ org.slug }}</div>
            <div><strong>Created:</strong> {{ date(org.createdAt) }}</div>
            <div class="d-flex ga-2 mt-3 flex-wrap">
              <v-chip>{{ org.counts.groups }} groups</v-chip>
              <v-chip>{{ org.counts.institutions }} institutions</v-chip>
              <v-chip>{{ org.counts.users }} users</v-chip>
              <v-chip>{{ org.counts.employees }} employees</v-chip>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            Owners
            <v-spacer />
            <v-btn
              v-if="canManage"
              size="small"
              variant="tonal"
              prepend-icon="mdi-account-plus"
              @click="openOwner"
            >
              Invite owner
            </v-btn>
          </v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="o in org.owners"
              :key="o.id"
              :title="o.name"
              :subtitle="o.email"
              prepend-icon="mdi-account-tie"
            >
              <template #append>
                <v-chip size="x-small" :color="o.membershipStatus === 'ACTIVE' ? 'success' : ''">
                  {{ o.membershipStatus }}
                </v-chip>
              </template>
            </v-list-item>
            <v-list-item v-if="org.owners.length === 0" subtitle="No owners yet" />
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-if="canBilling" class="mb-4">
      <v-card-title class="d-flex align-center">
        Subscription
        <template v-if="subscription">
          <span class="ml-2 text-medium-emphasis">{{ subscription.plan.name }}</span>
          <v-chip class="ml-2" size="small" :color="subscription.active ? 'success' : 'error'">
            {{ subscription.status }}
          </v-chip>
        </template>
        <v-spacer />
        <v-btn
          v-if="plans.length > 0"
          size="small"
          variant="tonal"
          prepend-icon="mdi-cog"
          @click="openSubscription"
        >
          Configure
        </v-btn>
      </v-card-title>
      <v-card-text v-if="subscription">
        <div v-if="subscription.trialEndsAt">Trial ends {{ date(subscription.trialEndsAt) }}</div>
        <div>
          Current period: {{ date(subscription.currentPeriodStart) }} –
          {{ date(subscription.currentPeriodEnd) }}
        </div>
        <div class="mt-3 text-subtitle-2">Licensed modules</div>
        <v-chip
          v-for="f in subscription.licensedFeatures"
          :key="f"
          size="small"
          class="mr-1 mt-1"
          :color="subscription.addOnFeatures.includes(f) ? 'primary' : undefined"
        >
          {{ f }}
        </v-chip>
        <div class="mt-3 text-subtitle-2">Limits (used / limit)</div>
        <v-table density="compact">
          <tbody>
            <tr v-for="l in subscription.limits" :key="l.key">
              <td>{{ LIMITS[l.key].label }}</td>
              <td>{{ l.used.toLocaleString() }} / {{ limitText(l.limit) }}</td>
              <td>
                <v-chip v-if="subscription.limitOverrides[l.key] !== undefined" size="x-small">
                  override
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else>No subscription.</v-card-text>
    </v-card>

    <v-card v-if="canBilling">
      <v-card-title class="d-flex align-center">
        Invoices
        <v-spacer />
        <v-btn
          v-if="subscription"
          size="small"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openNewInvoice"
        >
          New invoice
        </v-btn>
      </v-card-title>
      <v-data-table :items="invoices" :headers="invoiceHeaders" density="compact">
        <template #[`item.status`]="{ item }">
          <v-chip size="small" :color="invoiceStatusColor(item.status)">
            {{ invoiceStatusLabel(item.status) }}
          </v-chip>
          <div v-if="item.submittedReference && item.status !== 'PAID'" class="text-caption">
            UTR {{ item.submittedReference }}
          </div>
        </template>
        <template #[`item.actions`]="{ item }">
          <InvoiceActions
            :invoice="item"
            @pdf="downloadInvoice(item)"
            @act="(a) => actOnInvoice(item, a)"
          />
        </template>
        <template #[`item.periodStart`]="{ item }">
          {{ date(item.periodStart) }} – {{ date(item.periodEnd) }}
        </template>
        <template #[`item.amountCents`]="{ item }">
          {{ money(item.amountCents, item.currency) }}
        </template>
        <template #[`item.dueAt`]="{ item }">{{ date(item.dueAt) }}</template>
      </v-data-table>
    </v-card>
  </template>

  <NewInvoiceDialog
    v-model="newInvoiceDialog"
    :organization-id="id"
    :subscription="subscription"
    :default-tax-percent="defaultTaxPercent"
    @created="(inv) => run(loadBilling, `Invoice ${inv.number} created`)"
  />
  <InvoiceStatusDialog
    v-model="invoiceActionDialog"
    :organization-id="id"
    :invoice="actionInvoice"
    :action="invoiceAction"
    @saved="(inv) => run(loadBilling, `Invoice ${inv.number} updated`)"
  />

  <v-dialog v-model="renameDialog" max-width="520">
    <v-card title="Rename organization">
      <v-form @submit.prevent="saveRename">
        <v-card-text>
          <v-text-field v-model="rename.name" label="Name" :rules="[required]" />
          <v-text-field v-model="rename.reason" label="Reason" :rules="[reasonRule]" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="renameDialog = false">Cancel</v-btn>
          <v-btn color="primary" type="submit">Save</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>

  <v-dialog v-model="statusDialog" max-width="520">
    <v-card :title="`Set status to ${statusForm.status}`">
      <v-form @submit.prevent="saveStatus">
        <v-card-text>
          <v-alert
            v-if="statusForm.status !== 'ACTIVE'"
            type="warning"
            variant="tonal"
            class="mb-4"
          >
            All users of this organization will be signed out and blocked until it is re-activated.
            Data is retained.
          </v-alert>
          <v-text-field v-model="statusForm.reason" label="Reason" :rules="[reasonRule]" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="statusDialog = false">Cancel</v-btn>
          <v-btn color="primary" type="submit">Confirm</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>

  <v-dialog v-model="ownerDialog" max-width="520">
    <v-card title="Invite owner">
      <v-form @submit.prevent="saveOwner">
        <v-card-text>
          <v-text-field v-model="ownerForm.name" label="Name" :rules="[required]" />
          <v-text-field v-model="ownerForm.email" label="E-mail" type="email" :rules="[required]" />
          <v-select
            v-model="ownerForm.role"
            :items="[
              { title: 'Group owner (full tenant access)', value: 'group_owner' },
              { title: 'Institution owner', value: 'institution_owner' },
            ]"
            label="Role"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="ownerDialog = false">Cancel</v-btn>
          <v-btn color="primary" type="submit">Send invite</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>

  <v-dialog v-model="subDialog" max-width="720">
    <v-card title="Configure subscription">
      <v-form @submit.prevent="saveSubscription">
        <v-card-text>
          <div class="d-flex ga-4">
            <v-select
              v-model="subForm.planId"
              :items="plans"
              item-title="name"
              item-value="id"
              label="Plan"
            />
            <v-select
              v-model="subForm.status"
              :items="[...SUBSCRIPTION_STATUSES]"
              label="Status"
              style="max-width: 180px"
            />
          </div>
          <v-autocomplete
            v-model="subForm.addOnFeatures"
            :items="featureItems"
            label="Add-on modules (on top of the plan)"
            multiple
            chips
            closable-chips
          />
          <div class="text-subtitle-2 mb-2">
            Limit overrides (blank = plan default, "unlimited" = no cap)
          </div>
          <v-row dense>
            <v-col v-for="k in LIMIT_KEYS" :key="k" cols="12" sm="6">
              <v-text-field
                v-model="subForm.limits[k]"
                :label="LIMITS[k].label"
                :rules="[limitRule]"
                density="compact"
              />
            </v-col>
          </v-row>
          <v-text-field v-model="subForm.reason" label="Reason" :rules="[reasonRule]" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="subDialog = false">Cancel</v-btn>
          <v-btn color="primary" type="submit">Save</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
