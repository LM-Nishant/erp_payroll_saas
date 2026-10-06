import { prisma } from '../db/prisma';

export interface PermissionView {
  id: string;
  code: string;
  module: string;
  description: string;
}

/** The global permission catalog (synced from @erp/shared). */
export function listPermissions(): Promise<PermissionView[]> {
  return prisma.permission.findMany({
    orderBy: [{ module: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, module: true, description: true },
  });
}

/** Map permission codes to ids; unknown codes are returned in `unknown`. */
export async function permissionIdsFor(codes: readonly string[]) {
  const rows = await prisma.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });
  const found = new Map(rows.map((r) => [r.code, r.id] as const));
  return {
    ids: [...found.values()],
    unknown: codes.filter((c) => !found.has(c)),
  };
}
