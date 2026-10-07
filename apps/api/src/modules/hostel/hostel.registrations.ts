import { registerEventType } from '../../core/events';
import { registerNotificationEvent } from '../../core/notifications';
import { registerWorkflowEntity } from '../../core/workflow/registry';
import {
  HOSTEL_EVENTS,
  HOSTEL_NOTIFICATIONS,
  HOSTEL_OUTPASS_WORKFLOW,
  outpassWorkflowCallbacks,
} from './hostel.operations';

/*
 * Hostel registrations — imported once from `apps/api/src/engines.ts`. Out-passes go through the
 * workflow engine when an org defines a `hostel_outpass` workflow; otherwise the warden decides
 * directly (POST /hostel/outpasses/:id/decide).
 */
registerWorkflowEntity({
  entityType: HOSTEL_OUTPASS_WORKFLOW,
  label: 'Hostel out-pass',
  ...outpassWorkflowCallbacks,
});

for (const [key, label] of [
  [HOSTEL_EVENTS.allocationCreated, 'Hostel allocation created'],
  [HOSTEL_EVENTS.allocationVacated, 'Hostel allocation vacated'],
  [HOSTEL_EVENTS.outpassApproved, 'Hostel out-pass approved'],
  [HOSTEL_EVENTS.outpassRejected, 'Hostel out-pass rejected'],
  [HOSTEL_EVENTS.complaintRaised, 'Hostel complaint raised'],
] as const)
  registerEventType({ key, label, webhook: true });

registerNotificationEvent({
  key: HOSTEL_NOTIFICATIONS.outpassSubmitted,
  label: 'Hostel out-pass submitted (wardens)',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: HOSTEL_NOTIFICATIONS.outpassDecided,
  label: 'Hostel out-pass approved / rejected (student & parents)',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: HOSTEL_NOTIFICATIONS.complaintUpdated,
  label: 'Hostel complaint status changed',
  defaultChannels: ['in_app'],
});
