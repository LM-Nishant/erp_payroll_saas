import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const optionalDate = isoDateSchema.nullish();
const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9][0-9 ()-]{3,31}$/, 'Invalid phone number');
/** Wall-clock time `HH:MM` (24h). */
export const transportTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM');
const money = z.coerce.number().min(0).max(10_000_000);
const km = z.coerce.number().min(0).max(10_000);
export const chargePeriodSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be YYYY-MM');
const dateTimeSchema = z.string().datetime({ offset: true });

export const VEHICLE_TYPES = ['BUS', 'MINI_BUS', 'VAN', 'CAR', 'OTHER'] as const;
export const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
export const TRANSPORT_STAFF_ROLES = ['DRIVER', 'CONDUCTOR', 'ATTENDANT'] as const;
export const TRANSPORT_ACTIVE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const TRANSPORT_FARE_FREQUENCIES = ['MONTHLY', 'TERM', 'ANNUAL'] as const;
export const TRANSPORT_PASSENGER_TYPES = ['STUDENT', 'STAFF'] as const;
export const TRANSPORT_TRIP_TYPES = ['BOTH', 'PICKUP', 'DROP'] as const;
export const TRANSPORT_ALLOCATION_STATUSES = ['ACTIVE', 'ENDED'] as const;
export const TRANSPORT_TRIP_DIRECTIONS = ['PICKUP', 'DROP'] as const;
export const TRANSPORT_TRIP_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export const TRANSPORT_BOARDING_STATUSES = ['BOARDED', 'ABSENT'] as const;
export const TRANSPORT_INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const TRANSPORT_INCIDENT_STATUSES = ['OPEN', 'RESOLVED'] as const;
export const VEHICLE_MAINTENANCE_KINDS = [
  'SERVICE',
  'REPAIR',
  'INSPECTION',
  'TYRES',
  'OTHER',
] as const;
export const TRANSPORT_CHARGE_STATUSES = ['PENDING', 'POSTED', 'WAIVED'] as const;
export const TRANSPORT_BROADCAST_KINDS = ['DELAY', 'GENERAL'] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type TransportStaffRole = (typeof TRANSPORT_STAFF_ROLES)[number];
export type PassengerType = (typeof TRANSPORT_PASSENGER_TYPES)[number];
export type TransportTripDirection = (typeof TRANSPORT_TRIP_DIRECTIONS)[number];
export type TransportTripStatus = (typeof TRANSPORT_TRIP_STATUSES)[number];

