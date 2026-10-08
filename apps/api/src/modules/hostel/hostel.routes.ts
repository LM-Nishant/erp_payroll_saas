import { Router, type Request, type RequestHandler } from 'express';
import {
  applyOwnOutpassSchema,
  createHostelAllocationSchema,
  createHostelBlockSchema,
  createHostelComplaintSchema,
  createHostelMovementSchema,
  createHostelRoomSchema,
  createHostelSchema,
  createHostelVisitorSchema,
  createMessPlanSchema,
  createOutpassSchema,
  decideOutpassSchema,
  generateHostelChargesSchema,
  hostelListQuerySchema,
  hostelReportQuerySchema,
  idParamSchema,
  outpassGateSchema,
  raiseOwnComplaintSchema,
  rollCallQuerySchema,
  saveRollCallSchema,
  transferHostelAllocationSchema,
  updateHostelAllocationSchema,
  updateHostelBedSchema,
  updateHostelBlockSchema,
  updateHostelChargeSchema,
  updateHostelComplaintSchema,
  updateHostelRoomSchema,
  updateHostelSchema,
  updateMessPlanSchema,
  vacateHostelAllocationSchema,
  type HostelListQuery,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { hostelAllocationService, hostelChargeService } from './hostel.allocations';
import {
  complaintService,
  hostelDashboard,
  hostelReport,
  movementService,
  outpassService,
  rollCallService,
  visitorService,
} from './hostel.operations';
import { blockService, hostelService, messPlanService, roomService } from './hostel.structure';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const VIEW = requirePermission('hostel.view');
const MANAGE = requirePermission('hostel.manage');
const ALLOCATE = requirePermission('hostel.allocate');
const APPROVE = requirePermission('hostel.outpass_approve');
const VIEW_OWN = requirePermission('hostel.view_own');
const APPLY_OWN = requirePermission('hostel.apply_own');

type Lister = (q: HostelListQuery) => Promise<{ items: unknown[]; total: number }>;
const list =
  (fn: Lister): RequestHandler =>
  async (req, res) => {
    const query = parseInput(hostelListQuerySchema, req.query);
    const { items, total } = await fn(query);
    res.json(toListResponse(items, total, query));
  };

export const hostelRouter = Router();
const r = hostelRouter;

// Portal ("My hostel")
r.get('/me', VIEW_OWN, async (_req, res) => {
  res.json({ data: await hostelAllocationService.mine() });
});
r.post('/me/outpasses', APPLY_OWN, async (req, res) => {
  res
    .status(201)
    .json({ data: await outpassService.applyOwn(parseInput(applyOwnOutpassSchema, req.body)) });
});
r.post('/me/outpasses/:id/cancel', APPLY_OWN, async (req, res) => {
  res.json({ data: await outpassService.cancel(idOf(req), true) });
});
r.post('/me/complaints', APPLY_OWN, async (req, res) => {
  res
    .status(201)
    .json({ data: await complaintService.raiseOwn(parseInput(raiseOwnComplaintSchema, req.body)) });
});

// Dashboard & reports
r.get('/dashboard', VIEW, async (req, res) => {
  const { institutionId } = parseInput(hostelReportQuerySchema, req.query);
  res.json({ data: await hostelDashboard(institutionId) });
});
r.get('/reports', VIEW, async (req, res) => {
  res.json({ data: await hostelReport(parseInput(hostelReportQuerySchema, req.query)) });
});

// Rooms & beds (cross-hostel)
r.get(
  '/rooms',
  VIEW,
  list((q) => roomService.list(q)),
);
r.get('/rooms/:id', VIEW, async (req, res) => {
  res.json({ data: await roomService.get(idOf(req)) });
});
r.patch('/rooms/:id', MANAGE, async (req, res) => {
  res.json({
    data: await roomService.update(idOf(req), parseInput(updateHostelRoomSchema, req.body)),
  });
});
r.delete('/rooms/:id', MANAGE, async (req, res) => {
  await roomService.remove(idOf(req));
  res.status(204).end();
});
r.patch('/beds/:id', MANAGE, async (req, res) => {
  res.json({
    data: await roomService.updateBed(idOf(req), parseInput(updateHostelBedSchema, req.body)),
  });
});

// Blocks & mess plans
r.patch('/blocks/:id', MANAGE, async (req, res) => {
  res.json({
    data: await blockService.update(idOf(req), parseInput(updateHostelBlockSchema, req.body)),
  });
});
r.delete('/blocks/:id', MANAGE, async (req, res) => {
  await blockService.remove(idOf(req));
  res.status(204).end();
});
r.patch('/mess-plans/:id', MANAGE, async (req, res) => {
  res.json({
    data: await messPlanService.update(idOf(req), parseInput(updateMessPlanSchema, req.body)),
  });
});
r.delete('/mess-plans/:id', MANAGE, async (req, res) => {
  await messPlanService.remove(idOf(req));
  res.status(204).end();
});

// Allocations
r.get(
  '/allocations',
  VIEW,
  list((q) => hostelAllocationService.list(q)),
);
r.post('/allocations', ALLOCATE, async (req, res) => {
  res.status(201).json({
    data: await hostelAllocationService.create(parseInput(createHostelAllocationSchema, req.body)),
  });
});
r.get('/allocations/:id', VIEW, async (req, res) => {
  res.json({ data: await hostelAllocationService.get(idOf(req)) });
});
r.patch('/allocations/:id', ALLOCATE, async (req, res) => {
  res.json({
    data: await hostelAllocationService.update(
      idOf(req),
      parseInput(updateHostelAllocationSchema, req.body),
    ),
  });
});
r.post('/allocations/:id/vacate', ALLOCATE, async (req, res) => {
  res.json({
    data: await hostelAllocationService.vacate(
      idOf(req),
      parseInput(vacateHostelAllocationSchema, req.body),
    ),
  });
});
r.post('/allocations/:id/transfer', ALLOCATE, async (req, res) => {
  res.status(201).json({
    data: await hostelAllocationService.transfer(
      idOf(req),
      parseInput(transferHostelAllocationSchema, req.body),
    ),
  });
});

// Charges
r.get(
  '/charges',
  VIEW,
  list((q) => hostelChargeService.list(q)),
);
r.post('/charges/generate', ALLOCATE, async (req, res) => {
  res.json({
    data: await hostelChargeService.generate(parseInput(generateHostelChargesSchema, req.body)),
  });
});
r.patch('/charges/:id', ALLOCATE, async (req, res) => {
  res.json({
    data: await hostelChargeService.update(
      idOf(req),
      parseInput(updateHostelChargeSchema, req.body),
    ),
  });
});

// Out-passes
r.get(
  '/outpasses',
  VIEW,
  list((q) => outpassService.list(q)),
);
r.post('/outpasses', MANAGE, async (req, res) => {
  res
    .status(201)
    .json({ data: await outpassService.create(parseInput(createOutpassSchema, req.body)) });
});
r.get('/outpasses/:id', VIEW, async (req, res) => {
  res.json({ data: await outpassService.get(idOf(req)) });
});
r.post('/outpasses/:id/decide', APPROVE, async (req, res) => {
  res.json({
    data: await outpassService.decide(idOf(req), parseInput(decideOutpassSchema, req.body)),
  });
});
r.post('/outpasses/:id/cancel', MANAGE, async (req, res) => {
  res.json({ data: await outpassService.cancel(idOf(req), false) });
});
r.post('/outpasses/:id/checkout', MANAGE, async (req, res) => {
  res.json({
    data: await outpassService.checkout(idOf(req), parseInput(outpassGateSchema, req.body ?? {})),
  });
});
r.post('/outpasses/:id/return', MANAGE, async (req, res) => {
  res.json({
    data: await outpassService.markReturned(
      idOf(req),
      parseInput(outpassGateSchema, req.body ?? {}),
    ),
  });
});

// Visitors & in/out register
r.get(
  '/visitors',
  VIEW,
  list((q) => visitorService.list(q)),
);
r.post('/visitors', MANAGE, async (req, res) => {
  res
    .status(201)
    .json({ data: await visitorService.create(parseInput(createHostelVisitorSchema, req.body)) });
});
r.post('/visitors/:id/checkout', MANAGE, async (req, res) => {
  res.json({
    data: await visitorService.checkout(idOf(req), parseInput(outpassGateSchema, req.body ?? {})),
  });
});
r.get(
  '/movements',
  VIEW,
  list((q) => movementService.list(q)),
);
r.post('/movements', MANAGE, async (req, res) => {
  res
    .status(201)
    .json({ data: await movementService.create(parseInput(createHostelMovementSchema, req.body)) });
});

// Complaints
r.get(
  '/complaints',
  VIEW,
  list((q) => complaintService.list(q)),
);
r.post('/complaints', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await complaintService.create(parseInput(createHostelComplaintSchema, req.body)),
  });
});
r.patch('/complaints/:id', MANAGE, async (req, res) => {
  res.json({
    data: await complaintService.update(
      idOf(req),
      parseInput(updateHostelComplaintSchema, req.body),
    ),
  });
});

