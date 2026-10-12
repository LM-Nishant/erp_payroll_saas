<script setup lang="ts">
import {
  CERTIFICATE_CONDUCTS,
  type CertificateEligibilityDto,
  type CertificateType,
  type StudentCertificateDto,
} from '@erp/shared';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ApiError, apiDownload, apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/**
 * Staff view of a student's Transfer / Character certificates: issue (with the fee-dues check
 * and optional waiver), download the branded PDF, cancel and reissue.
 */
const props = defineProps<{ studentId: string }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();

const LABEL: Record<CertificateType, string> = {
  TRANSFER: 'Transfer certificate',
  CHARACTER: 'Character certificate',
};
const items = ref<StudentCertificateDto[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const today = () => new Date().toISOString().slice(0, 10);
const money = (v: number) =>
  `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const issue = reactive({
  open: false,
  busy: false,
  type: 'TRANSFER' as CertificateType,
  eligibility: null as CertificateEligibilityDto | null,
  issueDate: today(),
  leavingDate: '',
  reason: '',
  conduct: 'Good',
  lastClass: '',
  promotionStatus: '',
  remarks: '',
  waiveFeeDues: false,
  waiverReason: '',
  error: null as string | null,
  duesBlocked: null as number | null,
});
const action = reactive({
  open: false,
  busy: false,
  kind: 'cancel' as 'cancel' | 'reissue',
  item: null as StudentCertificateDto | null,
  reason: '',
  issueDate: today(),
  leavingDate: '',
  leavingReason: '',
  conduct: '',
  remarks: '',
  error: null as string | null,
});

const hasIssuedTc = computed(() =>
  items.value.some((c) => c.type === 'TRANSFER' && c.status === 'ISSUED'),
);
const duesPending = computed(
  () => issue.type === 'TRANSFER' && (issue.eligibility?.feeDues ?? 0) > 0,
);

async function load() {
  try {
    items.value = (
      await apiFetch<{ data: StudentCertificateDto[] }>(
        `/api/v1/students/${props.studentId}/certificates`,
      )
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function openIssue(type: CertificateType) {
  Object.assign(issue, {
    open: true,
    type,
    eligibility: null,
    issueDate: today(),
    leavingDate: '',
    reason: '',
    conduct: 'Good',
    lastClass: '',
    promotionStatus: '',
    remarks: '',
    waiveFeeDues: false,
    waiverReason: '',
    error: null,
    duesBlocked: null,
  });
  try {
    const el = (
      await apiFetch<{ data: CertificateEligibilityDto }>(
        `/api/v1/students/${props.studentId}/certificates/eligibility?type=${type}`,
      )
    ).data;
    issue.eligibility = el;
    issue.lastClass = el.defaults.lastClass ?? '';
    issue.leavingDate = el.defaults.leavingDate ?? '';
  } catch (e) {
    issue.error = (e as Error).message;
  }
}

async function submitIssue() {
  issue.busy = true;
  issue.error = null;
  issue.duesBlocked = null;
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  try {
    const res = await apiFetch<{ data: StudentCertificateDto }>(
      `/api/v1/students/${props.studentId}/certificates`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: issue.type,
          issueDate: issue.issueDate || undefined,
          leavingDate: issue.type === 'TRANSFER' ? issue.leavingDate || null : null,
          reason: opt(issue.reason),
          conduct: issue.conduct,
          lastClass: opt(issue.lastClass),
          promotionStatus: opt(issue.promotionStatus),
          remarks: opt(issue.remarks),
          ...(issue.waiveFeeDues
            ? { waiveFeeDues: true, waiverReason: opt(issue.waiverReason) }
            : {}),
        }),
      },
    );
    issue.open = false;
    notice.value = `${LABEL[res.data.type]} ${res.data.certificateNo} issued`;
    await load();
    emit('changed');
  } catch (e) {
    if (e instanceof ApiError && e.code === 'FEE_DUES_PENDING') {
      issue.duesBlocked = (e.details as { amount?: number } | undefined)?.amount ?? 0;
    }
    issue.error = (e as Error).message;
  } finally {
    issue.busy = false;
  }
}

function openAction(kind: 'cancel' | 'reissue', item: StudentCertificateDto) {
  Object.assign(action, {
    open: true,
    busy: false,
    kind,
    item,
    reason: '',
    issueDate: today(),
    leavingDate: item.leavingDate ?? '',
    leavingReason: item.reason ?? '',
    conduct: item.conduct,
    remarks: item.remarks ?? '',
    error: null,
  });
}

async function submitAction() {
  if (!action.item) return;
  action.busy = true;
  action.error = null;
  try {
    if (action.kind === 'cancel') {
      await apiFetch(`/api/v1/students/certificates/${action.item.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: action.reason.trim() }),
      });
      notice.value = `${action.item.certificateNo} cancelled`;
    } else {
      const res = await apiFetch<{ data: StudentCertificateDto }>(
        `/api/v1/students/certificates/${action.item.id}/reissue`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: action.reason.trim(),
            issueDate: action.issueDate || undefined,
            ...(action.item.type === 'TRANSFER'
              ? {
                  leavingDate: action.leavingDate || undefined,
                  leavingReason: action.leavingReason.trim() || null,
                }
              : {}),
            conduct: action.conduct.trim() || undefined,
            remarks: action.remarks.trim() || null,
          }),
        },
      );
      notice.value = `Reissued as ${res.data.certificateNo}`;
    }
    action.open = false;
    await load();
    emit('changed');
  } catch (e) {
    action.error = (e as Error).message;
  } finally {
    action.busy = false;
  }
}

