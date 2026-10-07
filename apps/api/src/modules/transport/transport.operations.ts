import type { Prisma } from '@prisma/client';
import type {
  BroadcastRouteInput,
  CreateTransportIncidentInput,
  CreateTransportTripInput,
  CreateVehicleFuelLogInput,
  CreateVehicleMaintenanceInput,
  RecordBoardingInput,
  TransportBoardingRowDto,
  TransportDashboardDto,
  TransportIncidentDto,
  TransportListQuery,
  TransportReportDto,
  TransportReportQuery,
  TransportTripDto,
  TransportTripStatus,
  UpdateTransportIncidentInput,
  UpdateTransportTripInput,
  VehicleFuelLogDto,
  VehicleMaintenanceDto,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { currentPrincipal, findScopeHolders } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, InvalidReferenceError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { publish } from '../../core/notifications';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  assertVisible,
  authorizeRow,
  dateStr,
  dateStrOrNull,
  familyUserIds,
  institutionScope,
  isoOrNull,
  num,
  resolveInstitution,
  studentRefs,
  employeeRefs,
  toDate,
  today,
} from './transport.common';
import { loadRoute, loadVehicle } from './transport.fleet';
import { canTransitionTrip, dueExpiries, shouldRemind } from './transport.logic';

const db = () => tenantDb();
const VIEW = 'transport.view';
const MANAGE = 'transport.manage';

const dateRange = (from?: string, to?: string) =>
  from || to ? { ...(from && { gte: toDate(from) }), ...(to && { lte: toDate(to) }) } : undefined;

// ---- Trips ----------------------------------------------------------------------------------
const tripInclude = {
  route: { select: { id: true, code: true, name: true } },
  vehicle: { select: { id: true, regNo: true } },
  driver: { select: { id: true, name: true } },
} as const;
type TripRow = Prisma.TransportTripGetPayload<{ include: typeof tripInclude }>;

async function boardingCounts(tripIds: string[]) {
  const map = new Map<string, { boarded: number; absent: number }>();
  if (!tripIds.length) return map;
  const rows = await db().transportBoarding.groupBy({
    by: ['tripId', 'status'],
    where: { tripId: { in: tripIds } },
    _count: { _all: true },
  });
  for (const r of rows) {
    const c = map.get(r.tripId) ?? { boarded: 0, absent: 0 };
    if (r.status === 'BOARDED') c.boarded += r._count._all;
    else c.absent += r._count._all;
    map.set(r.tripId, c);
  }
  return map;
}

function toTripDto(t: TripRow, counts?: { boarded: number; absent: number }): TransportTripDto {
  return {
    id: t.id,
    institutionId: t.institutionId,
    route: t.route,
    vehicle: t.vehicle,
    driver: t.driver,
    tripDate: dateStr(t.tripDate),
    direction: t.direction as TransportTripDto['direction'],
    status: t.status as TransportTripStatus,
    startedAt: isoOrNull(t.startedAt),
    endedAt: isoOrNull(t.endedAt),
    startOdometerKm: t.startOdometerKm,
    endOdometerKm: t.endOdometerKm,
    delayMinutes: t.delayMinutes,
    notes: t.notes,
    boarded: counts?.boarded ?? 0,
    absent: counts?.absent ?? 0,
  };
}

async function loadTrip(id: string, permission = VIEW) {
  return assertVisible(
    await db().transportTrip.findFirst({ where: { id }, include: tripInclude }),
    permission,
    'Trip',
  );
}

async function tripDto(id: string) {
  const t = await db().transportTrip.findFirstOrThrow({ where: { id }, include: tripInclude });
  return toTripDto(t, (await boardingCounts([id])).get(id));
}

