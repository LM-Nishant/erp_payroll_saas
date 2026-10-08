import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';
import { chargePeriodSchema } from './transport';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9][0-9 ()-]{3,31}$/, 'Invalid phone number');
const money = z.coerce.number().min(0).max(10_000_000);
const dateTimeSchema = z.string().datetime({ offset: true });

export const HOSTEL_TYPES = ['BOYS', 'GIRLS', 'STAFF', 'MIXED'] as const;
export const HOSTEL_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const HOSTEL_ROOM_TYPES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'DORMITORY'] as const;
export const HOSTEL_ROOM_STATUSES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
export const HOSTEL_BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'BLOCKED'] as const;
export const HOSTEL_OCCUPANT_TYPES = ['STUDENT', 'STAFF'] as const;
export const HOSTEL_ALLOCATION_STATUSES = ['ACTIVE', 'VACATED', 'TRANSFERRED'] as const;
export const HOSTEL_CHARGE_STATUSES = ['PENDING', 'POSTED', 'WAIVED'] as const;
export const OUTPASS_TYPES = ['OUTING', 'HOME', 'MEDICAL', 'OTHER'] as const;
export const OUTPASS_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'OUT',
  'RETURNED',
] as const;
export const HOSTEL_MOVEMENT_DIRECTIONS = ['OUT', 'IN'] as const;
export const HOSTEL_COMPLAINT_CATEGORIES = [
  'MAINTENANCE',
  'ELECTRICAL',
  'PLUMBING',
  'CLEANLINESS',
  'FOOD',
  'DISCIPLINE',
  'OTHER',
] as const;
export const HOSTEL_COMPLAINT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const HOSTEL_COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const ROLL_CALL_SESSIONS = ['MORNING', 'NIGHT'] as const;
export const ROLL_CALL_STATUSES = ['PRESENT', 'ABSENT', 'ON_LEAVE'] as const;

export type HostelType = (typeof HOSTEL_TYPES)[number];
export type OutpassStatus = (typeof OUTPASS_STATUSES)[number];
export type HostelComplaintStatus = (typeof HOSTEL_COMPLAINT_STATUSES)[number];

const nonEmpty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

// ---- Hostels / blocks / rooms / beds --------------------------------------------------------
const hostelFields = {
  code: text(32)
    .min(1)
    .transform((v) => v.toUpperCase()),
  name: text(160).min(1),
  hostelType: z.enum(HOSTEL_TYPES),
  wardenEmployeeId: idSchema.nullish(),
  phone: phoneSchema.nullish(),
  address: optionalText(500),
  status: z.enum(HOSTEL_STATUSES).default('ACTIVE'),
};
export const createHostelSchema = z.object({ institutionId: idSchema, ...hostelFields }).strict();
export type CreateHostelInput = z.infer<typeof createHostelSchema>;
export const updateHostelSchema = nonEmpty(hostelFields);
export type UpdateHostelInput = z.infer<typeof updateHostelSchema>;

const blockFields = {
  name: text(80).min(1),
  floors: z.coerce.number().int().min(1).max(100).default(1),
};
export const createHostelBlockSchema = z.object(blockFields).strict();
export type CreateHostelBlockInput = z.infer<typeof createHostelBlockSchema>;
export const updateHostelBlockSchema = nonEmpty(blockFields);
export type UpdateHostelBlockInput = z.infer<typeof updateHostelBlockSchema>;

const roomFields = {
  blockId: idSchema.nullish(),
  floor: z.coerce.number().int().min(0).max(100).default(0),
  roomNo: text(20).min(1),
  roomType: z.enum(HOSTEL_ROOM_TYPES).default('DOUBLE'),
  /** Number of beds; beds are created/removed to match. */
  capacity: z.coerce.number().int().min(1).max(50),
  amenities: z.array(text(60).min(1)).max(30).optional(),
  monthlyRent: money.default(0),
  status: z.enum(HOSTEL_ROOM_STATUSES).default('ACTIVE'),
};
export const createHostelRoomSchema = z.object(roomFields).strict();
export type CreateHostelRoomInput = z.infer<typeof createHostelRoomSchema>;
export const updateHostelRoomSchema = nonEmpty(roomFields);
export type UpdateHostelRoomInput = z.infer<typeof updateHostelRoomSchema>;
export const updateHostelBedSchema = z
  .object({ status: z.enum(['AVAILABLE', 'BLOCKED']) })
  .strict();
