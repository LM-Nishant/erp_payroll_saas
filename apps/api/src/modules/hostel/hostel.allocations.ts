import type { Prisma } from '@prisma/client';
import type {
  CreateHostelAllocationInput,
  GenerateHostelChargesInput,
  HostelAllocationDto,
  HostelChargeDto,
  HostelListQuery,
  MyHostelDto,
  TransferHostelAllocationInput,
  UpdateHostelAllocationInput,
  UpdateHostelChargeInput,
  VacateHostelAllocationInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { accessFor, currentPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, InvalidReferenceError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { postExternalCharge } from '../transport/charges-hook';
import {
  assertVisible,
  authorizeRow,
  dateStr,
  dateStrOrNull,
  employeeRefs,
  institutionScope,
  myStudentIds,
  num,
  periodBounds,
  resolvePerson,
  studentRefs,
  toDate,
  type PersonRef,
} from '../transport/transport.common';
import { genderAllowed, monthlyHostelCharge, occupantAllowed } from './hostel.logic';
import { complaintService, outpassService } from './hostel.operations';
import { HOSTEL_VIEW, loadHostel } from './hostel.structure';

type Db = ReturnType<typeof tenantDb>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

const db = () => tenantDb();
const ALLOCATE = 'hostel.allocate';

const allocationInclude = {
  hostel: { select: { id: true, code: true, name: true, hostelType: true } },
  room: { select: { id: true, roomNo: true, floor: true } },
  bed: { select: { id: true, bedNo: true } },
  messPlan: { select: { id: true, name: true, monthlyFee: true } },
} as const;
type AllocationRow = Prisma.HostelAllocationGetPayload<{ include: typeof allocationInclude }>;

export async function peopleFor(rows: { studentId: string | null; employeeId: string | null }[]) {
  const [students, employees] = await Promise.all([
    studentRefs(rows.map((r) => r.studentId)),
    employeeRefs(rows.map((r) => r.employeeId)),
  ]);
  return (r: { studentId: string | null; employeeId: string | null }): PersonRef | undefined =>
    r.studentId
      ? students.get(r.studentId)
      : r.employeeId
        ? employees.get(r.employeeId)
        : undefined;
}

function toAllocationDto(a: AllocationRow, person?: PersonRef): HostelAllocationDto {
  return {
    id: a.id,
    institutionId: a.institutionId,
    hostel: { id: a.hostel.id, code: a.hostel.code, name: a.hostel.name },
    room: a.room,
    bed: a.bed,
    occupantType: a.occupantType,
    studentId: a.studentId,
    employeeId: a.employeeId,
    occupantName: person?.name ?? '—',
    occupantCode: person?.code ?? null,
    messPlan: a.messPlan
      ? { id: a.messPlan.id, name: a.messPlan.name, monthlyFee: num(a.messPlan.monthlyFee) }
      : null,
    fromDate: dateStr(a.fromDate),
    toDate: dateStrOrNull(a.toDate),
    status: a.status,
    monthlyRent: num(a.monthlyRent),
    notes: a.notes,
  };
}

async function allocationDto(id: string) {
  const a = await db().hostelAllocation.findFirstOrThrow({
    where: { id },
    include: allocationInclude,
  });
  return toAllocationDto(a, (await peopleFor([a]))(a));
}

async function loadAllocation(id: string) {
  return assertVisible(
    await db().hostelAllocation.findFirst({ where: { id }, include: allocationInclude }),
    HOSTEL_VIEW,
    'Allocation',
  );
}

/** Pick (and lock in the transaction) a free bed: the given bed, or the first free bed of a room. */
async function claimBed(tx: Tx, hostelId: string, bedId?: string | null, roomId?: string | null) {
  const bed = bedId
    ? await tx.hostelBed.findFirst({ where: { id: bedId, hostelId }, include: { room: true } })
    : await tx.hostelBed.findFirst({
        where: { roomId: roomId ?? undefined, hostelId, status: 'AVAILABLE' },
        include: { room: true },
        orderBy: { bedNo: 'asc' },
      });
  if (!bed) {
    if (bedId) throw new InvalidReferenceError('bedId', 'Bed');
    const room = await tx.hostelRoom.findFirst({ where: { id: roomId ?? undefined, hostelId } });
    if (!room) throw new InvalidReferenceError('roomId', 'Room');
    throw new AppError(409, 'CAPACITY_EXCEEDED', `Room ${room.roomNo} has no free bed`);
  }
  if (bed.room.status !== 'ACTIVE')
    throw new ConflictError(`Room ${bed.room.roomNo} is not active`);
  if (bed.status !== 'AVAILABLE') {
    throw new AppError(
      409,
      'BED_UNAVAILABLE',
      `Bed ${bed.room.roomNo}-${bed.bedNo} is ${bed.status.toLowerCase()}`,
    );
  }
  const claimed = await tx.hostelBed.updateMany({
    where: { id: bed.id, status: 'AVAILABLE' },
    data: { status: 'OCCUPIED' },
  });
  if (claimed.count !== 1) throw new AppError(409, 'BED_UNAVAILABLE', 'Bed was just taken');
  return bed;
}

async function resolveRoomOrBedHostel(bedId?: string | null, roomId?: string | null) {
  if (bedId) {
    const bed = await db().hostelBed.findFirst({
      where: { id: bedId },
      select: { hostelId: true },
    });
    if (!bed) throw new InvalidReferenceError('bedId', 'Bed');
    return bed.hostelId;
  }
  const room = await db().hostelRoom.findFirst({
    where: { id: roomId ?? '' },
    select: { hostelId: true },
  });
  if (!room) throw new InvalidReferenceError('roomId', 'Room');
  return room.hostelId;
}

async function validateMessPlan(messPlanId: string | null | undefined, hostelId: string) {
  if (!messPlanId) return null;
  const m = await db().hostelMessPlan.findFirst({ where: { id: messPlanId, hostelId } });
  if (!m) throw new InvalidReferenceError('messPlanId', 'Mess plan');
  return m.id;
}

async function occupantIdsMatching(search: string) {
  const [students, employees] = await Promise.all([
    db().student.findMany({
      where: { OR: [{ displayName: { contains: search } }, { admissionNo: { contains: search } }] },
      select: { id: true },
      take: 500,
    }),
    db().employee.findMany({
      where: {
        OR: [{ displayName: { contains: search } }, { employeeCode: { contains: search } }],
      },
      select: { id: true },
      take: 500,
    }),
  ]);
  return {
    OR: [
      { studentId: { in: students.map((s) => s.id) } },
      { employeeId: { in: employees.map((e) => e.id) } },
    ],
  };
}

export const hostelAllocationService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelAllocationWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.hostelId && { hostelId: query.hostelId }),
      ...(query.roomId && { roomId: query.roomId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.occupantType && { occupantType: query.occupantType }),
      ...(query.status && { status: query.status }),
      ...(query.search && (await occupantIdsMatching(query.search))),
    };
    const [rows, total] = await Promise.all([
      db().hostelAllocation.findMany({
        where,
        include: allocationInclude,
        orderBy: [{ hostel: { code: 'asc' } }, { room: { roomNo: 'asc' } }, { createdAt: 'asc' }],
        ...toPageWindow(query),
      }),
      db().hostelAllocation.count({ where }),
    ]);
    const person = await peopleFor(rows);
    return { items: rows.map((r) => toAllocationDto(r, person(r))), total };
  },

  async get(id: string) {
    const a = await loadAllocation(id);
    return toAllocationDto(a, (await peopleFor([a]))(a));
  },

  async create(input: CreateHostelAllocationInput) {
    const hostelId = await resolveRoomOrBedHostel(input.bedId, input.roomId);
    const hostel = await loadHostel(hostelId);
    await authorizeRow(hostel, ALLOCATE);
    if (hostel.status !== 'ACTIVE') throw new ConflictError('Hostel is inactive');
    if (!occupantAllowed(hostel.hostelType, input.occupantType)) {
      throw new AppError(
        422,
        'OCCUPANT_NOT_ALLOWED',
        `${hostel.name} does not house ${input.occupantType.toLowerCase()}`,
      );
    }
    const isStudent = input.occupantType === 'STUDENT';
    const personId = (isStudent ? input.studentId : input.employeeId) as string;
    const person = await resolvePerson(input.occupantType, personId, hostel.institutionId);
    if (isStudent && !genderAllowed(hostel.hostelType, person.gender)) {
      throw new AppError(
        422,
        'GENDER_MISMATCH',
        `${person.name} cannot be placed in ${hostel.name}`,
      );
    }
    const messPlanId = await validateMessPlan(input.messPlanId, hostelId);
    const created = await db().$transaction(async (tx) => {
      const existing = await tx.hostelAllocation.findFirst({
        where: {
          status: 'ACTIVE',
          ...(isStudent ? { studentId: personId } : { employeeId: personId }),
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('Occupant already has an active hostel allocation', {
          allocationId: existing.id,
        });
      }
      const bed = await claimBed(tx, hostelId, input.bedId, input.roomId);
      return tx.hostelAllocation.create({
        data: withTenant({
          institutionId: hostel.institutionId,
          groupId: hostel.groupId,
          hostelId,
          roomId: bed.roomId,
          bedId: bed.id,
          occupantType: input.occupantType,
          studentId: isStudent ? personId : null,
          employeeId: isStudent ? null : personId,
          messPlanId,
          fromDate: toDate(input.fromDate),
          monthlyRent: input.monthlyRent ?? bed.room.monthlyRent,
          notes: input.notes ?? null,
        }),
      });
    });
    const dto = await allocationDto(created.id);
    await audit.record({
      action: 'hostel_allocation.created',
      entityType: 'hostel_allocation',
      entityId: created.id,
      after: dto,
    });
    await emit(
      'hostel.allocation.created',
      { allocationId: created.id, hostelId, roomId: dto.room.id, studentId: dto.studentId },
      { institutionId: hostel.institutionId },
    );
    return dto;
  },

  async update(id: string, input: UpdateHostelAllocationInput) {
    const before = await loadAllocation(id);
    await authorizeRow(before, ALLOCATE);
    if (before.status !== 'ACTIVE') throw new ConflictError('Allocation is not active');
    const messPlanId =
      input.messPlanId !== undefined
        ? await validateMessPlan(input.messPlanId, before.hostelId)
        : undefined;
    await db().hostelAllocation.update({
      where: { id },
      data: {
        ...(messPlanId !== undefined && { messPlanId }),
        ...(input.monthlyRent !== undefined && { monthlyRent: input.monthlyRent }),
        ...(input.notes !== undefined && { notes: input.notes ?? null }),
      },
    });
    const person = (await peopleFor([before]))(before);
    const dto = await allocationDto(id);
    await audit.record({
      action: 'hostel_allocation.updated',
      entityType: 'hostel_allocation',
      entityId: id,
      before: toAllocationDto(before, person),
      after: dto,
    });
    return dto;
  },

  async vacate(id: string, input: VacateHostelAllocationInput) {
    const before = await loadAllocation(id);
    await authorizeRow(before, ALLOCATE);
    if (before.status !== 'ACTIVE') throw new ConflictError('Allocation is not active');
    if (input.toDate < dateStr(before.fromDate)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'toDate must be on/after fromDate');
    }
    await db().$transaction(async (tx) => {
      await tx.hostelAllocation.update({
        where: { id },
        data: {
          status: 'VACATED',
          toDate: toDate(input.toDate),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
        },
      });
      await tx.hostelBed.update({ where: { id: before.bedId }, data: { status: 'AVAILABLE' } });
    });
    const dto = await allocationDto(id);
    await audit.record({
      action: 'hostel_allocation.vacated',
      entityType: 'hostel_allocation',
      entityId: id,
      before: { status: before.status, toDate: dateStrOrNull(before.toDate) },
      after: { status: dto.status, toDate: dto.toDate },
    });
    await emit(
      'hostel.allocation.vacated',
      { allocationId: id, hostelId: before.hostelId, studentId: before.studentId },
      { institutionId: before.institutionId },
    );
    return dto;
  },

  /** Move to another bed/room (possibly another hostel of the same institution). */
  async transfer(id: string, input: TransferHostelAllocationInput) {
    const before = await loadAllocation(id);
    await authorizeRow(before, ALLOCATE);
    if (before.status !== 'ACTIVE') throw new ConflictError('Allocation is not active');
    if (input.date < dateStr(before.fromDate)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'date must be on/after fromDate');
    }
    const hostelId = await resolveRoomOrBedHostel(input.bedId, input.roomId);
    const hostel = await loadHostel(hostelId);
    await authorizeRow(hostel, ALLOCATE);
    if (hostel.institutionId !== before.institutionId) {
      throw new InvalidReferenceError(input.bedId ? 'bedId' : 'roomId', 'Bed');
    }
    if (!occupantAllowed(hostel.hostelType, before.occupantType)) {
      throw new AppError(
        422,
        'OCCUPANT_NOT_ALLOWED',
        `${hostel.name} does not house this occupant`,
      );
    }
    const person = (await peopleFor([before]))(before);
    if (before.studentId && !genderAllowed(hostel.hostelType, person?.gender)) {
      throw new AppError(
        422,
        'GENDER_MISMATCH',
        `${person?.name ?? 'Student'} cannot be placed in ${hostel.name}`,
      );
    }
    const created = await db().$transaction(async (tx) => {
      const bed = await claimBed(tx, hostelId, input.bedId, input.roomId);
      await tx.hostelAllocation.update({
        where: { id },
        data: { status: 'TRANSFERRED', toDate: toDate(input.date) },
      });
      await tx.hostelBed.update({ where: { id: before.bedId }, data: { status: 'AVAILABLE' } });
      return tx.hostelAllocation.create({
        data: withTenant({
          institutionId: hostel.institutionId,
          groupId: hostel.groupId,
          hostelId,
          roomId: bed.roomId,
          bedId: bed.id,
          occupantType: before.occupantType,
          studentId: before.studentId,
          employeeId: before.employeeId,
          messPlanId: hostelId === before.hostelId ? before.messPlanId : null,
          fromDate: toDate(input.date),
          monthlyRent: input.monthlyRent ?? bed.room.monthlyRent,
          notes: input.notes ?? before.notes,
        }),
      });
    });
    const dto = await allocationDto(created.id);
    await audit.record({
      action: 'hostel_allocation.transferred',
      entityType: 'hostel_allocation',
      entityId: created.id,
      before: toAllocationDto(before, person),
      after: dto,
    });
    return dto;
  },

  /** Portal "My hostel": own (student) or wards' (parent) hostel details. */
  async mine(): Promise<MyHostelDto[]> {
    const studentIds = await myStudentIds();
    if (!studentIds.length) return [];
    const [students, allocations] = await Promise.all([
      studentRefs(studentIds),
      db().hostelAllocation.findMany({
        where: { status: 'ACTIVE', studentId: { in: studentIds } },
        include: { ...allocationInclude, hostel: true },
      }),
    ]);
    const wardens = await employeeRefs(allocations.map((a) => a.hostel.wardenEmployeeId));
    const out: MyHostelDto[] = [];
    for (const ref of students.values()) {
      const a = allocations.find((x) => x.studentId === ref.id);
      let roommates: MyHostelDto['roommates'] = [];
      if (a) {
        const mates = await db().hostelAllocation.findMany({
          where: { roomId: a.roomId, status: 'ACTIVE', id: { not: a.id } },
          include: { bed: { select: { bedNo: true } } },
        });
        const who = await peopleFor(mates);
        roommates = mates.map((m) => ({ name: who(m)?.name ?? '—', bedNo: m.bed.bedNo }));
      }
      const [outpasses, complaints] = await Promise.all([
        outpassService.forStudent(ref.id),
        complaintService.forStudent(ref.id),
      ]);
      out.push({
        studentId: ref.id,
        studentName: ref.name,
        allocation: a ? toAllocationDto(a, ref) : null,
        hostel: a
          ? {
              name: a.hostel.name,
              hostelType: a.hostel.hostelType,
              phone: a.hostel.phone,
              wardenName: wardens.get(a.hostel.wardenEmployeeId ?? '')?.name ?? null,
            }
          : null,
        roommates,
        outpasses,
        complaints,
      });
    }
    return out;
  },
};

