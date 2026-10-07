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
import { circulationService } from './library.circulation';
import {
  LIBRARY_BOOK_OWNER,
  LIBRARY_DAILY_JOB,
  LIBRARY_EVENTS,
  LIBRARY_NOTIFICATIONS,
} from './library.constants';
// PDF templates (library_labels, library_report) register on import.
import './library.reports';

/*
 * Library registrations — imported once from `apps/api/src/engines.ts`.
 */

registerDocumentOwnerType({
  type: LIBRARY_BOOK_OWNER,
  resolveScope: async (id) => {
    const b = await tenantDb().libraryBook.findUnique({
      where: { id },
      select: { groupId: true, institutionId: true, campusId: true },
    });
    return b ? { ...b, departmentId: null } : null;
  },
});

for (const [key, label] of [
  [LIBRARY_EVENTS.bookCreated, 'Library book catalogued'],
  [LIBRARY_EVENTS.issued, 'Library book issued'],
  [LIBRARY_EVENTS.returned, 'Library book returned'],
  [LIBRARY_EVENTS.renewed, 'Library loan renewed'],
  [LIBRARY_EVENTS.reserved, 'Library book reserved'],
  [LIBRARY_EVENTS.reservationReady, 'Library reservation ready for pickup'],
  [LIBRARY_EVENTS.fineAssessed, 'Library fine assessed'],
  [LIBRARY_EVENTS.fineSettled, 'Library fine collected / waived'],
] as const)
  registerEventType({ key, label, webhook: true });

for (const [key, label] of [
  [LIBRARY_NOTIFICATIONS.dueReminder, 'Library book due tomorrow'],
  [LIBRARY_NOTIFICATIONS.overdue, 'Library book overdue (member and guardians)'],
  [LIBRARY_NOTIFICATIONS.reservationReady, 'Reserved library book ready for pickup'],
  [LIBRARY_NOTIFICATIONS.fineAssessed, 'Library fine charged'],
] as const)
  registerNotificationEvent({ key, label, defaultChannels: ['in_app', 'email'] });

const DAY = 24 * 60 * 60 * 1000;

/** Daily: due / overdue reminders and expiry of uncollected reservations. */
defineJob<{ organizationId: string }>({
  name: LIBRARY_DAILY_JOB,
  attempts: 3,
  handler: async () => {
    await circulationService.runDaily();
  },
});

defineRecurringJob({
  name: 'library.daily.schedule',
  everyMs: DAY,
  handler: async () => {
    const bucket = Math.floor(Date.now() / DAY);
    await forEachActiveOrganization(async (organizationId) => {
      await enqueue(
        LIBRARY_DAILY_JOB,
        { organizationId },
        { jobId: `${LIBRARY_DAILY_JOB}:${organizationId}:${bucket}` },
      );
    });
  },
});