export const tripService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportTripWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.routeId && { routeId: query.routeId }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(query.status && { status: query.status }),
      ...(dateRange(query.from, query.to) && { tripDate: dateRange(query.from, query.to) }),
    };
    const [rows, total] = await Promise.all([
      db().transportTrip.findMany({
        where,
        include: tripInclude,
        orderBy: [{ tripDate: 'desc' }, { route: { code: 'asc' } }, { direction: 'desc' }],
        ...toPageWindow(query),
      }),
      db().transportTrip.count({ where }),
    ]);
    const counts = await boardingCounts(rows.map((r) => r.id));
    return { items: rows.map((r) => toTripDto(r, counts.get(r.id))), total };
  },

  async get(id: string) {
    const t = await loadTrip(id);
    return toTripDto(t, (await boardingCounts([id])).get(id));
  },

  async create(input: CreateTransportTripInput) {
    const route = await loadRoute(input.routeId);
    await authorizeRow(route, MANAGE);
    const vehicleId = input.vehicleId ?? route.vehicleId;
    const driverId = input.driverId ?? route.driverId;
    if (vehicleId) {
      const v = await db().transportVehicle.findFirst({
        where: { id: vehicleId, institutionId: route.institutionId },
      });
      if (!v) throw new InvalidReferenceError('vehicleId', 'Vehicle');
    }
    if (driverId) {
      const d = await db().transportStaff.findFirst({
        where: { id: driverId, institutionId: route.institutionId },
      });
      if (!d) throw new InvalidReferenceError('driverId', 'Driver');
    }
    const dup = await db().transportTrip.findFirst({
      where: { routeId: route.id, tripDate: toDate(input.tripDate), direction: input.direction },
      select: { id: true },
    });
    if (dup) throw new ConflictError('A trip already exists for this route, date and direction');
    const t = await db().transportTrip.create({
      data: withTenant({
        institutionId: route.institutionId,
        groupId: route.groupId,
        routeId: route.id,
        vehicleId: vehicleId ?? null,
        driverId: driverId ?? null,
        tripDate: toDate(input.tripDate),
        direction: input.direction,
        notes: input.notes ?? null,
      }),
    });
    const dto = await tripDto(t.id);
    await audit.record({
      action: 'transport_trip.created',
      entityType: 'transport_trip',
      entityId: t.id,
      after: dto,
    });
    return dto;
  },

  async update(id: string, input: UpdateTransportTripInput) {
    const before = await loadTrip(id);
    await authorizeRow(before, MANAGE);
    const from = before.status as TransportTripStatus;
    const to = input.status ?? from;
    if (!canTransitionTrip(from, to)) {
      throw new AppError(409, 'INVALID_TRANSITION', `Cannot move a ${from} trip to ${to}`);
    }
    const now = new Date();
    const startOdo =
      input.startOdometerKm !== undefined ? input.startOdometerKm : before.startOdometerKm;
    const endOdo = input.endOdometerKm !== undefined ? input.endOdometerKm : before.endOdometerKm;
    if (startOdo != null && endOdo != null && endOdo < startOdo) {
      throw new AppError(400, 'VALIDATION_ERROR', 'endOdometerKm must be ≥ startOdometerKm');
    }
    await db().$transaction(async (tx) => {
      await tx.transportTrip.update({
        where: { id },
        data: {
          status: to,
          ...(input.startOdometerKm !== undefined && { startOdometerKm: input.startOdometerKm }),
          ...(input.endOdometerKm !== undefined && { endOdometerKm: input.endOdometerKm }),
          ...(input.delayMinutes !== undefined && { delayMinutes: input.delayMinutes }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
          ...(to === 'IN_PROGRESS' && !before.startedAt && { startedAt: now }),
          ...(to === 'COMPLETED' && {
            endedAt: before.endedAt ?? now,
            startedAt: before.startedAt ?? now,
          }),
        },
      });
      if (to === 'COMPLETED' && endOdo != null && before.vehicle) {
        const v = await tx.transportVehicle.findFirst({ where: { id: before.vehicle.id } });
        if (v && (v.odometerKm ?? 0) < endOdo) {
          await tx.transportVehicle.update({ where: { id: v.id }, data: { odometerKm: endOdo } });
        }
      }
    });
    const dto = await tripDto(id);
    await audit.record({
      action: 'transport_trip.updated',
      entityType: 'transport_trip',
      entityId: id,
      before: toTripDto(before),
      after: dto,
    });
    if (to === 'COMPLETED' && from !== 'COMPLETED') {
      await emit(
        'transport.trip.completed',
        { tripId: id, routeId: before.routeId, boarded: dto.boarded, absent: dto.absent },
        { institutionId: before.institutionId },
      );
    }
    return dto;
  },

  /** Boarding sheet: every allocation active on the trip date for the route. */
  async boarding(id: string): Promise<TransportBoardingRowDto[]> {
    const trip = await loadTrip(id);
    const [allocations, recorded] = await Promise.all([
      db().transportAllocation.findMany({
        where: {
          routeId: trip.routeId,
          effectiveFrom: { lte: trip.tripDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: trip.tripDate } }],
          tripType: { in: ['BOTH', trip.direction] },
        },
        include: { stop: { select: { name: true, sequence: true } } },
      }),
      db().transportBoarding.findMany({ where: { tripId: id } }),
    ]);
    const [students, employees] = await Promise.all([
      studentRefs(allocations.map((a) => a.studentId)),
      employeeRefs(allocations.map((a) => a.employeeId)),
    ]);
    const statusOf = new Map(recorded.map((r) => [r.allocationId, r.status]));
    return allocations
      .sort((a, b) => a.stop.sequence - b.stop.sequence)
      .map((a) => ({
        allocationId: a.id,
        passengerName:
          (a.studentId
            ? students.get(a.studentId)?.name
            : employees.get(a.employeeId ?? '')?.name) ?? '—',
        stopName: a.stop.name,
        status: statusOf.get(a.id) ?? null,
      }));
  },

  async recordBoarding(id: string, input: RecordBoardingInput) {
    const trip = await loadTrip(id);
    await authorizeRow(trip, MANAGE);
    if (trip.status === 'CANCELLED') throw new ConflictError('Trip is cancelled');
    const ids = [...new Set(input.entries.map((e) => e.allocationId))];
    const valid = await db().transportAllocation.count({
      where: { id: { in: ids }, routeId: trip.routeId },
    });
    if (valid !== ids.length) throw new InvalidReferenceError('entries', 'Allocation');
    const now = new Date();
    await db().$transaction(async (tx) => {
      for (const e of input.entries) {
        const existing = await tx.transportBoarding.findFirst({
          where: { tripId: id, allocationId: e.allocationId },
        });
        if (existing) {
          await tx.transportBoarding.update({
            where: { id: existing.id },
            data: { status: e.status, recordedAt: now },
          });
        } else {
          await tx.transportBoarding.create({
            data: withTenant({
              institutionId: trip.institutionId,
              tripId: id,
              allocationId: e.allocationId,
              status: e.status,
              recordedAt: now,
            }),
          });
        }
      }
    });
    await audit.record({
      action: 'transport_trip.boarding_recorded',
      entityType: 'transport_trip',
      entityId: id,
      after: { entries: input.entries.length },
    });
    return this.boarding(id);
  },
};

