import { findScopeHolders, type ResourceScope } from '../../core/authz';
import { logger } from '../../core/logger';
import { publish } from '../../core/notifications';

/** Publish to explicit recipients (deduped); never fails the business operation. */
export async function notifyUsers(
  eventKey: string,
  recipients: (string | null | undefined)[],
  input: {
    title: string;
    body?: string;
    link?: string;
    institutionId?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const ids = [...new Set(recipients.filter((r): r is string => !!r))];
  if (ids.length === 0) return;
  try {
    await publish(eventKey, { ...input, recipients: ids });
  } catch (err) {
    logger.warn({ err, eventKey }, 'assets: notification publish failed');
  }
}

/** Users holding `permission` over the resource (e.g. asset managers of the institution). */
export async function holders(permission: string, resource: ResourceScope): Promise<string[]> {
  return findScopeHolders({ permission, resource });
}
