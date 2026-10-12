import type {
  AudienceInput,
  AudienceMemberDto,
  AudienceSkippedDto,
  CampaignAudienceDto,
  MessageChannel,
} from '@erp/shared';
import type { Prisma } from '@prisma/client';
import {
  accessFor,
  covers,
  currentPrincipal,
  hasPermission,
  hierarchyResource,
  permissionDenied,
  type ResourceScope,
} from '../authz';
import { ForbiddenError, ValidationError } from '../http/errors';
import { tenantDb } from '../tenancy/tenant-db';
import { normalizeAddress } from './messaging';

/** Deliverable audience member (one per distinct address). */
export interface AudienceMember extends AudienceMemberDto {
  address: string;
  variables: Record<string, unknown>;
}

export interface ResolvedAudience {
  audience: CampaignAudienceDto;
  members: AudienceMember[];
  skipped: AudienceSkippedDto[];
  byKind: { student: number; guardian: number; staff: number };
}

/** Opt-out keys: a user who disabled one of these for the channel gets no announcements. */
export const BROADCAST_OPT_OUT_KEYS = ['message.broadcast', '*'] as const;

interface Unit {
  label: string;
  resource: ResourceScope;
}

interface Candidate {
  kind: AudienceMemberDto['kind'];
  name: string;
  userId: string | null;
  raw: string | null;
  studentName: string | null;
}

const RECIPIENT_LABEL = {
  students: 'Students',
  guardians: 'Guardians',
  both: 'Students & guardians',
  staff: 'Staff',
} as const;

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function scopeDenied(what: string, permission: string) {
  return new ForbiddenError(
    `"${permission}" is not granted for ${what} — you can only message audiences inside your scope`,
    'SCOPE_DENIED',
  );
}

/** Units of the audience (the scope we authorize against) + row filters for members. */
async function loadUnits(audience: AudienceInput) {
  const db = tenantDb();
  const institution = await db.institution.findFirst({
    where: { id: audience.institutionId, deletedAt: null },
    select: { id: true, name: true, groupId: true },
  });
  if (!institution) {
    throw new ValidationError('Unknown institution', { field: 'audience.institutionId' });
  }
  const ids = [...new Set(audience.ids)];
  const unknown = (what: string) =>
    new ValidationError(`One or more ${what} are not in this institution`, {
      field: 'audience.ids',
    });
  const inInstitution = { institutionId: institution.id, deletedAt: null };
  let units: Unit[];
  let studentWhere: Prisma.StudentWhereInput = {};
  let staffWhere: Prisma.EmployeeWhereInput = {};
  let explicit = false;

  switch (audience.type) {
    case 'institution':
      units = [{ label: institution.name, resource: hierarchyResource.institution(institution) }];
      break;
    case 'department': {
      const rows = await db.department.findMany({
        where: { id: { in: ids }, ...inInstitution },
        select: { id: true, name: true, institutionId: true, campusId: true },
      });
      if (rows.length !== ids.length) throw unknown('departments');
      units = rows.map((d) => ({
        label: d.name,
        resource: { groupId: institution.groupId, ...hierarchyResource.department(d) },
      }));
      studentWhere = { departmentId: { in: ids } };
      staffWhere = { departmentId: { in: ids } };
      break;
    }
    case 'program': {
      const rows = await db.program.findMany({
        where: { id: { in: ids }, ...inInstitution },
        select: { id: true, name: true, institutionId: true, departmentId: true },
      });
      if (rows.length !== ids.length) throw unknown('programs');
      units = rows.map((p) => ({ label: p.name, resource: hierarchyResource.program(p) }));
      studentWhere = { programId: { in: ids } };
      break;
    }
    case 'class_section': {
      const rows = await db.classSection.findMany({
        where: { id: { in: ids }, ...inInstitution },
        select: {
          id: true,
          name: true,
          institutionId: true,
          departmentId: true,
          campusId: true,
          program: { select: { name: true } },
        },
      });
      if (rows.length !== ids.length) throw unknown('class sections');
      units = rows.map((cs) => ({
        label: `${cs.program.name} ${cs.name}`,
        resource: { groupId: institution.groupId, ...hierarchyResource.classSection(cs) },
      }));
      studentWhere = { classSectionId: { in: ids } };
      break;
    }
    case 'students': {
      const rows = await db.student.findMany({
        where: { id: { in: ids }, ...inInstitution },
        select: {
          id: true,
          displayName: true,
          groupId: true,
          institutionId: true,
          campusId: true,
          departmentId: true,
        },
      });
      if (rows.length !== ids.length) throw unknown('students');
      units = rows.map((s) => ({ label: s.displayName, resource: hierarchyResource.student(s) }));
      studentWhere = { id: { in: ids } };
      explicit = true;
      break;
    }
    case 'staff': {
      const rows = await db.employee.findMany({
        where: { id: { in: ids }, ...inInstitution },
        select: {
          id: true,
          displayName: true,
          groupId: true,
          institutionId: true,
          campusId: true,
          departmentId: true,
        },
      });
      if (rows.length !== ids.length) throw unknown('staff members');
      units = rows.map((e) => ({ label: e.displayName, resource: hierarchyResource.employee(e) }));
      staffWhere = { id: { in: ids } };
      explicit = true;
      break;
    }
  }
  return { institution, units, studentWhere, staffWhere, explicit };
}

