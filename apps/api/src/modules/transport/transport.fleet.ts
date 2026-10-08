import type { Prisma } from '@prisma/client';
import type {
  CreateTransportFareSlabInput,
  CreateTransportRouteInput,
  CreateTransportStaffInput,
  CreateTransportStopInput,
  CreateVehicleInput,
  TransportFareSlabDto,
  TransportListQuery,
  TransportRouteDto,
  TransportStaffDto,
  TransportStopDto,
  UpdateTransportFareSlabInput,
  UpdateTransportRouteInput,
  UpdateTransportStaffInput,
  UpdateTransportStopInput,
  UpdateVehicleInput,
  VehicleDto,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { isUniqueViolation } from '../../core/db/helpers';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  assertVisible,
  authorizeRow,
  dateStrOrNull,
  institutionScope,
  num,
  numOrNull,
  resolveInstitution,
  resolvePerson,
  toDateOrNull,
} from './transport.common';
import { fareForStop, type FareSlabLike } from './transport.logic';

const db = () => tenantDb();
const VIEW = 'transport.view';
const MANAGE = 'transport.manage';

// ---- Mappers --------------------------------------------------------------------------------
type VehicleRow = Prisma.TransportVehicleGetPayload<object>;
export function toVehicleDto(v: VehicleRow): VehicleDto {
  return {
    id: v.id,
    institutionId: v.institutionId,
    regNo: v.regNo,
    vehicleType: v.vehicleType,
    make: v.make,
    capacity: v.capacity,
    gpsDeviceId: v.gpsDeviceId,
    insuranceExpiry: dateStrOrNull(v.insuranceExpiry),
    fitnessExpiry: dateStrOrNull(v.fitnessExpiry),
    permitExpiry: dateStrOrNull(v.permitExpiry),
    pollutionExpiry: dateStrOrNull(v.pollutionExpiry),
    nextServiceDate: dateStrOrNull(v.nextServiceDate),
    odometerKm: v.odometerKm,
    status: v.status,
    notes: v.notes,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

const staffInclude = { vehicle: { select: { regNo: true } } } as const;
type StaffRow = Prisma.TransportStaffGetPayload<{ include: typeof staffInclude }>;
export function toStaffDto(s: StaffRow): TransportStaffDto {
  return {
    id: s.id,
    institutionId: s.institutionId,
    employeeId: s.employeeId,
    role: s.role as TransportStaffDto['role'],
    name: s.name,
    phone: s.phone,
    licenceNo: s.licenceNo,
    licenceExpiry: dateStrOrNull(s.licenceExpiry),
    vehicleId: s.vehicleId,
    vehicleRegNo: s.vehicle?.regNo ?? null,
    status: s.status,
  };
}

type StopRow = Prisma.TransportStopGetPayload<object>;
export function toStopDto(s: StopRow, slabs: FareSlabLike[]): TransportStopDto {
  const fareAmount = numOrNull(s.fareAmount);
  const distanceKm = numOrNull(s.distanceKm);
  return {
    id: s.id,
    routeId: s.routeId,
    sequence: s.sequence,
    name: s.name,
    pickupTime: s.pickupTime,
    dropTime: s.dropTime,
    latitude: numOrNull(s.latitude),
    longitude: numOrNull(s.longitude),
    distanceKm,
    fareAmount,
    effectiveFare: fareForStop({ fareAmount, distanceKm }, slabs),
  };
}

const routeInclude = {
  vehicle: { select: { id: true, regNo: true, capacity: true } },
  driver: { select: { id: true, name: true, phone: true } },
  attendant: { select: { id: true, name: true, phone: true } },
  _count: { select: { stops: { where: { deletedAt: null } } } },
} as const;
type RouteRow = Prisma.TransportRouteGetPayload<{ include: typeof routeInclude }>;
function toRouteDto(r: RouteRow, activeAllocations: number): TransportRouteDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    code: r.code,
    name: r.name,
    vehicle: r.vehicle,
    driver: r.driver,
    attendant: r.attendant,
    distanceKm: numOrNull(r.distanceKm),
    status: r.status,
    notes: r.notes,
    stopCount: r._count.stops,
    activeAllocations,
  };
}

