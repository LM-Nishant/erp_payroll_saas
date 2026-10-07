import { findScopeHolders } from '../authz/holders';
import {
  dueExpiryReminders,
  expireStaleUploads,
  markReminderSent,
  purgeExpiredDocuments,
} from '../documents/hooks';
import { publish, registerNotificationEvent } from '../notifications';
import { defineJob, defineRecurringJob, enqueue, forEachActiveOrganization } from '../queue';

/*
 * Layer 4 document maintenance, scheduled by Layer 5. Each recurring job fans out one tenant job
 * per active organization (idempotent per hour/day bucket via jobId).
 */

registerNotificationEvent({
  key: 'document.expiring',
  label: 'Document expiring soon',
  defaultChannels: ['in_app', 'email'],
});

type OrgJob = { organizationId: string };
const HOUR = 60 * 60 * 1000;

/** Send due expiry reminders to the owning user (if any) and document managers in scope. */
export async function sendDocumentExpiryReminders(): Promise<number> {
  const due = await dueExpiryReminders();
  for (const r of due) {
    const managers = await findScopeHolders({
      permission: 'document.manage',
      resource: { groupId: r.groupId, institutionId: r.institutionId },
    });
    const recipients = new Set(managers);
    if (r.ownerType === 'user') recipients.add(r.ownerId);
    await publish('document.expiring', {
      recipients: [...recipients],
      title: `Document expiring on ${r.expiryDate}: ${r.title}`,
      body: `"${r.title}" (${r.category}) expires on ${r.expiryDate}.`,
      link: `/documents?documentId=${r.documentId}`,
      data: { documentId: r.documentId, expiryDate: r.expiryDate, daysBefore: r.daysBefore },
      institutionId: r.institutionId,
    });
    await markReminderSent(r.reminderId);
  }
  return due.length;
}

defineJob<OrgJob>({
  name: 'documents.expiry_reminders',
  attempts: 3,
  handler: async () => {
    await sendDocumentExpiryReminders();
  },
});
defineJob<OrgJob>({
  name: 'documents.purge_expired',
  attempts: 3,
  handler: async () => {
    await purgeExpiredDocuments();
  },
});
defineJob<OrgJob>({
  name: 'storage.expire_uploads',
  attempts: 3,
  handler: async () => {
    await expireStaleUploads();
  },
});

function fanOut(job: string, everyMs: number) {
  return async () => {
    const bucket = Math.floor(Date.now() / everyMs);
    await forEachActiveOrganization(async (organizationId) => {
      await enqueue(job, { organizationId }, { jobId: `${job}:${organizationId}:${bucket}` });
    });
  };
}

defineRecurringJob({
  name: 'documents.expiry_reminders.schedule',
  everyMs: HOUR,
  handler: fanOut('documents.expiry_reminders', HOUR),
});
defineRecurringJob({
  name: 'documents.purge_expired.schedule',
  everyMs: 6 * HOUR,
  handler: fanOut('documents.purge_expired', 6 * HOUR),
});
defineRecurringJob({
  name: 'storage.expire_uploads.schedule',
  everyMs: HOUR,
  handler: fanOut('storage.expire_uploads', HOUR),
});
