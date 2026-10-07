<script setup lang="ts">
import type { InvoiceDto } from '@erp/shared';

/** Row action buttons for an invoice in platform tables. */
defineProps<{ invoice: InvoiceDto }>();
defineEmits<{ pdf: []; act: ['PAID' | 'OPEN' | 'VOID'] }>();
</script>

<template>
  <div class="d-flex ga-1 justify-end">
    <v-btn
      size="small"
      variant="text"
      icon="mdi-file-pdf-box"
      title="Download PDF"
      @click="$emit('pdf')"
    />
    <v-btn
      v-if="['OPEN', 'OVERDUE', 'PAYMENT_SUBMITTED'].includes(invoice.status)"
      size="small"
      variant="tonal"
      color="success"
      @click="$emit('act', 'PAID')"
    >
      {{ invoice.status === 'PAYMENT_SUBMITTED' ? 'Verify & mark paid' : 'Mark paid' }}
    </v-btn>
    <v-btn
      v-if="invoice.status === 'PAYMENT_SUBMITTED'"
      size="small"
      variant="text"
      color="warning"
      @click="$emit('act', 'OPEN')"
    >
      Reject
    </v-btn>
    <v-btn
      v-if="invoice.status === 'DRAFT'"
      size="small"
      variant="tonal"
      @click="$emit('act', 'OPEN')"
    >
      Issue
    </v-btn>
    <v-btn
      v-if="!['PAID', 'VOID'].includes(invoice.status)"
      size="small"
      variant="text"
      color="error"
      @click="$emit('act', 'VOID')"
    >
      Void
    </v-btn>
  </div>
</template>