function toSlabDto(s: Prisma.TransportFareSlabGetPayload<object>): TransportFareSlabDto {
  return {
    id: s.id,
    institutionId: s.institutionId,
    name: s.name,
    minKm: num(s.minKm),
    maxKm: num(s.maxKm),
    amount: num(s.amount),
    frequency: s.frequency,
  };
}

// ---- Shared lookups -------------------------------------------------------------------------
export async function slabsFor(institutionId: string): Promise<FareSlabLike[]> {
  const rows = await db().transportFareSlab.findMany({ where: { institutionId } });
  return rows.map((s) => ({ minKm: num(s.minKm), maxKm: num(s.maxKm), amount: num(s.amount) }));
}

/** Active allocations per route (ACTIVE status = currently holding a seat). */
export async function activeAllocationCounts(routeIds: string[]): Promise<Map<string, number>> {
  if (!routeIds.length) return new Map();
  const rows = await db().transportAllocation.groupBy({
    by: ['routeId'],
    where: { routeId: { in: routeIds }, status: 'ACTIVE' },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.routeId, r._count._all]));
}

export async function loadVehicle(id: string, permission = VIEW) {
  return assertVisible(
    await db().transportVehicle.findFirst({ where: { id } }),
    permission,
    'Vehicle',
  );
}

export async function loadRoute(id: string, permission = VIEW) {
  return assertVisible(await db().transportRoute.findFirst({ where: { id } }), permission, 'Route');
}

async function sameInstitutionVehicle(id: string | null | undefined, institutionId: string) {
  if (!id) return null;
  const v = await db().transportVehicle.findFirst({ where: { id, institutionId } });
  if (!v) throw new InvalidReferenceError('vehicleId', 'Vehicle');
  return v;
}

async function sameInstitutionStaff(
  id: string | null | undefined,
  institutionId: string,
  field: string,
  role?: string,
) {
  if (!id) return null;
  const s = await db().transportStaff.findFirst({
    where: { id, institutionId, ...(role ? { role } : {}) },
  });
  if (!s) throw new InvalidReferenceError(field, role === 'DRIVER' ? 'Driver' : 'Transport staff');
  return s;
}

function capacityExceeded(capacity: number, allocated: number): never {
  throw new AppError(
    409,
    'CAPACITY_EXCEEDED',
    `Vehicle capacity ${capacity} is below the ${allocated} passengers allocated to the route`,
  );
}

// ---- Vehicles -------------------------------------------------------------------------------
function vehicleData(input: Partial<CreateVehicleInput>) {
  return {
    ...(input.regNo !== undefined && { regNo: input.regNo }),
    ...(input.vehicleType !== undefined && { vehicleType: input.vehicleType }),
    ...(input.make !== undefined && { make: input.make ?? null }),
    ...(input.capacity !== undefined && { capacity: input.capacity }),
    ...(input.gpsDeviceId !== undefined && { gpsDeviceId: input.gpsDeviceId ?? null }),
    ...(input.insuranceExpiry !== undefined && {
      insuranceExpiry: toDateOrNull(input.insuranceExpiry),
    }),
    ...(input.fitnessExpiry !== undefined && { fitnessExpiry: toDateOrNull(input.fitnessExpiry) }),
    ...(input.permitExpiry !== undefined && { permitExpiry: toDateOrNull(input.permitExpiry) }),
    ...(input.pollutionExpiry !== undefined && {
      pollutionExpiry: toDateOrNull(input.pollutionExpiry),
    }),
    ...(input.nextServiceDate !== undefined && {
      nextServiceDate: toDateOrNull(input.nextServiceDate),
    }),
    ...(input.odometerKm !== undefined && { odometerKm: input.odometerKm ?? null }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.notes !== undefined && { notes: input.notes ?? null }),
  };
}

