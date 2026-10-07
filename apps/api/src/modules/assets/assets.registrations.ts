import { z } from 'zod';
import { hierarchyResource } from '../../core/authz';
import { registerDocumentOwnerType } from '../../core/documents/owners';
import { registerEventType } from '../../core/events';
import { registerNotificationEvent } from '../../core/notifications';
import { registerPdfTemplate } from '../../core/pdf';
import {
  defineJob,
  defineRecurringJob,
  enqueue,
  forEachActiveOrganization,
} from '../../core/queue';
import { tenantDb } from '../../core/tenancy';
import { registerWorkflowEntity } from '../../core/workflow';
import { registerChecklistHook } from '../employees/employees.lifecycle';
import {
  EXIT_CHECKLIST_KEY,
  HANDOVER_TEMPLATE,
  TRANSFER_WORKFLOW,
  transferWorkflowCallbacks,
} from './assets.custody';
import { addDays, dateOnly, todayUtc } from './assets.logic';
import { DISPOSAL_WORKFLOW, disposalWorkflowCallbacks } from './assets.maintenance';
import { holders, notifyUsers } from './assets.notify';
import { REPORT_TEMPLATE } from './assets.reports';
import { LABEL_TEMPLATE } from './assets.service';

/* ---- documents: invoices + handover forms hang off the asset ---- */
registerDocumentOwnerType({
  type: 'asset',
  resolveScope: async (id) =>
    tenantDb().asset.findUnique({
      where: { id },
      select: { groupId: true, institutionId: true, campusId: true, departmentId: true },
    }),
  selfAccess: {
    actions: ['view', 'download'],
    ownedIds: async (principal) =>
      principal.userId
        ? (
            await tenantDb().asset.findMany({
              where: { custodian: { userId: principal.userId } },
              select: { id: true },
            })
          ).map((a) => a.id)
        : [],
  },
});

/* ---- domain events (webhook-able) ---- */
for (const [key, label] of [
  ['asset.created', 'Asset created'],
  ['asset.lost', 'Asset marked lost'],
  ['asset.assigned', 'Asset assigned'],
  ['asset.acknowledged', 'Asset receipt acknowledged'],
  ['asset.returned', 'Asset returned'],
  ['asset.transferred', 'Asset transferred'],
  ['asset.maintenance_opened', 'Asset maintenance ticket opened'],
  ['asset.maintenance_updated', 'Asset maintenance ticket updated'],
  ['asset.maintenance_completed', 'Asset maintenance completed'],
  ['asset.disposed', 'Asset disposed / written off'],
  ['asset.audit_completed', 'Asset audit completed'],
  ['asset.inventory_low', 'Inventory below reorder level'],
] as const)
  registerEventType({ key, label, webhook: true });

/* ---- notifications ---- */
for (const [key, label, channels] of [
  ['asset.assigned', 'Asset assigned to you', ['in_app', 'email']],
  ['asset.issue_reported', 'Asset issue reported by an employee', ['in_app', 'email']],
  ['asset.maintenance_closed', 'Your asset ticket was closed', ['in_app']],
  ['asset.transfer_decided', 'Asset transfer decided', ['in_app']],
  ['asset.disposal_requested', 'Asset disposal awaiting approval', ['in_app', 'email']],
  ['asset.disposal_decided', 'Asset disposal decided', ['in_app']],
  ['asset.audit_discrepancies', 'Asset audit discrepancies', ['in_app', 'email']],
  ['asset.inventory_low', 'Inventory below reorder level', ['in_app', 'email']],
  ['asset.reminders', 'Warranty / AMC / service due reminders', ['in_app', 'email']],
] as const)
  registerNotificationEvent({ key, label, defaultChannels: [...channels] });

/* ---- approvals ---- */
registerWorkflowEntity({
  entityType: TRANSFER_WORKFLOW,
  label: 'Asset transfer',
  linkFor: () => '/assets/assignments?tab=transfers',
  ...transferWorkflowCallbacks,
});
registerWorkflowEntity({
  entityType: DISPOSAL_WORKFLOW,
  label: 'Asset disposal / write-off',
  linkFor: () => '/assets/disposal',
  ...disposalWorkflowCallbacks,
});