export type UpdateHostelBedInput = z.infer<typeof updateHostelBedSchema>;

const messPlanFields = {
  name: text(80).min(1),
  description: optionalText(500),
  monthlyFee: money,
};
export const createMessPlanSchema = z.object(messPlanFields).strict();
export type CreateMessPlanInput = z.infer<typeof createMessPlanSchema>;
export const updateMessPlanSchema = nonEmpty(messPlanFields);
export type UpdateMessPlanInput = z.infer<typeof updateMessPlanSchema>;

// ---- Allocations ----------------------------------------------------------------------------
export const createHostelAllocationSchema = z
  .object({
    occupantType: z.enum(HOSTEL_OCCUPANT_TYPES).default('STUDENT'),
    studentId: idSchema.nullish(),
    employeeId: idSchema.nullish(),
    /** A specific bed, or a room (first free bed is picked). */
    bedId: idSchema.nullish(),
    roomId: idSchema.nullish(),
    messPlanId: idSchema.nullish(),
    fromDate: isoDateSchema,
    /** Overrides the room's monthly rent. */
    monthlyRent: money.nullish(),
    notes: optionalText(500),
  })
  .strict()
  .refine((v) => (v.occupantType === 'STUDENT' ? !!v.studentId : !!v.employeeId), {
    message: 'studentId (STUDENT) or employeeId (STAFF) is required',
    path: ['studentId'],
  })
  .refine((v) => !!(v.bedId || v.roomId), {
    message: 'bedId or roomId is required',
    path: ['bedId'],
  });
export type CreateHostelAllocationInput = z.infer<typeof createHostelAllocationSchema>;
export const vacateHostelAllocationSchema = z
  .object({ toDate: isoDateSchema, notes: optionalText(500) })
  .strict();
export type VacateHostelAllocationInput = z.infer<typeof vacateHostelAllocationSchema>;
export const transferHostelAllocationSchema = z
  .object({
    bedId: idSchema.nullish(),
    roomId: idSchema.nullish(),
    date: isoDateSchema,
    monthlyRent: money.nullish(),
    notes: optionalText(500),
  })
  .strict()
  .refine((v) => !!(v.bedId || v.roomId), {
    message: 'bedId or roomId is required',
    path: ['bedId'],
  });
export type TransferHostelAllocationInput = z.infer<typeof transferHostelAllocationSchema>;
export const updateHostelAllocationSchema = nonEmpty({
  messPlanId: idSchema.nullable(),
  monthlyRent: money,
  notes: optionalText(500),
});
export type UpdateHostelAllocationInput = z.infer<typeof updateHostelAllocationSchema>;

export const generateHostelChargesSchema = z
  .object({ period: chargePeriodSchema, institutionId: idSchema.optional() })
  .strict();
export type GenerateHostelChargesInput = z.infer<typeof generateHostelChargesSchema>;
export const updateHostelChargeSchema = z
  .object({ status: z.enum(HOSTEL_CHARGE_STATUSES) })
  .strict();
export type UpdateHostelChargeInput = z.infer<typeof updateHostelChargeSchema>;

// ---- Visitors, out-passes, in/out register --------------------------------------------------
export const createHostelVisitorSchema = z
  .object({
    hostelId: idSchema,
    studentId: idSchema.nullish(),
    visitorName: text(200).min(1),
    relation: optionalText(60),
    phone: phoneSchema.nullish(),
    idProof: optionalText(80),
    purpose: optionalText(300),
    checkInAt: dateTimeSchema.optional(),
  })
  .strict();
export type CreateHostelVisitorInput = z.infer<typeof createHostelVisitorSchema>;

const outpassFields = {
  passType: z.enum(OUTPASS_TYPES).default('OUTING'),
  fromAt: dateTimeSchema,
  toAt: dateTimeSchema,
  destination: optionalText(200),
  reason: text(500).min(1),
};
const outpassRange = (v: { fromAt: string; toAt: string }) =>
  Date.parse(v.toAt) > Date.parse(v.fromAt);
