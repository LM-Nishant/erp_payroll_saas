<script setup lang="ts">
import type { InvoiceDto, SubscriptionDto } from '@erp/shared';
import { computed, reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { isoDay, money } from './billing';

/** Platform: raise an invoice (line items + GST) for an organization. */
const props = defineProps<{
  organizationId: string;
  subscription: SubscriptionDto | null;
  defaultTaxPercent?: number;
}>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ created: [InvoiceDto] }>();

interface Line {
  description: string;
  quantity: number;
  unit: number;
}
const form = reactive({
  periodStart: '',
  periodEnd: '',
  dueAt: '',
  taxPercent: 18,
  status: 'OPEN' as 'OPEN' | 'DRAFT',
  notes: '',
  reason: '',
  lines: [] as Line[],
});
const error = ref<string | null>(null);
const saving = ref(false);
const currency = computed(() => props.subscription?.plan.currency ?? 'INR');

watch(open, (v) => {
  if (!v) return;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearly = props.subscription?.plan.billingInterval === 'YEARLY';
  const end = new Date(
    Date.UTC(start.getUTCFullYear() + (yearly ? 1 : 0), start.getUTCMonth() + (yearly ? 0 : 1), 0),
  );
  const plan = props.subscription?.plan;
  Object.assign(form, {
    periodStart: isoDay(start),
    periodEnd: isoDay(end),
    dueAt: isoDay(new Date(now.getTime() + 15 * 86_400_000)),
    taxPercent: props.defaultTaxPercent ?? 18,
    status: 'OPEN',
    notes: '',
    reason: '',
    lines: [
      {
        description: plan ? `${plan.name} subscription` : 'Subscription',
        quantity: 1,
        unit: (plan?.priceCents ?? 0) / 100,
      },
    ],
  });
  error.value = null;
});

const subtotal = computed(() =>
  form.lines.reduce(
    (n, l) => n + Math.round(Number(l.quantity) * Math.round(Number(l.unit) * 100)),
    0,
  ),
);
const tax = computed(() =>
  Math.round((subtotal.value * Math.round(Number(form.taxPercent) * 100)) / 10_000),
);
const required = (v: unknown) => (v !== '' && v !== null && v !== undefined) || 'Required';
const reasonRule = (v: string) => (v?.trim().length ?? 0) >= 10 || 'At least 10 characters';

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const res = await apiFetch<{ data: InvoiceDto }>(
      `/api/v1/platform/organizations/${props.organizationId}/invoices`,
      {
        method: 'POST',
        body: JSON.stringify({
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          dueAt: form.dueAt,
          status: form.status,
          taxRateBps: Math.round(Number(form.taxPercent) * 100),
          lineItems: form.lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitCents: Math.round(Number(l.unit) * 100),
          })),
          notes: form.notes || null,
          reason: form.reason,
        }),
      },
    );
    emit('created', res.data);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="760">
    <v-card title="New invoice">
      <v-form @submit.prevent="save">
        <v-card-text>
          <v-alert v-if="error" type="error" class="mb-3" density="compact">{{ error }}</v-alert>
          <v-row dense>
            <v-col cols="4">
              <v-text-field
                v-model="form.periodStart"
                type="date"
                label="Period start"
                :rules="[required]"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model="form.periodEnd"
                type="date"
                label="Period end"
                :rules="[required]"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field v-model="form.dueAt" type="date" label="Due date" :rules="[required]" />
            </v-col>
          </v-row>
          <div class="text-subtitle-2 mb-2">Line items ({{ currency }})</div>
          <v-row v-for="(line, i) in form.lines" :key="i" dense align="center">
            <v-col cols="6">
              <v-text-field
                v-model="line.description"
                label="Description"
                density="compact"
                :rules="[required]"
              />
            </v-col>
            <v-col cols="2">
              <v-text-field
                v-model.number="line.quantity"
                type="number"
                min="0"
                step="any"
                label="Qty"
                density="compact"
              />
            </v-col>
            <v-col cols="3">
              <v-text-field
                v-model.number="line.unit"
                type="number"
                min="0"
                step="0.01"
                label="Unit price"
                density="compact"
              />
            </v-col>
            <v-col cols="1">
              <v-btn
                icon="mdi-delete"
                variant="text"
                size="small"
                :disabled="form.lines.length === 1"
                @click="form.lines.splice(i, 1)"
              />
            </v-col>
          </v-row>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            class="mb-4"
            @click="form.lines.push({ description: '', quantity: 1, unit: 0 })"
          >
            Add line
          </v-btn>
          <v-row dense>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.taxPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                label="GST %"
              />
            </v-col>
            <v-col cols="8" class="text-right">
              <div>Subtotal: {{ money(subtotal, currency) }}</div>
              <div>GST: {{ money(tax, currency) }}</div>
              <div class="text-h6">Total: {{ money(subtotal + tax, currency) }}</div>
            </v-col>
          </v-row>
          <v-textarea v-model="form.notes" label="Notes (shown on invoice)" rows="2" auto-grow />
          <v-radio-group v-model="form.status" inline hide-details class="mb-2">
            <v-radio value="OPEN" label="Issue now (visible to organization)" />
            <v-radio value="DRAFT" label="Save as draft" />
          </v-radio-group>
          <v-text-field v-model="form.reason" label="Reason (audit)" :rules="[reasonRule]" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="open = false">Cancel</v-btn>
          <v-btn color="primary" type="submit" :loading="saving">Create invoice</v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
