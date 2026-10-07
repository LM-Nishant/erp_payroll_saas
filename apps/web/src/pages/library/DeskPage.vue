<script setup lang="ts">
import type {
  ApiListResponse,
  LibraryCopyDto,
  LibraryLoanDto,
  LibraryMemberDto,
  LibraryMemberSummaryDto,
  LibraryReturnResultDto,
} from '@erp/shared';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { apiFetch } from '@/api/client';
import LibraryTabs from './LibraryTabs.vue';
import { STATUS_COLOR, fmtDate, money, qs } from './library';

type CopyLookup = LibraryCopyDto & { activeLoan: LibraryLoanDto | null };
const mode = ref<'issue' | 'return'>('issue');
const barcode = ref('');
const barcodeField = ref<{ focus: () => void } | null>(null);
const copy = ref<CopyLookup | null>(null);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const busy = ref(false);

const memberType = ref<'STUDENT' | 'EMPLOYEE'>('STUDENT');
const memberSearch = ref('');
const memberOptions = ref<LibraryMemberDto[]>([]);
const memberId = ref<string | null>(null);
const member = ref<LibraryMemberSummaryDto | null>(null);
const condition = ref<'GOOD' | 'DAMAGED' | 'LOST'>('GOOD');
const damageCharge = ref<string>('');
const lastReturn = ref<LibraryReturnResultDto | null>(null);

const focus = () => nextTick(() => barcodeField.value?.focus());