export const createOutpassSchema = z
  .object({ studentId: idSchema, ...outpassFields })
  .strict()
  .refine(outpassRange, { message: 'toAt must be after fromAt', path: ['toAt'] });
export type CreateOutpassInput = z.infer<typeof createOutpassSchema>;
/** Portal apply: a student applies for themself; a parent must pick the ward. */
export const applyOwnOutpassSchema = z
  .object({ studentId: idSchema.optional(), ...outpassFields })
  .strict()
  .refine(outpassRange, { message: 'toAt must be after fromAt', path: ['toAt'] });
export type ApplyOwnOutpassInput = z.infer<typeof applyOwnOutpassSchema>;
export const decideOutpassSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: optionalText(1000) })
  .strict();
export type DecideOutpassInput = z.infer<typeof decideOutpassSchema>;
export const outpassGateSchema = z
  .object({ at: dateTimeSchema.optional(), notes: optionalText(300) })
  .strict();
export type OutpassGateInput = z.infer<typeof outpassGateSchema>;

export const createHostelMovementSchema = z
  .object({
    hostelId: idSchema,
    studentId: idSchema,
    direction: z.enum(HOSTEL_MOVEMENT_DIRECTIONS),
    at: dateTimeSchema.optional(),
    notes: optionalText(300),
  })
  .strict();
export type CreateHostelMovementInput = z.infer<typeof createHostelMovementSchema>;

// ---- Complaints & roll call -----------------------------------------------------------------
const complaintFields = {
  category: z.enum(HOSTEL_COMPLAINT_CATEGORIES).default('MAINTENANCE'),
  title: text(200).min(1),
  description: optionalText(2000),
  priority: z.enum(HOSTEL_COMPLAINT_PRIORITIES).default('MEDIUM'),
};
export const createHostelComplaintSchema = z
  .object({
    hostelId: idSchema,
    roomId: idSchema.nullish(),
    studentId: idSchema.nullish(),
    ...complaintFields,
  })
  .strict();
export type CreateHostelComplaintInput = z.infer<typeof createHostelComplaintSchema>;
export const raiseOwnComplaintSchema = z
  .object({ studentId: idSchema.optional(), ...complaintFields })
  .strict();
export type RaiseOwnComplaintInput = z.infer<typeof raiseOwnComplaintSchema>;
export const updateHostelComplaintSchema = nonEmpty({
  status: z.enum(HOSTEL_COMPLAINT_STATUSES),
  priority: z.enum(HOSTEL_COMPLAINT_PRIORITIES),
  resolution: optionalText(1000),
});
export type UpdateHostelComplaintInput = z.infer<typeof updateHostelComplaintSchema>;

export const rollCallQuerySchema = z
  .object({
    hostelId: idSchema,
    date: isoDateSchema,
    session: z.enum(ROLL_CALL_SESSIONS).default('NIGHT'),
  })
  .strict();
export type RollCallQuery = z.infer<typeof rollCallQuerySchema>;
export const saveRollCallSchema = z
  .object({
    hostelId: idSchema,
    date: isoDateSchema,
    session: z.enum(ROLL_CALL_SESSIONS).default('NIGHT'),
    entries: z
      .array(z.object({ studentId: idSchema, status: z.enum(ROLL_CALL_STATUSES) }).strict())
      .min(1)
      .max(2000),
  })
  .strict();
export type SaveRollCallInput = z.infer<typeof saveRollCallSchema>;

export const hostelListQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    hostelId: idSchema.optional(),
    roomId: idSchema.optional(),
    studentId: idSchema.optional(),
    status: z.string().trim().max(16).optional(),
    occupantType: z.enum(HOSTEL_OCCUPANT_TYPES).optional(),
    period: chargePeriodSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();
export type HostelListQuery = z.infer<typeof hostelListQuerySchema>;
export const hostelReportQuerySchema = z
  .object({ institutionId: idSchema.optional(), hostelId: idSchema.optional() })
  .strict();
export type HostelReportQuery = z.infer<typeof hostelReportQuerySchema>;

// ---- DTOs -----------------------------------------------------------------------------------
export interface HostelDto {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  hostelType: HostelType;
  wardenEmployeeId: string | null;
  wardenName: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  rooms: number;
  beds: number;
  occupied: number;
}

export interface HostelBlockDto {
  id: string;
  hostelId: string;
  name: string;
  floors: number;
}

