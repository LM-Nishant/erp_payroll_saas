<script setup lang="ts">
import type { PlatformBillingSettingsDto } from '@erp/shared';
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '@/api/client';

/** Platform: seller details printed on invoices and the UPI ID organizations pay to. */
const form = reactive({
  sellerName: '',
  sellerAddress: '',
  gstin: '',
  contactEmail: '',
  contactPhone: '',
  upiId: '',
  upiPayeeName: '',
  taxPercent: 18,
  invoiceTerms: '',
});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const saving = ref(false);

function fill(s: PlatformBillingSettingsDto) {
  Object.assign(form, {
    sellerName: s.sellerName,
    sellerAddress: s.sellerAddress ?? '',
    gstin: s.gstin ?? '',
    contactEmail: s.contactEmail ?? '',
    contactPhone: s.contactPhone ?? '',
    upiId: s.upiId ?? '',
    upiPayeeName: s.upiPayeeName ?? '',
    taxPercent: s.defaultTaxRateBps / 100,
    invoiceTerms: s.invoiceTerms ?? '',
  });
}

onMounted(async () => {
  try {
    fill(
      (await apiFetch<{ data: PlatformBillingSettingsDto }>('/api/v1/platform/billing-settings'))
        .data,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const required = (v: string) => Boolean(v?.trim()) || 'Required';
const upiRule = (v: string) =>
  !v || /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(v) || 'Format: name@bank';

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const { taxPercent, ...rest } = form;
    const body = Object.fromEntries(
      Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]),
    );
    const res = await apiFetch<{ data: PlatformBillingSettingsDto }>(
      '/api/v1/platform/billing-settings',
      {
        method: 'PUT',
        body: JSON.stringify({ ...body, defaultTaxRateBps: Math.round(Number(taxPercent) * 100) }),
      },
    );
    fill(res.data);
    notice.value = 'Billing settings saved';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <h2 class="text-h5 mb-4">Billing settings</h2>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-snackbar :model-value="!!notice" color="success" @update:model-value="notice = null">
    {{ notice }}
  </v-snackbar>
  <v-form @submit.prevent="save">
    <v-card class="mb-4" title="UPI payments">
      <v-card-text>
        <v-row dense>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.upiId"
              label="UPI ID (VPA)"
              placeholder="company@okhdfcbank"
              :rules="[upiRule]"
              hint="Organizations scan a QR for this UPI ID and submit the UTR"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.upiPayeeName" label="Payee name" />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
    <v-card class="mb-4" title="Invoice seller details">
      <v-card-text>
        <v-row dense>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.sellerName" label="Seller name" :rules="[required]" />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.gstin" label="GSTIN" />
          </v-col>
          <v-col cols="12">
            <v-textarea v-model="form.sellerAddress" label="Address" rows="2" auto-grow />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.contactEmail" label="Contact email" />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.contactPhone" label="Contact phone" />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model.number="form.taxPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              label="Default GST %"
            />
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="form.invoiceTerms"
              label="Terms printed on invoices"
              rows="2"
              auto-grow
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
    <v-btn color="primary" type="submit" :loading="saving">Save</v-btn>
  </v-form>
</template>