async function lookup() {
  error.value = null;
  message.value = null;
  copy.value = null;
  const code = barcode.value.trim();
  if (!code) return;
  try {
    copy.value = (
      await apiFetch<{ data: CopyLookup }>(
        `/api/v1/library/copies/by-barcode/${encodeURIComponent(code)}`,
      )
    ).data;
    if (mode.value === 'return' && copy.value.activeLoan) await doReturn();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function searchMembers() {
  try {
    memberOptions.value = (
      await apiFetch<ApiListResponse<LibraryMemberDto>>(
        `/api/v1/library/members?${qs({
          memberType: memberType.value,
          search: memberSearch.value,
          institutionId: copy.value?.institutionId,
          pageSize: 20,
        })}`,
      )
    ).data;
  } catch {
    memberOptions.value = [];
  }
}
async function loadMember() {
  member.value = null;
  if (!memberId.value) return;
  try {
    member.value = (
      await apiFetch<{ data: LibraryMemberSummaryDto }>(
        `/api/v1/library/members/${memberType.value.toLowerCase()}/${memberId.value}`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function doIssue() {
  if (!copy.value || !memberId.value) return;
  busy.value = true;
  error.value = null;
  try {
    const loan = (
      await apiFetch<{ data: LibraryLoanDto }>('/api/v1/library/issue', {
        method: 'POST',
        body: JSON.stringify({
          barcode: copy.value.barcode,
          ...(memberType.value === 'STUDENT'
            ? { studentId: memberId.value }
            : { employeeId: memberId.value }),
        }),
      })
    ).data;
    message.value = `Issued “${loan.book?.title}” to ${loan.memberName}, due ${fmtDate(loan.dueDate)}.`;
    copy.value = null;
    barcode.value = '';
    await loadMember();
    focus();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function doReturn() {
  if (!copy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const r = (
      await apiFetch<{ data: LibraryReturnResultDto }>('/api/v1/library/return', {
        method: 'POST',
        body: JSON.stringify({
          barcode: copy.value.barcode,
          condition: condition.value,
          ...(damageCharge.value ? { damageCharge: Number(damageCharge.value) } : {}),
        }),
      })
    ).data;
    lastReturn.value = r;
    message.value = `Returned “${r.loan.book?.title}” from ${r.loan.memberName}.`;
    copy.value = null;
    barcode.value = '';
    condition.value = 'GOOD';
    damageCharge.value = '';
    focus();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function renew(loanId: string) {
  try {
    await apiFetch(`/api/v1/library/loans/${loanId}/renew`, { method: 'POST', body: '{}' });
    await loadMember();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const canIssue = computed(
  () =>
    mode.value === 'issue' && copy.value && ['AVAILABLE', 'RESERVED'].includes(copy.value.status),
);
watch(memberId, loadMember);
watch(memberType, () => {
  memberId.value = null;
  memberOptions.value = [];
});
let timer: ReturnType<typeof setTimeout>;
watch(memberSearch, () => {
  clearTimeout(timer);
  timer = setTimeout(searchMembers, 300);
});
watch(mode, () => {
  copy.value = null;
  lastReturn.value = null;
  focus();
});
onMounted(focus);
</script>
<template>
  <LibraryTabs title="Issue / Return desk" />
  <v-btn-toggle v-model="mode" mandatory color="primary" class="mb-4" density="comfortable">
    <v-btn value="issue" prepend-icon="mdi-book-arrow-right">Issue</v-btn>
    <v-btn value="return" prepend-icon="mdi-book-arrow-left">Return</v-btn>
  </v-btn-toggle>
  <v-alert v-if="error" type="error" class="mb-3" closable @click:close="error = null">{{
    error
  }}</v-alert>
  <v-alert v-if="message" type="success" class="mb-3" closable @click:close="message = null">{{
    message
  }}</v-alert>
  <v-row>
    <v-col cols="12" md="6">
      <v-card>
        <v-card-title>Scan copy</v-card-title>
        <v-card-text>
          <v-text-field
            ref="barcodeField"
            v-model="barcode"
            label="Barcode / accession number"
            prepend-inner-icon="mdi-barcode-scan"
            autofocus
            hint="Scan with a barcode reader or type and press Enter"
            @keyup.enter="lookup"
          />
          <template v-if="copy">
            <div class="text-subtitle-1">{{ copy.book?.title }}</div>
            <div class="text-body-2 mb-2">
              {{ copy.accessionNo }} · shelf {{ copy.shelf || '—' }}
              <v-chip size="small" :color="STATUS_COLOR[copy.status]" class="ml-2">{{
                copy.status
              }}</v-chip>
            </div>
            <v-alert v-if="copy.activeLoan" type="info" variant="tonal" density="compact">
              On loan to {{ copy.activeLoan.memberName }} · due
              {{ fmtDate(copy.activeLoan.dueDate) }}
              <span v-if="copy.activeLoan.overdue" class="text-error">
                · {{ copy.activeLoan.overdueDays }} days overdue, fine
                {{ money(copy.activeLoan.fineAmount) }}</span
              >
            </v-alert>
            <template v-if="mode === 'return' && copy.activeLoan">
              <v-select
                v-model="condition"
                :items="['GOOD', 'DAMAGED', 'LOST']"
                label="Condition"
                class="mt-3"
              />
              <v-text-field
                v-if="condition !== 'GOOD'"
                v-model="damageCharge"
                label="Damage / replacement charge"
                type="number"
              />
              <v-btn color="primary" :loading="busy" @click="doReturn">Return</v-btn>
            </template>
          </template>
          <v-alert v-if="lastReturn" type="success" variant="tonal" class="mt-3">
            <div v-if="lastReturn.loan.overdueDays">
              Returned {{ lastReturn.loan.overdueDays }} day(s) late.
            </div>
            <div v-if="lastReturn.fine">
              Fine {{ money(lastReturn.fine.amount) }} ({{ lastReturn.fine.reason }}) —
              {{ lastReturn.fine.status }}
            </div>
            <div v-if="lastReturn.reservation">
              Hold this copy for <b>{{ lastReturn.reservation.memberName }}</b> (reservation ready).
            </div>
          </v-alert>
        </v-card-text>
      </v-card>
    </v-col>
    <v-col v-if="mode === 'issue'" cols="12" md="6">
      <v-card>
        <v-card-title>Member</v-card-title>
        <v-card-text>
          <v-btn-toggle v-model="memberType" mandatory density="compact" class="mb-3">
            <v-btn value="STUDENT">Student</v-btn>
            <v-btn value="EMPLOYEE">Staff</v-btn>
          </v-btn-toggle>
          <v-autocomplete
            v-model="memberId"
            v-model:search="memberSearch"
            :items="memberOptions"
            :item-title="(m: LibraryMemberDto) => `${m.name} (${m.code ?? '—'})`"
            item-value="id"
            label="Search name / admission no / employee code"
            no-filter
            clearable
          />
          <template v-if="member">
            <div class="text-body-2 mb-2">
              Limit {{ member.policy.maxBooks }} books · {{ member.policy.loanDays }} days ·
              {{ member.active.length }} on loan · pending fines
              {{
                money(
                  member.fines
                    .filter((f) => f.status === 'PENDING')
                    .reduce((s, f) => s + f.amount, 0),
                )
              }}
            </div>
            <v-table density="compact">
              <tbody>
                <tr v-for="l in member.active" :key="l.id">
                  <td>{{ l.book?.title }}</td>
                  <td>{{ l.copy?.barcode }}</td>
                  <td :class="l.overdue ? 'text-error' : ''">due {{ fmtDate(l.dueDate) }}</td>
                  <td>
                    <v-btn size="small" variant="text" @click="renew(l.id)">Renew</v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </template>
          <v-btn
            color="primary"
            class="mt-3"
            :disabled="!canIssue || !memberId"
            :loading="busy"
            @click="doIssue"
            >Issue</v-btn
          >
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