export const vehicleService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportVehicleWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.status && { status: query.status }),
      ...(query.search && { regNo: { contains: query.search } }),
    };
    const [rows, total] = await Promise.all([
      db().transportVehicle.findMany({
        where,
        orderBy: { regNo: 'asc' },
        ...toPageWindow(query),
      }),
      db().transportVehicle.count({ where }),
    ]);
    return { items: rows.map(toVehicleDto), total };
  },

  async get(id: string) {
    return toVehicleDto(await loadVehicle(id));
  },

  async create(input: CreateVehicleInput) {
    const inst = await resolveInstitution(input.institutionId);
    await authorizeRow({ institutionId: inst.id, groupId: inst.groupId }, MANAGE);
    try {
      const v = await db().transportVehicle.create({
        data: withTenant({
          institutionId: inst.id,
          groupId: inst.groupId,
          ...vehicleData(input),
          regNo: input.regNo,
          capacity: input.capacity,
        }),
      });
      await audit.record({
        action: 'transport_vehicle.created',
        entityType: 'transport_vehicle',
        entityId: v.id,
        after: toVehicleDto(v),
      });
      await emit('transport.vehicle.created', { vehicleId: v.id }, { institutionId: inst.id });
      return toVehicleDto(v);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A vehicle with this reg. no. exists');
      throw err;
    }
  },

  async update(id: string, input: UpdateVehicleInput) {
    const before = await loadVehicle(id);
    await authorizeRow(before, MANAGE);
    if (input.capacity !== undefined && input.capacity < before.capacity) {
      const routes = await db().transportRoute.findMany({
        where: { vehicleId: id },
        select: { id: true },
      });
      const counts = await activeAllocationCounts(routes.map((r) => r.id));
      const max = Math.max(0, ...counts.values());
      if (max > input.capacity) capacityExceeded(input.capacity, max);
    }
    try {
      const v = await db().transportVehicle.update({ where: { id }, data: vehicleData(input) });
      await audit.record({
        action: 'transport_vehicle.updated',
        entityType: 'transport_vehicle',
        entityId: id,
        before: toVehicleDto(before),
        after: toVehicleDto(v),
      });
      return toVehicleDto(v);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A vehicle with this reg. no. exists');
      throw err;
    }
  },

  async remove(id: string) {
    const before = await loadVehicle(id);
    await authorizeRow(before, MANAGE);
    const used = await db().transportRoute.count({ where: { vehicleId: id } });
    if (used) throw new ConflictError('Vehicle is assigned to routes; reassign them first');
    await db().$transaction(async (tx) => {
      await tx.transportStaff.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } });
      await tx.transportVehicle.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });
    });
    await audit.record({
      action: 'transport_vehicle.deleted',
      entityType: 'transport_vehicle',
      entityId: id,
      before: toVehicleDto(before),
    });
  },
};