// ---- Incidents ------------------------------------------------------------------------------
function toIncidentDto(i: Prisma.TransportIncidentGetPayload<object>): TransportIncidentDto {
  return {
    id: i.id,
    institutionId: i.institutionId,
    tripId: i.tripId,
    routeId: i.routeId,
    vehicleId: i.vehicleId,
    occurredAt: i.occurredAt.toISOString(),
    severity: i.severity,
    title: i.title,
    description: i.description,
    status: i.status,
    resolution: i.resolution,
  };
}

export const incidentService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportIncidentWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.routeId && { routeId: query.routeId }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(query.status && { status: query.status }),
      ...(query.search && { title: { contains: query.search } }),
    };
    const [rows, total] = await Promise.all([
      db().transportIncident.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        ...toPageWindow(query),
      }),
      db().transportIncident.count({ where }),
    ]);
    return { items: rows.map(toIncidentDto), total };
  },

  async create(input: CreateTransportIncidentInput) {
    let institutionId = input.institutionId;
    let groupId: string | null = null;
    let routeId = input.routeId ?? null;
    let vehicleId = input.vehicleId ?? null;
    if (input.tripId) {
      const trip = await loadTrip(input.tripId);
      institutionId = trip.institutionId;
      groupId = trip.groupId;
      routeId = routeId ?? trip.routeId;
      vehicleId = vehicleId ?? trip.vehicleId;
    }
    if (routeId) {
      const route = await loadRoute(routeId);
      if (institutionId && route.institutionId !== institutionId) {
        throw new InvalidReferenceError('routeId', 'Route');
      }
      institutionId = route.institutionId;
      groupId = route.groupId;
    }
    if (vehicleId) {
      const v = await loadVehicle(vehicleId);
      if (institutionId && v.institutionId !== institutionId) {
        throw new InvalidReferenceError('vehicleId', 'Vehicle');
      }
      institutionId = v.institutionId;
      groupId = v.groupId;
    }
    if (!institutionId) throw new InvalidReferenceError('institutionId', 'Institution');
    if (!groupId) groupId = (await resolveInstitution(institutionId)).groupId;
    await authorizeRow({ institutionId, groupId }, MANAGE);
    const i = await db().transportIncident.create({
      data: withTenant({
        institutionId,
        groupId,
        tripId: input.tripId ?? null,
        routeId,
        vehicleId,
        occurredAt: new Date(input.occurredAt),
        severity: input.severity,
        title: input.title,
        description: input.description ?? null,
        reportedByUserId: currentPrincipal().userId ?? null,
      }),
    });
    const dto = toIncidentDto(i);
    await audit.record({
      action: 'transport_incident.reported',
      entityType: 'transport_incident',
      entityId: i.id,
      after: dto,
    });
    await emit(
      'transport.incident.reported',
      { incidentId: i.id, severity: i.severity, routeId, vehicleId },
      { institutionId },
    );
    return dto;
  },

  async update(id: string, input: UpdateTransportIncidentInput) {
    const before = await assertVisible(
      await db().transportIncident.findFirst({ where: { id } }),
      VIEW,
      'Incident',
    );
    await authorizeRow(before, MANAGE);
    const i = await db().transportIncident.update({
      where: { id },
      data: {
        ...(input.severity !== undefined && { severity: input.severity }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.resolution !== undefined && { resolution: input.resolution ?? null }),
        ...(input.description !== undefined && { description: input.description ?? null }),
      },
    });
    const dto = toIncidentDto(i);
    await audit.record({
      action: 'transport_incident.updated',
      entityType: 'transport_incident',
      entityId: id,
      before: toIncidentDto(before),
      after: dto,
    });
    return dto;
  },
};