// ---- Vehicles -------------------------------------------------------------------------------
const vehicleFields = {
  regNo: text(32)
    .min(2)
    .transform((v) => v.toUpperCase()),
  vehicleType: z.enum(VEHICLE_TYPES).default('BUS'),
  make: optionalText(80),
  capacity: z.coerce.number().int().min(1).max(200),
  gpsDeviceId: optionalText(64),
  insuranceExpiry: optionalDate,
  fitnessExpiry: optionalDate,
  permitExpiry: optionalDate,
  pollutionExpiry: optionalDate,
  nextServiceDate: optionalDate,
  odometerKm: z.coerce.number().int().min(0).nullish(),
  status: z.enum(VEHICLE_STATUSES).default('ACTIVE'),
  notes: optionalText(1000),
};
export const createVehicleSchema = z.object({ institutionId: idSchema, ...vehicleFields }).strict();
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export const updateVehicleSchema = z
  .object(vehicleFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

// ---- Drivers / conductors / attendants ------------------------------------------------------
const staffFields = {
  employeeId: idSchema.nullish(),
  role: z.enum(TRANSPORT_STAFF_ROLES).default('DRIVER'),
  name: text(200).min(1),
  phone: phoneSchema.nullish(),
  licenceNo: optionalText(40),
  licenceExpiry: optionalDate,
  vehicleId: idSchema.nullish(),
  status: z.enum(TRANSPORT_ACTIVE_STATUSES).default('ACTIVE'),
};
export const createTransportStaffSchema = z
  .object({ institutionId: idSchema, ...staffFields })
  .strict();
export type CreateTransportStaffInput = z.infer<typeof createTransportStaffSchema>;
export const updateTransportStaffSchema = z
  .object(staffFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportStaffInput = z.infer<typeof updateTransportStaffSchema>;

// ---- Routes & stops -------------------------------------------------------------------------
const stopFields = {
  name: text(160).min(1),
  sequence: z.coerce.number().int().min(1).max(500),
  pickupTime: transportTimeSchema.nullish(),
  dropTime: transportTimeSchema.nullish(),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  distanceKm: km.nullish(),
  fareAmount: money.nullish(),
};
export const createTransportStopSchema = z.object(stopFields).strict();
export type CreateTransportStopInput = z.infer<typeof createTransportStopSchema>;
export const updateTransportStopSchema = z
  .object(stopFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportStopInput = z.infer<typeof updateTransportStopSchema>;

const routeFields = {
  code: text(32)
    .min(1)
    .transform((v) => v.toUpperCase()),
  name: text(160).min(1),
  vehicleId: idSchema.nullish(),
  driverId: idSchema.nullish(),
  attendantId: idSchema.nullish(),
  distanceKm: km.nullish(),
  status: z.enum(TRANSPORT_ACTIVE_STATUSES).default('ACTIVE'),
  notes: optionalText(1000),
};
export const createTransportRouteSchema = z
  .object({
    institutionId: idSchema,
    ...routeFields,
    stops: z.array(createTransportStopSchema).max(100).optional(),
  })
  .strict();
export type CreateTransportRouteInput = z.infer<typeof createTransportRouteSchema>;
export const updateTransportRouteSchema = z
  .object(routeFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportRouteInput = z.infer<typeof updateTransportRouteSchema>;

// ---- Fare slabs -----------------------------------------------------------------------------
const fareSlabFields = {
  name: text(80).min(1),
  minKm: km,
  maxKm: km,
  amount: money,
  frequency: z.enum(TRANSPORT_FARE_FREQUENCIES).default('MONTHLY'),
};
export const createTransportFareSlabSchema = z
  .object({ institutionId: idSchema, ...fareSlabFields })
  .strict()
  .refine((v) => v.maxKm > v.minKm, { message: 'maxKm must exceed minKm', path: ['maxKm'] });
export type CreateTransportFareSlabInput = z.infer<typeof createTransportFareSlabSchema>;
export const updateTransportFareSlabSchema = z
  .object(fareSlabFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportFareSlabInput = z.infer<typeof updateTransportFareSlabSchema>;

// ---- Allocations & charges ------------------------------------------------------------------
export const createTransportAllocationSchema = z
  .object({
    passengerType: z.enum(TRANSPORT_PASSENGER_TYPES).default('STUDENT'),
    studentId: idSchema.nullish(),
    employeeId: idSchema.nullish(),
    routeId: idSchema,
    stopId: idSchema,
    tripType: z.enum(TRANSPORT_TRIP_TYPES).default('BOTH'),
    effectiveFrom: isoDateSchema,
    effectiveTo: optionalDate,
    /** Overrides the stop fare / distance slab. */
    fareAmount: money.nullish(),
    notes: optionalText(500),
  })
  .strict()
  .refine((v) => (v.passengerType === 'STUDENT' ? !!v.studentId : !!v.employeeId), {
    message: 'studentId (STUDENT) or employeeId (STAFF) is required',
    path: ['studentId'],
  });
export type CreateTransportAllocationInput = z.infer<typeof createTransportAllocationSchema>;
export const updateTransportAllocationSchema = z
  .object({
    routeId: idSchema,
    stopId: idSchema,
    tripType: z.enum(TRANSPORT_TRIP_TYPES),
    effectiveTo: optionalDate,
    fareAmount: money.nullish(),
    notes: optionalText(500),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportAllocationInput = z.infer<typeof updateTransportAllocationSchema>;
export const endTransportAllocationSchema = z
  .object({ effectiveTo: isoDateSchema, notes: optionalText(500) })
  .strict();
export type EndTransportAllocationInput = z.infer<typeof endTransportAllocationSchema>;

export const generateTransportChargesSchema = z
  .object({ period: chargePeriodSchema, institutionId: idSchema.optional() })
  .strict();
export type GenerateTransportChargesInput = z.infer<typeof generateTransportChargesSchema>;
export const updateTransportChargeSchema = z
  .object({ status: z.enum(TRANSPORT_CHARGE_STATUSES) })
  .strict();
export type UpdateTransportChargeInput = z.infer<typeof updateTransportChargeSchema>;

// ---- Trips, boarding, incidents, fuel, maintenance ------------------------------------------
export const createTransportTripSchema = z
  .object({
    routeId: idSchema,
    tripDate: isoDateSchema,
    direction: z.enum(TRANSPORT_TRIP_DIRECTIONS),
    vehicleId: idSchema.nullish(),
    driverId: idSchema.nullish(),
    notes: optionalText(1000),
  })
  .strict();
export type CreateTransportTripInput = z.infer<typeof createTransportTripSchema>;
export const updateTransportTripSchema = z
  .object({
    status: z.enum(TRANSPORT_TRIP_STATUSES),
    startOdometerKm: z.coerce.number().int().min(0).nullish(),
    endOdometerKm: z.coerce.number().int().min(0).nullish(),
    delayMinutes: z.coerce.number().int().min(0).max(1440).nullish(),
    notes: optionalText(1000),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportTripInput = z.infer<typeof updateTransportTripSchema>;
export const recordBoardingSchema = z
  .object({
    entries: z
      .array(
        z.object({ allocationId: idSchema, status: z.enum(TRANSPORT_BOARDING_STATUSES) }).strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type RecordBoardingInput = z.infer<typeof recordBoardingSchema>;

export const createTransportIncidentSchema = z
  .object({
    institutionId: idSchema.optional(),
    tripId: idSchema.nullish(),
    routeId: idSchema.nullish(),
    vehicleId: idSchema.nullish(),
    occurredAt: dateTimeSchema,
    severity: z.enum(TRANSPORT_INCIDENT_SEVERITIES).default('LOW'),
    title: text(200).min(1),
    description: optionalText(2000),
  })
  .strict()
  .refine((v) => !!(v.institutionId || v.tripId || v.routeId || v.vehicleId), {
    message: 'institutionId, tripId, routeId or vehicleId is required',
    path: ['institutionId'],
  });
export type CreateTransportIncidentInput = z.infer<typeof createTransportIncidentSchema>;
export const updateTransportIncidentSchema = z
  .object({
    severity: z.enum(TRANSPORT_INCIDENT_SEVERITIES),
    status: z.enum(TRANSPORT_INCIDENT_STATUSES),
    resolution: optionalText(1000),
    description: optionalText(2000),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateTransportIncidentInput = z.infer<typeof updateTransportIncidentSchema>;

export const createVehicleFuelLogSchema = z
  .object({
    vehicleId: idSchema,
    logDate: isoDateSchema,
    litres: z.coerce.number().positive().max(10_000),
    amount: money,
    odometerKm: z.coerce.number().int().min(0).nullish(),
    vendor: optionalText(120),
  })
  .strict();
export type CreateVehicleFuelLogInput = z.infer<typeof createVehicleFuelLogSchema>;

export const createVehicleMaintenanceSchema = z
  .object({
    vehicleId: idSchema,
    serviceDate: isoDateSchema,
    kind: z.enum(VEHICLE_MAINTENANCE_KINDS).default('SERVICE'),
    description: text(1000).min(1),
    cost: money.default(0),
    odometerKm: z.coerce.number().int().min(0).nullish(),
    vendor: optionalText(120),
    nextServiceDate: optionalDate,
  })
  .strict();
export type CreateVehicleMaintenanceInput = z.infer<typeof createVehicleMaintenanceSchema>;

export const broadcastRouteSchema = z
  .object({
    kind: z.enum(TRANSPORT_BROADCAST_KINDS).default('GENERAL'),
    message: text(1000).min(1),
    delayMinutes: z.coerce.number().int().min(1).max(600).nullish(),
    direction: z.enum(TRANSPORT_TRIP_DIRECTIONS).nullish(),
  })
  .strict();
export type BroadcastRouteInput = z.infer<typeof broadcastRouteSchema>;

// ---- List queries ---------------------------------------------------------------------------
export const transportListQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    routeId: idSchema.optional(),
    vehicleId: idSchema.optional(),
    studentId: idSchema.optional(),
    status: z.string().trim().max(16).optional(),
    role: z.enum(TRANSPORT_STAFF_ROLES).optional(),
    passengerType: z.enum(TRANSPORT_PASSENGER_TYPES).optional(),
    period: chargePeriodSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();
export type TransportListQuery = z.infer<typeof transportListQuerySchema>;
export const transportReportQuerySchema = z
  .object({
    institutionId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();
export type TransportReportQuery = z.infer<typeof transportReportQuerySchema>;

// ---- DTOs -----------------------------------------------------------------------------------
export interface VehicleDto {
  id: string;
  institutionId: string;
  regNo: string;
  vehicleType: string;
  make: string | null;
  capacity: number;
  gpsDeviceId: string | null;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  permitExpiry: string | null;
  pollutionExpiry: string | null;
  nextServiceDate: string | null;
  odometerKm: number | null;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransportStaffDto {
  id: string;
  institutionId: string;
  employeeId: string | null;
  role: TransportStaffRole;
  name: string;
  phone: string | null;
  licenceNo: string | null;
  licenceExpiry: string | null;
  vehicleId: string | null;
  vehicleRegNo: string | null;
  status: string;
}

export interface TransportStopDto {
  id: string;
  routeId: string;
  sequence: number;
  name: string;
  pickupTime: string | null;
  dropTime: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  fareAmount: number | null;
  /** Fare applied to allocations at this stop (stop override, else matching slab). */
  effectiveFare: number | null;
}

export interface TransportRouteDto {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  vehicle: { id: string; regNo: string; capacity: number } | null;
  driver: { id: string; name: string; phone: string | null } | null;
  attendant: { id: string; name: string; phone: string | null } | null;
  distanceKm: number | null;
  status: string;
  notes: string | null;
  stopCount: number;
  activeAllocations: number;
  stops?: TransportStopDto[];
}

export interface TransportFareSlabDto {
  id: string;
  institutionId: string;
  name: string;
  minKm: number;
  maxKm: number;
  amount: number;
  frequency: string;
}

export interface TransportAllocationDto {
  id: string;
  institutionId: string;
  passengerType: PassengerType;
  studentId: string | null;
  employeeId: string | null;
  passengerName: string;
  passengerCode: string | null;
  route: { id: string; code: string; name: string };
  stop: { id: string; name: string; pickupTime: string | null; dropTime: string | null };
  tripType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  fareAmount: number;
  notes: string | null;
}

export interface TransportChargeDto {
  id: string;
  institutionId: string;
  allocationId: string;
  studentId: string | null;
  employeeId: string | null;
  passengerName: string;
  period: string;
  amount: number;
  status: string;
  externalRef: string | null;
}

export interface TransportTripDto {
  id: string;
  institutionId: string;
  route: { id: string; code: string; name: string };
  vehicle: { id: string; regNo: string } | null;
  driver: { id: string; name: string } | null;
  tripDate: string;
  direction: TransportTripDirection;
  status: TransportTripStatus;
  startedAt: string | null;
  endedAt: string | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  delayMinutes: number | null;
  notes: string | null;
  boarded: number;
  absent: number;
}

export interface TransportBoardingRowDto {
  allocationId: string;
  passengerName: string;
  stopName: string;
  status: string | null;
}

export interface TransportIncidentDto {
  id: string;
  institutionId: string;
  tripId: string | null;
  routeId: string | null;
  vehicleId: string | null;
  occurredAt: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  resolution: string | null;
}

export interface VehicleFuelLogDto {
  id: string;
  institutionId: string;
  vehicleId: string;
  vehicleRegNo: string;
  logDate: string;
  litres: number;
  amount: number;
  odometerKm: number | null;
  vendor: string | null;
}

export interface VehicleMaintenanceDto {
  id: string;
  institutionId: string;
  vehicleId: string;
  vehicleRegNo: string;
  serviceDate: string;
  kind: string;
  description: string;
  cost: number;
  odometerKm: number | null;
  vendor: string | null;
  nextServiceDate: string | null;
}

export interface TransportDashboardDto {
  vehicles: number;
  activeVehicles: number;
  drivers: number;
  routes: number;
  stops: number;
  allocatedStudents: number;
  allocatedStaff: number;
  totalSeats: number;
  seatUtilisationPercent: number;
  tripsToday: number;
  openIncidents: number;
  expiringDocuments: {
    vehicleId: string | null;
    staffId: string | null;
    label: string;
    kind: string;
    expiresOn: string;
  }[];
  serviceDue: { vehicleId: string; regNo: string; nextServiceDate: string }[];
}

export interface TransportReportDto {
  routes: {
    routeId: string;
    code: string;
    name: string;
    capacity: number;
    allocated: number;
    monthlyFare: number;
  }[];
  vehicles: {
    vehicleId: string;
    regNo: string;
    fuelLitres: number;
    fuelCost: number;
    maintenanceCost: number;
    trips: number;
    distanceKm: number;
  }[];
  charges: { period: string; status: string; count: number; amount: number }[];
}

export interface MyTransportDto {
  studentId: string | null;
  employeeId: string | null;
  passengerName: string;
  allocation: TransportAllocationDto | null;
  route: {
    code: string;
    name: string;
    stops: { name: string; sequence: number; pickupTime: string | null; dropTime: string | null }[];
  } | null;
  vehicle: { regNo: string; vehicleType: string; capacity: number } | null;
  driver: { name: string; phone: string | null } | null;
  attendant: { name: string; phone: string | null } | null;
  latestTrips: {
    tripDate: string;
    direction: string;
    status: string;
    delayMinutes: number | null;
    boarding: string | null;
  }[];
}
