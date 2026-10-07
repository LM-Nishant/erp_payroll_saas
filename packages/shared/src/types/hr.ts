import type {
  EmployeeMovementStatus,
  EmployeeMovementType,
  EmployeePersonalInput,
  EmployeeStatus,
  EmploymentType,
} from '../schemas/hr';

/* HR employee master DTOs (Layer 6). Dates are `YYYY-MM-DD`; timestamps are ISO strings. */

export interface EmployeeRefDto {
  id: string;
  employeeCode: string;
  displayName: string;
}

export interface EmployeeDto {
  id: string;
  employeeCode: string;
  userId: string | null;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  designationId: string | null;
  reportingManagerId: string | null;
  employmentType: EmploymentType;
  employeeTypeId: string | null;
  employeeType: { id: string; name: string; code: string } | null;
  /** True when a profile photo is on file (fetch it from `/employees/:id/photo-url`). */
  hasPhoto: boolean;
  /** True when the profile photo has a face descriptor for selfie punches. */
  hasFaceDescriptor: boolean;
  status: EmployeeStatus;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  displayName: string;
  workEmail: string | null;
  workPhone: string | null;
  dateOfJoining: string | null;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number | null;
  resignationDate: string | null;
  lastWorkingDate: string | null;
  exitDate: string | null;
  exitType: string | null;
  exitReason: string | null;
  rehireCount: number;
  institution: { id: string; name: string; code: string } | null;
  campus: { id: string; name: string; code: string } | null;
  department: { id: string; name: string; code: string } | null;
  designation: { id: string; name: string; code: string } | null;
  reportingManager: EmployeeRefDto | null;
  createdAt: string;
  updatedAt: string;
}

/** Masked sensitive values (e.g. `XXXXXX1234`) — never the clear values. */
export interface EmployeeSensitiveMaskedDto {
  pan: string | null;
  aadhaar: string | null;
  uan: string | null;
  esicNumber: string | null;
  pfNumber: string | null;
  bankAccount: {
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName: string | null;
    branch: string | null;
  } | null;
}

export type EmployeeSensitiveDto = EmployeeSensitiveMaskedDto;

export interface EmployeeProfileDto {
  personal: EmployeePersonalInput;
  /** Always masked. Use `POST /employees/:id/sensitive/reveal` for clear values. */
  sensitive: EmployeeSensitiveMaskedDto;
  hasSensitive: boolean;
}

export interface EmployeeDetailDto extends EmployeeDto {
  profile: EmployeeProfileDto;
  secondaryDepartments: { id: string; name: string; code: string }[];
}

export interface EmployeePositionDto {
  id: string;
  institutionId: string;
  designationId: string | null;
  designationName: string | null;
  employmentType: EmploymentType;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  movementId: string | null;
}

export interface EmployeeDepartmentHistoryDto {
  id: string;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  isPrimary: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  movementId: string | null;
}

export interface EmployeeReportingLineDto {
  id: string;
  managerId: string;
  manager: EmployeeRefDto | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  movementId: string | null;
}

export interface EmployeeHistoryDto {
  positions: EmployeePositionDto[];
  departments: EmployeeDepartmentHistoryDto[];
  reportingLines: EmployeeReportingLineDto[];
}

export interface EmployeeMovementDto {
  id: string;
  employeeId: string;
  type: EmployeeMovementType;
  status: EmployeeMovementStatus;
  effectiveDate: string;
  fromGroupId: string | null;
  fromInstitutionId: string;
  fromCampusId: string | null;
  fromDepartmentId: string | null;
  fromDesignationId: string | null;
  fromReportingManagerId: string | null;
  toGroupId: string | null;
  toInstitutionId: string;
  toCampusId: string | null;
  toDepartmentId: string | null;
  toDesignationId: string | null;
  toReportingManagerId: string | null;
  reason: string | null;
  workflowInstanceId: string | null;
  requestedByUserId: string | null;
  decidedComment: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface EmployeeSalaryRevisionDto {
  id: string;
  employeeId: string;
  institutionId: string;
  effectiveFrom: string;
  currency: string;
  annualCtc: number;
  amounts: Record<string, number>;
  salaryStructureId: string | null;
  revisionReason: string;
  previousId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface EmployeeChecklistItemDto {
  id: string;
  kind: 'ONBOARDING' | 'EXIT';
  key: string;
  title: string;
  source: string;
  status: 'PENDING' | 'DONE' | 'WAIVED';
  notes: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
}

export interface EmployeeProfileChangeRequestDto {
  id: string;
  employeeId: string;
  status: 'PENDING_APPROVAL' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
  changes: Record<string, unknown>;
  reason: string | null;
  workflowInstanceId: string | null;
  decidedComment: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface DesignationDto {
  id: string;
  code: string;
  name: string;
  groupId: string | null;
  institutionId: string | null;
  departmentId: string | null;
  department: { id: string; name: string; code: string } | null;
  category: EmploymentType | null;
  level: number | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCodeSequenceDto {
  id: string;
  institutionId: string | null;
  prefix: string;
  padding: number;
  nextNumber: number;
  preview: string;
}

export interface EmployeeImportRowReport {
  row: number;
  employeeCode: string | null;
  employeeId?: string;
  errors: { field: string; message: string }[];
}

export interface EmployeeImportJobDto {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  fileName: string;
  dryRun: boolean;
  totalRows: number;
  createdCount: number;
  errorCount: number;
  report: EmployeeImportRowReport[] | null;
  createdAt: string;
  completedAt: string | null;
}

/** `GET /employees/me` — the caller's own record (sensitive values masked). */
export interface MyEmployeeDto extends EmployeeDetailDto {
  pendingChangeRequests: EmployeeProfileChangeRequestDto[];
}

export interface EmployeeTypeDto {
  id: string;
  code: string;
  name: string;
  category: EmploymentType;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
}
