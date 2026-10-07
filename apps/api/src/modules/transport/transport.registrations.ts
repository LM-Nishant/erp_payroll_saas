import { registerDocumentOwnerType } from '../../core/documents/owners';
import { registerEventType } from '../../core/events';
import { registerNotificationEvent } from '../../core/notifications';
import {
  defineJob,
  defineRecurringJob,
  enqueue,
  forEachActiveOrganization,
} from '../../core/queue';
import { tenantDb } from '../../core/tenancy';
import { runTransportReminders } from './transport.operations';

const scopeOf = (row: { groupId: string | null; institutionId: string } | null) =>
  row
    ? { groupId: row.groupId, institutionId: row.institutionId, campusId: null, departmentId: null }
    : null;

// Vehicle papers (RC, insurance, fitness, permit, PUC) and driver licences are stored through the
// documents engine; documents with an expiryDate get the engine's own expiry reminders too.
registerDocumentOwnerType({
  type: 'transport_vehicle',
  resolveScope: async (id) =>
    scopeOf(
      await tenantDb().transportVehicle.findFirst({
        where: { id },
        select: { groupId: true, institutionId: true },
      }),
    ),
});
registerDocumentOwnerType({
  type: 'transport_staff',
  resolveScope: async (id) =>
    scopeOf(
      await tenantDb().transportStaff.findFirst({
        where: { id },
        select: { groupId: true, institutionId: true },
      }),
    ),
});

for (const [key, label] of [
  ['transport.vehicle.created', 'Transport vehicle created'],
  ['transport.allocation.created', 'Transport allocation created'],
  ['transport.allocation.ended', 'Transport allocation ended'],
  ['transport.trip.completed', 'Transport trip completed'],
  ['transport.incident.reported', 'Transport incident reported'],
] as const)
  registerEventType({ key, label, webhook: true });

registerNotificationEvent({
  key: 'transport.route_broadcast',
  label: 'Transport route announcements (delays, changes)',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'transport.expiry_reminder',
  label: 'Transport document / licence / service reminders',
  defaultChannels: ['in_app', 'email'],
});

const REMINDER_JOB = 'transport.reminders';
const DAY = 24 * 60 * 60 * 1000;

defineJob<{ organizationId: string }>({
  name: REMINDER_JOB,
  attempts: 3,
  handler: async () => {
    await runTransportReminders();
  },
});

defineRecurringJob({
  name: 'transport.reminders.schedule',
  everyMs: DAY,
  handler: async () => {
    const bucket = Math.floor(Date.now() / DAY);
    await forEachActiveOrganization(async (organizationId) => {
      await enqueue(
        REMINDER_JOB,
        { organizationId },
        { jobId: `${REMINDER_JOB}:${organizationId}:${bucket}` },
      );
    });
  },
});