// Roll call
r.get('/roll-call', VIEW, async (req, res) => {
  res.json({ data: await rollCallService.sheet(parseInput(rollCallQuerySchema, req.query)) });
});
r.put('/roll-call', MANAGE, async (req, res) => {
  res.json({ data: await rollCallService.save(parseInput(saveRollCallSchema, req.body)) });
});

// Hostels (+ nested blocks / rooms / mess plans)
r.get(
  '/',
  VIEW,
  list((q) => hostelService.list(q)),
);
r.post('/', MANAGE, async (req, res) => {
  res
    .status(201)
    .json({ data: await hostelService.create(parseInput(createHostelSchema, req.body)) });
});
r.get('/:id', VIEW, async (req, res) => {
  res.json({ data: await hostelService.get(idOf(req)) });
});
r.patch('/:id', MANAGE, async (req, res) => {
  res.json({
    data: await hostelService.update(idOf(req), parseInput(updateHostelSchema, req.body)),
  });
});
r.delete('/:id', MANAGE, async (req, res) => {
  await hostelService.remove(idOf(req));
  res.status(204).end();
});
r.get('/:id/blocks', VIEW, async (req, res) => {
  res.json({ data: await blockService.list(idOf(req)) });
});
r.post('/:id/blocks', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await blockService.create(idOf(req), parseInput(createHostelBlockSchema, req.body)),
  });
});
r.post('/:id/rooms', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await roomService.create(idOf(req), parseInput(createHostelRoomSchema, req.body)),
  });
});
r.get('/:id/mess-plans', VIEW, async (req, res) => {
  res.json({ data: await messPlanService.list(idOf(req)) });
});
r.post('/:id/mess-plans', MANAGE, async (req, res) => {
  res.status(201).json({
    data: await messPlanService.create(idOf(req), parseInput(createMessPlanSchema, req.body)),
  });
});
