import type { Prisma } from '@prisma/client';
import type { DomainEventTypeDto } from '@erp/shared';
import { tryGetPrincipal } from '../authz/principal';
import { logger } from '../logger';
import { defineJob, enqueue } from '../queue';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';

/*
 * Internal domain event bus (core/events).
 *
 *   registerEventType({ key: 'employee.created', label: 'Employee created', webhook: true });
 *   onEvent('employee.*', async (event) => { ... });      // runs in the queue, tenant context
 *   await emit('employee.created', { employeeId }, { institutionId });
 *
 * `emit` persists a domain_events row (tenant-scoped) and enqueues `events.dispatch`, which
 * runs every matching subscriber (notification rules, outbound webhooks, workflows…) in the
 * event's tenant with the system principal. Subscribers must be idempotent (at-least-once).
 */

export interface DomainEventTypeDef {
  key: string;
  label: string;
  description?: string;
  /** Deliverable to outbound webhooks (default true). Never emit secrets in payloads. */
  webhook?: boolean;
}

export interface DomainEvent<P = Record<string, unknown>> {
  id: string;
  organizationId: string;
  eventKey: string;
  payload: P;
  institutionId: string | null;
  actorType: string;
  actorId: string | null;
  occurredAt: Date;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

const types = new Map<string, DomainEventTypeDef>();
const subscribers: Array<{ pattern: string; name: string; handler: EventHandler }> = [];

const EVENT_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

export function registerEventType(def: DomainEventTypeDef): void {
  if (!EVENT_KEY.test(def.key)) throw new Error(`Invalid event key ${def.key}`);
  types.set(def.key, { webhook: true, ...def });
}

export function listEventTypes(): DomainEventTypeDto[] {
  return [...types.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description ?? null,
      webhook: t.webhook !== false,
    }));
}

export function getEventType(key: string): DomainEventTypeDef | undefined {
  return types.get(key);
}

/** `*` (everything), exact key, or `prefix.*`. */
export function matchesEventPattern(pattern: string, key: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}

/** Subscribe to events. `name` identifies the subscriber in logs. */
export function onEvent(pattern: string, name: string, handler: EventHandler): void {
  const existing = subscribers.findIndex((s) => s.name === name);
  if (existing >= 0) subscribers.splice(existing, 1);
  subscribers.push({ pattern, name, handler });
}

export interface EmitOptions {
  institutionId?: string | null;
}

/**
 * Publish a domain event of the CURRENT tenant. Call after the change is committed (or accept
 * that subscribers may run for a rolled-back change). Returns the event id.
 */
export async function emit(
  eventKey: string,
  payload: Record<string, unknown>,
  options: EmitOptions = {},
): Promise<string> {
  if (!types.has(eventKey)) throw new Error(`Unregistered event type ${eventKey}`);
  const principal = tryGetPrincipal();
  const row = await tenantDb().domainEvent.create({
    data: withTenant({
      eventKey,
      payload: payload as Prisma.InputJsonValue,
      institutionId: options.institutionId ?? null,
      actorType: principal?.actorType ?? 'system',
      actorId: principal?.userId ?? principal?.apiClientId ?? null,
    }),
  });
  await enqueue(
    'events.dispatch',
    { organizationId: currentOrganizationId(), eventId: row.id },
    { jobId: `event:${row.id}` },
  );
  return row.id;
}

defineJob<{ organizationId: string; eventId: string; subscriber?: string }>({
  name: 'events.dispatch',
  attempts: 3,
  handler: async ({ organizationId, eventId, subscriber }) => {
    const row = await tenantDb().domainEvent.findFirst({ where: { id: eventId } });
    if (!row) return;
    const event: DomainEvent = {
      id: row.id,
      organizationId: row.organizationId,
      eventKey: row.eventKey,
      payload: (row.payload as Record<string, unknown>) ?? {},
      institutionId: row.institutionId,
      actorType: row.actorType ?? 'system',
      actorId: row.actorId,
      occurredAt: row.createdAt,
    };
    const targets = subscribers.filter(
      (s) =>
        matchesEventPattern(s.pattern, event.eventKey) && (!subscriber || s.name === subscriber),
    );
    // Each subscriber fails independently: a failure re-enqueues only that subscriber.
    for (const s of targets) {
      try {
        await s.handler(event);
      } catch (err) {
        if (subscriber) throw err;
        logger.warn(
          { eventKey: event.eventKey, subscriber: s.name, err: (err as Error).message },
          'Event subscriber failed; retrying separately',
        );
        await enqueue(
          'events.dispatch',
          { organizationId, eventId, subscriber: s.name },
          { delayMs: 5000 },
        );
      }
    }
  },
});
