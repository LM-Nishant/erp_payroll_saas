import type { Prisma } from '@prisma/client';
import type {
  CreateTransportAllocationInput,
  EndTransportAllocationInput,
  GenerateTransportChargesInput,
  MyTransportDto,
  TransportAllocationDto,
  TransportChargeDto,
  TransportListQuery,
  UpdateTransportAllocationInput,
  UpdateTransportChargeInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { accessFor, currentPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, InvalidReferenceError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { cancelExternalCharge, postExternalCharge } from './charges-hook';
import {
  assertVisible,
  authorizeRow,
  dateStr,
  dateStrOrNull,
  employeeRefs,
  institutionScope,
  myEmployeeIds,
  myStudentIds,
  num,
  numOrNull,
  periodBounds,
  resolvePerson,
  studentRefs,
  toDate,
  type PersonRef,
} from './transport.common';
import { loadRoute, slabsFor } from './transport.fleet';
import { fareForStop } from './transport.logic';

type Db = ReturnType<typeof tenantDb>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

const db = () => tenantDb();
const VIEW = 'transport.view';
const ALLOCATE = 'transport.allocate';

const allocationInclude = {
  route: { select: { id: true, code: true, name: true } },
  stop: { select: { id: true, name: true, pickupTime: true, dropTime: true } },
} as const;
type AllocationRow = Prisma.TransportAllocationGetPayload<{ include: typeof allocationInclude }>;

async function peopleFor(rows: { studentId: string | null; employeeId: string | null }[]) {
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

function toAllocationDto(a: AllocationRow, person?: PersonRef): TransportAllocationDto {
  return {
    id: a.id,
    institutionId: a.institutionId,
    passengerType: a.passengerType as TransportAllocationDto['passengerType'],
    studentId: a.studentId,
    employeeId: a.employeeId,
    passengerName: person?.name ?? '—',
    passengerCode: person?.code ?? null,
    route: a.route,
    stop: a.stop,
    tripType: a.tripType,
    effectiveFrom: dateStr(a.effectiveFrom),
    effectiveTo: dateStrOrNull(a.effectiveTo),
    status: a.status,
    fareAmount: num(a.fareAmount),
    notes: a.notes,
  };
}

async function allocationDto(id: string) {
  const a = await db().transportAllocation.findFirstOrThrow({
    where: { id },
    include: allocationInclude,
  });
  return toAllocationDto(a, (await peopleFor([a]))(a));
}

/** Seat check: the route's vehicle must have room for one more active passenger. */
async function assertSeat(tx: Tx, routeId: string, excludeAllocationId?: string) {
  const route = await tx.transportRoute.findFirstOrThrow({
    where: { id: routeId },
    include: { vehicle: { select: { capacity: true, regNo: true } } },
  });
  if (!route.vehicle) return;
  const used = await tx.transportAllocation.count({
    where: {
      routeId,
      status: 'ACTIVE',
      ...(excludeAllocationId && { id: { not: excludeAllocationId } }),
    },
  });
  if (used >= route.vehicle.capacity) {
    throw new AppError(
      409,
      'CAPACITY_EXCEEDED',
      `Route ${route.code} is full (${route.vehicle.regNo}: ${route.vehicle.capacity} seats)`,
    );
  }
}

async function resolveStop(routeId: string, stopId: string) {
  const stop = await db().transportStop.findFirst({ where: { id: stopId, routeId } });
  if (!stop) throw new InvalidReferenceError('stopId', 'Stop');
  return stop;
}

async function loadAllocation(id: string, permission = VIEW) {
  return assertVisible(
    await db().transportAllocation.findFirst({ where: { id }, include: allocationInclude }),
    permission,
    'Allocation',
  );
}

async function passengerIdsMatching(search: string) {
  const [students, employees] = await Promise.all([
    db().student.findMany({
      where: {
        OR: [{ displayName: { contains: search } }, { admissionNo: { contains: search } }],
      },
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
  return { studentIds: students.map((s) => s.id), employeeIds: employees.map((e) => e.id) };
}

export const allocationService = {
  async list(query: TransportListQuery) {
    let searchWhere: Prisma.TransportAllocationWhereInput = {};
    if (query.search) {
      const m = await passengerIdsMatching(query.search);
      searchWhere = {
        OR: [{ studentId: { in: m.studentIds } }, { employeeId: { in: m.employeeIds } }],
      };
    }
    const where: Prisma.TransportAllocationWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.routeId && { routeId: query.routeId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.passengerType && { passengerType: query.passengerType }),
      ...(query.status && { status: query.status }),
      ...searchWhere,
    };
    const [rows, total] = await Promise.all([
      db().transportAllocation.findMany({
        where,
        include: allocationInclude,
        orderBy: [{ route: { code: 'asc' } }, { createdAt: 'asc' }],
        ...toPageWindow(query),
      }),
      db().transportAllocation.count({ where }),
    ]);
    const person = await peopleFor(rows);
    return { items: rows.map((r) => toAllocationDto(r, person(r))), total };
  },

  async get(id: string) {
    const a = await loadAllocation(id);
    return toAllocationDto(a, (await peopleFor([a]))(a));
  },

  async create(input: CreateTransportAllocationInput) {
    const route = await loadRoute(input.routeId);
    await authorizeRow(route, ALLOCATE);
    if (route.status !== 'ACTIVE') throw new ConflictError('Route is inactive');
    const stop = await resolveStop(route.id, input.stopId);
    const isStudent = input.passengerType === 'STUDENT';
    const personId = (isStudent ? input.studentId : input.employeeId) as string;
    await resolvePerson(input.passengerType, personId, route.institutionId);
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new AppError(400, 'VALIDATION_ERROR', 'effectiveTo must be on/after effectiveFrom');
    }
    const fare =
      input.fareAmount ??
      fareForStop(
        { fareAmount: numOrNull(stop.fareAmount), distanceKm: numOrNull(stop.distanceKm) },
        await slabsFor(route.institutionId),
      ) ??
      0;
    const created = await db().$transaction(async (tx) => {
      const existing = await tx.transportAllocation.findFirst({
        where: {
          status: 'ACTIVE',
          ...(isStudent ? { studentId: personId } : { employeeId: personId }),
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('Passenger already has an active transport allocation', {
          allocationId: existing.id,
        });
      }
      await assertSeat(tx, route.id);
      return tx.transportAllocation.create({
        data: withTenant({
          institutionId: route.institutionId,
          groupId: route.groupId,
          passengerType: input.passengerType,
          studentId: isStudent ? personId : null,
          employeeId: isStudent ? null : personId,
          routeId: route.id,
          stopId: stop.id,
          tripType: input.tripType,
          effectiveFrom: toDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          fareAmount: fare,
          notes: input.notes ?? null,
        }),
      });
    });
    const dto = await allocationDto(created.id);
    await audit.record({
      action: 'transport_allocation.created',
      entityType: 'transport_allocation',
      entityId: created.id,
      after: dto,
    });
    await emit(
      'transport.allocation.created',
      { allocationId: created.id, routeId: route.id, studentId: dto.studentId },
      { institutionId: route.institutionId },
    );
    return dto;
  },

  async update(id: string, input: UpdateTransportAllocationInput) {
    const before = await loadAllocation(id);
    await authorizeRow(before, ALLOCATE);
    if (before.status !== 'ACTIVE') throw new ConflictError('Allocation has ended');
    const routeId = input.routeId ?? before.routeId;
    if (input.routeId && input.routeId !== before.routeId) {
      const route = await loadRoute(input.routeId);
      await authorizeRow(route, ALLOCATE);
      if (route.institutionId !== before.institutionId) {
        throw new InvalidReferenceError('routeId', 'Route');
      }
    }
    const stopId = input.stopId ?? (routeId === before.routeId ? before.stopId : undefined);
    if (!stopId) throw new InvalidReferenceError('stopId', 'Stop');
    const stop = await resolveStop(routeId, stopId);
    let fare: number | undefined;
    if (input.fareAmount !== undefined) {
      fare = input.fareAmount ?? undefined;
    } else if (stop.id !== before.stopId) {
      fare =
        fareForStop(
          { fareAmount: numOrNull(stop.fareAmount), distanceKm: numOrNull(stop.distanceKm) },
          await slabsFor(before.institutionId),
        ) ?? num(before.fareAmount);
    }
    await db().$transaction(async (tx) => {
      if (routeId !== before.routeId) await assertSeat(tx, routeId, id);
      await tx.transportAllocation.update({
        where: { id },
        data: {
          routeId,
          stopId: stop.id,
          ...(input.tripType !== undefined && { tripType: input.tripType }),
          ...(input.effectiveTo !== undefined && {
            effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          }),
          ...(fare !== undefined && { fareAmount: fare }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
        },
      });
    });
    const person = (await peopleFor([before]))(before);
    const dto = await allocationDto(id);
    await audit.record({
      action: 'transport_allocation.updated',
      entityType: 'transport_allocation',
      entityId: id,
      before: toAllocationDto(before, person),
      after: dto,
    });
    return dto;
  },

  async end(id: string, input: EndTransportAllocationInput) {
    const before = await loadAllocation(id);
    await authorizeRow(before, ALLOCATE);
    if (before.status !== 'ACTIVE') throw new ConflictError('Allocation has already ended');
    if (input.effectiveTo < dateStr(before.effectiveFrom)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'effectiveTo must be on/after effectiveFrom');
    }
    await db().transportAllocation.update({
      where: { id },
      data: {
        status: 'ENDED',
        effectiveTo: toDate(input.effectiveTo),
        ...(input.notes !== undefined && { notes: input.notes ?? null }),
      },
    });
    const dto = await allocationDto(id);
    await audit.record({
      action: 'transport_allocation.ended',
      entityType: 'transport_allocation',
      entityId: id,
      before: { status: before.status, effectiveTo: dateStrOrNull(before.effectiveTo) },
      after: { status: dto.status, effectiveTo: dto.effectiveTo },
    });
    await emit(
      'transport.allocation.ended',
      { allocationId: id, routeId: before.routeId, studentId: before.studentId },
      { institutionId: before.institutionId },
    );
    return dto;
  },

  /** Portal "My transport": the student's own allocation, wards' allocations, own staff seat. */
  async mine(): Promise<MyTransportDto[]> {
    const [studentIds, employeeIds] = await Promise.all([myStudentIds(), myEmployeeIds()]);
    if (!studentIds.length && !employeeIds.length) return [];
    const [students, employees, allocations] = await Promise.all([
      studentRefs(studentIds),
      employeeRefs(employeeIds),
      db().transportAllocation.findMany({
        where: {
          status: 'ACTIVE',
          OR: [{ studentId: { in: studentIds } }, { employeeId: { in: employeeIds } }],
        },
        include: {
          ...allocationInclude,
          route: {
            include: {
              vehicle: true,
              driver: true,
              attendant: true,
              stops: { where: { deletedAt: null }, orderBy: { sequence: 'asc' } },
            },
          },
        },
      }),
    ]);
    const out: MyTransportDto[] = [];
    const people: { kind: 'STUDENT' | 'STAFF'; ref: PersonRef }[] = [
      ...[...students.values()].map((ref) => ({ kind: 'STUDENT' as const, ref })),
      ...[...employees.values()].map((ref) => ({ kind: 'STAFF' as const, ref })),
    ];
    for (const { kind, ref } of people) {
      const a = allocations.find((x) =>
        kind === 'STUDENT' ? x.studentId === ref.id : x.employeeId === ref.id,
      );
      if (!a && kind === 'STAFF') continue;
      const trips = a
        ? await db().transportTrip.findMany({
            where: { routeId: a.routeId },
            orderBy: [{ tripDate: 'desc' }, { direction: 'asc' }],
            take: 6,
            include: { boardings: { where: { allocationId: a.id }, select: { status: true } } },
          })
        : [];
      const r = a?.route;
      out.push({
        studentId: kind === 'STUDENT' ? ref.id : null,
        employeeId: kind === 'STAFF' ? ref.id : null,
        passengerName: ref.name,
        allocation: a
          ? toAllocationDto(
              {
                ...a,
                route: { id: a.route.id, code: a.route.code, name: a.route.name },
              } as AllocationRow,
              ref,
            )
          : null,
        route: r
          ? {
              code: r.code,
              name: r.name,
              stops: r.stops.map((s) => ({
                name: s.name,
                sequence: s.sequence,
                pickupTime: s.pickupTime,
                dropTime: s.dropTime,
              })),
            }
          : null,
        vehicle: r?.vehicle
          ? {
              regNo: r.vehicle.regNo,
              vehicleType: r.vehicle.vehicleType,
              capacity: r.vehicle.capacity,
            }
          : null,
        driver: r?.driver ? { name: r.driver.name, phone: r.driver.phone } : null,
        attendant: r?.attendant ? { name: r.attendant.name, phone: r.attendant.phone } : null,
        latestTrips: trips.map((t) => ({
          tripDate: dateStr(t.tripDate),
          direction: t.direction,
          status: t.status,
          delayMinutes: t.delayMinutes,
          boarding: t.boardings[0]?.status ?? null,
        })),
      });
    }
    return out;
  },
};

// ---- Charges --------------------------------------------------------------------------------
const chargeInclude = {
  allocation: { select: { route: { select: { code: true } } } },
} as const;
type ChargeRow = Prisma.TransportChargeGetPayload<{ include: typeof chargeInclude }>;

function toChargeDto(c: ChargeRow, person?: PersonRef): TransportChargeDto {
  return {
    id: c.id,
    institutionId: c.institutionId,
    allocationId: c.allocationId,
    studentId: c.studentId,
    employeeId: c.employeeId,
    passengerName: person?.name ?? '—',
    period: c.period,
    amount: num(c.amount),
    status: c.status,
    externalRef: c.externalRef,
  };
}

export const transportChargeService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportChargeWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.period && { period: query.period }),
      ...(query.status && { status: query.status }),
      ...(query.studentId && { studentId: query.studentId }),
    };
    const [rows, total] = await Promise.all([
      db().transportCharge.findMany({
        where,
        include: chargeInclude,
        orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
        ...toPageWindow(query),
      }),
      db().transportCharge.count({ where }),
    ]);
    const person = await peopleFor(rows);
    return { items: rows.map((r) => toChargeDto(r, person(r))), total };
  },

  /**
   * Create one charge per allocation active during `period` (idempotent per allocation+period)
   * and post student charges to the fees module when a poster is registered (charges-hook.ts).
   */
  async generate(input: GenerateTransportChargesInput) {
    const access = await accessFor(currentPrincipal(), ALLOCATE);
    const scope = access.all ? {} : { institutionId: { in: [...access.institutionIds] } };
    if (input.institutionId) {
      await authorizeRow({ institutionId: input.institutionId }, ALLOCATE);
    }
    const { start, end } = periodBounds(input.period);
    const allocations = await db().transportAllocation.findMany({
      where: {
        ...scope,
        ...(input.institutionId && { institutionId: input.institutionId }),
        effectiveFrom: { lte: end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
        fareAmount: { gt: 0 },
      },
      include: { route: { select: { code: true } } },
    });
    const existing = new Set(
      (
        await db().transportCharge.findMany({
          where: { period: input.period, allocationId: { in: allocations.map((a) => a.id) } },
          select: { allocationId: true },
        })
      ).map((c) => c.allocationId),
    );
    let created = 0;
    let posted = 0;
    for (const a of allocations) {
      if (existing.has(a.id)) continue;
      const charge = await db().transportCharge.create({
        data: withTenant({
          institutionId: a.institutionId,
          groupId: a.groupId,
          allocationId: a.id,
          studentId: a.studentId,
          employeeId: a.employeeId,
          period: input.period,
          amount: a.fareAmount,
        }),
      });
      created += 1;
      const ref = await postExternalCharge({
        source: 'transport',
        sourceChargeId: charge.id,
        studentId: a.studentId,
        employeeId: a.employeeId,
        institutionId: a.institutionId,
        period: input.period,
        amount: num(a.fareAmount),
        description: `Transport fee ${input.period} (route ${a.route.code})`,
      });
      if (ref) {
        await db().transportCharge.update({
          where: { id: charge.id },
          data: { status: 'POSTED', externalRef: ref },
        });
        posted += 1;
      }
    }
    await audit.record({
      action: 'transport_charge.generated',
      entityType: 'transport_charge',
      entityId: input.institutionId ?? null,
      after: { period: input.period, created, posted, skipped: existing.size },
    });
    return { period: input.period, created, posted, skipped: existing.size };
  },

  async update(id: string, input: UpdateTransportChargeInput) {
    const before = await assertVisible(
      await db().transportCharge.findFirst({ where: { id }, include: chargeInclude }),
      VIEW,
      'Charge',
    );
    await authorizeRow(before, ALLOCATE);
    if (input.status === 'WAIVED' && before.status === 'POSTED' && before.studentId) {
      await cancelExternalCharge({
        source: 'transport',
        sourceChargeId: before.id,
        studentId: before.studentId,
        reason: `Transport charge ${before.period} waived`,
      });
    }
    const c = await db().transportCharge.update({
      where: { id },
      data: { status: input.status },
      include: chargeInclude,
    });
    await audit.record({
      action: 'transport_charge.updated',
      entityType: 'transport_charge',
      entityId: id,
      before: { status: before.status },
      after: { status: c.status },
    });
    return toChargeDto(c, (await peopleFor([c]))(c));
  },
};
