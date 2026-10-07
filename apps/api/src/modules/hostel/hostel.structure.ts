import type { Prisma } from '@prisma/client';
import type {
  CreateHostelBlockInput,
  CreateHostelInput,
  CreateHostelRoomInput,
  CreateMessPlanInput,
  HostelBedDto,
  HostelBlockDto,
  HostelDto,
  HostelListQuery,
  HostelMessPlanDto,
  HostelRoomDto,
  HostelType,
  UpdateHostelBedInput,
  UpdateHostelBlockInput,
  UpdateHostelInput,
  UpdateHostelRoomInput,
  UpdateMessPlanInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { isUniqueViolation } from '../../core/db/helpers';
import { ConflictError, InvalidReferenceError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  assertVisible,
  authorizeRow,
  institutionScope,
  num,
  resolveInstitution,
  studentRefs,
  employeeRefs,
} from '../transport/transport.common';
import { newBedLabels } from './hostel.logic';

const db = () => tenantDb();
export const HOSTEL_VIEW = 'hostel.view';
export const HOSTEL_MANAGE = 'hostel.manage';

// ---- Hostels --------------------------------------------------------------------------------
type HostelRow = Prisma.HostelGetPayload<object>;

async function bedStats(hostelIds: string[]) {
  const map = new Map<string, { rooms: number; beds: number; occupied: number }>();
  if (!hostelIds.length) return map;
  const [rooms, beds] = await Promise.all([
    db().hostelRoom.groupBy({
      by: ['hostelId'],
      where: { hostelId: { in: hostelIds } },
      _count: { _all: true },
    }),
    db().hostelBed.groupBy({
      by: ['hostelId', 'status'],
      where: { hostelId: { in: hostelIds } },
      _count: { _all: true },
    }),
  ]);
  for (const id of hostelIds) map.set(id, { rooms: 0, beds: 0, occupied: 0 });
  for (const r of rooms) map.get(r.hostelId)!.rooms = r._count._all;
  for (const b of beds) {
    const s = map.get(b.hostelId)!;
    s.beds += b._count._all;
    if (b.status === 'OCCUPIED') s.occupied += b._count._all;
  }
  return map;
}

async function wardenNames(rows: HostelRow[]) {
  return employeeRefs(rows.map((h) => h.wardenEmployeeId));
}

function toHostelDto(
  h: HostelRow,
  stats?: { rooms: number; beds: number; occupied: number },
  wardenName?: string | null,
): HostelDto {
  return {
    id: h.id,
    institutionId: h.institutionId,
    code: h.code,
    name: h.name,
    hostelType: h.hostelType as HostelType,
    wardenEmployeeId: h.wardenEmployeeId,
    wardenName: wardenName ?? null,
    phone: h.phone,
    address: h.address,
    status: h.status,
    rooms: stats?.rooms ?? 0,
    beds: stats?.beds ?? 0,
    occupied: stats?.occupied ?? 0,
  };
}

export async function loadHostel(id: string, permission = HOSTEL_VIEW) {
  return assertVisible(await db().hostel.findFirst({ where: { id } }), permission, 'Hostel');
}

async function hostelDto(h: HostelRow) {
  const [stats, wardens] = await Promise.all([bedStats([h.id]), wardenNames([h])]);
  return toHostelDto(h, stats.get(h.id), wardens.get(h.wardenEmployeeId ?? '')?.name);
}

async function resolveWarden(employeeId: string | null | undefined, institutionId: string) {
  if (!employeeId) return { wardenEmployeeId: null, wardenUserId: null };
  const e = (await employeeRefs([employeeId])).get(employeeId);
  if (!e || e.institutionId !== institutionId) {
    throw new InvalidReferenceError('wardenEmployeeId', 'Employee');
  }
  return { wardenEmployeeId: e.id, wardenUserId: e.userId };
}

export const hostelService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }],
      }),
    };
    const [rows, total] = await Promise.all([
      db().hostel.findMany({ where, orderBy: { code: 'asc' }, ...toPageWindow(query) }),
      db().hostel.count({ where }),
    ]);
    const [stats, wardens] = await Promise.all([
      bedStats(rows.map((r) => r.id)),
      wardenNames(rows),
    ]);
    return {
      items: rows.map((h) =>
        toHostelDto(h, stats.get(h.id), wardens.get(h.wardenEmployeeId ?? '')?.name),
      ),
      total,
    };
  },

  async get(id: string) {
    return hostelDto(await loadHostel(id));
  },

  async create(input: CreateHostelInput) {
    const inst = await resolveInstitution(input.institutionId);
    await authorizeRow({ institutionId: inst.id, groupId: inst.groupId }, HOSTEL_MANAGE);
    const warden = await resolveWarden(input.wardenEmployeeId, inst.id);
    try {
      const h = await db().hostel.create({
        data: withTenant({
          institutionId: inst.id,
          groupId: inst.groupId,
          code: input.code,
          name: input.name,
          hostelType: input.hostelType,
          ...warden,
          phone: input.phone ?? null,
          address: input.address ?? null,
          status: input.status,
        }),
      });
      const dto = await hostelDto(h);
      await audit.record({
        action: 'hostel.created',
        entityType: 'hostel',
        entityId: h.id,
        after: dto,
      });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A hostel with this code exists');
      throw err;
    }
  },

  async update(id: string, input: UpdateHostelInput) {
    const before = await loadHostel(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    const warden =
      input.wardenEmployeeId !== undefined
        ? await resolveWarden(input.wardenEmployeeId, before.institutionId)
        : {};
    try {
      const h = await db().hostel.update({
        where: { id },
        data: {
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.hostelType !== undefined && { hostelType: input.hostelType }),
          ...warden,
          ...(input.phone !== undefined && { phone: input.phone ?? null }),
          ...(input.address !== undefined && { address: input.address ?? null }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      const dto = await hostelDto(h);
      await audit.record({
        action: 'hostel.updated',
        entityType: 'hostel',
        entityId: id,
        before: toHostelDto(before),
        after: dto,
      });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A hostel with this code exists');
      throw err;
    }
  },

  async remove(id: string) {
    const before = await loadHostel(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    const rooms = await db().hostelRoom.count({ where: { hostelId: id } });
    if (rooms) throw new ConflictError('Hostel has rooms; remove them first');
    await db().hostel.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await audit.record({
      action: 'hostel.deleted',
      entityType: 'hostel',
      entityId: id,
      before: toHostelDto(before),
    });
  },
};

// ---- Blocks ---------------------------------------------------------------------------------
const toBlockDto = (b: Prisma.HostelBlockGetPayload<object>): HostelBlockDto => ({
  id: b.id,
  hostelId: b.hostelId,
  name: b.name,
  floors: b.floors,
});

async function loadBlock(id: string) {
  return assertVisible(await db().hostelBlock.findFirst({ where: { id } }), HOSTEL_VIEW, 'Block');
}

export const blockService = {
  async list(hostelId: string) {
    await loadHostel(hostelId);
    const rows = await db().hostelBlock.findMany({ where: { hostelId }, orderBy: { name: 'asc' } });
    return rows.map(toBlockDto);
  },

  async create(hostelId: string, input: CreateHostelBlockInput) {
    const hostel = await loadHostel(hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    const b = await db().hostelBlock.create({
      data: withTenant({
        institutionId: hostel.institutionId,
        hostelId,
        name: input.name,
        floors: input.floors,
      }),
    });
    await audit.record({
      action: 'hostel_block.created',
      entityType: 'hostel_block',
      entityId: b.id,
      after: toBlockDto(b),
    });
    return toBlockDto(b);
  },

  async update(id: string, input: UpdateHostelBlockInput) {
    const before = await loadBlock(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    const b = await db().hostelBlock.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.floors !== undefined && { floors: input.floors }),
      },
    });
    await audit.record({
      action: 'hostel_block.updated',
      entityType: 'hostel_block',
      entityId: id,
      before: toBlockDto(before),
      after: toBlockDto(b),
    });
    return toBlockDto(b);
  },

  async remove(id: string) {
    const before = await loadBlock(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    if (await db().hostelRoom.count({ where: { blockId: id } })) {
      throw new ConflictError('Block has rooms; move or remove them first');
    }
    await db().hostelBlock.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'hostel_block.deleted',
      entityType: 'hostel_block',
      entityId: id,
      before: toBlockDto(before),
    });
  },
};

// ---- Rooms & beds ---------------------------------------------------------------------------
const roomInclude = {
  block: { select: { name: true } },
  beds: { where: { deletedAt: null }, orderBy: { bedNo: 'asc' } },
} as const;
type RoomRow = Prisma.HostelRoomGetPayload<{ include: typeof roomInclude }>;

/** Occupants of the given beds (active allocations). */
async function bedOccupants(bedIds: string[]) {
  const map = new Map<string, HostelBedDto['occupant']>();
  if (!bedIds.length) return map;
  const allocations = await db().hostelAllocation.findMany({
    where: { bedId: { in: bedIds }, status: 'ACTIVE' },
    select: { id: true, bedId: true, studentId: true, employeeId: true },
  });
  const [students, employees] = await Promise.all([
    studentRefs(allocations.map((a) => a.studentId)),
    employeeRefs(allocations.map((a) => a.employeeId)),
  ]);
  for (const a of allocations) {
    const person = a.studentId ? students.get(a.studentId) : employees.get(a.employeeId ?? '');
    map.set(a.bedId, { allocationId: a.id, name: person?.name ?? '—', studentId: a.studentId });
  }
  return map;
}

function toRoomDto(r: RoomRow, occupants: Map<string, HostelBedDto['occupant']>): HostelRoomDto {
  const amenities = Array.isArray(r.amenities) ? (r.amenities as string[]) : [];
  return {
    id: r.id,
    hostelId: r.hostelId,
    blockId: r.blockId,
    blockName: r.block?.name ?? null,
    floor: r.floor,
    roomNo: r.roomNo,
    roomType: r.roomType,
    capacity: r.capacity,
    amenities,
    monthlyRent: num(r.monthlyRent),
    status: r.status,
    occupied: r.beds.filter((b) => b.status === 'OCCUPIED').length,
    beds: r.beds.map((b) => ({
      id: b.id,
      bedNo: b.bedNo,
      status: b.status,
      occupant: occupants.get(b.id) ?? null,
    })),
  };
}

export async function loadRoom(id: string, permission = HOSTEL_VIEW) {
  return assertVisible(
    await db().hostelRoom.findFirst({ where: { id }, include: roomInclude }),
    permission,
    'Room',
  );
}

async function roomDto(id: string) {
  const r = await db().hostelRoom.findFirstOrThrow({ where: { id }, include: roomInclude });
  return toRoomDto(r, await bedOccupants(r.beds.map((b) => b.id)));
}

async function validateBlock(blockId: string | null | undefined, hostelId: string) {
  if (!blockId) return null;
  const b = await db().hostelBlock.findFirst({ where: { id: blockId, hostelId } });
  if (!b) throw new InvalidReferenceError('blockId', 'Block');
  return b.id;
}

export const roomService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelRoomWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.hostelId && { hostelId: query.hostelId }),
      ...(query.status && { status: query.status }),
      ...(query.search && { roomNo: { contains: query.search } }),
    };
    const [rows, total] = await Promise.all([
      db().hostelRoom.findMany({
        where,
        include: roomInclude,
        orderBy: [{ hostelId: 'asc' }, { floor: 'asc' }, { roomNo: 'asc' }],
        ...toPageWindow(query),
      }),
      db().hostelRoom.count({ where }),
    ]);
    const occupants = await bedOccupants(rows.flatMap((r) => r.beds.map((b) => b.id)));
    return { items: rows.map((r) => toRoomDto(r, occupants)), total };
  },

  async get(id: string) {
    await loadRoom(id);
    return roomDto(id);
  },

  async create(hostelId: string, input: CreateHostelRoomInput) {
    const hostel = await loadHostel(hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    const blockId = await validateBlock(input.blockId, hostelId);
    let roomId: string;
    try {
      roomId = await db().$transaction(async (tx) => {
        const room = await tx.hostelRoom.create({
          data: withTenant({
            institutionId: hostel.institutionId,
            hostelId,
            blockId,
            floor: input.floor,
            roomNo: input.roomNo,
            roomType: input.roomType,
            capacity: input.capacity,
            amenities: input.amenities ?? [],
            monthlyRent: input.monthlyRent,
            status: input.status,
          }),
        });
        await tx.hostelBed.createMany({
          data: newBedLabels([], input.capacity).map((bedNo) =>
            withTenant({ institutionId: hostel.institutionId, hostelId, roomId: room.id, bedNo }),
          ),
        });
        return room.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A room with this number exists');
      throw err;
    }
    const dto = await roomDto(roomId);
    await audit.record({
      action: 'hostel_room.created',
      entityType: 'hostel_room',
      entityId: roomId,
      after: dto,
    });
    return dto;
  },

  async update(id: string, input: UpdateHostelRoomInput) {
    const before = await loadRoom(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    const beforeDto = toRoomDto(before, new Map());
    const blockId =
      input.blockId !== undefined ? await validateBlock(input.blockId, before.hostelId) : undefined;
    try {
      await db().$transaction(async (tx) => {
        await tx.hostelRoom.update({
          where: { id },
          data: {
            ...(blockId !== undefined && { blockId }),
            ...(input.floor !== undefined && { floor: input.floor }),
            ...(input.roomNo !== undefined && { roomNo: input.roomNo }),
            ...(input.roomType !== undefined && { roomType: input.roomType }),
            ...(input.capacity !== undefined && { capacity: input.capacity }),
            ...(input.amenities !== undefined && { amenities: input.amenities }),
            ...(input.monthlyRent !== undefined && { monthlyRent: input.monthlyRent }),
            ...(input.status !== undefined && { status: input.status }),
          },
        });
        if (input.capacity !== undefined && input.capacity !== before.beds.length) {
          if (input.capacity > before.beds.length) {
            await tx.hostelBed.createMany({
              data: newBedLabels(
                before.beds.map((b) => b.bedNo),
                input.capacity,
              ).map((bedNo) =>
                withTenant({
                  institutionId: before.institutionId,
                  hostelId: before.hostelId,
                  roomId: id,
                  bedNo,
                }),
              ),
            });
          } else {
            const surplus = before.beds.length - input.capacity;
            const free = before.beds.filter((b) => b.status !== 'OCCUPIED').reverse();
            const history = new Set(
              (
                await tx.hostelAllocation.findMany({
                  where: { bedId: { in: free.map((b) => b.id) } },
                  select: { bedId: true },
                })
              ).map((a) => a.bedId),
            );
            const removable = free.filter((b) => !history.has(b.id)).slice(0, surplus);
            if (removable.length < surplus) {
              throw new ConflictError(
                'Cannot reduce capacity: occupied beds (or beds with allocation history) remain',
              );
            }
            await tx.hostelBed.deleteMany({ where: { id: { in: removable.map((b) => b.id) } } });
          }
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A room with this number exists');
      throw err;
    }
    const dto = await roomDto(id);
    await audit.record({
      action: 'hostel_room.updated',
      entityType: 'hostel_room',
      entityId: id,
      before: beforeDto,
      after: dto,
    });
    return dto;
  },

  async remove(id: string) {
    const before = await loadRoom(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    if (await db().hostelAllocation.count({ where: { roomId: id } })) {
      throw new ConflictError('Room has allocation history; mark it INACTIVE instead');
    }
    if (await db().hostelComplaint.count({ where: { roomId: id } })) {
      throw new ConflictError('Room has complaints; mark it INACTIVE instead');
    }
    await db().$transaction(async (tx) => {
      await tx.hostelBed.deleteMany({ where: { roomId: id } });
      await tx.hostelRoom.delete({ where: { id } });
    });
    await audit.record({
      action: 'hostel_room.deleted',
      entityType: 'hostel_room',
      entityId: id,
      before: toRoomDto(before, new Map()),
    });
  },

  async updateBed(id: string, input: UpdateHostelBedInput) {
    const bed = await assertVisible(
      await db().hostelBed.findFirst({ where: { id } }),
      HOSTEL_VIEW,
      'Bed',
    );
    await authorizeRow(bed, HOSTEL_MANAGE);
    if (bed.status === 'OCCUPIED') throw new ConflictError('Bed is occupied');
    await db().hostelBed.update({ where: { id }, data: { status: input.status } });
    await audit.record({
      action: 'hostel_bed.updated',
      entityType: 'hostel_bed',
      entityId: id,
      before: { status: bed.status },
      after: { status: input.status },
    });
    return roomDto(bed.roomId);
  },
};

// ---- Mess plans -----------------------------------------------------------------------------
const toMessDto = (m: Prisma.HostelMessPlanGetPayload<object>): HostelMessPlanDto => ({
  id: m.id,
  hostelId: m.hostelId,
  name: m.name,
  description: m.description,
  monthlyFee: num(m.monthlyFee),
});

async function loadMessPlan(id: string) {
  return assertVisible(
    await db().hostelMessPlan.findFirst({ where: { id } }),
    HOSTEL_VIEW,
    'Mess plan',
  );
}

export const messPlanService = {
  async list(hostelId: string) {
    await loadHostel(hostelId);
    const rows = await db().hostelMessPlan.findMany({
      where: { hostelId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toMessDto);
  },

  async create(hostelId: string, input: CreateMessPlanInput) {
    const hostel = await loadHostel(hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    const m = await db().hostelMessPlan.create({
      data: withTenant({
        institutionId: hostel.institutionId,
        hostelId,
        name: input.name,
        description: input.description ?? null,
        monthlyFee: input.monthlyFee,
      }),
    });
    await audit.record({
      action: 'hostel_mess_plan.created',
      entityType: 'hostel_mess_plan',
      entityId: m.id,
      after: toMessDto(m),
    });
    return toMessDto(m);
  },

  async update(id: string, input: UpdateMessPlanInput) {
    const before = await loadMessPlan(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    const m = await db().hostelMessPlan.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description ?? null }),
        ...(input.monthlyFee !== undefined && { monthlyFee: input.monthlyFee }),
      },
    });
    await audit.record({
      action: 'hostel_mess_plan.updated',
      entityType: 'hostel_mess_plan',
      entityId: id,
      before: toMessDto(before),
      after: toMessDto(m),
    });
    return toMessDto(m);
  },

  async remove(id: string) {
    const before = await loadMessPlan(id);
    await authorizeRow(before, HOSTEL_MANAGE);
    if (await db().hostelAllocation.count({ where: { messPlanId: id, status: 'ACTIVE' } })) {
      throw new ConflictError('Mess plan has active subscribers');
    }
    await db().hostelMessPlan.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'hostel_mess_plan.deleted',
      entityType: 'hostel_mess_plan',
      entityId: id,
      before: toMessDto(before),
    });
  },
};