/** The caller must hold every permission over every unit of the audience. */
async function authorizeUnits(units: Unit[], permissions: string[]) {
  const principal = currentPrincipal();
  for (const permission of permissions) {
    if (!hasPermission(principal, permission)) throw permissionDenied(permission);
    const access = await accessFor(principal, permission);
    for (const unit of units) {
      if (!covers(access, unit.resource)) throw scopeDenied(unit.label, permission);
    }
  }
}

function labelOf(audience: AudienceInput, institutionName: string, units: Unit[]) {
  const who = RECIPIENT_LABEL[audience.recipients];
  if (audience.type === 'institution') return `${who} of ${institutionName}`;
  const names = units.map((u) => u.label);
  const more = names.length > 3 ? ` +${names.length - 3} more` : '';
  return `${who} of ${names.slice(0, 3).join(', ')}${more}`;
}

/**
 * Resolve an announcement audience to deliverable addresses on `channel`, enforcing the
 * caller's RBAC scope: `message.broadcast` (+ `message.schedule` when scheduling) AND
 * `student.view` (students / guardians) or `employee.view` (staff) over EVERY unit of the
 * audience — e.g. a department-scoped HOD may target their department, its programs, sections
 * and students, but not the whole institution or another department.
 *
 * Members without an address, with an invalid one or opted out (notification preference
 * `message.broadcast` / `*` disabled for the channel) are reported in `skipped`; duplicates
 * (one guardian of two siblings) collapse into one message.
 */
