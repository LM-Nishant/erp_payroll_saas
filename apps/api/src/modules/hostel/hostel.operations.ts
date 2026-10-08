import type { Prisma } from '@prisma/client';
import type {
  ApplyOwnOutpassInput,
  CreateHostelComplaintInput,
  CreateHostelMovementInput,
  CreateHostelVisitorInput,
  CreateOutpassInput,
  DecideOutpassInput,
  HostelComplaintDto,
  HostelDashboardDto,
  HostelListQuery,
  HostelMovementDto,
  HostelReportDto,
  HostelReportQuery,
  HostelVisitorDto,
  OutpassDto,
  OutpassGateInput,
  OutpassStatus,
  RaiseOwnComplaintInput,
  RollCallQuery,
  RollCallSheetDto,
  SaveRollCallInput,
  UpdateHostelComplaintInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { currentPrincipal, findScopeHolders, tryGetPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { publish } from '../../core/notifications';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { cancelWorkflow } from '../../core/workflow/engine';
import {
  assertVisible,
  authorizeRow,
  dateStr,
  familyUserIds,
  institutionScope,
  isoOrNull,
  myStudentIds,
  num,
  studentRefs,
  toDate,
  today,
} from '../transport/transport.common';
import { canTransitionOutpass, occupancyPercent } from './hostel.logic';
import { HOSTEL_MANAGE, HOSTEL_VIEW, loadHostel } from './hostel.structure';

const db = () => tenantDb();
const userId = () => tryGetPrincipal()?.userId ?? null;

export const HOSTEL_OUTPASS_WORKFLOW = 'hostel_outpass';
export const HOSTEL_OUTPASS_APPROVE = 'hostel.outpass_approve';
export const HOSTEL_EVENTS = {
  allocationCreated: 'hostel.allocation.created',
  allocationVacated: 'hostel.allocation.vacated',
  outpassApproved: 'hostel.outpass.approved',
  outpassRejected: 'hostel.outpass.rejected',
  complaintRaised: 'hostel.complaint.raised',
} as const;
export const HOSTEL_NOTIFICATIONS = {
  outpassSubmitted: 'hostel.outpass_submitted',
  outpassDecided: 'hostel.outpass_decided',
  complaintUpdated: 'hostel.complaint_updated',
} as const;

const dateRange = (query: HostelListQuery, field: string) =>
  query.from || query.to
    ? {
        [field]: {
          ...(query.from && { gte: toDate(query.from) }),
          ...(query.to && { lt: new Date(toDate(query.to).getTime() + 86_400_000) }),
        },
      }
    : {};

/** The student's active allocation (gives the hostel); 422 when not a hosteller. */
async function activeStudentAllocation(studentId: string) {
  const a = await db().hostelAllocation.findFirst({
    where: { studentId, status: 'ACTIVE' },
    include: { hostel: true },
  });
  if (!a) {
    throw new AppError(422, 'NOT_A_HOSTELLER', 'Student has no active hostel allocation');
  }
  return a;
}

/** Portal: resolve which of my students the request is for (parents must pick the ward). */
async function ownStudentId(studentId?: string) {
  const mine = await myStudentIds();
  if (studentId) {
    if (!mine.includes(studentId)) throw new InvalidReferenceError('studentId', 'Student');
    return studentId;
  }
  const own = await db().student.findFirst({
    where: { userId: currentPrincipal().userId ?? '__none__' },
    select: { id: true },
  });
  if (own) return own.id;
  if (mine.length === 1) return mine[0]!;
  throw new AppError(400, 'VALIDATION_ERROR', 'studentId is required');
}

// ---- Visitors -------------------------------------------------------------------------------
type VisitorRow = Prisma.HostelVisitorGetPayload<{
  include: { hostel: { select: { name: true } } };
}>;
function toVisitorDto(v: VisitorRow, studentName: string | null): HostelVisitorDto {
  return {
    id: v.id,
    hostelId: v.hostelId,
    hostelName: v.hostel.name,
    studentId: v.studentId,
    studentName,
    visitorName: v.visitorName,
    relation: v.relation,
    phone: v.phone,
    idProof: v.idProof,
    purpose: v.purpose,
    checkInAt: v.checkInAt.toISOString(),
    checkOutAt: isoOrNull(v.checkOutAt),
  };
}

export const visitorService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelVisitorWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.hostelId && { hostelId: query.hostelId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.status === 'IN' && { checkOutAt: null }),
      ...(query.search && { visitorName: { contains: query.search } }),
      ...dateRange(query, 'checkInAt'),
    };
    const [rows, total] = await Promise.all([
      db().hostelVisitor.findMany({
        where,
        include: { hostel: { select: { name: true } } },
        orderBy: { checkInAt: 'desc' },
        ...toPageWindow(query),
      }),
      db().hostelVisitor.count({ where }),
    ]);
    const students = await studentRefs(rows.map((r) => r.studentId));
    return {
      items: rows.map((r) => toVisitorDto(r, students.get(r.studentId ?? '')?.name ?? null)),
      total,
    };
  },

  async create(input: CreateHostelVisitorInput) {
    const hostel = await loadHostel(input.hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    let studentName: string | null = null;
    if (input.studentId) {
      const a = await db().hostelAllocation.findFirst({
        where: { studentId: input.studentId, hostelId: hostel.id, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!a) throw new InvalidReferenceError('studentId', 'Hosteller');
      studentName = (await studentRefs([input.studentId])).get(input.studentId)?.name ?? null;
    }
    const v = await db().hostelVisitor.create({
      data: withTenant({
        institutionId: hostel.institutionId,
        hostelId: hostel.id,
        studentId: input.studentId ?? null,
        visitorName: input.visitorName,
        relation: input.relation ?? null,
        phone: input.phone ?? null,
        idProof: input.idProof ?? null,
        purpose: input.purpose ?? null,
        checkInAt: input.checkInAt ? new Date(input.checkInAt) : new Date(),
        recordedByUserId: userId(),
      }),
      include: { hostel: { select: { name: true } } },
    });
    const dto = toVisitorDto(v, studentName);
    await audit.record({
      action: 'hostel_visitor.checked_in',
      entityType: 'hostel_visitor',
      entityId: v.id,
      after: dto,
    });
    return dto;
  },

  async checkout(id: string, input: OutpassGateInput) {
    const before = await assertVisible(
      await db().hostelVisitor.findFirst({ where: { id } }),
      HOSTEL_VIEW,
      'Visitor',
    );
    await authorizeRow(before, HOSTEL_MANAGE);
    if (before.checkOutAt) throw new ConflictError('Visitor already checked out');
    const at = input.at ? new Date(input.at) : new Date();
    if (at < before.checkInAt) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Check-out must be after check-in');
    }
    const v = await db().hostelVisitor.update({
      where: { id },
      data: { checkOutAt: at },
      include: { hostel: { select: { name: true } } },
    });
    await audit.record({
      action: 'hostel_visitor.checked_out',
      entityType: 'hostel_visitor',
      entityId: id,
      after: { checkOutAt: at.toISOString() },
    });
    const name = v.studentId ? (await studentRefs([v.studentId])).get(v.studentId)?.name : null;
    return toVisitorDto(v, name ?? null);
  },
};

// ---- Out-passes -----------------------------------------------------------------------------
type OutpassRow = Prisma.HostelOutpassGetPayload<{
  include: { hostel: { select: { name: true } } };
}>;
function toOutpassDto(o: OutpassRow, studentName: string): OutpassDto {
  return {
    id: o.id,
    institutionId: o.institutionId,
    hostelId: o.hostelId,
    hostelName: o.hostel.name,
    studentId: o.studentId,
    studentName,
    passType: o.passType,
    fromAt: o.fromAt.toISOString(),
    toAt: o.toAt.toISOString(),
    destination: o.destination,
    reason: o.reason,
    status: o.status as OutpassStatus,
    workflowInstanceId: o.workflowInstanceId,
    decidedComment: o.decidedComment,
    decidedAt: isoOrNull(o.decidedAt),
    outAt: isoOrNull(o.outAt),
    returnedAt: isoOrNull(o.returnedAt),
    createdAt: o.createdAt.toISOString(),
  };
}

const outpassInclude = { hostel: { select: { name: true } } } as const;

async function outpassDtos(rows: OutpassRow[]) {
  const students = await studentRefs(rows.map((r) => r.studentId));
  return rows.map((r) => toOutpassDto(r, students.get(r.studentId)?.name ?? '—'));
}

async function outpassDto(id: string) {
  const o = await db().hostelOutpass.findFirstOrThrow({ where: { id }, include: outpassInclude });
  return (await outpassDtos([o]))[0]!;
}

async function loadOutpass(id: string) {
  return assertVisible(
    await db().hostelOutpass.findFirst({ where: { id }, include: outpassInclude }),
    HOSTEL_VIEW,
    'Out-pass',
  );
}

/** Applies an approval decision; idempotent (used by the direct endpoint and workflow callbacks). */
async function applyOutpassDecision(
  ref: Pick<WorkflowInstanceRef, 'entityId' | 'comment'>,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
): Promise<void> {
  const o = await db().hostelOutpass.findFirst({ where: { id: ref.entityId } });
  if (!o || o.status !== 'PENDING') return;
  const updated = await db().hostelOutpass.updateMany({
    where: { id: o.id, status: 'PENDING' },
    data: {
      status,
      decidedComment: ref.comment ?? null,
      decidedAt: new Date(),
      decidedByUserId: userId(),
    },
  });
  if (updated.count !== 1) return;
  await audit.record({
    action: `hostel_outpass.${status.toLowerCase()}`,
    entityType: 'hostel_outpass',
    entityId: o.id,
    before: { status: o.status },
    after: { status, comment: ref.comment ?? null },
  });
  if (status === 'CANCELLED') return;
  await emit(
    status === 'APPROVED' ? HOSTEL_EVENTS.outpassApproved : HOSTEL_EVENTS.outpassRejected,
    { outpassId: o.id, studentId: o.studentId, hostelId: o.hostelId },
    { institutionId: o.institutionId },
  );
  const recipients = await familyUserIds([o.studentId]);
  if (recipients.length) {
    const name = (await studentRefs([o.studentId])).get(o.studentId)?.name ?? 'Student';
    await publish(HOSTEL_NOTIFICATIONS.outpassDecided, {
      recipients,
      title: `Out-pass ${status === 'APPROVED' ? 'approved' : 'rejected'}: ${name}`,
      body: `${o.passType} ${dateStr(o.fromAt)} → ${dateStr(o.toAt)}${ref.comment ? ` — ${ref.comment}` : ''}`,
      link: '/portal/hostel',
      data: { outpassId: o.id, status },
      institutionId: o.institutionId,
    });
  }
}

export const outpassWorkflowCallbacks = {
  linkFor: () => '/institution/hostel/outpasses',
  onApproved: (ref: WorkflowInstanceRef) => applyOutpassDecision(ref, 'APPROVED'),
  onRejected: (ref: WorkflowInstanceRef) => applyOutpassDecision(ref, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) => applyOutpassDecision(ref, 'CANCELLED'),
};

async function createOutpass(studentId: string, input: Omit<CreateOutpassInput, 'studentId'>) {
  const a = await activeStudentAllocation(studentId);
  const overlapping = await db().hostelOutpass.findFirst({
    where: {
      studentId,
      status: { in: ['PENDING', 'APPROVED', 'OUT'] },
      fromAt: { lt: new Date(input.toAt) },
      toAt: { gt: new Date(input.fromAt) },
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new ConflictError('An overlapping out-pass already exists', {
      outpassId: overlapping.id,
    });
  }
  const name = (await studentRefs([studentId])).get(studentId)?.name ?? 'Student';
  const o = await db().hostelOutpass.create({
    data: withTenant({
      institutionId: a.institutionId,
      groupId: a.hostel.groupId,
      hostelId: a.hostelId,
      studentId,
      passType: input.passType,
      fromAt: new Date(input.fromAt),
      toAt: new Date(input.toAt),
      destination: input.destination ?? null,
      reason: input.reason,
      requestedByUserId: userId(),
    }),
  });
  await audit.record({
    action: 'hostel_outpass.requested',
    entityType: 'hostel_outpass',
    entityId: o.id,
    after: { studentId, passType: o.passType, fromAt: input.fromAt, toAt: input.toAt },
  });
  const instance = await submitWorkflow({
    entityType: HOSTEL_OUTPASS_WORKFLOW,
    entityId: o.id,
    title: `Out-pass (${o.passType}) — ${name}`,
    requesterUserId: userId(),
    institutionId: a.institutionId,
    groupId: a.hostel.groupId,
    context: { studentId, hostelId: a.hostelId, passType: o.passType },
  });
  if (instance) {
    await db().hostelOutpass.updateMany({
      where: { id: o.id, workflowInstanceId: null },
      data: { workflowInstanceId: instance.id },
    });
  }
  const approvers = await findScopeHolders({
    permission: HOSTEL_OUTPASS_APPROVE,
    resource: { institutionId: a.institutionId, groupId: a.hostel.groupId ?? undefined },
  });
  if (approvers.length) {
    await publish(HOSTEL_NOTIFICATIONS.outpassSubmitted, {
      recipients: approvers,
      title: `Out-pass request: ${name}`,
      body: `${o.passType} ${dateStr(o.fromAt)} → ${dateStr(o.toAt)}: ${o.reason}`,
      link: '/institution/hostel/outpasses',
      data: { outpassId: o.id },
      institutionId: a.institutionId,
    });
  }
  return outpassDto(o.id);
}

async function gate(id: string, to: 'OUT' | 'RETURNED', input: OutpassGateInput) {
  const o = await loadOutpass(id);
  await authorizeRow(o, HOSTEL_MANAGE);
  if (!canTransitionOutpass(o.status as OutpassStatus, to)) {
    throw new AppError(409, 'INVALID_STATE', `Out-pass is ${o.status.toLowerCase()}`);
  }
  const at = input.at ? new Date(input.at) : new Date();
  await db().$transaction(async (tx) => {
    await tx.hostelOutpass.update({
      where: { id },
      data: to === 'OUT' ? { status: 'OUT', outAt: at } : { status: 'RETURNED', returnedAt: at },
    });
    await tx.hostelMovement.create({
      data: withTenant({
        institutionId: o.institutionId,
        hostelId: o.hostelId,
        studentId: o.studentId,
        outpassId: o.id,
        direction: to === 'OUT' ? 'OUT' : 'IN',
        at,
        notes: input.notes ?? null,
        recordedByUserId: userId(),
      }),
    });
  });
  await audit.record({
    action: to === 'OUT' ? 'hostel_outpass.checked_out' : 'hostel_outpass.returned',
    entityType: 'hostel_outpass',
    entityId: id,
    before: { status: o.status },
    after: { status: to, at: at.toISOString() },
  });
  return outpassDto(id);
}

export const outpassService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelOutpassWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.hostelId && { hostelId: query.hostelId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.status && { status: query.status }),
      ...dateRange(query, 'fromAt'),
    };
    if (query.search) {
      const s = await db().student.findMany({
        where: {
          OR: [
            { displayName: { contains: query.search } },
            { admissionNo: { contains: query.search } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      where.studentId = { in: s.map((x) => x.id) };
    }
    const [rows, total] = await Promise.all([
      db().hostelOutpass.findMany({
        where,
        include: outpassInclude,
        orderBy: { createdAt: 'desc' },
        ...toPageWindow(query),
      }),
      db().hostelOutpass.count({ where }),
    ]);
    return { items: await outpassDtos(rows), total };
  },

  async get(id: string) {
    return (await outpassDtos([await loadOutpass(id)]))[0]!;
  },

  /** Staff raising an out-pass on behalf of a hosteller. */
  async create(input: CreateOutpassInput) {
    const a = await activeStudentAllocation(input.studentId);
    await authorizeRow(a, HOSTEL_MANAGE);
    return createOutpass(input.studentId, input);
  },

  /** Portal: a student (or their parent) applies. */
  async applyOwn(input: ApplyOwnOutpassInput) {
    const studentId = await ownStudentId(input.studentId);
    return createOutpass(studentId, input);
  },

  /** Direct decision when no workflow definition governs `hostel_outpass`. */
  async decide(id: string, input: DecideOutpassInput) {
    const o = await loadOutpass(id);
    await authorizeRow(o, HOSTEL_OUTPASS_APPROVE);
    if (o.status !== 'PENDING') {
      throw new AppError(409, 'INVALID_STATE', `Out-pass is ${o.status.toLowerCase()}`);
    }
    if (o.workflowInstanceId) {
      throw new AppError(409, 'WORKFLOW_MANAGED', 'Act on the workflow instance of this out-pass');
    }
    if (o.requestedByUserId && o.requestedByUserId === userId()) {
      throw new ForbiddenError('You cannot decide your own request', 'MAKER_CHECKER');
    }
    await applyOutpassDecision(
      { entityId: id, comment: input.comment ?? null },
      input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    );
    return outpassDto(id);
  },

  /** Cancel: the requester (portal) or hostel staff. */
  async cancel(id: string, own: boolean) {
    const o = own
      ? await db().hostelOutpass.findFirst({ where: { id }, include: outpassInclude })
      : await loadOutpass(id);
    if (!o) throw new NotFoundError('Out-pass');
    if (own) {
      if (!(await myStudentIds()).includes(o.studentId)) throw new NotFoundError('Out-pass');
    } else {
      await authorizeRow(o, HOSTEL_MANAGE);
    }
    if (!['PENDING', 'APPROVED'].includes(o.status)) {
      throw new AppError(409, 'INVALID_STATE', `Out-pass is ${o.status.toLowerCase()}`);
    }
    if (o.status === 'PENDING' && o.workflowInstanceId) {
      const instance = await db().workflowInstance.findFirst({
        where: { id: o.workflowInstanceId },
      });
      if (instance && (instance.status === 'PENDING' || instance.status === 'SENT_BACK')) {
        await cancelWorkflow(instance, 'Out-pass withdrawn');
      }
    }
    await db().hostelOutpass.updateMany({
      where: { id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'CANCELLED' },
    });
    await audit.record({
      action: 'hostel_outpass.cancelled',
      entityType: 'hostel_outpass',
      entityId: id,
      before: { status: o.status },
      after: { status: 'CANCELLED' },
    });
    return outpassDto(id);
  },

  checkout: (id: string, input: OutpassGateInput) => gate(id, 'OUT', input),
  markReturned: (id: string, input: OutpassGateInput) => gate(id, 'RETURNED', input),

  async forStudent(studentId: string) {
    const rows = await db().hostelOutpass.findMany({
      where: { studentId },
      include: outpassInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return outpassDtos(rows);
  },
};

// ---- In/out register ------------------------------------------------------------------------
export const movementService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelMovementWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.hostelId && { hostelId: query.hostelId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.status && { direction: query.status }),
      ...dateRange(query, 'at'),
    };
    const [rows, total] = await Promise.all([
      db().hostelMovement.findMany({ where, orderBy: { at: 'desc' }, ...toPageWindow(query) }),
      db().hostelMovement.count({ where }),
    ]);
    const students = await studentRefs(rows.map((r) => r.studentId));
    return {
      items: rows.map((m): HostelMovementDto => ({
        id: m.id,
        hostelId: m.hostelId,
        studentId: m.studentId,
        studentName: students.get(m.studentId)?.name ?? '—',
        outpassId: m.outpassId,
        direction: m.direction,
        at: m.at.toISOString(),
        notes: m.notes,
      })),
      total,
    };
  },

  async create(input: CreateHostelMovementInput) {
    const hostel = await loadHostel(input.hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    const a = await db().hostelAllocation.findFirst({
      where: { studentId: input.studentId, hostelId: hostel.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!a) throw new InvalidReferenceError('studentId', 'Hosteller');
    const m = await db().hostelMovement.create({
      data: withTenant({
        institutionId: hostel.institutionId,
        hostelId: hostel.id,
        studentId: input.studentId,
        direction: input.direction,
        at: input.at ? new Date(input.at) : new Date(),
        notes: input.notes ?? null,
        recordedByUserId: userId(),
      }),
    });
    await audit.record({
      action: 'hostel_movement.recorded',
      entityType: 'hostel_movement',
      entityId: m.id,
      after: { studentId: m.studentId, direction: m.direction, at: m.at.toISOString() },
    });
    const name = (await studentRefs([m.studentId])).get(m.studentId)?.name ?? '—';
    return {
      id: m.id,
      hostelId: m.hostelId,
      studentId: m.studentId,
      studentName: name,
      outpassId: null,
      direction: m.direction,
      at: m.at.toISOString(),
      notes: m.notes,
    } satisfies HostelMovementDto;
  },
};

// ---- Complaints -----------------------------------------------------------------------------
const complaintInclude = {
  hostel: { select: { name: true } },
  room: { select: { roomNo: true } },
} as const;
type ComplaintRow = Prisma.HostelComplaintGetPayload<{ include: typeof complaintInclude }>;

async function complaintDtos(rows: ComplaintRow[]): Promise<HostelComplaintDto[]> {
  const students = await studentRefs(rows.map((r) => r.studentId));
  return rows.map((c) => ({
    id: c.id,
    hostelId: c.hostelId,
    hostelName: c.hostel.name,
    roomId: c.roomId,
    roomNo: c.room?.roomNo ?? null,
    studentId: c.studentId,
    studentName: c.studentId ? (students.get(c.studentId)?.name ?? null) : null,
    category: c.category,
    title: c.title,
    description: c.description,
    priority: c.priority,
    status: c.status as HostelComplaintDto['status'],
    resolution: c.resolution,
    resolvedAt: isoOrNull(c.resolvedAt),
    createdAt: c.createdAt.toISOString(),
  }));
}

async function complaintDto(id: string) {
  const c = await db().hostelComplaint.findFirstOrThrow({
    where: { id },
    include: complaintInclude,
  });
  return (await complaintDtos([c]))[0]!;
}

async function insertComplaint(
  hostel: { id: string; institutionId: string },
  data: {
    roomId: string | null;
    studentId: string | null;
    category: string;
    title: string;
    description?: string | null;
    priority: string;
  },
) {
  const c = await db().hostelComplaint.create({
    data: withTenant({
      institutionId: hostel.institutionId,
      hostelId: hostel.id,
      roomId: data.roomId,
      studentId: data.studentId,
      category: data.category,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority,
      raisedByUserId: userId(),
    }),
  });
  await audit.record({
    action: 'hostel_complaint.raised',
    entityType: 'hostel_complaint',
    entityId: c.id,
    after: { hostelId: hostel.id, category: c.category, title: c.title, priority: c.priority },
  });
  await emit(
    HOSTEL_EVENTS.complaintRaised,
    { complaintId: c.id, hostelId: hostel.id, category: c.category, priority: c.priority },
    { institutionId: hostel.institutionId },
  );
  return complaintDto(c.id);
}

export const complaintService = {
  async list(query: HostelListQuery) {
    const where: Prisma.HostelComplaintWhereInput = {
      ...(await institutionScope(HOSTEL_VIEW)),
      ...(query.institutionId && { institutionId: query.institutionId }),
      ...(query.hostelId && { hostelId: query.hostelId }),
      ...(query.roomId && { roomId: query.roomId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.status && { status: query.status }),
      ...(query.search && { title: { contains: query.search } }),
      ...dateRange(query, 'createdAt'),
    };
    const [rows, total] = await Promise.all([
      db().hostelComplaint.findMany({
        where,
        include: complaintInclude,
        orderBy: [{ createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      db().hostelComplaint.count({ where }),
    ]);
    return { items: await complaintDtos(rows), total };
  },

  async create(input: CreateHostelComplaintInput) {
    const hostel = await loadHostel(input.hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    if (input.roomId) {
      const room = await db().hostelRoom.findFirst({
        where: { id: input.roomId, hostelId: hostel.id },
      });
      if (!room) throw new InvalidReferenceError('roomId', 'Room');
    }
    if (input.studentId) {
      const a = await db().hostelAllocation.findFirst({
        where: { studentId: input.studentId, hostelId: hostel.id },
        select: { id: true },
      });
      if (!a) throw new InvalidReferenceError('studentId', 'Hosteller');
    }
    return insertComplaint(hostel, {
      roomId: input.roomId ?? null,
      studentId: input.studentId ?? null,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });
  },

  /** Portal: raise for own room. */
  async raiseOwn(input: RaiseOwnComplaintInput) {
    const studentId = await ownStudentId(input.studentId);
    const a = await activeStudentAllocation(studentId);
    return insertComplaint(a.hostel, {
      roomId: a.roomId,
      studentId,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });
  },

  async update(id: string, input: UpdateHostelComplaintInput) {
    const before = await assertVisible(
      await db().hostelComplaint.findFirst({ where: { id } }),
      HOSTEL_VIEW,
      'Complaint',
    );
    await authorizeRow(before, HOSTEL_MANAGE);
    const resolving =
      input.status && ['RESOLVED', 'CLOSED'].includes(input.status) && !before.resolvedAt;
    await db().hostelComplaint.update({
      where: { id },
      data: {
        ...(input.status && { status: input.status }),
        ...(input.priority && { priority: input.priority }),
        ...(input.resolution !== undefined && { resolution: input.resolution ?? null }),
        ...(resolving && { resolvedAt: new Date() }),
        ...(input.status && ['OPEN', 'IN_PROGRESS'].includes(input.status) && { resolvedAt: null }),
      },
    });
    const dto = await complaintDto(id);
    await audit.record({
      action: 'hostel_complaint.updated',
      entityType: 'hostel_complaint',
      entityId: id,
      before: { status: before.status, priority: before.priority, resolution: before.resolution },
      after: { status: dto.status, priority: dto.priority, resolution: dto.resolution },
    });
    if (input.status && input.status !== before.status && before.raisedByUserId) {
      await publish(HOSTEL_NOTIFICATIONS.complaintUpdated, {
        recipients: [before.raisedByUserId],
        title: `Complaint ${dto.status.toLowerCase().replace('_', ' ')}: ${dto.title}`,
        body: dto.resolution ?? `Status changed to ${dto.status}`,
        link: '/portal/hostel',
        data: { complaintId: id, status: dto.status },
        institutionId: before.institutionId,
      });
    }
    return dto;
  },

  async forStudent(studentId: string) {
    const rows = await db().hostelComplaint.findMany({
      where: { studentId },
      include: complaintInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return complaintDtos(rows);
  },
};

// ---- Roll call ------------------------------------------------------------------------------
export const rollCallService = {
  async sheet(query: RollCallQuery): Promise<RollCallSheetDto> {
    const hostel = await loadHostel(query.hostelId);
    const day = toDate(query.date);
    const dayEnd = new Date(day.getTime() + 86_400_000);
    const [allocations, rollCall, outpasses] = await Promise.all([
      db().hostelAllocation.findMany({
        where: {
          hostelId: hostel.id,
          occupantType: 'STUDENT',
          fromDate: { lte: day },
          OR: [{ status: 'ACTIVE' }, { toDate: { gte: day } }],
        },
        include: { room: { select: { roomNo: true } }, bed: { select: { bedNo: true } } },
        orderBy: [{ room: { roomNo: 'asc' } }, { bed: { bedNo: 'asc' } }],
      }),
      db().hostelRollCall.findFirst({
        where: { hostelId: hostel.id, rollDate: day, session: query.session },
        include: { entries: true },
      }),
      db().hostelOutpass.findMany({
        where: {
          hostelId: hostel.id,
          OR: [
            { status: 'OUT' },
            { status: 'APPROVED', fromAt: { lt: dayEnd }, toAt: { gt: day } },
          ],
        },
        select: { studentId: true },
      }),
    ]);
    const studentIds = [...new Set(allocations.flatMap((a) => (a.studentId ? [a.studentId] : [])))];
    const students = await studentRefs(studentIds);
    const away = new Set(outpasses.map((o) => o.studentId));
    const marked = new Map(rollCall?.entries.map((e) => [e.studentId, e.status]) ?? []);
    const seen = new Set<string>();
    const entries: RollCallSheetDto['entries'] = [];
    for (const a of allocations) {
      if (!a.studentId || seen.has(a.studentId)) continue;
      seen.add(a.studentId);
      entries.push({
        studentId: a.studentId,
        studentName: students.get(a.studentId)?.name ?? '—',
        roomNo: a.room.roomNo,
        bedNo: a.bed.bedNo,
        status: marked.get(a.studentId) ?? null,
        onOutpass: away.has(a.studentId),
      });
    }
    return {
      hostelId: hostel.id,
      date: query.date,
      session: query.session,
      rollCallId: rollCall?.id ?? null,
      entries,
    };
  },

  async save(input: SaveRollCallInput) {
    const hostel = await loadHostel(input.hostelId);
    await authorizeRow(hostel, HOSTEL_MANAGE);
    if (input.date > today()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Roll call cannot be taken for a future date');
    }
    const day = toDate(input.date);
    const residents = new Set(
      (
        await db().hostelAllocation.findMany({
          where: {
            hostelId: hostel.id,
            studentId: { in: input.entries.map((e) => e.studentId) },
            fromDate: { lte: day },
            OR: [{ status: 'ACTIVE' }, { toDate: { gte: day } }],
          },
          select: { studentId: true },
        })
      ).map((a) => a.studentId),
    );
    const stranger = input.entries.find((e) => !residents.has(e.studentId));
    if (stranger) throw new InvalidReferenceError('entries.studentId', 'Hosteller');
    const id = await db().$transaction(async (tx) => {
      const existing = await tx.hostelRollCall.findFirst({
        where: { hostelId: hostel.id, rollDate: day, session: input.session },
      });
      const rollCall =
        existing ??
        (await tx.hostelRollCall.create({
          data: withTenant({
            institutionId: hostel.institutionId,
            hostelId: hostel.id,
            rollDate: day,
            session: input.session,
            takenByUserId: userId(),
          }),
        }));
      if (existing) {
        await tx.hostelRollCall.update({
          where: { id: existing.id },
          data: { takenByUserId: userId() },
        });
      }
      for (const e of input.entries) {
        const row = await tx.hostelRollCallEntry.findFirst({
          where: { rollCallId: rollCall.id, studentId: e.studentId },
        });
        if (row) {
          if (row.status !== e.status) {
            await tx.hostelRollCallEntry.update({
              where: { id: row.id },
              data: { status: e.status },
            });
          }
        } else {
          await tx.hostelRollCallEntry.create({
            data: withTenant({ rollCallId: rollCall.id, studentId: e.studentId, status: e.status }),
          });
        }
      }
      return rollCall.id;
    });
    const counts = input.entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    }, {});
    await audit.record({
      action: 'hostel_roll_call.saved',
      entityType: 'hostel_roll_call',
      entityId: id,
      after: { hostelId: hostel.id, date: input.date, session: input.session, counts },
    });
    return this.sheet({ hostelId: hostel.id, date: input.date, session: input.session });
  },
};

// ---- Dashboard & reports --------------------------------------------------------------------
export async function hostelDashboard(institutionId?: string): Promise<HostelDashboardDto> {
  const scope = {
    ...(await institutionScope(HOSTEL_VIEW)),
    ...(institutionId && { institutionId }),
  };
  const day = toDate(today());
  const hostels = await db().hostel.findMany({
    where: scope,
    select: { id: true, code: true, name: true, hostelType: true },
    orderBy: { code: 'asc' },
  });
  const hostelIds = hostels.map((h) => h.id);
  const [bedGroups, rooms, pendingOutpasses, studentsOut, openComplaints, visitorsToday] =
    await Promise.all([
      db().hostelBed.groupBy({
        by: ['hostelId', 'status'],
        where: { hostelId: { in: hostelIds } },
        _count: { _all: true },
      }),
      db().hostelRoom.count({ where: { hostelId: { in: hostelIds } } }),
      db().hostelOutpass.count({ where: { ...scope, status: 'PENDING' } }),
      db().hostelOutpass.count({ where: { ...scope, status: 'OUT' } }),
      db().hostelComplaint.count({ where: { ...scope, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      db().hostelVisitor.count({
        where: { ...scope, checkInAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
      }),
    ]);
  const tally = (hostelId: string | null, status?: string) =>
    bedGroups
      .filter((g) => (!hostelId || g.hostelId === hostelId) && (!status || g.status === status))
      .reduce((s, g) => s + g._count._all, 0);
  const beds = tally(null);
  const occupied = tally(null, 'OCCUPIED');
  return {
    hostels: hostels.length,
    rooms,
    beds,
    occupied,
    available: tally(null, 'AVAILABLE'),
    blocked: tally(null, 'BLOCKED'),
    occupancyPercent: occupancyPercent(occupied, beds),
    pendingOutpasses,
    studentsOut,
    openComplaints,
    visitorsToday,
    byHostel: hostels.map((h) => ({
      hostelId: h.id,
      code: h.code,
      name: h.name,
      hostelType: h.hostelType,
      beds: tally(h.id),
      occupied: tally(h.id, 'OCCUPIED'),
    })),
  };
}

export async function hostelReport(query: HostelReportQuery): Promise<HostelReportDto> {
  const scope = {
    ...(await institutionScope(HOSTEL_VIEW)),
    ...(query.institutionId && { institutionId: query.institutionId }),
  };
  const hostelFilter = query.hostelId ? { hostelId: query.hostelId } : {};
  const hostels = await db().hostel.findMany({
    where: { ...scope, ...(query.hostelId && { id: query.hostelId }) },
    select: { id: true, name: true },
    orderBy: { code: 'asc' },
  });
  const hostelIds = hostels.map((h) => h.id);
  const [bedGroups, roomGroups, complaints, outpasses, charges] = await Promise.all([
    db().hostelBed.groupBy({
      by: ['hostelId', 'status'],
      where: { hostelId: { in: hostelIds } },
      _count: { _all: true },
    }),
    db().hostelRoom.groupBy({
      by: ['hostelId'],
      where: { hostelId: { in: hostelIds } },
      _count: { _all: true },
    }),
    db().hostelComplaint.groupBy({
      by: ['category', 'status'],
      where: { ...scope, ...hostelFilter },
      _count: { _all: true },
    }),
    db().hostelOutpass.groupBy({
      by: ['status'],
      where: { ...scope, ...hostelFilter },
      _count: { _all: true },
    }),
    db().hostelCharge.groupBy({
      by: ['period', 'status'],
      where: { ...scope, ...(query.hostelId && { allocation: { hostelId: query.hostelId } }) },
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: [{ period: 'desc' }],
    }),
  ]);
  return {
    occupancy: hostels.map((h) => {
      const beds = bedGroups
        .filter((g) => g.hostelId === h.id)
        .reduce((s, g) => s + g._count._all, 0);
      const occupied = bedGroups
        .filter((g) => g.hostelId === h.id && g.status === 'OCCUPIED')
        .reduce((s, g) => s + g._count._all, 0);
      return {
        hostelId: h.id,
        name: h.name,
        rooms: roomGroups.find((g) => g.hostelId === h.id)?._count._all ?? 0,
        beds,
        occupied,
        occupancyPercent: occupancyPercent(occupied, beds),
      };
    }),
    complaints: complaints.map((c) => ({
      category: c.category,
      status: c.status,
      count: c._count._all,
    })),
    outpasses: outpasses.map((o) => ({ status: o.status, count: o._count._all })),
    charges: charges.map((c) => ({
      period: c.period,
      status: c.status,
      count: c._count._all,
      amount: num(c._sum.amount),
    })),
  };
}
