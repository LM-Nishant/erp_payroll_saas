<script setup lang="ts">
import type { InvoiceDto, InvoiceStatus } from '@erp/shared';
import { reactive, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import { money } from './billing';

/** Platform: verify a UPI payment (mark PAID), reject it back to OPEN, issue a draft or void. */
const props = defineProps<{
  organizationId: string;
  invoice: InvoiceDto | null;
  action: 'PAID' | 'OPEN' | 'VOID' | null;
}>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [InvoiceDto] }>();

const form = reactive({
  paymentMethod: 'UPI',
  paymentReference: '',
  paidAt: '',
  notes: '',
  reason: '',
});
const error = ref<string | null>(null);
const saving = ref(false);

watch(open, (v) => {
  if (!v || !props.invoice) return;
  const inv = props.invoice;
  Object.assign(form, {
    paymentMethod: inv.paymentMethod ?? 'UPI',
    paymentReference: inv.paymentReference ?? inv.submittedReference ?? '',
    paidAt: new Date().toISOString().slice(0, 10),
    notes: inv.notes ?? '',
    reason:
      props.action === 'PAID' ? `UPI payment verified ${inv.submittedReference ?? ''}`.trim() : '',
  });
  error.value = null;
});

const titles: Record<string, string> = {
  PAID: 'Mark invoice paid',
  OPEN: 'Reopen / issue invoice',
  VOID: 'Void invoice',
};
const reasonRule = (v: string) => (v?.trim().length ?? 0) >= 10 || 'At least 10 characters';

async function save() {
  if (!props.invoice || !props.action) return;
  saving.value = true;
  error.value = null;
  try {
    const status: InvoiceStatus = props.action;
    const body: Record<string, unknown> = {
      status,
      reason: form.reason,
      notes: form.notes || null,
    };
    if (status === 'PAID') {
      Object.assign(body, {
        paymentMethod: form.paymentMethod || null,
        paymentReference: form.paymentReference || null,
        paidAt: form.paidAt,
      });
    }
    const res = await apiFetch<{ data: InvoiceDto }>(
      `/api/v1/platform/organizations/${props.organizationId}/invoices/${props.invoice.id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    emit('saved', res.data);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="560">
    <v-card v-if="invoice && action" :title="titles[action]">
      <v-form @submit.prevent="save">
        <v-card-text>
          <v-alert v-if="error" type="error" class="mb-3" density="compact">{{ error }}</v-alert>
          <div class="mb-3">
            <strong>{{ invoice.number }}</strong> —
            {{ money(invoice.amountCents, invoice.currency) }}
          </div>
          <v-alert
            v-if="invoice.submittedReference"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            Organization reported UTR <strong>{{ invoice.submittedReference }}</strong>
            <span v-if="invoice.submittedAt">
              on {{ new Date(invoice.submittedAt).toLocaleString() }}
            </span>
            <div v-if="invoice.submittedNote">{{ invoice.submittedNote }}</div>
          </v-alert>
          <template v-if="action === 'PAID'">
            <v-text-field v-model="form.paymentMethod" label="Payment method" />
            <v-text-field v-model="form.paymentReference" label="Payment reference / UTR" />
            <v-text-field v-model="form.paidAt" type="date" label="Paid on" />
          </template>
          <v-alert
            v-if="action === 'OPEN' && invoice.status === 'PAYMENT_SUBMITTED'"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            Rejecting returns the invoice to Open so the organization can pay again. Explain why in
            the notes.
          </v-alert>
          <v-alert
            v-if="action === 'VOID'"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            Void invoices cannot be reopened.
          </v-alert>
          <v-textarea v-model="form.notes" label="Notes (shown on invoice)" rows="2" auto-grow />
          <v-text-field v-model="form.reason" label="Reason (audit)" :rules="[reasonRule]" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="open = false">Cancel</v-btn>
          <v-btn :color="action === 'VOID' ? 'error' : 'primary'" type="submit" :loading="saving">
            Save
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
