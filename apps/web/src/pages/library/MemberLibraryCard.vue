<script setup lang="ts">
import type { LibraryMemberSummaryDto } from '@erp/shared';
import { computed } from 'vue';
import { STATUS_COLOR, fmtDate, money } from './library';

/** Issued books, history, fines and reservations of one member (staff view and self-service). */
const props = defineProps<{ member: LibraryMemberSummaryDto; selfService?: boolean }>();
const emit = defineEmits<{
  renew: [loanId: string];
  cancelReservation: [reservationId: string];
}>();
const pending = computed(() =>
  props.member.fines.filter((f) => f.status === 'PENDING').reduce((s, f) => s + f.amount, 0),
);
</script>
<template>
  <div class="d-flex align-center mb-2">
    <h3 class="text-h6">{{ member.name }}</h3>
    <v-chip size="small" class="ml-2">{{ member.memberType }}</v-chip>
    <v-spacer />
    <span class="text-body-2"
      >Up to {{ member.policy.maxBooks }} books · {{ member.policy.loanDays }} days ·
      {{ member.policy.maxRenewals }} renewal(s) · fine
      {{ money(member.policy.finePerDay) }}/day</span
    >
  </div>
  <v-alert v-if="pending" type="warning" variant="tonal" density="compact" class="mb-2"
    >Pending fines: {{ money(pending) }}</v-alert
  >
  <div class="text-subtitle-2 mt-2">Issued ({{ member.active.length }})</div>
  <v-table density="compact">
    <thead>
      <tr>
        <th>Title</th>
        <th>Barcode</th>
        <th>Issued</th>
        <th>Due</th>
        <th>Fine so far</th>
        <th v-if="selfService" />
      </tr>
    </thead>
    <tbody>
      <tr v-for="l in member.active" :key="l.id">
        <td>{{ l.book?.title }}</td>
        <td>{{ l.copy?.barcode }}</td>
        <td>{{ fmtDate(l.issuedAt) }}</td>
        <td :class="l.overdue ? 'text-error font-weight-bold' : ''">
          {{ fmtDate(l.dueDate) }}<span v-if="l.overdue"> ({{ l.overdueDays }} days late)</span>
        </td>
        <td>{{ l.fineAmount ? money(l.fineAmount) : '—' }}</td>
        <td v-if="selfService">
          <v-btn
            v-if="!l.overdue && l.renewCount < member.policy.maxRenewals"
            size="small"
            variant="text"
            @click="emit('renew', l.id)"
            >Renew</v-btn
          >
        </td>
      </tr>
      <tr v-if="!member.active.length">
        <td colspan="6" class="text-medium-emphasis">No books issued.</td>
      </tr>
    </tbody>
  </v-table>
  <template v-if="member.reservations.length">
    <div class="text-subtitle-2 mt-4">Reservations</div>
    <v-table density="compact">
      <tbody>
        <tr v-for="r in member.reservations" :key="r.id">
          <td>{{ r.book?.title }}</td>
          <td>
            <v-chip size="small" :color="STATUS_COLOR[r.status]">{{ r.status }}</v-chip>
          </td>
          <td>
            <span v-if="r.status === 'READY'"
              >Ready for pickup until {{ fmtDate(r.expiresAt) }}</span
            >
            <span v-else-if="r.position">Position #{{ r.position }} in queue</span>
          </td>
          <td v-if="selfService">
            <v-btn
              size="small"
              variant="text"
              color="error"
              @click="emit('cancelReservation', r.id)"
              >Cancel</v-btn
            >
          </td>
        </tr>
      </tbody>
    </v-table>
  </template>
  <template v-if="member.fines.length">
    <div class="text-subtitle-2 mt-4">Fines</div>
    <v-table density="compact">
      <tbody>
        <tr v-for="f in member.fines" :key="f.id">
          <td>{{ fmtDate(f.createdAt) }}</td>
          <td>{{ f.bookTitle ?? '—' }}</td>
          <td>{{ f.reason }}</td>
          <td>{{ money(f.amount) }}</td>
          <td>
            <v-chip size="small" :color="STATUS_COLOR[f.status]">{{ f.status }}</v-chip>
          </td>
        </tr>
      </tbody>
    </v-table>
  </template>
  <template v-if="member.history.length">
    <div class="text-subtitle-2 mt-4">History</div>
    <v-table density="compact">
      <tbody>
        <tr v-for="l in member.history" :key="l.id">
          <td>{{ l.book?.title }}</td>
          <td>{{ fmtDate(l.issuedAt) }} → {{ fmtDate(l.returnedAt) }}</td>
          <td>{{ l.overdueDays ? `${l.overdueDays} days late` : 'on time' }}</td>
          <td>{{ l.status }}</td>
        </tr>
      </tbody>
    </v-table>
  </template>
</template>
