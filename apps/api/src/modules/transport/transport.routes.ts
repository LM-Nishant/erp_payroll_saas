import { Router, type Request, type RequestHandler } from 'express';
import {
  broadcastRouteSchema,
  createTransportAllocationSchema,
  createTransportFareSlabSchema,
  createTransportIncidentSchema,
  createTransportRouteSchema,
  createTransportStaffSchema,
  createTransportStopSchema,
  createTransportTripSchema,
  createVehicleFuelLogSchema,
  createVehicleMaintenanceSchema,
  createVehicleSchema,
  endTransportAllocationSchema,
  generateTransportChargesSchema,
  idParamSchema,
  recordBoardingSchema,
  transportListQuerySchema,
  transportReportQuerySchema,
  updateTransportAllocationSchema,
  updateTransportChargeSchema,
  updateTransportFareSlabSchema,
  updateTransportIncidentSchema,
  updateTransportRouteSchema,
  updateTransportStaffSchema,
  updateTransportStopSchema,
  updateTransportTripSchema,
  updateVehicleSchema,
  type TransportListQuery,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { allocationService, transportChargeService } from './transport.allocations';
import {
  fareSlabService,
  routeService,
  transportStaffService,
  vehicleService,
} from './transport.fleet';
import {
  broadcastToRoute,
  fuelService,
  incidentService,
  maintenanceService,
  transportDashboard,
  transportReport,
  tripService,
} from './transport.operations';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const VIEW = requirePermission('transport.view');
const MANAGE = requirePermission('transport.manage');
const ALLOCATE = requirePermission('transport.allocate');

type Lister = (q: TransportListQuery) => Promise<{ items: unknown[]; total: number }>;
const list =
  (fn: Lister): RequestHandler =>
  async (req, res) => {
    const query = parseInput(transportListQuerySchema, req.query);
    const { items, total } = await fn(query);
    res.json(toListResponse(items, total, query));
  };

export const transportRouter = Router();
const r = transportRouter;

// Portal
r.get('/me', requirePermission('transport.view_own'), async (_req, res) => {
  res.json({ data: await allocationService.mine() });
});

// Dashboard & reports
r.get('/dashboard', VIEW, async (req, res) => {
  const { institutionId } = parseInput(transportReportQuerySchema, req.query);
  res.json({ data: await transportDashboard(institutionId) });
});
r.get('/reports', VIEW, async (req, res) => {
  res.json({ data: await transportReport(parseInput(transportReportQuerySchema, req.query)) });
});

// Vehicles
r.get(
  '/vehicles',
  VIEW,
  list((q) => vehicleService.list(q)),
);
r.post('/vehicles', MANAGE, async (req, res) => {
  res
    .status(201)
    .json({ data: await vehicleService.create(parseInput(createVehicleSchema, req.body)) });
});
r.get('/vehicles/:id', VIEW, async (req, res) => {
  res.json({ data: await vehicleService.get(idOf(req)) });
});
r.patch('/vehicles/:id', MANAGE, async (req, res) => {
  res.json({
    data: await vehicleService.update(idOf(req), parseInput(updateVehicleSchema, req.body)),
  });
});
r.delete('/vehicles/:id', MANAGE, async (req, res) => {
  await vehicleService.remove(idOf(req));
  res.status(204).end();
});

// Drivers / conductors / attendants
r.get(
  '/staff',
  VIEW,
  list((q) => transportStaffService.list(q)),
);
r.post('/staff', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await transportStaffService.create(parseInput(createTransportStaffSchema, req.body)),
  });
});
r.get('/staff/:id', VIEW, async (req, res) => {
  res.json({ data: await transportStaffService.get(idOf(req)) });
});
r.patch('/staff/:id', MANAGE, async (req, res) => {
  res.json({
    data: await transportStaffService.update(
      idOf(req),
      parseInput(updateTransportStaffSchema, req.body),
    ),
  });
});
r.delete('/staff/:id', MANAGE, async (req, res) => {
  await transportStaffService.remove(idOf(req));
  res.status(204).end();
});

// Routes & stops
r.get(
  '/routes',
  VIEW,
  list((q) => routeService.list(q)),
);
r.post('/routes', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await routeService.create(parseInput(createTransportRouteSchema, req.body)),
  });
});
r.get('/routes/:id', VIEW, async (req, res) => {
  res.json({ data: await routeService.get(idOf(req)) });
});
r.patch('/routes/:id', MANAGE, async (req, res) => {
  res.json({
    data: await routeService.update(idOf(req), parseInput(updateTransportRouteSchema, req.body)),
  });
});
r.delete('/routes/:id', MANAGE, async (req, res) => {
  await routeService.remove(idOf(req));
  res.status(204).end();
});
r.post('/routes/:id/stops', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await routeService.addStop(idOf(req), parseInput(createTransportStopSchema, req.body)),
  });
});
r.post('/routes/:id/broadcast', MANAGE, async (req, res) => {
  res.json({ data: await broadcastToRoute(idOf(req), parseInput(broadcastRouteSchema, req.body)) });
});
r.patch('/stops/:id', MANAGE, async (req, res) => {
  res.json({
    data: await routeService.updateStop(idOf(req), parseInput(updateTransportStopSchema, req.body)),
  });
});
r.delete('/stops/:id', MANAGE, async (req, res) => {
  await routeService.removeStop(idOf(req));
  res.status(204).end();
});