export interface HostelBedDto {
  id: string;
  bedNo: string;
  status: string;
  occupant: { allocationId: string; name: string; studentId: string | null } | null;
}

export interface HostelRoomDto {
  id: string;
  hostelId: string;
  blockId: string | null;
  blockName: string | null;
  floor: number;
  roomNo: string;
  roomType: string;
  capacity: number;
  amenities: string[];
  monthlyRent: number;
  status: string;
  occupied: number;
  beds: HostelBedDto[];
}

export interface HostelMessPlanDto {
  id: string;
  hostelId: string;
  name: string;
  description: string | null;
  monthlyFee: number;
}

export interface HostelAllocationDto {
  id: string;
  institutionId: string;
  hostel: { id: string; code: string; name: string };
  room: { id: string; roomNo: string; floor: number };
  bed: { id: string; bedNo: string };
  occupantType: string;
  studentId: string | null;
  employeeId: string | null;
  occupantName: string;
  occupantCode: string | null;
  messPlan: { id: string; name: string; monthlyFee: number } | null;
  fromDate: string;
  toDate: string | null;
  status: string;
  monthlyRent: number;
  notes: string | null;
}

export interface HostelChargeDto {
  id: string;
  institutionId: string;
  allocationId: string;
  studentId: string | null;
  employeeId: string | null;
  occupantName: string;
  period: string;
  rentAmount: number;
  messAmount: number;
  amount: number;
  status: string;
  externalRef: string | null;
}

export interface HostelVisitorDto {
  id: string;
  hostelId: string;
  hostelName: string;
  studentId: string | null;
  studentName: string | null;
  visitorName: string;
  relation: string | null;
  phone: string | null;
  idProof: string | null;
  purpose: string | null;
  checkInAt: string;
  checkOutAt: string | null;
}

export interface OutpassDto {
  id: string;
  institutionId: string;
  hostelId: string;
  hostelName: string;
  studentId: string;
  studentName: string;
  passType: string;
  fromAt: string;
  toAt: string;
  destination: string | null;
  reason: string;
  status: OutpassStatus;
  workflowInstanceId: string | null;
  decidedComment: string | null;
  decidedAt: string | null;
  outAt: string | null;
  returnedAt: string | null;
  createdAt: string;
}

export interface HostelMovementDto {
  id: string;
  hostelId: string;
  studentId: string;
  studentName: string;
  outpassId: string | null;
  direction: string;
  at: string;
  notes: string | null;
}

export interface HostelComplaintDto {
  id: string;
  hostelId: string;
  hostelName: string;
  roomId: string | null;
  roomNo: string | null;
  studentId: string | null;
  studentName: string | null;
  category: string;
  title: string;
  description: string | null;
  priority: string;
  status: HostelComplaintStatus;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface RollCallSheetDto {
  hostelId: string;
  date: string;
  session: string;
  rollCallId: string | null;
  entries: {
    studentId: string;
    studentName: string;
    roomNo: string;
    bedNo: string;
    status: string | null;
    onOutpass: boolean;
  }[];
}

export interface HostelDashboardDto {
  hostels: number;
  rooms: number;
  beds: number;
  occupied: number;
  available: number;
  blocked: number;
  occupancyPercent: number;
  pendingOutpasses: number;
  studentsOut: number;
  openComplaints: number;
  visitorsToday: number;
  byHostel: {
    hostelId: string;
    code: string;
    name: string;
    hostelType: string;
    beds: number;
    occupied: number;
  }[];
}

export interface HostelReportDto {
  occupancy: {
    hostelId: string;
    name: string;
    rooms: number;
    beds: number;
    occupied: number;
    occupancyPercent: number;
  }[];
  complaints: { category: string; status: string; count: number }[];
  outpasses: { status: string; count: number }[];
  charges: { period: string; status: string; count: number; amount: number }[];
}

export interface MyHostelDto {
  studentId: string;
  studentName: string;
  allocation: HostelAllocationDto | null;
  hostel: {
    name: string;
    hostelType: string;
    phone: string | null;
    wardenName: string | null;
  } | null;
  roommates: { name: string; bedNo: string }[];
  outpasses: OutpassDto[];
  complaints: HostelComplaintDto[];
}
