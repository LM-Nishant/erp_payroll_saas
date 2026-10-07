<script setup lang="ts">
import {
  FEATURE_KEYS,
  FEATURES,
  LIMIT_KEYS,
  LIMITS,
  type LimitKey,
  type PlanDto,
  type PlanLimits,
} from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { money } from '@/components/billing/billing';

/** Platform: subscription plan catalog (custom plans, modules and limits). */
const plans = ref<PlanDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load() {
  try {
    plans.value = (await apiFetch<{ data: PlanDto[] }>('/api/v1/platform/plans')).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const headers = [
  { title: 'Plan', key: 'name' },
  { title: 'Price', key: 'priceCents' },
  { title: 'Modules', key: 'features', sortable: false },
  { title: 'Status', key: 'status' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];
const featureItems = FEATURE_KEYS.map((k) => ({ value: k, title: FEATURES[k] }));
const byteLimit = (k: LimitKey) => k === 'storage_bytes';
const GB = 1024 ** 3;

const dialog = ref(false);
const editing = ref<PlanDto | null>(null);
const saving = ref(false);
const form = reactive({
  key: '',
  name: '',
  description: '',
  price: 0,
  currency: 'INR',
  billingInterval: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
  trialDays: 14,
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  features: [] as string[],
  limits: {} as Record<LimitKey, { unlimited: boolean; value: number }>,
});

function openPlan(plan: PlanDto | null) {
  editing.value = plan;
  Object.assign(form, {
    key: plan?.key ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price: (plan?.priceCents ?? 0) / 100,
    currency: plan?.currency ?? 'INR',
    billingInterval: plan?.billingInterval ?? 'MONTHLY',
    trialDays: plan?.trialDays ?? 14,
    status: plan?.status ?? 'ACTIVE',
    features: [...(plan?.features ?? [])],
    limits: Object.fromEntries(
      LIMIT_KEYS.map((k) => {
        const v = plan ? plan.limits[k] : 0;
        const unlimited = v === null;
        const raw = v ?? 0;
        return [k, { unlimited, value: byteLimit(k) ? raw / GB : raw }];
      }),
    ),
  });
  dialog.value = true;
}

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const limits: PlanLimits = {};
    for (const k of LIMIT_KEYS) {
      const l = form.limits[k];
      limits[k] = l.unlimited ? null : Math.round(Number(l.value) * (byteLimit(k) ? GB : 1));
    }
    const body = {
      name: form.name,
      description: form.description || null,
      priceCents: Math.round(Number(form.price) * 100),
      currency: form.currency,
      billingInterval: form.billingInterval,
      trialDays: Number(form.trialDays),
      status: form.status,
      features: form.features,
      limits,
    };
    if (editing.value) {
      await apiFetch(`/api/v1/platform/plans/${editing.value.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } else {
      await apiFetch('/api/v1/platform/plans', {
        method: 'POST',
        body: JSON.stringify({ key: form.key, ...body }),
      });
    }
    dialog.value = false;
    notice.value = `Plan ${form.name} saved`;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

const required = (v: string) => Boolean(String(v ?? '').trim()) || 'Required';
const keyRule = (v: string) => /^[a-z][a-z0-9_]{1,63}$/.test(v) || 'lower_snake_case';
</script>

<template>
  <div class="d-flex align-center mb-4">
    <h2 class="text-h5">Plans</h2>
    <v-spacer />
    <v-btn color="primary" prepend-icon="mdi-plus" @click="openPlan(null)">New plan</v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-4" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-snackbar :model-value="!!notice" color="success" @update:model-value="notice = null">
    {{ notice }}
  </v-snackbar>
  <v-card>
    <v-data-table :items="plans" :headers="headers" density="comfortable">
      <template #[`item.name`]="{ item }">
        <div class="font-weight-medium">{{ item.name }}</div>
        <div class="text-caption text-medium-emphasis">{{ item.key }}</div>
      </template>
      <template #[`item.priceCents`]="{ item }">
        {{ money(item.priceCents, item.currency) }} /
        {{ item.billingInterval === 'YEARLY' ? 'year' : 'month' }}
      </template>
      <template #[`item.features`]="{ item }">
        <v-chip v-for="f in item.features" :key="f" size="x-small" class="mr-1 mb-1">{{
          f
        }}</v-chip>
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip size="small" :color="item.status === 'ACTIVE' ? 'success' : 'default'">
          {{ item.status }}
        </v-chip>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn size="small" variant="text" icon="mdi-pencil" @click="openPlan(item)" />
      </template>
    </v-data-table>
  </v-card>

  <v-dialog v-model="dialog" max-width="760" scrollable>
    <v-card :title="editing ? `Edit plan — ${editing.name}` : 'New plan'">
      <v-form @submit.prevent="save">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" md="6">
              <v-text-field v-model="form.name" label="Name" :rules="[required]" />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="form.key"
                label="Key"
                :disabled="!!editing"
                :rules="editing ? [] : [keyRule]"
                hint="e.g. custom_logicmines"
                persistent-hint
              />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="form.description" label="Description" rows="2" auto-grow />
            </v-col>
            <v-col cols="6" md="3">
              <v-text-field
                v-model.number="form.price"
                type="number"
                min="0"
                step="0.01"
                label="Price"
              />
            </v-col>
            <v-col cols="6" md="3">
              <v-text-field v-model="form.currency" label="Currency" />
            </v-col>
            <v-col cols="6" md="3">
              <v-select
                v-model="form.billingInterval"
                :items="['MONTHLY', 'YEARLY']"
                label="Billing"
              />
            </v-col>
            <v-col cols="6" md="3">
              <v-text-field
                v-model.number="form.trialDays"
                type="number"
                min="0"
                label="Trial days"
              />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="form.features"
                :items="featureItems"
                label="Modules"
                multiple
                chips
                closable-chips
              />
            </v-col>
          </v-row>
          <div class="text-subtitle-2 mb-2">Limits</div>
          <v-row v-for="k in LIMIT_KEYS" :key="k" dense align="center">
            <v-col cols="5">{{ LIMITS[k].label }}{{ byteLimit(k) ? ' (GB)' : '' }}</v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.limits[k].value"
                type="number"
                min="0"
                density="compact"
                hide-details
                :disabled="form.limits[k].unlimited"
              />
            </v-col>
            <v-col cols="3">
              <v-checkbox
                v-model="form.limits[k].unlimited"
                label="Unlimited"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>
          <v-select
            v-model="form.status"
            :items="['ACTIVE', 'INACTIVE']"
            label="Status"
            class="mt-4"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" type="submit" :loading="saving">Save</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
