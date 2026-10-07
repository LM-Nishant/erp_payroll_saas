import type {
  LibraryCopyStatus,
  LibraryFineReason,
  LibraryFineStatus,
  LibraryItemType,
  LibraryLoanStatus,
  LibraryMemberType,
  LibraryReservationStatus,
} from '../schemas/library';

export interface LibraryBookDto {
  id: string;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  itemType: LibraryItemType;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  edition: string | null;
  publicationYear: number | null;
  category: string | null;
  language: string | null;
  tags: string[];
  callNumber: string | null;
  url: string | null;
  description: string | null;
  coverDocumentId: string | null;
  totalCopies?: number;
  availableCopies?: number;
  institution?: { id: string; name: string; code: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCopyDto {
  id: string;
  institutionId: string;
  campusId: string | null;
  bookId: string;
  accessionNo: string;
  barcode: string;
  shelf: string | null;
  rack: string | null;
  status: LibraryCopyStatus;
  condition: string | null;
  price: number | null;
  acquiredOn: string | null;
  notes: string | null;
  book?: { id: string; title: string; isbn: string | null; callNumber: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryPolicyDto {
  id: string | null;
  institutionId: string;
  memberType: LibraryMemberType;
  maxBooks: number;
  loanDays: number;
  maxRenewals: number;
  finePerDay: number;
  maxFine: number;
  holdDays: number;
}

export interface LibraryLoanDto {
  id: string;
  institutionId: string;
  copyId: string;
  bookId: string;
  memberType: LibraryMemberType;
  studentId: string | null;
  employeeId: string | null;
  memberName: string;
  issuedAt: string;
  dueDate: string;
  returnedAt: string | null;
  renewCount: number;
  status: LibraryLoanStatus;
  overdue: boolean;
  overdueDays: number;
  /** Fine charged on return, or the running fine for open overdue loans. */
  fineAmount: number;
  returnCondition: string | null;
  book?: { id: string; title: string; authors: string[] } | null;
  copy?: { id: string; barcode: string; accessionNo: string } | null;
}

export interface LibraryReservationDto {
  id: string;
  institutionId: string;
  bookId: string;
  copyId: string | null;
  memberType: LibraryMemberType;
  studentId: string | null;
  employeeId: string | null;
  memberName: string;
  status: LibraryReservationStatus;
  position: number | null;
  readyAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  book?: { id: string; title: string } | null;
  copy?: { id: string; barcode: string } | null;
}

export interface LibraryFineDto {
  id: string;
  institutionId: string;
  loanId: string | null;
  memberType: LibraryMemberType;
  studentId: string | null;
  employeeId: string | null;
  memberName: string;
  amount: number;
  reason: LibraryFineReason;
  status: LibraryFineStatus;
  note: string | null;
  externalChargeId: string | null;
  settledAt: string | null;
  createdAt: string;
  bookTitle?: string | null;
}

export interface LibraryMemberDto {
  memberType: LibraryMemberType;
  id: string;
  name: string;
  code: string | null;
  institutionId: string;
  classSection?: string | null;
  activeLoans: number;
  overdueLoans: number;
  pendingFines: number;
}

export interface LibraryReturnResultDto {
  loan: LibraryLoanDto;
  fine: LibraryFineDto | null;
  /** Reservation that the returned copy was allocated to (copy status RESERVED). */
  reservation: LibraryReservationDto | null;
}

export interface LibraryDashboardDto {
  titles: number;
  copies: number;
  available: number;
  issued: number;
  overdue: number;
  reservationsWaiting: number;
  reservationsReady: number;
  pendingFines: number;
  pendingFineAmount: number;
  issuedToday: number;
  returnedToday: number;
  recentLoans: LibraryLoanDto[];
}

export interface LibraryImportResultDto {
  created: number;
  updated: number;
  copiesCreated: number;
  errors: Array<{ row: number; message: string }>;
}

export interface LibraryStockVerificationDto {
  id: string;
  institutionId: string;
  name: string;
  status: 'OPEN' | 'COMPLETED';
  scannedCount: number;
  result: {
    expected: number;
    found: number;
    missing: Array<{ barcode: string; title: string; accessionNo: string }>;
    unexpected: string[];
    misplacedStatus: Array<{ barcode: string; status: string }>;
  } | null;
  completedAt: string | null;
  createdAt: string;
}

export interface LibraryReportDto {
  key: string;
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface LibraryMemberSummaryDto {
  memberType: LibraryMemberType;
  studentId: string | null;
  employeeId: string | null;
  name: string;
  institutionId: string;
  policy: LibraryPolicyDto;
  active: LibraryLoanDto[];
  history: LibraryLoanDto[];
  fines: LibraryFineDto[];
  reservations: LibraryReservationDto[];
}

export interface MyLibraryDto {
  members: LibraryMemberSummaryDto[];
}
