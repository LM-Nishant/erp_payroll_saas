import type { CreateOrganizationInput, CreatedOrganizationDto } from '@erp/shared';
import { createOrganizationRecord, runAsPlatform } from '../../core/platform';
import { NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { userService } from '../users/users.service';

export interface OwnerInviteInput {
  name: string;
  email: string;
  role: 'group_owner' | 'institution_owner';
}

/**
 * Invite (or add) an organization-wide owner inside the tenant. Runs through the audited
 * `runAsPlatform` path and reuses the regular user-invite flow (the invite token is e-mailed,
 * never returned).
 */
export async function inviteOrganizationOwner(
  actorUserId: string | null,
  organizationId: string,
  owner: OwnerInviteInput,
) {
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
