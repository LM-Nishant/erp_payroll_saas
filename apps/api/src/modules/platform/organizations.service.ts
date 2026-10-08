import type { CreateOrganizationInput, CreatedOrganizationDto } from '@erp/shared';
import { audit } from '../../core/audit';
import { NotFoundError } from '../../core/http/errors';
import {
  createOrganizationRecord,
  getPlatformOrganization,
  runAsPlatform,
} from '../../core/platform';
import { tenantDb, withTenant } from '../../core/tenancy';
import { userService } from '../users/users.service';

export interface OwnerInviteInput {
  name: string;
  email: string;
  role: 'group_owner' | 'institution_owner';
}

/** Institution code derived from the organization slug (fits the 32-char code rule). */
export function institutionCodeFromSlug(slug: string): string {
  return slug.toUpperCase().slice(0, 32).replace(/-+$/, '') || 'MAIN';
}

/**
 * Invite (or add) an organization-wide owner inside the tenant. Runs through the audited
 * `runAsPlatform` path and reuses the regular user-invite flow (the invite token is e-mailed,
 * never returned).
 *
 * An institution owner cannot create institutions, so when the organization has none yet the
 * first one is created automatically, named after the organization.
 */
export async function inviteOrganizationOwner(
  actorUserId: string | null,
  organizationId: string,
  owner: OwnerInviteInput,
) {
  const org =
    owner.role === 'institution_owner' ? await getPlatformOrganization(organizationId) : null;
  return runAsPlatform(
    {
      organizationId,
      actorUserId,
      reason: `Platform onboarding: invite organization owner ${owner.email}`,
    },
    async () => {
      const role = await tenantDb().role.findFirst({
        where: { key: owner.role },
        select: { id: true },
      });
      if (!role) throw new NotFoundError('Role');
      if (org && (await tenantDb().institution.count()) === 0) {
        const institution = await tenantDb().institution.create({
          data: withTenant({
            name: org.name,
            code: institutionCodeFromSlug(org.slug),
            type: org.kind === 'COMPANY' ? 'COMPANY' : 'INSTITUTE',
          }),
        });
        await audit.record({
          action: 'institution.create',
          entityType: 'institution',
          entityId: institution.id,
          after: institution,
        });
      }
      const user = await userService.create({
        email: owner.email,
        name: owner.name,
        roles: [{ roleId: role.id, scopes: [{ type: 'ORGANIZATION' }] }],
      });
      return {
        id: user.id,
        email: user.email,
        inviteDeliveryStatus:
          'inviteDeliveryStatus' in user ? (user.inviteDeliveryStatus as string) : null,
      };
    },
  );
}

/** Onboard a tenant: organization + default roles + subscription + first owner invite. */
export async function createOrganization(
  actorUserId: string | null,
  input: CreateOrganizationInput,
): Promise<CreatedOrganizationDto> {
  const org = await createOrganizationRecord(actorUserId, input);
  const owner = await inviteOrganizationOwner(actorUserId, org.id, input.owner);
  return { ...org, owner };
}
