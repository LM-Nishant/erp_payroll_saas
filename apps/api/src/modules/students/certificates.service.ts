import type { Prisma, Student, StudentCertificate } from '@prisma/client';
import type {
  CancelCertificateInput,
  CertificateEligibilityDto,
  CertificateType,
  IssueCertificateInput,
  ReissueCertificateInput,
  StudentCertificateDto,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  authorize,
  can,
  currentPrincipal,
  hasPermission,
  hierarchyResource,
} from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import { documentEngine } from '../../core/documents';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { renderPdfTemplate, storedPdfMetadata } from '../../core/pdf';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  CHARACTER_CERTIFICATE_TEMPLATE,
  TRANSFER_CERTIFICATE_TEMPLATE,
  type CertificatePdfInput,
} from './certificates.templates';
import { getStudentDuesProvider } from './students.hooks';
import { dateStr, toDate } from './students.mappers';

/*
 * Transfer Certificates (TC) and Character Certificates (CC). Each certificate gets a number from
 * a per-institution / type / year series (`GWIS-MAIN/TC/2026/0001`), is rendered with the
 * tenant's branded letterhead and stored as an immutable document owned by the student. Issuing a
 * TC withdraws the student and is blocked while fee dues are pending (unless waived with
 * `certificate.waive_dues`). Cancelled certificates stay on record; a reissue cancels the old
 * certificate and issues a new number that points back to it.
 */

/** 409 — the student has pending fee dues; a TC needs them cleared or waived. */
export class FeeDuesPendingError extends AppError {
  constructor(amount: number, invoiceCount: number) {
    super(
      409,
      'FEE_DUES_PENDING',
      `Fee dues of Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} are pending; clear or waive them before issuing a transfer certificate`,
      { amount, invoiceCount },
    );
  }
}

type Db = ReturnType<typeof tenantDb>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

const certInclude = {
  student: { select: { displayName: true, admissionNo: true } },
  replacedBy: { select: { id: true }, take: 1 },
} as const;
type CertRow = Prisma.StudentCertificateGetPayload<{ include: typeof certInclude }>;