export async function resolveAudience(
  audience: AudienceInput,
  channel: MessageChannel,
  opts: { schedule?: boolean } = {},
): Promise<ResolvedAudience> {
  const { institution, units, studentWhere, staffWhere, explicit } = await loadUnits(audience);
  const wantsStaff = audience.recipients === 'staff';
  await authorizeUnits(units, [
    'message.broadcast',
    ...(opts.schedule ? ['message.schedule'] : []),
    wantsStaff ? 'employee.view' : 'student.view',
  ]);

  const db = tenantDb();
  const email = channel === 'email';
  const candidates: Candidate[] = [];

  if (wantsStaff) {
    const staff = await db.employee.findMany({
      where: {
        ...staffWhere,
        institutionId: institution.id,
        deletedAt: null,
        ...(explicit ? {} : { status: { in: ['ACTIVE', 'ON_NOTICE'] } }),
      },
      select: {
        displayName: true,
        workEmail: true,
        workPhone: true,
        userId: true,
        user: { select: { email: true } },
        profile: { select: { personalEmail: true, personalPhone: true } },
      },
      orderBy: { displayName: 'asc' },
    });
    for (const e of staff) {
      candidates.push({
        kind: 'staff',
        name: e.displayName,
        userId: e.userId,
        studentName: null,
        raw: email
          ? (blank(e.workEmail) ?? blank(e.profile?.personalEmail) ?? blank(e.user?.email))
          : (blank(e.workPhone) ?? blank(e.profile?.personalPhone)),
      });
    }
  } else {
    const withStudents = audience.recipients !== 'guardians';
    const withGuardians = audience.recipients !== 'students';
    const students = await db.student.findMany({
      where: {
        ...studentWhere,
        institutionId: institution.id,
        deletedAt: null,
        ...(explicit ? {} : { status: 'ACTIVE' }),
      },
      select: {
        displayName: true,
        email: true,
        phone: true,
        userId: true,
        user: { select: { email: true } },
        guardians: {
          // No guardians needed → match none.
          where: withGuardians
            ? { deletedAt: null, guardian: { deletedAt: null } }
            : { id: { in: [] } },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: {
            guardian: {
              select: {
                name: true,
                email: true,
                phone: true,
                userId: true,
                user: { select: { email: true } },
              },
            },
          },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    for (const s of students) {
      if (withStudents) {
        candidates.push({
          kind: 'student',
          name: s.displayName,
          userId: s.userId,
          studentName: s.displayName,
          raw: email ? (blank(s.email) ?? blank(s.user?.email)) : blank(s.phone),
        });
      }
      for (const { guardian: g } of s.guardians) {
        candidates.push({
          kind: 'guardian',
          name: g.name,
          userId: g.userId,
          studentName: s.displayName,
          raw: email ? (blank(g.email) ?? blank(g.user?.email)) : blank(g.phone),
        });
      }
    }
  }

  const userIds = [...new Set(candidates.map((c) => c.userId).filter((v): v is string => !!v))];
  const optedOut = new Set(
    userIds.length === 0
      ? []
      : (
          await db.notificationPreference.findMany({
            where: {
              userId: { in: userIds },
              channel,
              enabled: false,
              eventKey: { in: [...BROADCAST_OPT_OUT_KEYS] },
            },
            select: { userId: true },
          })
        ).map((p) => p.userId),
  );

  const members = new Map<string, AudienceMember>();
  const skipped: AudienceSkippedDto[] = [];
  for (const c of candidates) {
    const base = { kind: c.kind, name: c.name, userId: c.userId, studentName: c.studentName };
    if (c.userId && optedOut.has(c.userId)) {
      skipped.push({ ...base, address: c.raw, reason: 'OPTED_OUT' });
      continue;
    }
    if (!c.raw) {
      skipped.push({ ...base, address: null, reason: 'NO_ADDRESS' });
      continue;
    }
    const address = normalizeAddress(channel, c.raw);
    if (!address) {
      skipped.push({ ...base, address: c.raw, reason: 'INVALID_ADDRESS' });
      continue;
    }
    const existing = members.get(address);
    if (existing) {
      // e.g. one guardian of two siblings → one message naming both children.
      if (c.studentName && existing.studentName && !existing.studentName.includes(c.studentName)) {
        existing.studentName = `${existing.studentName}, ${c.studentName}`;
        existing.variables.studentName = existing.studentName;
      }
      continue;
    }
    members.set(address, {
      ...base,
      address,
      variables: { name: c.name, studentName: c.studentName, kind: c.kind },
    });
  }

  const list = [...members.values()];
  const byKind = { student: 0, guardian: 0, staff: 0 };
  for (const m of list) byKind[m.kind]++;
  return {
    audience: {
      institutionId: institution.id,
      type: audience.type,
      ids: audience.ids,
      recipients: audience.recipients,
      label: labelOf(audience, institution.name, units),
    },
    members: list,
    skipped,
    byKind,
  };
}
