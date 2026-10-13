/**
 * Date-range overview dashboard. A section is present only when the caller holds its view
 * permission (and the module is enabled); figures are limited to the caller's scopes.
 */
export interface DashboardOverviewDto {
  range: { from: string; to: string; days: number };
  institutionId: string | null;
  fees?: {
    collected: number;
    receipts: number;
    refunded: number;
    netCollected: number;
    upiPending: { count: number; amount: number };
    /** Balance of open invoices whose due date falls in the range. */
    dueInRange: number;
    /** Balance of all open invoices due on or before `to` (as of today). */
    outstanding: number;
  };
  expenses?: { total: number; count: number };
  payroll?: {
    /** Net pay of runs finalized in the range. */
    finalizedNet: number;
    finalizedRuns: number;
    /** Salary payouts marked paid in the range. */
    paid: number;
    paidCount: number;
    /** Salary payouts still pending (any finalized run in scope). */
    pendingPayout: number;
    pendingPayoutCount: number;
  };
  /** Money in vs out for the range (fees net of refunds − expenses − salary paid). */
  cashFlow?: { inflow: number; outflow: number; net: number };
  students?: {
    active: number;
    /** Daily student attendance; counts are student-days when the range spans several days. */
    attendance?: {
      marked: number;
      present: number;
      absent: number;
      late: number;
      leave: number;
      halfDay: number;
    };
  };
  employees?: {
    active: number;
    /** Employee attendance; counts are employee-days when the range spans several days. */
    attendance?: {
      present: number;
      absent: number;
      late: number;
      halfDay: number;
      onLeave: number;
      offOrHoliday: number;
    };
    leave?: { onApprovedLeave: number; pendingRequests: number };
  };
  hostel?: { hostels: number; beds: number; occupied: number; available: number; blocked: number };
  transport?: {
    vehicles: number;
    capacity: number;
    allocated: number;
    available: number;
    routes: number;
  };
  /** Per-day fee collection and expenses (ranges up to 62 days). */
  trend?: { date: string; collected: number; expenses: number }[];
}
