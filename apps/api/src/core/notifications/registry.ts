import type { NotificationChannel } from '@erp/shared';

export interface NotificationEventDefinition {
  key: string;
  label: string;
  /** Channels used when no organization rule overrides them (default in-app only). */
  defaultChannels?: NotificationChannel[];
  /** Mandatory notifications ignore user preferences (security / compliance). */
  mandatory?: boolean;
}

const events = new Map<string, Required<NotificationEventDefinition>>();

/** Modules declare the notification events they publish (shown in rules / preferences UIs). */
export function registerNotificationEvent(def: NotificationEventDefinition): void {
  events.set(def.key, {
    key: def.key,
    label: def.label,
    defaultChannels: def.defaultChannels ?? ['in_app'],
    mandatory: def.mandatory ?? false,
  });
}

export function getNotificationEvent(key: string) {
  return events.get(key);
}

export function listNotificationEvents() {
  return [...events.values()].sort((a, b) => a.key.localeCompare(b.key));
}

registerNotificationEvent({
  key: 'system.announcement',
  label: 'Announcements',
  defaultChannels: ['in_app'],
});