// ---- Fuel & maintenance ---------------------------------------------------------------------
const vehicleRef = { vehicle: { select: { regNo: true } } } as const;

function toFuelDto(
  f: Prisma.TransportFuelLogGetPayload<{ include: typeof vehicleRef }>,
): VehicleFuelLogDto {
  return {
    id: f.id,
    institutionId: f.institutionId,
    vehicleId: f.vehicleId,
    vehicleRegNo: f.vehicle.regNo,
    logDate: dateStr(f.logDate),
    litres: num(f.litres),
    amount: num(f.amount),
    odometerKm: f.odometerKm,
    vendor: f.vendor,
  };
}

function toMaintenanceDto(
  m: Prisma.TransportMaintenanceLogGetPayload<{ include: typeof vehicleRef }>,
): VehicleMaintenanceDto {
  return {
    id: m.id,
    institutionId: m.institutionId,
    vehicleId: m.vehicleId,
    vehicleRegNo: m.vehicle.regNo,
    serviceDate: dateStr(m.serviceDate),
    kind: m.kind,
    description: m.description,
    cost: num(m.cost),
    odometerKm: m.odometerKm,
    vendor: m.vendor,
    nextServiceDate: dateStrOrNull(m.nextServiceDate),
  };
}

export const fuelService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportFuelLogWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(dateRange(query.from, query.to) && { logDate: dateRange(query.from, query.to) }),
    };
    const [rows, total] = await Promise.all([
      db().transportFuelLog.findMany({
        where,
        include: vehicleRef,
        orderBy: { logDate: 'desc' },
        ...toPageWindow(query),
      }),
      db().transportFuelLog.count({ where }),
    ]);
    return { items: rows.map(toFuelDto), total };
  },

  async create(input: CreateVehicleFuelLogInput) {
    const v = await loadVehicle(input.vehicleId);
    await authorizeRow(v, MANAGE);
    const f = await db().$transaction(async (tx) => {
      const row = await tx.transportFuelLog.create({
        data: withTenant({
          institutionId: v.institutionId,
          groupId: v.groupId,
          vehicleId: v.id,
          logDate: toDate(input.logDate),
          litres: input.litres,
          amount: input.amount,
          odometerKm: input.odometerKm ?? null,
          vendor: input.vendor ?? null,
        }),
        include: vehicleRef,
      });
      if (input.odometerKm != null && (v.odometerKm ?? 0) < input.odometerKm) {
        await tx.transportVehicle.update({
          where: { id: v.id },
          data: { odometerKm: input.odometerKm },
        });
      }
      return row;
    });
    const dto = toFuelDto(f);
    await audit.record({
      action: 'transport_fuel_log.created',
      entityType: 'transport_fuel_log',
      entityId: f.id,
      after: dto,
    });
    return dto;
  },

  async remove(id: string) {
    const before = await assertVisible(
      await db().transportFuelLog.findFirst({ where: { id }, include: vehicleRef }),
      VIEW,
      'Fuel log',
    );
    await authorizeRow(before, MANAGE);
    await db().transportFuelLog.delete({ where: { id } });
    await audit.record({
      action: 'transport_fuel_log.deleted',
      entityType: 'transport_fuel_log',
      entityId: id,
      before: toFuelDto(before),
    });
  },
};

