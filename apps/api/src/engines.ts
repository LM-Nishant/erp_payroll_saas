/*
 * Side-effect imports that register Layer 5 engines with the queue / event bus: job handlers,
 * recurring schedules, event types, notification events and workflow entities. Imported by
 * both the API (`app.ts`) and the worker (`worker.ts`) so either process can run any job.
 * Later layers add their module registrations (e.g. `modules/leave/leave.workflow.ts`) here.
 */
import './core/events';
import './core/communication';
import './core/notifications';
import './core/workflow';
import './core/integrations';
import './core/jobs/documents';
import './modules/employees/employees.registrations';
import './modules/students/students.registrations';
import './modules/attendance/attendance.registrations';
import './modules/payroll/payroll.registrations';
import './modules/ai/ai.registrations';
import './modules/finance/finance.registrations';
import './modules/fees/fees.registrations';
import './modules/assets/assets.registrations';
import './modules/library/library.registrations';
import './modules/academics/academics.registrations';
import './modules/transport/transport.registrations';
import './modules/hostel/hostel.registrations';