/* ---- employee exit: all assets must be returned ---- */
registerChecklistHook('EXIT', {
  key: EXIT_CHECKLIST_KEY,
  title: 'Return assigned assets',
  source: 'assets',
  appliesTo: async (employee) =>
    (await tenantDb().assetAssignment.count({
      where: { employeeId: employee.id, status: 'ACTIVE' },
    })) > 0,
});

/* ---- PDF templates ---- */
registerPdfTemplate({
  key: LABEL_TEMPLATE,
  version: 1,
  name: 'Asset labels',
  description: 'QR code labels (asset tag, name, location) for sticking on assets.',
  inputSchema: z
    .object({
      title: z.string(),
      labels: z
        .array(
          z
            .object({
              tag: z.string(),
              name: z.string(),
              location: z.string(),
              qr: z.string(),
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict(),
  defaultCategory: 'asset',
  defaultDocumentType: 'asset_labels',
  title: (i) => i.title,
  build: (i) => [
    { type: 'heading', level: 1, text: i.title },
    ...i.labels.flatMap((l) => [
      {
        type: 'image' as const,
        data: Buffer.from(l.qr, 'base64'),
        width: 90,
        align: 'left' as const,
        caption: `${l.tag} — ${l.name}${l.location ? ` · ${l.location}` : ''}`,
      },
      { type: 'spacer' as const, size: 6 },
    ]),
  ],
});

registerPdfTemplate({
  key: HANDOVER_TEMPLATE,
  version: 1,
  name: 'Asset handover form',
  description: 'Custody handover acknowledgement generated on asset check-out.',
  inputSchema: z
    .object({
      assetTag: z.string(),
      assetName: z.string(),
      category: z.string(),
      makeModel: z.string(),
      serialNo: z.string(),
      institution: z.string(),
      assignedTo: z.string(),
      assignedAt: z.string(),
      condition: z.string(),
      accessories: z.string(),
    })
    .strict(),
  defaultCategory: 'asset',
  defaultDocumentType: 'asset_handover',
  title: (i) => `Asset handover — ${i.assetTag}`,
  build: (i) => [
    { type: 'heading', level: 1, text: 'Asset handover form' },
    {
      type: 'keyValue',
      rows: [
        ['Asset tag', i.assetTag],
        ['Asset', i.assetName],
        ['Category', i.category],
        ['Make / model', i.makeModel],
        ['Serial no', i.serialNo],
        ['Institution', i.institution],
        ['Assigned to', i.assignedTo],
        ['Assigned on', i.assignedAt],
        ['Condition', i.condition],
        ['Accessories', i.accessories],
      ],
    },
    { type: 'spacer', size: 10 },
    {
      type: 'paragraph',
      text: 'I acknowledge receipt of the above asset in the stated condition. I will use it for official purposes, take reasonable care of it, report damage or loss immediately and return it (with accessories) on request or before my last working day.',
      align: 'justify',
    },
    { type: 'spacer', size: 24 },
    { type: 'signature', label: 'Received by', name: i.assignedTo },
    { type: 'signature', label: 'Issued by (asset desk)' },
  ],
});

registerPdfTemplate({
  key: REPORT_TEMPLATE,
  version: 1,
  name: 'Asset report',
  description: 'Tabular asset report (register, depreciation, custody, maintenance, disposals).',
  inputSchema: z
    .object({
      title: z.string(),
      subtitle: z.string().optional(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .strict(),
  defaultCategory: 'asset',
  defaultDocumentType: 'asset_report',
  title: (i) => i.title,
  build: (i) => [
    { type: 'heading', level: 1, text: i.title },
    ...(i.subtitle ? [{ type: 'paragraph' as const, text: i.subtitle }] : []),
    { type: 'table', columns: i.columns, rows: i.rows },
  ],
});

/* ---- daily reminders: warranty / AMC expiry, service due, low stock ---- */
export const REMINDER_JOB = 'assets.reminders';
const DAY = 24 * 60 * 60 * 1000;
/** Days-before thresholds that trigger a reminder (keeps it to a few nudges per item). */
const EXPIRY_THRESHOLDS = [30, 7, 1];
const SERVICE_THRESHOLDS = [7, 1, 0];

/** Send the per-institution reminder digest for `today` (exported for tests). */
export async function sendAssetReminders(today = todayUtc()) {
  const db = tenantDb();
  const at = (days: number[]) => days.map((d) => addDays(today, d));
  const live = { status: { notIn: ['DISPOSED', 'LOST'] as ('DISPOSED' | 'LOST')[] } };
  const [warranty, amc, service] = await Promise.all([
    db.asset.findMany({
      where: { ...live, warrantyExpiry: { in: at(EXPIRY_THRESHOLDS) } },
      select: { id: true, institutionId: true, groupId: true, assetTag: true, name: true },
    }),
    db.asset.findMany({
      where: { ...live, amcExpiry: { in: at(EXPIRY_THRESHOLDS) } },
      select: { id: true, institutionId: true, groupId: true, assetTag: true, name: true },
    }),
    db.asset.findMany({
      where: { ...live, nextServiceDate: { in: at(SERVICE_THRESHOLDS) } },
      select: { id: true, institutionId: true, groupId: true, assetTag: true, name: true },
    }),
  ]);
  const byInst = new Map<
    string,
    { groupId: string | null; warranty: string[]; amc: string[]; service: string[] }
  >();
  const add = (rows: typeof warranty, key: 'warranty' | 'amc' | 'service') => {
    for (const r of rows) {
      const e = byInst.get(r.institutionId) ?? {
        groupId: r.groupId,
        warranty: [],
        amc: [],
        service: [],
      };
      e[key].push(`${r.assetTag} ${r.name}`);
      byInst.set(r.institutionId, e);
    }
  };
  add(warranty, 'warranty');
  add(amc, 'amc');
  add(service, 'service');
  let sent = 0;
  for (const [institutionId, e] of byInst) {
    const resource = hierarchyResource.asset({
      groupId: e.groupId,
      institutionId,
      campusId: null,
      departmentId: null,
    });
    const parts = [
      e.warranty.length ? `${e.warranty.length} warranty expiring` : null,
      e.amc.length ? `${e.amc.length} AMC expiring` : null,
      e.service.length ? `${e.service.length} service due` : null,
    ].filter(Boolean);
    const lines = [
      ...e.warranty.slice(0, 10).map((x) => `Warranty: ${x}`),
      ...e.amc.slice(0, 10).map((x) => `AMC: ${x}`),
      ...e.service.slice(0, 10).map((x) => `Service: ${x}`),
    ];
    await notifyUsers('asset.reminders', await holders('asset.maintain', resource), {
      title: `Asset reminders (${dateOnly(today)}): ${parts.join(', ')}`,
      body: lines.join('\n'),
      link: '/assets/maintenance',
      institutionId,
      data: { warranty: e.warranty.length, amc: e.amc.length, service: e.service.length },
    });
    sent += 1;
  }
  return sent;
}

defineJob<{ organizationId: string }>({
  name: REMINDER_JOB,
  attempts: 3,
  handler: async () => {
    if ((await tenantDb().asset.count({ take: 1 })) === 0) return;
    await sendAssetReminders();
  },
});
defineRecurringJob({
  name: `${REMINDER_JOB}.schedule`,
  everyMs: DAY / 4,
  handler: async () => {
    const day = Math.floor(Date.now() / DAY);
    await forEachActiveOrganization(async (organizationId) => {
      await enqueue(
        REMINDER_JOB,
        { organizationId },
        { jobId: `${REMINDER_JOB}:${organizationId}:${day}` },
      );
    });
  },
});
