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
import './modules/attendance/attendance.registrations';