// ---- Charges --------------------------------------------------------------------------------
function toChargeDto(
  c: Prisma.HostelChargeGetPayload<object>,
  person?: PersonRef,
): HostelChargeDto {
  return {
    id: c.id,
    institutionId: c.institutionId,
    allocationId: c.allocationId,
    studentId: c.studentId,
    employeeId: c.employeeId,
    occupantName: person?.name ?? '—',
    period: c.period,
    rentAmount: num(c.rentAmount),
    messAmount: num(c.messAmount),
    amount: num(c.amount),
    status: c.status,
    externalRef: c.externalRef,
  };
}

export const hostelChargeService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelChargeWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.period && { period: query.period }),
      ...(query.status && { status: query.status }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.hostelId && { allocation: { hostelId: query.hostelId } }),
    };
    const [rows, total] = await Promise.all([
      db().hostelCharge.findMany({
        where,
        orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
        ...toPageWindow(query),
      }),
      db().hostelCharge.count({ where }),
    ]);
    const person = await peopleFor(rows);
    return { items: rows.map((r) => toChargeDto(r, person(r))), total };
  },

  /** One charge (rent + mess) per allocation active during the period; posts via charges-hook. */
  async generate(input: GenerateHostelChargesInput) {
    const access = await accessFor(currentPrincipal(), ALLOCATE);
    const scope = access.all ? {} : { institutionId: { in: [...access.institutionIds] } };
    if (input.institutionId) await authorizeRow({ institutionId: input.institutionId }, ALLOCATE);
    const { start, end } = periodBounds(input.period);
    const allocations = await db().hostelAllocation.findMany({
      where: {
        ...scope,
        ...(input.institutionId && { institutionId: input.institutionId }),
        fromDate: { lte: end },
        OR: [{ toDate: null }, { toDate: { gte: start } }],
      },
      include: {
        hostel: { select: { code: true } },
        room: { select: { roomNo: true } },
        messPlan: { select: { monthlyFee: true } },
      },
    });
    const existing = new Set(
      (
        await db().hostelCharge.findMany({
          where: { period: input.period, allocationId: { in: allocations.map((a) => a.id) } },
          select: { allocationId: true },
        })
      ).map((c) => c.allocationId),
    );
    let created = 0;
    let posted = 0;
    for (const a of allocations) {
      if (existing.has(a.id)) continue;
      const amounts = monthlyHostelCharge(
        num(a.monthlyRent),
        a.messPlan ? num(a.messPlan.monthlyFee) : 0,
      );
      if (amounts.amount <= 0) continue;
      const charge = await db().hostelCharge.create({
        data: withTenant({
          institutionId: a.institutionId,
          groupId: a.groupId,
          allocationId: a.id,
          studentId: a.studentId,
          employeeId: a.employeeId,
          period: input.period,
          ...amounts,
        }),
      });
      created += 1;
      const ref = await postExternalCharge({
        source: 'hostel',
        sourceChargeId: charge.id,
        studentId: a.studentId,
        employeeId: a.employeeId,
        institutionId: a.institutionId,
        period: input.period,
        amount: amounts.amount,
        description: `Hostel fee ${input.period} (${a.hostel.code} room ${a.room.roomNo})`,
      });
      if (ref) {
        await db().hostelCharge.update({
          where: { id: charge.id },
          data: { status: 'POSTED', externalRef: ref },
        });
        posted += 1;
      }
    }
    await audit.record({
      action: 'hostel_charge.generated',
      entityType: 'hostel_charge',
      entityId: input.institutionId ?? null,
      after: { period: input.period, created, posted, skipped: existing.size },
    });
    return { period: input.period, created, posted, skipped: existing.size };
  },

  async update(id: string, input: UpdateHostelChargeInput) {
    const before = await assertVisible(
      await db().hostelCharge.findFirst({ where: { id } }),
      HOSTEL_VIEW,
      'Charge',
    );
    await authorizeRow(before, ALLOCATE);
    const c = await db().hostelCharge.update({ where: { id }, data: { status: input.status } });
    await audit.record({
      action: 'hostel_charge.updated',
      entityType: 'hostel_charge',
      entityId: id,
      before: { status: before.status },
      after: { status: c.status },
    });
    return toChargeDto(c, (await peopleFor([c]))(c));
  },
};
