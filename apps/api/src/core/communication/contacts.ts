import type { MessageChannel } from '@erp/shared';
import { prisma } from '../db/prisma';
import { currentOrganizationId } from '../tenancy/context';

export interface Contact {
  address: string | null;
  name: string | null;
}

/**
 * Resolves a user's address on a channel. The default resolver knows e-mail (login address of
 * a member of the current organization); later layers (HR employee master) register resolvers
 * for phone numbers: `registerContactResolver('sms', async (userIds) => new Map(...))`.
 */
export type ContactResolver = (userIds: string[]) => Promise<Map<string, Contact>>;

const resolvers = new Map<MessageChannel, ContactResolver>();

export function registerContactResolver(channel: MessageChannel, resolver: ContactResolver) {
  resolvers.set(channel, resolver);
}

async function memberNames(userIds: string[]) {
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      deletedAt: null,
      memberships: { some: { organizationId: currentOrganizationId() } },
    },
    select: { id: true, email: true, name: true, status: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

/** Contacts for users of the CURRENT organization (non-members resolve to no address). */
export async function resolveContacts(
  channel: MessageChannel,
  userIds: string[],
): Promise<Map<string, Contact>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const members = await memberNames(ids);
  const custom = resolvers.get(channel);
  const resolved = custom ? await custom(ids) : new Map<string, Contact>();
  const out = new Map<string, Contact>();
  for (const id of ids) {
    const m = members.get(id);
    if (!m) {
      out.set(id, { address: null, name: null });
      continue;
    }
    const c = resolved.get(id);
    out.set(id, {
      address: c?.address ?? (channel === 'email' && m.status !== 'DISABLED' ? m.email : null),
      name: c?.name ?? m.name,
    });
  }
  return out;
}