export const maintenanceService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportMaintenanceLogWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(dateRange(query.from, query.to) && { serviceDate: dateRange(query.from, query.to) }),
    };
    const [rows, total] = await Promise.all([
      db().transportMaintenanceLog.findMany({
        where,
        include: vehicleRef,
        orderBy: { serviceDate: 'desc' },
        ...toPageWindow(query),
      }),
      db().transportMaintenanceLog.count({ where }),
    ]);
    return { items: rows.map(toMaintenanceDto), total };
  },

  async create(input: CreateVehicleMaintenanceInput) {
    const v = await loadVehicle(input.vehicleId);
    await authorizeRow(v, MANAGE);
    const m = await db().$transaction(async (tx) => {
      const row = await tx.transportMaintenanceLog.create({
        data: withTenant({
          institutionId: v.institutionId,
          groupId: v.groupId,
          vehicleId: v.id,
          serviceDate: toDate(input.serviceDate),
          kind: input.kind,
          description: input.description,
          cost: input.cost,
          odometerKm: input.odometerKm ?? null,
          vendor: input.vendor ?? null,
          nextServiceDate: input.nextServiceDate ? toDate(input.nextServiceDate) : null,
        }),
        include: vehicleRef,
      });
      const data: Prisma.TransportVehicleUpdateInput = {};
      if (input.nextServiceDate) data.nextServiceDate = toDate(input.nextServiceDate);
      if (input.odometerKm != null && (v.odometerKm ?? 0) < input.odometerKm) {
        data.odometerKm = input.odometerKm;
      }
      if (Object.keys(data).length) {
        await tx.transportVehicle.update({ where: { id: v.id }, data });
      }
      return row;
    });
    const dto = toMaintenanceDto(m);
    await audit.record({
      action: 'transport_maintenance.created',
      entityType: 'transport_maintenance',
      entityId: m.id,
      after: dto,
    });
    return dto;
  },

  async remove(id: string) {
    const before = await assertVisible(
      await db().transportMaintenanceLog.findFirst({ where: { id }, include: vehicleRef }),
      VIEW,
      'Maintenance log',
    );
    await authorizeRow(before, MANAGE);
    await db().transportMaintenanceLog.delete({ where: { id } });
    await audit.record({
      action: 'transport_maintenance.deleted',
      entityType: 'transport_maintenance',
      entityId: id,
      before: toMaintenanceDto(before),
    });
  },
};