const SERIES_CODE: Record<CertificateType, string> = { TRANSFER: 'TC', CHARACTER: 'CC' };
const TEMPLATE: Record<CertificateType, string> = {
  TRANSFER: TRANSFER_CERTIFICATE_TEMPLATE,
  CHARACTER: CHARACTER_CERTIFICATE_TEMPLATE,
};
const DOCUMENT_TYPE: Record<CertificateType, string> = {
  TRANSFER: 'transfer_certificate',
  CHARACTER: 'character_certificate',
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const money = (v: number) =>
  `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function userNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const rows = await tenantDb().organizationMembership.findMany({
    where: { userId: { in: unique } },
    include: { user: { select: { id: true, name: true } } },
  });
  for (const r of rows) map.set(r.user.id, r.user.name);
  return map;
}

function toDto(c: CertRow, names: Map<string, string>): StudentCertificateDto {
  return {
    id: c.id,
    certificateNo: c.certificateNo,
    type: c.type,
    status: c.status,
    studentId: c.studentId,
    studentName: c.student.displayName,
    admissionNo: c.student.admissionNo,
    institutionId: c.institutionId,
    issueDate: dateStr(c.issueDate)!,
    leavingDate: dateStr(c.leavingDate),
    reason: c.reason,
    conduct: c.conduct,
    lastClass: c.lastClass,
    academicYear: c.academicYear,
    promotionStatus: c.promotionStatus,
    remarks: c.remarks,
    feeDuesAmount: Number(c.feeDuesAmount),
    feeDuesWaived: c.feeDuesWaived,
    feeDuesWaiverReason: c.feeDuesWaiverReason,
    documentId: c.documentId,
    issuedById: c.issuedById,
    issuedByName: c.issuedById ? (names.get(c.issuedById) ?? null) : null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    cancelReason: c.cancelReason,
    replacesId: c.replacesId,
    replacedById: c.replacedBy[0]?.id ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function toDtos(rows: CertRow[]) {
  const names = await userNames(rows.map((r) => r.issuedById));
  return rows.map((r) => toDto(r, names));
}

const toOne = async (row: CertRow) => (await toDtos([row]))[0]!;

async function loadStudent(id: string, permission: string) {
  const student = await tenantDb().student.findUnique({ where: { id } });
  if (!student || !(await can(currentPrincipal(), permission, hierarchyResource.student(student))))
    throw new NotFoundError('Student');
  return student;
}

async function loadCertificate(id: string) {
  const cert = await tenantDb().studentCertificate.findUnique({
    where: { id },
    include: certInclude,
  });
  if (!cert) throw new NotFoundError('Certificate');
  return cert;
}

const certScope = (c: StudentCertificate) =>
  hierarchyResource.student({
    groupId: c.groupId,
    institutionId: c.institutionId,
    campusId: c.campusId,
    departmentId: c.departmentId,
  });

/** Staff access: `certificate.view` in the certificate's scope (404 otherwise). */
async function loadForStaff(id: string, permission?: string) {
  const cert = await loadCertificate(id);
  if (!(await can(currentPrincipal(), 'certificate.view', certScope(cert))))
    throw new NotFoundError('Certificate');
  if (permission) await authorize(currentPrincipal(), permission, certScope(cert));
  return cert;
}

/** Whether the caller is the certificate's student or a linked guardian (portal access). */
async function isOwnCertificate(cert: StudentCertificate) {
  const principal = currentPrincipal();
  if (!principal.userId || !hasPermission(principal, 'certificate.view_own')) return false;
  const db = tenantDb();
  const self = await db.student.count({
    where: { id: cert.studentId, userId: principal.userId },
  });
  if (self) return true;
  const ward = await db.studentGuardian.count({
    where: { studentId: cert.studentId, guardian: { userId: principal.userId } },
  });
  return ward > 0;
}

async function nextCertificateNo(
  tx: Tx,
  institutionId: string,
  type: CertificateType,
  issueDate: string,
) {
  const year = Number(issueDate.slice(0, 4));
  const where = { institutionId, type, year };
  let series = await tx.studentCertificateSeries.findFirst({ where });
  if (!series) {
    const inst = await tx.institution.findUnique({
      where: { id: institutionId },
      select: { code: true },
    });
    try {
      series = await tx.studentCertificateSeries.create({
        data: withTenant({
          ...where,
          prefix: `${(inst?.code ?? 'INST').toUpperCase()}/${SERIES_CODE[type]}/${year}/`,
          padding: 4,
        }),
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      series = await tx.studentCertificateSeries.findFirstOrThrow({ where });
    }
  }
  const updated = await tx.studentCertificateSeries.update({
    where: { id: series.id },
    data: { nextNumber: { increment: 1 } },
  });
  const n = updated.nextNumber - 1;
  return `${updated.prefix}${String(n).padStart(updated.padding, '0')}`;
}

async function checkDues(student: Student, asOf: string) {
  const provider = getStudentDuesProvider();
  if (!provider) return null;
  return provider({ studentId: student.id, institutionId: student.institutionId, asOf });
}

/** Template input — a snapshot of the certificate and the student's particulars. */
async function pdfInput(cert: StudentCertificate): Promise<CertificatePdfInput> {
  const db = tenantDb();
  const [student, inst, guardian, replaces] = await Promise.all([
    db.student.findUniqueOrThrow({
      where: { id: cert.studentId },
      include: { program: { select: { name: true } } },
    }),
    db.institution.findUniqueOrThrow({
      where: { id: cert.institutionId },
      select: { name: true, address: true },
    }),
    db.studentGuardian.findFirst({
      where: { studentId: cert.studentId },
      include: { guardian: { select: { name: true } } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    }),
    cert.replacesId
      ? db.studentCertificate.findUnique({
          where: { id: cert.replacesId },
          select: { certificateNo: true },
        })
      : null,
  ]);
  const dues = Number(cert.feeDuesAmount);
  return {
    certificateNo: cert.certificateNo,
    issueDate: dateStr(cert.issueDate)!,
    institution: inst.name,
    institutionAddress: inst.address ?? '',
    studentName: student.displayName,
    admissionNo: student.admissionNo,
    dateOfBirth: dateStr(student.dateOfBirth) ?? '',
    gender: student.gender ?? '',
    guardianName: guardian?.guardian.name ?? '',
    admissionDate: dateStr(student.admissionDate) ?? '',
    program: student.program.name,
    lastClass: cert.lastClass ?? '',
    academicYear: cert.academicYear,
    leavingDate: dateStr(cert.leavingDate) ?? '',
    reason: cert.reason ?? '',
    conduct: cert.conduct,
    promotionStatus: cert.promotionStatus ?? '',
    feeStatus:
      dues > 0
        ? cert.feeDuesWaived
          ? `${money(dues)} waived${cert.feeDuesWaiverReason ? ` (${cert.feeDuesWaiverReason})` : ''}`
          : money(dues)
        : 'No dues',
    remarks: cert.remarks ?? '',
    replacesNo: replaces?.certificateNo ?? '',
  };
}

/** Render the branded PDF and store it as the student's document; links it to the certificate. */
async function storeDocument(cert: StudentCertificate) {
  const input = await pdfInput(cert);
  const template = TEMPLATE[cert.type];
  const rendered = await renderPdfTemplate(template, input, {
    groupId: cert.groupId,
    institutionId: cert.institutionId,
    campusId: cert.campusId,
    departmentId: cert.departmentId,
  });
  const doc = await documentEngine.attach({
    ownerType: 'student',
    ownerId: cert.studentId,
    module: 'students',
    metadata: {
      title: rendered.title,
      category: 'student',
      documentType: DOCUMENT_TYPE[cert.type],
      confidentiality: 'INTERNAL',
      issueDate: dateStr(cert.issueDate)!,
    },
    file: {
      fileName: fileNameOf(cert),
      mimeType: 'application/pdf',
      body: rendered.body,
    },
    extra: storedPdfMetadata(template, rendered, input, { certificateId: cert.id }),
    authorization: 'caller',
  });
  await tenantDb().studentCertificate.update({
    where: { id: cert.id },
    data: { documentId: doc.id },
  });
  return { documentId: doc.id, body: rendered.body };
}

const fileNameOf = (c: { type: CertificateType; certificateNo: string }) =>
  `${SERIES_CODE[c.type].toLowerCase()}-${c.certificateNo.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;

async function afterIssue(cert: CertRow, extra: Record<string, unknown> = {}) {
  await storeDocument(cert);
  const fresh = await loadCertificate(cert.id);
  const dto = await toOne(fresh);
  await audit.record({
    action: `student.certificate_issued`,
    entityType: 'student_certificate',
    entityId: cert.id,
    after: { ...dto, ...extra },
  });
  await emit(
    'student.certificate_issued',
    {
      certificateId: cert.id,
      certificateNo: cert.certificateNo,
      type: cert.type,
      studentId: cert.studentId,
    },
    { institutionId: cert.institutionId },
  );
  return dto;
}

export const certificateService = {
  async listForStudent(studentId: string) {
    const student = await loadStudent(studentId, 'certificate.view');
    const rows = await tenantDb().studentCertificate.findMany({
      where: { studentId: student.id },
      include: certInclude,
      orderBy: [{ createdAt: 'desc' }],
    });
    return toDtos(rows);
  },

  async eligibility(studentId: string, type: CertificateType): Promise<CertificateEligibilityDto> {
    const student = await loadStudent(studentId, 'certificate.view');
    const db = tenantDb();
    const [existing, cs] = await Promise.all([
      type === 'TRANSFER'
        ? db.studentCertificate.findFirst({
            where: { studentId, type: 'TRANSFER', status: 'ISSUED' },
            select: { id: true, certificateNo: true },
          })
        : null,
      db.classSection.findUnique({
        where: { id: student.classSectionId },
        select: { name: true },
      }),
    ]);
    const lastEnrollment = await db.studentEnrollment.findFirst({
      where: { studentId, toDate: { not: null } },
      orderBy: { toDate: 'desc' },
      select: { toDate: true },
    });
    const leavingDate =
      student.status === 'ACTIVE' || student.status === 'INACTIVE'
        ? todayStr()
        : (dateStr(lastEnrollment?.toDate) ?? todayStr());
    const dues = type === 'TRANSFER' ? await checkDues(student, leavingDate) : null;
    return {
      type,
      feeDues: dues?.amount ?? 0,
      duesChecked: !!dues,
      existingTransfer: existing,
      canWaiveDues: await can(
        currentPrincipal(),
        'certificate.waive_dues',
        hierarchyResource.student(student),
      ),
      defaults: {
        lastClass: cs?.name ?? null,
        academicYear: student.academicYear,
        leavingDate: type === 'TRANSFER' ? leavingDate : null,
      },
    };
  },

  async issue(studentId: string, input: IssueCertificateInput) {
    const student = await loadStudent(studentId, 'certificate.view');
    const scope = hierarchyResource.student(student);
    await authorize(currentPrincipal(), 'certificate.issue', scope);
    const db = tenantDb();
    const issueDate = input.issueDate ?? todayStr();
    const isTc = input.type === 'TRANSFER';
    const leavingDate = input.leavingDate ?? null;

    let duesAmount = 0;
    let waived = false;
    if (isTc) {
      const existing = await db.studentCertificate.findFirst({
        where: { studentId, type: 'TRANSFER', status: 'ISSUED' },
        select: { certificateNo: true },
      });
      if (existing) {
        throw new ConflictError(
          `Transfer certificate ${existing.certificateNo} is already issued; cancel or reissue it instead`,
        );
      }
      const dues = await checkDues(student, leavingDate ?? issueDate);
      if (dues && dues.amount > 0) {
        if (!input.waiveFeeDues) throw new FeeDuesPendingError(dues.amount, dues.invoiceCount);
        await authorize(currentPrincipal(), 'certificate.waive_dues', scope);
        duesAmount = dues.amount;
        waived = true;
      }
    }

    const cs = await db.classSection.findUnique({
      where: { id: student.classSectionId },
      select: { name: true },
    });
    const withdraw = isTc && (student.status === 'ACTIVE' || student.status === 'INACTIVE');
    const cert = await db.$transaction(async (tx) => {
      const certificateNo = await nextCertificateNo(
        tx,
        student.institutionId,
        input.type,
        issueDate,
      );
      const created = await tx.studentCertificate.create({
        data: withTenant({
          certificateNo,
          type: input.type,
          studentId,
          groupId: student.groupId,
          institutionId: student.institutionId,
          campusId: student.campusId,
          departmentId: student.departmentId,
          issueDate: toDate(issueDate),
          leavingDate: leavingDate ? toDate(leavingDate) : null,
          reason: input.reason ?? null,
          conduct: input.conduct,
          lastClass: input.lastClass ?? cs?.name ?? null,
          academicYear: student.academicYear,
          promotionStatus: input.promotionStatus ?? null,
          remarks: input.remarks ?? null,
          feeDuesAmount: duesAmount,
          feeDuesWaived: waived,
          feeDuesWaiverReason: waived ? (input.waiverReason ?? null) : null,
          issuedById: currentPrincipal().userId,
        }),
        include: certInclude,
      });
      if (withdraw) {
        await tx.studentEnrollment.updateMany({
          where: { studentId, toDate: null },
          data: { toDate: toDate(leavingDate ?? issueDate), status: 'WITHDRAWN' },
        });
        await tx.student.update({ where: { id: studentId }, data: { status: 'WITHDRAWN' } });
      }
      return created;
    });

    if (withdraw) {
      await audit.record({
        action: 'student.withdrawn',
        entityType: 'student',
        entityId: studentId,
        before: { status: student.status },
        after: { status: 'WITHDRAWN', reason: input.reason, certificateNo: cert.certificateNo },
      });
      await emit('student.withdrawn', { studentId }, { institutionId: student.institutionId });
    }
    return afterIssue(cert, waived ? { waivedBy: currentPrincipal().userId } : {});
  },

  async cancel(id: string, input: CancelCertificateInput) {
    const before = await loadForStaff(id, 'certificate.cancel');
    if (before.status !== 'ISSUED') throw new ConflictError('Certificate is already cancelled');
    const updated = await tenantDb().studentCertificate.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: currentPrincipal().userId,
        cancelReason: input.reason,
      },
      include: certInclude,
    });
    const dto = await toOne(updated);
    await audit.record({
      action: 'student.certificate_cancelled',
      entityType: 'student_certificate',
      entityId: id,
      before: { status: before.status },
      after: { status: 'CANCELLED', reason: input.reason },
    });
    await emit(
      'student.certificate_cancelled',
      { certificateId: id, certificateNo: before.certificateNo, studentId: before.studentId },
      { institutionId: before.institutionId },
    );
    return dto;
  },

  /** Cancel and issue a fresh number with corrected details (dues decision carried over). */
  async reissue(id: string, input: ReissueCertificateInput) {
    const old = await loadForStaff(id, 'certificate.issue');
    await authorize(currentPrincipal(), 'certificate.cancel', certScope(old));
    if (old.status !== 'ISSUED')
      throw new ConflictError('Only an issued certificate can be reissued');
    if (old.type === 'TRANSFER' && input.leavingDate === null)
      throw new ConflictError('A transfer certificate needs a leaving date');
    const issueDate = input.issueDate ?? todayStr();
    const db = tenantDb();
    const cert = await db.$transaction(async (tx) => {
      const flipped = await tx.studentCertificate.updateMany({
        where: { id, status: 'ISSUED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: currentPrincipal().userId,
          cancelReason: `Reissued: ${input.reason}`.slice(0, 500),
        },
      });
      if (flipped.count !== 1) throw new ConflictError('Certificate is already cancelled');
      const certificateNo = await nextCertificateNo(tx, old.institutionId, old.type, issueDate);
      return tx.studentCertificate.create({
        data: withTenant({
          certificateNo,
          type: old.type,
          studentId: old.studentId,
          groupId: old.groupId,
          institutionId: old.institutionId,
          campusId: old.campusId,
          departmentId: old.departmentId,
          issueDate: toDate(issueDate),
          leavingDate:
            input.leavingDate === undefined
              ? old.leavingDate
              : input.leavingDate
                ? toDate(input.leavingDate)
                : null,
          reason: input.leavingReason === undefined ? old.reason : input.leavingReason,
          conduct: input.conduct ?? old.conduct,
          lastClass: input.lastClass === undefined ? old.lastClass : input.lastClass,
          academicYear: old.academicYear,
          promotionStatus:
            input.promotionStatus === undefined ? old.promotionStatus : input.promotionStatus,
          remarks: input.remarks === undefined ? old.remarks : input.remarks,
          feeDuesAmount: old.feeDuesAmount,
          feeDuesWaived: old.feeDuesWaived,
          feeDuesWaiverReason: old.feeDuesWaiverReason,
          replacesId: old.id,
          issuedById: currentPrincipal().userId,
        }),
        include: certInclude,
      });
    });
    await audit.record({
      action: 'student.certificate_cancelled',
      entityType: 'student_certificate',
      entityId: old.id,
      before: { status: 'ISSUED' },
      after: { status: 'CANCELLED', reason: input.reason, replacedBy: cert.certificateNo },
    });
    await emit(
      'student.certificate_cancelled',
      { certificateId: old.id, certificateNo: old.certificateNo, studentId: old.studentId },
      { institutionId: old.institutionId },
    );
    return afterIssue(cert, { replaces: old.certificateNo, reissueReason: input.reason });
  },

  /**
   * The certificate PDF — for staff with `certificate.view` in scope, or (issued certificates
   * only) the student / a linked guardian holding `certificate.view_own`.
   */
  async pdf(id: string) {
    const cert = await loadCertificate(id);
    const staff = await can(currentPrincipal(), 'certificate.view', certScope(cert));
    if (!staff && !(cert.status === 'ISSUED' && (await isOwnCertificate(cert))))
      throw new NotFoundError('Certificate');
    let body: Buffer | null = null;
    if (cert.documentId) {
      const file = await documentEngine.readCurrentVersion(cert.documentId);
      body = file?.body ?? null;
    }
    if (!body) body = (await storeDocument(cert)).body;
    await audit.record({
      action: 'student.certificate_downloaded',
      entityType: 'student_certificate',
      entityId: id,
      metadata: { certificateNo: cert.certificateNo, viaPortal: !staff },
    });
    return { body, fileName: fileNameOf(cert) };
  },

  /** Portal: the signed-in student's issued certificates. */
  async mine() {
    const principal = currentPrincipal();
    if (!principal.userId) return [];
    const rows = await tenantDb().studentCertificate.findMany({
      where: { status: 'ISSUED', student: { userId: principal.userId } },
      include: certInclude,
      orderBy: { issueDate: 'desc' },
    });
    return toDtos(rows);
  },

  /** Portal: issued certificates of the guardian's linked wards (optionally one ward). */
  async forMyWards(studentId?: string) {
    const principal = currentPrincipal();
    if (!principal.userId) return [];
    const links = await tenantDb().studentGuardian.findMany({
      where: { guardian: { userId: principal.userId }, ...(studentId ? { studentId } : {}) },
      select: { studentId: true },
    });
    if (studentId && !links.length) throw new NotFoundError('Student');
    if (!links.length) return [];
    const rows = await tenantDb().studentCertificate.findMany({
      where: { status: 'ISSUED', studentId: { in: links.map((l) => l.studentId) } },
      include: certInclude,
      orderBy: { issueDate: 'desc' },
    });
    return toDtos(rows);
  },
};
