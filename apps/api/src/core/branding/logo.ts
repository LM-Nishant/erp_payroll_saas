import type { SignedUrlDto } from '@erp/shared';
import { documentEngine } from '../documents/service';
import type { SettingTarget } from '../settings/target';
import { currentOrganizationId } from '../tenancy/context';
import { resolveBranding } from './index';

/**
 * Short-lived signed URL of the resolved (inherited) logo for a target, or null when no level
 * has an uploaded logo. Issuing the URL is audited (`document.download`); callers authorize
 * (e.g. `branding.view` on the target) before calling.
 */
export async function brandingLogoUrl(
  target: Pick<SettingTarget, 'scopeType' | 'targetId' | 'groupId' | 'institutionId'>,
): Promise<SignedUrlDto | null> {
  const resolved = await resolveBranding(currentOrganizationId(), target);
  if (!resolved.logoFileId) return null;
  return documentEngine.currentVersionUrl(resolved.logoFileId, 'inline');
}