// Fare slabs
r.get(
  '/fare-slabs',
  VIEW,
  list((q) => fareSlabService.list(q)),
);
r.post('/fare-slabs', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await fareSlabService.create(parseInput(createTransportFareSlabSchema, req.body)),
  });
});
r.patch('/fare-slabs/:id', MANAGE, async (req, res) => {
  res.json({
    data: await fareSlabService.update(
      idOf(req),
      parseInput(updateTransportFareSlabSchema, req.body),
    ),
  });
});
r.delete('/fare-slabs/:id', MANAGE, async (req, res) => {
  await fareSlabService.remove(idOf(req));
  res.status(204).end();
});

// Allocations & charges
r.get(
  '/allocations',
  VIEW,
  list((q) => allocationService.list(q)),
);
r.post('/allocations', ALLOCATE, async (req, res) => {
  res.status(201).json({
    data: await allocationService.create(parseInput(createTransportAllocationSchema, req.body)),
  });
});
r.get('/allocations/:id', VIEW, async (req, res) => {
  res.json({ data: await allocationService.get(idOf(req)) });
});
r.patch('/allocations/:id', ALLOCATE, async (req, res) => {
  res.json({
    data: await allocationService.update(
      idOf(req),
      parseInput(updateTransportAllocationSchema, req.body),
    ),
  });
});
r.post('/allocations/:id/end', ALLOCATE, async (req, res) => {
  res.json({
    data: await allocationService.end(
      idOf(req),
      parseInput(endTransportAllocationSchema, req.body),
    ),
  });
});
r.get(
  '/charges',
  VIEW,
  list((q) => transportChargeService.list(q)),
);
r.post('/charges/generate', ALLOCATE, async (req, res) => {
  res.json({
    data: await transportChargeService.generate(
      parseInput(generateTransportChargesSchema, req.body),
    ),
  });
});
r.patch('/charges/:id', ALLOCATE, async (req, res) => {
  res.json({
    data: await transportChargeService.update(
      idOf(req),
      parseInput(updateTransportChargeSchema, req.body),
    ),
  });
});

// Trips & boarding
r.get(
  '/trips',
  VIEW,
  list((q) => tripService.list(q)),
);
r.post('/trips', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await tripService.create(parseInput(createTransportTripSchema, req.body)),
  });
});
r.get('/trips/:id', VIEW, async (req, res) => {
  res.json({ data: await tripService.get(idOf(req)) });
});
r.patch('/trips/:id', MANAGE, async (req, res) => {
  res.json({
    data: await tripService.update(idOf(req), parseInput(updateTransportTripSchema, req.body)),
  });
});
r.get('/trips/:id/boarding', VIEW, async (req, res) => {
  res.json({ data: await tripService.boarding(idOf(req)) });
});
r.put('/trips/:id/boarding', MANAGE, async (req, res) => {
  res.json({
    data: await tripService.recordBoarding(idOf(req), parseInput(recordBoardingSchema, req.body)),
  });
});

// Incidents, fuel, maintenance
r.get(
  '/incidents',
  VIEW,
  list((q) => incidentService.list(q)),
);
r.post('/incidents', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await incidentService.create(parseInput(createTransportIncidentSchema, req.body)),
  });
});
r.patch('/incidents/:id', MANAGE, async (req, res) => {
  res.json({
    data: await incidentService.update(
      idOf(req),
      parseInput(updateTransportIncidentSchema, req.body),
    ),
  });
});
r.get(
  '/fuel-logs',
  VIEW,
  list((q) => fuelService.list(q)),
);
r.post('/fuel-logs', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await fuelService.create(parseInput(createVehicleFuelLogSchema, req.body)),
  });
});
r.delete('/fuel-logs/:id', MANAGE, async (req, res) => {
  await fuelService.remove(idOf(req));
  res.status(204).end();
});
r.get(
  '/maintenance',
  VIEW,
  list((q) => maintenanceService.list(q)),
);
r.post('/maintenance', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await maintenanceService.create(parseInput(createVehicleMaintenanceSchema, req.body)),
  });
});
r.delete('/maintenance/:id', MANAGE, async (req, res) => {
  await maintenanceService.remove(idOf(req));
  res.status(204).end();
});
