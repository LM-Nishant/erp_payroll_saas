<script setup lang="ts">
import type { Form16RecordDto, PayslipDto } from '@erp/shared';
import { onMounted, ref } from 'vue';
import { apiFetch } from '@/api/client';
import { money, openSignedUrl } from './payroll';

/** Employee self-service: own payslips and published Form 16 (downloads are audited). */
const payslips = ref<PayslipDto[]>([]);
const form16 = ref<Form16RecordDto[]>([]);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    [payslips.value, form16.value] = await Promise.all([
      apiFetch<{ data: PayslipDto[] }>('/api/v1/payroll/me/payslips').then((r) => r.data),
      apiFetch<{ data: Form16RecordDto[] }>('/api/v1/payroll/me/form16').then((r) => r.data),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function open(path: string) {
  try {
    await openSignedUrl(path);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <h2 class="text-h5 mb-4">My payslips</h2>
  <v-alert v-if="error" type="error" closable class="mb-4" @click:close="error = null">
    {{ error }}
  </v-alert>
  <v-card class="mb-4" title="Payslips">
    <v-table density="compact">
      <thead>
        <tr>
          <th>Month</th>
          <th class="text-end">Net pay</th>
          <th>Published</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in payslips" :key="p.id">
          <td>
            {{ p.periodStart.slice(0, 7)
            }}<span v-if="p.revision > 1"> (rev {{ p.revision }})</span>
          </td>
          <td class="text-end">{{ money(p.net) }}</td>
          <td>{{ p.publishedAt.slice(0, 10) }}</td>
          <td class="text-end">
            <v-btn
              prepend-icon="mdi-download"
              size="small"
              variant="text"
              @click="open(`/api/v1/payroll/me/payslips/${p.id}/download-url`)"
            >
              PDF
            </v-btn>
          </td>
        </tr>
        <tr v-if="!payslips.length">
          <td colspan="4" class="text-medium-emphasis">No payslips published yet.</td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
  <v-card title="Form 16">
    <v-table density="compact">
      <tbody>
        <tr v-for="r in form16" :key="r.id">
          <td>FY {{ r.financialYear }}</td>
          <td class="text-end">
            <v-btn
              prepend-icon="mdi-download"
              size="small"
              variant="text"
              @click="open(`/api/v1/payroll/me/form16/${r.id}/download-url`)"
            >
              PDF
            </v-btn>
          </td>
        </tr>
        <tr v-if="!form16.length">
          <td class="text-medium-emphasis">No Form 16 published yet.</td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>
