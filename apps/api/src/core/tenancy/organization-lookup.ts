import { prisma } from '../db/prisma';

export interface OrganizationRecord {
  id: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

/** Platform-level lookup used by resolvers/middleware (runs outside tenant scope). */
export interface OrganizationLookup {
  findById(id: string): Promise<OrganizationRecord | null>;
  findBySlug(slug: string): Promise<OrganizationRecord | null>;
}

const select = { id: true, slug: true, status: true } as const;

export const prismaOrganizationLookup: OrganizationLookup = {
  findById: (id) => prisma.organization.findFirst({ where: { id, deletedAt: null }, select }),
  findBySlug: (slug) => prisma.organization.findFirst({ where: { slug, deletedAt: null }, select }),
};