// ---- Broadcast ------------------------------------------------------------------------------
export async function broadcastToRoute(routeId: string, input: BroadcastRouteInput) {
  const route = await loadRoute(routeId);
  await authorizeRow(route, MANAGE);
  const allocations = await db().transportAllocation.findMany({
    where: {
      routeId,
      status: 'ACTIVE',
      ...(input.direction && { tripType: { in: ['BOTH', input.direction] } }),
    },
    select: { studentId: true, employeeId: true },
  });
  const studentIds = allocations.flatMap((a) => (a.studentId ? [a.studentId] : []));
  const employees = await employeeRefs(allocations.map((a) => a.employeeId));
  const recipients = [
    ...new Set([
      ...(await familyUserIds(studentIds)),
      ...[...employees.values()].flatMap((e) => (e.userId ? [e.userId] : [])),
    ]),
  ];
  const title =
    input.kind === 'DELAY'
      ? `Route ${route.code} running late${input.delayMinutes ? ` (~${input.delayMinutes} min)` : ''}`
      : `Route ${route.code}: ${route.name}`;
  if (recipients.length) {
    await publish('transport.route_broadcast', {
      recipients,
      title,
      body: input.message,
      link: '/portal/transport',
      data: { routeId, kind: input.kind, delayMinutes: input.delayMinutes ?? null },
      institutionId: route.institutionId,
    });
  }
  if (input.kind === 'DELAY' && input.delayMinutes) {
    const trip = await db().transportTrip.findFirst({
      where: {
        routeId,
        tripDate: toDate(today()),
        ...(input.direction && { direction: input.direction }),
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
    });
    if (trip) {
      await db().transportTrip.update({
        where: { id: trip.id },
        data: { delayMinutes: input.delayMinutes },
      });
    }
  }
  await audit.record({
    action: 'transport_route.broadcast',
    entityType: 'transport_route',
    entityId: routeId,
    after: { kind: input.kind, recipients: recipients.length, message: input.message },
  });
  return { recipients: recipients.length };
}

// ---- Dashboard & reports --------------------------------------------------------------------
function vehicleExpiryDates(v: Prisma.TransportVehicleGetPayload<object>) {
  return [
    { kind: 'INSURANCE', label: `${v.regNo} insurance`, date: dateStrOrNull(v.insuranceExpiry) },
    { kind: 'FITNESS', label: `${v.regNo} fitness`, date: dateStrOrNull(v.fitnessExpiry) },
    { kind: 'PERMIT', label: `${v.regNo} permit`, date: dateStrOrNull(v.permitExpiry) },
    { kind: 'POLLUTION', label: `${v.regNo} pollution`, date: dateStrOrNull(v.pollutionExpiry) },
  ];
}

export async function transportDashboard(institutionId?: string): Promise<TransportDashboardDto> {
  const scope = {
    ...(await institutionScope(VIEW)),
    ...(institutionId && { institutionId }),
  };
  const t = today();
  const [vehicles, staff, routes, stops, allocs, tripsToday, openIncidents] = await Promise.all([
    db().transportVehicle.findMany({ where: scope }),
    db().transportStaff.findMany({ where: scope }),
    db().transportRoute.count({ where: scope }),
    db().transportStop.count({ where: scope }),
    db().transportAllocation.groupBy({
      by: ['passengerType'],
      where: { ...scope, status: 'ACTIVE' },
      _count: { _all: true },
    }),
    db().transportTrip.count({ where: { ...scope, tripDate: toDate(t) } }),
    db().transportIncident.count({ where: { ...scope, status: 'OPEN' } }),
  ]);
  const routeVehicles = await db().transportRoute.findMany({
    where: { ...scope, status: 'ACTIVE', vehicleId: { not: null } },
    select: { vehicle: { select: { capacity: true } } },
  });
  const totalSeats = routeVehicles.reduce((s, r) => s + (r.vehicle?.capacity ?? 0), 0);
  const count = (k: string) => allocs.find((a) => a.passengerType === k)?._count._all ?? 0;
  const allocated = count('STUDENT') + count('STAFF');
  const expiring: TransportDashboardDto['expiringDocuments'] = [];
  for (const v of vehicles) {
    for (const e of dueExpiries(vehicleExpiryDates(v), t, 30)) {
      expiring.push({
        vehicleId: v.id,
        staffId: null,
        label: e.label,
        kind: e.kind,
        expiresOn: e.expiresOn,
      });
    }
  }
  for (const s of staff) {
    for (const e of dueExpiries(
      [{ kind: 'LICENCE', label: `${s.name} licence`, date: dateStrOrNull(s.licenceExpiry) }],
      t,
      30,
    )) {
      expiring.push({
        vehicleId: null,
        staffId: s.id,
        label: e.label,
        kind: e.kind,
        expiresOn: e.expiresOn,
      });
    }
  }
  expiring.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const serviceDue = vehicles
    .filter(
      (v) =>
        v.nextServiceDate &&
        dueExpiries([{ kind: 'S', label: '', date: dateStr(v.nextServiceDate) }], t, 14).length,
    )
    .map((v) => ({
      vehicleId: v.id,
      regNo: v.regNo,
      nextServiceDate: dateStr(v.nextServiceDate as Date),
    }))
    .sort((a, b) => a.nextServiceDate.localeCompare(b.nextServiceDate));
  return {
    vehicles: vehicles.length,
    activeVehicles: vehicles.filter((v) => v.status === 'ACTIVE').length,
    drivers: staff.filter((s) => s.role === 'DRIVER').length,
    routes,
    stops,
    allocatedStudents: count('STUDENT'),
    allocatedStaff: count('STAFF'),
    totalSeats,
    seatUtilisationPercent: totalSeats ? Math.round((allocated / totalSeats) * 1000) / 10 : 0,
    tripsToday,
    openIncidents,
    expiringDocuments: expiring.slice(0, 50),
    serviceDue,
  };
}

export async function transportReport(query: TransportReportQuery): Promise<TransportReportDto> {
  const scope = {
    ...(await institutionScope(VIEW)),
    ...(query.institutionId && { institutionId: query.institutionId }),
  };
  const range = dateRange(query.from, query.to);
  const [routes, allocs, vehicles, fuel, maint, trips, charges] = await Promise.all([
    db().transportRoute.findMany({
      where: scope,
      include: { vehicle: { select: { capacity: true } } },
      orderBy: { code: 'asc' },
    }),
    db().transportAllocation.groupBy({
      by: ['routeId'],
      where: { ...scope, status: 'ACTIVE' },
      _count: { _all: true },
      _sum: { fareAmount: true },
    }),
    db().transportVehicle.findMany({ where: scope, orderBy: { regNo: 'asc' } }),
    db().transportFuelLog.groupBy({
      by: ['vehicleId'],
      where: { ...scope, ...(range && { logDate: range }) },
      _sum: { litres: true, amount: true },
    }),
    db().transportMaintenanceLog.groupBy({
      by: ['vehicleId'],
      where: { ...scope, ...(range && { serviceDate: range }) },
      _sum: { cost: true },
    }),
    db().transportTrip.findMany({
      where: { ...scope, status: 'COMPLETED', ...(range && { tripDate: range }) },
      select: { vehicleId: true, startOdometerKm: true, endOdometerKm: true },
    }),
    db().transportCharge.groupBy({
      by: ['period', 'status'],
      where: scope,
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: [{ period: 'desc' }],
    }),
  ]);
  const allocBy = new Map(allocs.map((a) => [a.routeId, a]));
  const fuelBy = new Map(fuel.map((f) => [f.vehicleId, f._sum]));
  const maintBy = new Map(maint.map((m) => [m.vehicleId, m._sum]));
  const tripBy = new Map<string, { trips: number; km: number }>();
  for (const t of trips) {
    if (!t.vehicleId) continue;
    const c = tripBy.get(t.vehicleId) ?? { trips: 0, km: 0 };
    c.trips += 1;
    if (t.startOdometerKm != null && t.endOdometerKm != null) {
      c.km += t.endOdometerKm - t.startOdometerKm;
    }
    tripBy.set(t.vehicleId, c);
  }
  return {
    routes: routes.map((r) => ({
      routeId: r.id,
      code: r.code,
      name: r.name,
      capacity: r.vehicle?.capacity ?? 0,
      allocated: allocBy.get(r.id)?._count._all ?? 0,
      monthlyFare: num(allocBy.get(r.id)?._sum.fareAmount),
    })),
    vehicles: vehicles.map((v) => ({
      vehicleId: v.id,
      regNo: v.regNo,
      fuelLitres: num(fuelBy.get(v.id)?.litres),
      fuelCost: num(fuelBy.get(v.id)?.amount),
      maintenanceCost: num(maintBy.get(v.id)?.cost),
      trips: tripBy.get(v.id)?.trips ?? 0,
      distanceKm: tripBy.get(v.id)?.km ?? 0,
    })),
    charges: charges.map((c) => ({
      period: c.period,
      status: c.status,
      count: c._count._all,
      amount: num(c._sum.amount),
    })),
  };
}

// ---- Recurring reminders --------------------------------------------------------------------
/**
 * Daily: vehicle document / service and driver licence expiries hitting a reminder threshold
 * notify the transport managers of that institution. Returns the number of reminders sent.
 */
export async function runTransportReminders(on = today()): Promise<number> {
  const [vehicles, staff] = await Promise.all([
    db().transportVehicle.findMany({ where: { status: { not: 'INACTIVE' } } }),
    db().transportStaff.findMany({ where: { status: 'ACTIVE' } }),
  ]);
  const byInstitution = new Map<string, { groupId: string | null; lines: string[] }>();
  const add = (institutionId: string, groupId: string | null, line: string) => {
    const e = byInstitution.get(institutionId) ?? { groupId, lines: [] };
    e.lines.push(line);
    byInstitution.set(institutionId, e);
  };
  const describe = (label: string, daysLeft: number, date: string) =>
    daysLeft < 0
      ? `${label} expired on ${date}`
      : daysLeft === 0
        ? `${label} expires today`
        : `${label} expires in ${daysLeft} day(s) (${date})`;
  for (const v of vehicles) {
    const items = dueExpiries(
      [
        ...vehicleExpiryDates(v),
        { kind: 'SERVICE', label: `${v.regNo} service`, date: dateStrOrNull(v.nextServiceDate) },
      ],
      on,
      30,
    );
    for (const e of items) {
      if (shouldRemind(e.daysLeft))
        add(v.institutionId, v.groupId, describe(e.label, e.daysLeft, e.expiresOn));
    }
  }
  for (const s of staff) {
    for (const e of dueExpiries(
      [
        {
          kind: 'LICENCE',
          label: `${s.name} driving licence`,
          date: dateStrOrNull(s.licenceExpiry),
        },
      ],
      on,
      30,
    )) {
      if (shouldRemind(e.daysLeft))
        add(s.institutionId, s.groupId, describe(e.label, e.daysLeft, e.expiresOn));
    }
  }
  let sent = 0;
  for (const [institutionId, { groupId, lines }] of byInstitution) {
    const recipients = await findScopeHolders({
      permission: MANAGE,
      resource: { institutionId, ...(groupId ? { groupId } : {}) },
    });
    if (!recipients.length) continue;
    await publish('transport.expiry_reminder', {
      recipients,
      title: `Transport: ${lines.length} expiry reminder(s)`,
      body: lines.join('\n'),
      link: '/institution/transport/dashboard',
      data: { count: lines.length },
      institutionId,
    });
    sent += 1;
  }
  return sent;
}