async function download(c: StudentCertificateDto) {
  try {
    await apiDownload(
      `/api/v1/students/certificates/${c.id}/pdf`,
      `${c.type === 'TRANSFER' ? 'tc' : 'cc'}-${c.certificateNo.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const numberOf = (id: string | null) =>
  id ? (items.value.find((c) => c.id === id)?.certificateNo ?? '') : '';

onMounted(load);
watch(() => props.studentId, load);
</script>
<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <div class="text-subtitle-1">Certificates</div>
      <v-spacer />
      <template v-if="auth.can('certificate.issue')"
        ><v-btn
          prepend-icon="mdi-file-certificate-outline"
          size="small"
          color="primary"
          :disabled="hasIssuedTc"
          :title="hasIssuedTc ? 'A transfer certificate is already issued' : ''"
          @click="openIssue('TRANSFER')"
          >Issue TC</v-btn
        ><v-btn
          prepend-icon="mdi-account-check-outline"
          size="small"
          variant="tonal"
          @click="openIssue('CHARACTER')"
          >Issue character certificate</v-btn
        ></template
      >
    </div>
    <v-alert v-if="error" type="error" density="compact" class="mb-2">{{ error }}</v-alert>
    <v-table density="compact" data-testid="certificates-table"
      ><thead>
        <tr>
          <th>Certificate no.</th>
          <th>Type</th>
          <th>Issued</th>
          <th>Leaving date</th>
          <th>Conduct</th>
          <th>Fee dues</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!items.length">
          <td colspan="8" class="text-medium-emphasis">No certificates issued yet.</td>
        </tr>
        <tr v-for="c in items" :key="c.id">
          <td>
            <strong>{{ c.certificateNo }}</strong>
            <div v-if="c.replacesId" class="text-caption text-medium-emphasis">
              Replaces {{ numberOf(c.replacesId) }}
            </div>
          </td>
          <td>{{ c.type === 'TRANSFER' ? 'TC' : 'Character' }}</td>
          <td>
            {{ c.issueDate
            }}<span v-if="c.issuedByName" class="text-caption text-medium-emphasis">
              · {{ c.issuedByName }}</span
            >
          </td>
          <td>{{ c.leavingDate || '—' }}</td>
          <td>{{ c.conduct }}</td>
          <td>
            <span v-if="c.feeDuesAmount > 0"
              >{{ money(c.feeDuesAmount) }}{{ c.feeDuesWaived ? ' (waived)' : '' }}</span
            ><span v-else class="text-medium-emphasis">—</span>
          </td>
          <td>
            <v-chip
              size="small"
              :color="c.status === 'ISSUED' ? 'success' : 'default'"
              :title="c.cancelReason ?? ''"
              >{{ c.status }}</v-chip
            >
          </td>
          <td class="text-no-wrap">
            <v-btn size="small" variant="text" prepend-icon="mdi-download" @click="download(c)"
              >PDF</v-btn
            ><template v-if="c.status === 'ISSUED'"
              ><v-btn
                v-if="auth.can('certificate.issue') && auth.can('certificate.cancel')"
                size="small"
                variant="text"
                @click="openAction('reissue', c)"
                >Reissue</v-btn
              ><v-btn
                v-if="auth.can('certificate.cancel')"
                size="small"
                variant="text"
                color="error"
                @click="openAction('cancel', c)"
                >Cancel</v-btn
              ></template
            >
          </td>
        </tr>
      </tbody></v-table
    >

    <v-dialog v-model="issue.open" max-width="640"
      ><v-card
        ><v-card-title>Issue {{ LABEL[issue.type].toLowerCase() }}</v-card-title
        ><v-card-text
          ><v-alert
            v-if="duesPending && issue.duesBlocked === null"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
            >Fee dues of {{ money(issue.eligibility!.feeDues) }} are pending. A transfer certificate
            can be issued only after the dues are cleared<span
              v-if="issue.eligibility?.canWaiveDues"
            >
              or waived</span
            >.</v-alert
          ><v-alert v-if="issue.error" type="error" density="compact" class="mb-3">{{
            issue.error
          }}</v-alert
          ><v-alert
            v-if="issue.type === 'TRANSFER' && !issue.eligibility?.duesChecked && issue.eligibility"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
            >Fee dues are not checked (finance is not enabled for this institution).</v-alert
          ><v-row dense
            ><v-col cols="12" md="6"
              ><v-text-field v-model="issue.issueDate" label="Issue date" type="date" /></v-col
            ><v-col v-if="issue.type === 'TRANSFER'" cols="12" md="6"
              ><v-text-field
                v-model="issue.leavingDate"
                label="Date of leaving"
                type="date" /></v-col
            ><v-col v-if="issue.type === 'TRANSFER'" cols="12"
              ><v-text-field
                v-model="issue.reason"
                label="Reason for leaving"
                placeholder="e.g. Parent transferred to another city" /></v-col
            ><v-col cols="12" md="6"
              ><v-combobox
                v-model="issue.conduct"
                :items="[...CERTIFICATE_CONDUCTS]"
                label="Conduct"
            /></v-col>
            <v-col cols="12" md="6"
              ><v-text-field v-model="issue.lastClass" label="Class last studied" /></v-col
            ><v-col v-if="issue.type === 'TRANSFER'" cols="12"
              ><v-text-field
                v-model="issue.promotionStatus"
                label="Qualified for promotion"
                placeholder="e.g. Yes, to Grade 9" /></v-col
            ><v-col cols="12"
              ><v-textarea v-model="issue.remarks" label="Remarks" rows="2" auto-grow /></v-col
            ><template v-if="duesPending && issue.eligibility?.canWaiveDues"
              ><v-col cols="12"
                ><v-checkbox
                  v-model="issue.waiveFeeDues"
                  label="Waive pending fee dues for this TC"
                  hide-details /></v-col
              ><v-col v-if="issue.waiveFeeDues" cols="12"
                ><v-text-field
                  v-model="issue.waiverReason"
                  label="Waiver reason" /></v-col></template
          ></v-row>
          <p v-if="issue.type === 'TRANSFER'" class="text-caption text-medium-emphasis">
            Issuing a TC marks the student as withdrawn from the leaving date.
          </p></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="issue.open = false">Close</v-btn
          ><v-btn
            color="primary"
            :loading="issue.busy"
            :disabled="
              !issue.conduct ||
              (issue.type === 'TRANSFER' && !issue.leavingDate) ||
              (issue.waiveFeeDues && !issue.waiverReason.trim())
            "
            @click="submitIssue"
            >Issue</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >

    <v-dialog v-model="action.open" max-width="560"
      ><v-card v-if="action.item"
        ><v-card-title
          >{{ action.kind === 'cancel' ? 'Cancel' : 'Reissue' }}
          {{ action.item.certificateNo }}</v-card-title
        ><v-card-text
          ><v-alert v-if="action.error" type="error" density="compact" class="mb-3">{{
            action.error
          }}</v-alert>
          <p class="mb-3 text-medium-emphasis">
            {{
              action.kind === 'cancel'
                ? 'The certificate stays on record as cancelled and can no longer be downloaded from the portal.'
                : 'The current certificate is cancelled and a new certificate number is issued with the details below.'
            }}
          </p>
          <v-text-field v-model="action.reason" label="Reason" />
          <template v-if="action.kind === 'reissue'"
            ><v-text-field v-model="action.issueDate" label="Issue date" type="date" /><template
              v-if="action.item.type === 'TRANSFER'"
              ><v-text-field
                v-model="action.leavingDate"
                label="Date of leaving"
                type="date" /><v-text-field
                v-model="action.leavingReason"
                label="Reason for leaving" /></template
            ><v-combobox
              v-model="action.conduct"
              :items="[...CERTIFICATE_CONDUCTS]"
              label="Conduct" /><v-textarea
              v-model="action.remarks"
              label="Remarks"
              rows="2"
              auto-grow /></template></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="text" @click="action.open = false">Close</v-btn
          ><v-btn
            :color="action.kind === 'cancel' ? 'error' : 'primary'"
            :loading="action.busy"
            :disabled="!action.reason.trim()"
            @click="submitAction"
            >{{ action.kind === 'cancel' ? 'Cancel certificate' : 'Reissue' }}</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-snackbar :model-value="!!notice" color="success" @update:model-value="notice = null">{{
      notice
    }}</v-snackbar>
  </div>
</template>