// ---- Drivers / conductors / attendants ------------------------------------------------------
export const transportStaffService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportStaffWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.role && { role: query.role }),
      ...(query.status && { status: query.status }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(query.search && { name: { contains: query.search } }),
    };
    const [rows, total] = await Promise.all([
      db().transportStaff.findMany({
        where,
        include: staffInclude,
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        ...toPageWindow(query),
      }),
      db().transportStaff.count({ where }),
    ]);
    return { items: rows.map(toStaffDto), total };
  },

  async load(id: string, permission = VIEW) {
    return assertVisible(
      await db().transportStaff.findFirst({ where: { id }, include: staffInclude }),
      permission,
      'Transport staff',
    );
  },

  async get(id: string) {
    return toStaffDto(await this.load(id));
  },

  async create(input: CreateTransportStaffInput) {
    const inst = await resolveInstitution(input.institutionId);
    await authorizeRow({ institutionId: inst.id, groupId: inst.groupId }, MANAGE);
    if (input.employeeId) await resolvePerson('STAFF', input.employeeId);
    await sameInstitutionVehicle(input.vehicleId, inst.id);
    const s = await db().transportStaff.create({
      data: withTenant({
        institutionId: inst.id,
        groupId: inst.groupId,
        employeeId: input.employeeId ?? null,
        role: input.role,
        name: input.name,
        phone: input.phone ?? null,
        licenceNo: input.licenceNo ?? null,
        licenceExpiry: toDateOrNull(input.licenceExpiry) ?? null,
        vehicleId: input.vehicleId ?? null,
        status: input.status,
      }),
      include: staffInclude,
    });
    await audit.record({
      action: 'transport_staff.created',
      entityType: 'transport_staff',
      entityId: s.id,
      after: toStaffDto(s),
    });
    return toStaffDto(s);
  },

  async update(id: string, input: UpdateTransportStaffInput) {
    const before = await this.load(id);
    await authorizeRow(before, MANAGE);
    if (input.employeeId) await resolvePerson('STAFF', input.employeeId);
    await sameInstitutionVehicle(input.vehicleId, before.institutionId);
    const s = await db().transportStaff.update({
      where: { id },
      data: {
        ...(input.employeeId !== undefined && { employeeId: input.employeeId ?? null }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone ?? null }),
        ...(input.licenceNo !== undefined && { licenceNo: input.licenceNo ?? null }),
        ...(input.licenceExpiry !== undefined && {
          licenceExpiry: toDateOrNull(input.licenceExpiry),
        }),
        ...(input.vehicleId !== undefined && { vehicleId: input.vehicleId ?? null }),
        ...(input.status !== undefined && { status: input.status }),
      },
      include: staffInclude,
    });
    await audit.record({
      action: 'transport_staff.updated',
      entityType: 'transport_staff',
      entityId: id,
      before: toStaffDto(before),
      after: toStaffDto(s),
    });
    return toStaffDto(s);
  },

  async remove(id: string) {
    const before = await this.load(id);
    await authorizeRow(before, MANAGE);
    const used = await db().transportRoute.count({
      where: { OR: [{ driverId: id }, { attendantId: id }] },
    });
    if (used) throw new ConflictError('Staff member is assigned to routes; reassign them first');
    await db().transportStaff.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await audit.record({
      action: 'transport_staff.deleted',
      entityType: 'transport_staff',
      entityId: id,
      before: toStaffDto(before),
    });
  },
};

// ---- Routes & stops -------------------------------------------------------------------------
function stopData(input: Partial<CreateTransportStopInput>) {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.sequence !== undefined && { sequence: input.sequence }),
    ...(input.pickupTime !== undefined && { pickupTime: input.pickupTime ?? null }),
    ...(input.dropTime !== undefined && { dropTime: input.dropTime ?? null }),
    ...(input.latitude !== undefined && { latitude: input.latitude ?? null }),
    ...(input.longitude !== undefined && { longitude: input.longitude ?? null }),
    ...(input.distanceKm !== undefined && { distanceKm: input.distanceKm ?? null }),
    ...(input.fareAmount !== undefined && { fareAmount: input.fareAmount ?? null }),
  };
}

async function validateRouteRefs(
  institutionId: string,
  input: Pick<UpdateTransportRouteInput, 'vehicleId' | 'driverId' | 'attendantId'>,
) {
  const vehicle = await sameInstitutionVehicle(input.vehicleId, institutionId);
  await sameInstitutionStaff(input.driverId, institutionId, 'driverId', 'DRIVER');
  await sameInstitutionStaff(input.attendantId, institutionId, 'attendantId');
  return vehicle;
}

async function routeDto(id: string, withStops: boolean): Promise<TransportRouteDto> {
  const r = await db().transportRoute.findFirstOrThrow({ where: { id }, include: routeInclude });
  const counts = await activeAllocationCounts([id]);
  const dto = toRouteDto(r, counts.get(id) ?? 0);
  if (withStops) {
    const [stops, slabs] = await Promise.all([
      db().transportStop.findMany({ where: { routeId: id }, orderBy: { sequence: 'asc' } }),
      slabsFor(r.institutionId),
    ]);
    dto.stops = stops.map((s) => toStopDto(s, slabs));
  }
  return dto;
}

