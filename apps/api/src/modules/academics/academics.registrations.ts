import { registerEventType } from '../../core/events';
import { registerNotificationEvent } from '../../core/notifications';
// Registers the `report_card` PDF template at import time.
import '../exams/exams.report-card';

/* Academics (subjects, allocation, student attendance), timetable and exams engine wiring. */

for (const [key, label] of [
  ['subject.created', 'Subject created'],
  ['subject_allocation.changed', 'Subject teacher allocation changed'],
  ['student_attendance.marked', 'Student attendance marked'],
  ['timetable.updated', 'Section timetable updated'],
  ['timetable.substitution_created', 'Timetable substitution created'],
  ['exam.term_created', 'Exam term created'],
  ['exam.scheduled', 'Exam papers scheduled'],
  ['exam.results_computed', 'Exam results computed'],
  ['exam.results_published', 'Exam results published'],
] as const)
  registerEventType({ key, label, webhook: true });

for (const [key, label] of [
  ['student_attendance.absent', 'Student marked absent (to guardians)'],
  ['exam.results_published', 'Exam results published (to students and guardians)'],
  ['timetable.substitution_assigned', 'Substitution period assigned (to teacher)'],
] as const)
  registerNotificationEvent({ key, label, defaultChannels: ['in_app', 'email'] });