export const routeService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportRouteWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.status && { status: query.status }),
      ...(query.vehicleId && { vehicleId: query.vehicleId }),
      ...(query.search && {
        OR: [{ code: { contains: query.search } }, { name: { contains: query.search } }],
      }),
    };
    const [rows, total] = await Promise.all([
      db().transportRoute.findMany({
        where,
        include: routeInclude,
        orderBy: { code: 'asc' },
        ...toPageWindow(query),
      }),
      db().transportRoute.count({ where }),
    ]);
    const counts = await activeAllocationCounts(rows.map((r) => r.id));
    return { items: rows.map((r) => toRouteDto(r, counts.get(r.id) ?? 0)), total };
  },

  async get(id: string) {
    await loadRoute(id);
    return routeDto(id, true);
  },

  async create(input: CreateTransportRouteInput) {
    const inst = await resolveInstitution(input.institutionId);
    await authorizeRow({ institutionId: inst.id, groupId: inst.groupId }, MANAGE);
    await validateRouteRefs(inst.id, input);
    try {
      const route = await db().$transaction(async (tx) => {
        const r = await tx.transportRoute.create({
          data: withTenant({
            institutionId: inst.id,
            groupId: inst.groupId,
            code: input.code,
            name: input.name,
            vehicleId: input.vehicleId ?? null,
            driverId: input.driverId ?? null,
            attendantId: input.attendantId ?? null,
            distanceKm: input.distanceKm ?? null,
            status: input.status,
            notes: input.notes ?? null,
          }),
        });
        for (const s of input.stops ?? []) {
          await tx.transportStop.create({
            data: withTenant({
              institutionId: inst.id,
              groupId: inst.groupId,
              routeId: r.id,
              ...stopData(s),
              name: s.name,
              sequence: s.sequence,
            }),
          });
        }
        return r;
      });
      const dto = await routeDto(route.id, true);
      await audit.record({
        action: 'transport_route.created',
        entityType: 'transport_route',
        entityId: route.id,
        after: dto,
      });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A route with this code exists');
      throw err;
    }
  },

  async update(id: string, input: UpdateTransportRouteInput) {
    const before = await loadRoute(id);
    await authorizeRow(before, MANAGE);
    const vehicle = await validateRouteRefs(before.institutionId, input);
    if (vehicle) {
      const allocated = (await activeAllocationCounts([id])).get(id) ?? 0;
      if (allocated > vehicle.capacity) capacityExceeded(vehicle.capacity, allocated);
    }
    const beforeDto = await routeDto(id, false);
    try {
      await db().transportRoute.update({
        where: { id },
        data: {
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.vehicleId !== undefined && { vehicleId: input.vehicleId ?? null }),
          ...(input.driverId !== undefined && { driverId: input.driverId ?? null }),
          ...(input.attendantId !== undefined && { attendantId: input.attendantId ?? null }),
          ...(input.distanceKm !== undefined && { distanceKm: input.distanceKm ?? null }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A route with this code exists');
      throw err;
    }
    const dto = await routeDto(id, true);
    await audit.record({
      action: 'transport_route.updated',
      entityType: 'transport_route',
      entityId: id,
      before: beforeDto,
      after: { ...dto, stops: undefined },
    });
    return dto;
  },

  async remove(id: string) {
    const before = await loadRoute(id);
    await authorizeRow(before, MANAGE);
    const active = (await activeAllocationCounts([id])).get(id) ?? 0;
    if (active) throw new ConflictError('Route has active allocations; end them first');
    const now = new Date();
    await db().$transaction(async (tx) => {
      await tx.transportStop.updateMany({ where: { routeId: id }, data: { deletedAt: now } });
      await tx.transportRoute.update({
        where: { id },
        data: { deletedAt: now, status: 'INACTIVE' },
      });
    });
    await audit.record({
      action: 'transport_route.deleted',
      entityType: 'transport_route',
      entityId: id,
      before: { code: before.code, name: before.name },
    });
  },

  async addStop(routeId: string, input: CreateTransportStopInput) {
    const route = await loadRoute(routeId);
    await authorizeRow(route, MANAGE);
    const stop = await db().transportStop.create({
      data: withTenant({
        institutionId: route.institutionId,
        groupId: route.groupId,
        routeId,
        ...stopData(input),
        name: input.name,
        sequence: input.sequence,
      }),
    });
    const dto = toStopDto(stop, await slabsFor(route.institutionId));
    await audit.record({
      action: 'transport_stop.created',
      entityType: 'transport_stop',
      entityId: stop.id,
      after: dto,
    });
    return dto;
  },

  async loadStop(id: string) {
    const stop = await db().transportStop.findFirst({ where: { id } });
    if (!stop) throw new NotFoundError('Stop');
    await assertVisible(stop, VIEW, 'Stop');
    return stop;
  },

  async updateStop(id: string, input: UpdateTransportStopInput) {
    const before = await this.loadStop(id);
    await authorizeRow(before, MANAGE);
    const stop = await db().transportStop.update({ where: { id }, data: stopData(input) });
    const slabs = await slabsFor(stop.institutionId);
    const dto = toStopDto(stop, slabs);
    await audit.record({
      action: 'transport_stop.updated',
      entityType: 'transport_stop',
      entityId: id,
      before: toStopDto(before, slabs),
      after: dto,
    });
    return dto;
  },

  async removeStop(id: string) {
    const before = await this.loadStop(id);
    await authorizeRow(before, MANAGE);
    const used = await db().transportAllocation.count({ where: { stopId: id, status: 'ACTIVE' } });
    if (used) throw new ConflictError('Stop has active allocations; move them first');
    await db().transportStop.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'transport_stop.deleted',
      entityType: 'transport_stop',
      entityId: id,
      before: { name: before.name, routeId: before.routeId },
    });
  },
};

// ---- Fare slabs -----------------------------------------------------------------------------
export const fareSlabService = {
  async list(query: TransportListQuery) {
    const where: Prisma.TransportFareSlabWhereInput = {
      ...(await institutionScope(VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
    };
    const [rows, total] = await Promise.all([
      db().transportFareSlab.findMany({
        where,
        orderBy: [{ institutionId: 'asc' }, { minKm: 'asc' }],
        ...toPageWindow(query),
      }),
      db().transportFareSlab.count({ where }),
    ]);
    return { items: rows.map(toSlabDto), total };
  },

  async create(input: CreateTransportFareSlabInput) {
    const inst = await resolveInstitution(input.institutionId);
    await authorizeRow({ institutionId: inst.id, groupId: inst.groupId }, MANAGE);
    const s = await db().transportFareSlab.create({
      data: withTenant({
        institutionId: inst.id,
        groupId: inst.groupId,
        name: input.name,
        minKm: input.minKm,
        maxKm: input.maxKm,
        amount: input.amount,
        frequency: input.frequency,
      }),
    });
    await audit.record({
      action: 'transport_fare_slab.created',
      entityType: 'transport_fare_slab',
      entityId: s.id,
      after: toSlabDto(s),
    });
    return toSlabDto(s);
  },

  async update(id: string, input: UpdateTransportFareSlabInput) {
    const before = await assertVisible(
      await db().transportFareSlab.findFirst({ where: { id } }),
      VIEW,
      'Fare slab',
    );
    await authorizeRow(before, MANAGE);
    const minKm = input.minKm ?? num(before.minKm);
    const maxKm = input.maxKm ?? num(before.maxKm);
    if (maxKm <= minKm) {
      throw new AppError(400, 'VALIDATION_ERROR', 'maxKm must exceed minKm');
    }
    const s = await db().transportFareSlab.update({ where: { id }, data: input });
    await audit.record({
      action: 'transport_fare_slab.updated',
      entityType: 'transport_fare_slab',
      entityId: id,
      before: toSlabDto(before),
      after: toSlabDto(s),
    });
    return toSlabDto(s);
  },

  async remove(id: string) {
    const before = await assertVisible(
      await db().transportFareSlab.findFirst({ where: { id } }),
      VIEW,
      'Fare slab',
    );
    await authorizeRow(before, MANAGE);
    await db().transportFareSlab.delete({ where: { id } });
    await audit.record({
      action: 'transport_fare_slab.deleted',
      entityType: 'transport_fare_slab',
      entityId: id,
      before: toSlabDto(before),
    });
  },
};
