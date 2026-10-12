# Roles and permissions

Generated from `apps/api/src/core/authz/default-roles.ts` and `packages/shared/src/auth/permissions.ts`. Demo password for every account: `password123`.

Every role is granted at a **scope** (organization, group, institution or department) and only works inside that scope. A person can hold several roles (e.g. HR manager + employee). Licensing applies on top: a permission does nothing if the module is not licensed for the organization/institution.

## Who does what

| Role                                              | Typical scope | Who                                        | What they do                                                                                                                                                 | Demo login(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Group Owner** (`group_owner`)                   | ORGANIZATION  | Owner / trustee of the whole organization  | Everything inside the organization: setup, users and roles, branding, licences view, every module, approvals, audit.                                         | owner@greenwood.demo, owner@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Group Admin** (`group_admin`)                   | GROUP         | Head-office administrator of a group       | Runs all institutions in the group: academics, students, fees, HR, operations. No billing/subscription ownership.                                            | group.admin@greenwood.demo, admin@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Group HR** (`group_hr`)                         | GROUP         | Group HR head                              | HR across every institution of the group: employees, attendance, leave, shifts, holidays, salary assignment. Does not run payroll or manage Form 16.         | group.hr@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Group Finance** (`group_finance`)               | GROUP         | Group finance controller                   | Approves/locks payroll, reopens finalized runs, finance ledger and reports across the group.                                                                 | group.finance@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Institution Owner** (`institution_owner`)       | INSTITUTION   | Owner of one school/college/company branch | Full control of one institution across all modules; approves and finalizes payroll (does not prepare runs).                                                  | branch.owner@greenwood.demo, owner@sunrise.demo, owner@acme.demo, owner@lakeside.demo, owner@oldtown.demo, owner@maple.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Institution Admin** (`institution_admin`)       | INSTITUTION   | Institution administrator / office head    | Day-to-day administration of one institution across all modules (no payroll finalization).                                                                   | admin@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Principal** (`principal`)                       | INSTITUTION   | Principal / head of school                 | Academic head: admissions, students, classes, subjects, timetable, exams/results, student attendance, staff view, leave; also sees fees/finance and library. | principal@greenwood.demo, principal@sunrise.demo, north.principal@brightway.demo, south.principal@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Vice Principal** (`vice_principal`)             | INSTITUTION   | Vice principal                             | Academic bundle (admissions, students, classes, timetable, exams, student attendance, staff view, leave). No fees/finance.                                   | vice.principal@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Dean** (`dean`)                                 | INSTITUTION   | Dean (college)                             | Same academic bundle as vice principal, used for college programmes.                                                                                         | dean@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Registrar** (`registrar`)                       | INSTITUTION   | Registrar                                  | Same academic bundle; typically runs admissions and student records.                                                                                         | registrar@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **HOD** (`hod`)                                   | DEPARTMENT    | Head of department                         | Same academic bundle, limited to one department.                                                                                                             | hod@greenwood.demo, manager@acme.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Academic Coordinator** (`academic_coordinator`) | INSTITUTION   | Academic coordinator                       | Same academic bundle; typically runs timetable, classes and exam scheduling.                                                                                 | coordinator@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Teacher** (`teacher`)                           | DEPARTMENT    | Teacher                                    | Own classes in the department: student attendance, marks entry, timetable, students view, messages.                                                          | branch.teacher@greenwood.demo, teacher@greenwood.demo, teacher2@greenwood.demo, teacher@sunrise.demo, north.teacher@brightway.demo, south.teacher@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Faculty** (`faculty`)                           | DEPARTMENT    | College faculty                            | Same as teacher for college courses.                                                                                                                         | faculty@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **HR Manager** (`hr_manager`)                     | INSTITUTION   | Institution HR manager                     | Employees, designations, attendance, leave, shifts, holidays, salary assignment/revisions, HR documents, approvals. Does not run payroll or Form 16.         | hr@greenwood.demo, hr@sunrise.demo, hr@acme.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Payroll Manager** (`payroll_manager`)           | INSTITUTION   | Payroll executive                          | Salary components/structures, payroll runs and payslips, Form 16 upload/generate/publish. Cannot approve or finalize runs.                                   | payroll@greenwood.demo, payroll@acme.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Finance Manager** (`finance_manager`)           | INSTITUTION   | Finance manager                            | Approves and finalizes payroll; fees, finance ledger, billing and reports.                                                                                   | finance@greenwood.demo, finance@acme.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Accountant** (`accountant`)                     | INSTITUTION   | Accountant                                 | Fee collection, receipts, ledger entries and finance reports.                                                                                                | accountant@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **IT Admin** (`it_admin`)                         | INSTITUTION   | IT administrator                           | Users and logins, role assignment, branding, module features, integrations and secrets, audit.                                                               | it@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Asset Manager** (`asset_manager`)               | INSTITUTION   | Asset / store manager                      | Asset register, assignment to staff, transfers, maintenance, labels.                                                                                         | assets@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Transport Manager** (`transport_manager`)       | INSTITUTION   | Transport manager                          | Routes, stops, vehicles, student transport allocation and charges.                                                                                           | transport@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Librarian** (`librarian`)                       | INSTITUTION   | Librarian                                  | Catalogue, copies, issue/return, fines, library policies.                                                                                                    | librarian@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Hostel Manager** (`hostel_manager`)             | INSTITUTION   | Hostel manager                             | Hostels, rooms, beds and allocations; students and messages.                                                                                                 | hostel@greenwood.demo, north.hostel@brightway.demo, south.hostel@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Hostel Warden** (`hostel_warden`)               | INSTITUTION   | Hostel warden                              | Day-to-day hostel operations (rooms, allocations, students), messages.                                                                                       | warden@greenwood.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Student** (`student`)                           | INSTITUTION   | Student                                    | Own timetable, attendance, results, fees, library, transport, hostel.                                                                                        | student@greenwood.demo, student@sunrise.demo, student@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Parent** (`parent`)                             | INSTITUTION   | Parent / guardian                          | Ward's attendance, results, fees, transport, hostel.                                                                                                         | parent@greenwood.demo, parent@sunrise.demo, parent@brightway.demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Employee** (`employee`)                         | INSTITUTION   | Any staff member (self-service)            | Punch in/out (selfie), own attendance, leave, payslips, Form 16, salary structure PDF, reimbursements, documents, assets, library.                           | branch.teacher@greenwood.demo, principal@greenwood.demo, admin@greenwood.demo, vice.principal@greenwood.demo, dean@greenwood.demo, registrar@greenwood.demo, hod@greenwood.demo, coordinator@greenwood.demo, teacher@greenwood.demo, teacher2@greenwood.demo, faculty@greenwood.demo, hr@greenwood.demo, payroll@greenwood.demo, finance@greenwood.demo, accountant@greenwood.demo, it@greenwood.demo, assets@greenwood.demo, transport@greenwood.demo, librarian@greenwood.demo, hostel@greenwood.demo, warden@greenwood.demo, employee@greenwood.demo, manager@acme.demo, hr@acme.demo, payroll@acme.demo, finance@acme.demo, employee@acme.demo |

Platform roles (outside any organization): **Platform Super Admin** (`superadmin@erp.local`) manages organizations, plans, subscriptions and billing; **Platform Support Admin** (`support@erp.local`) has read-only organization view and audited support access.

## Common hand-offs

- **Leave / regularization:** employee applies → reporting manager / HR / HOD approves (Approvals page, or Approve on HR → Leave).
- **Salary:** HR manager assigns structure + CTC and raises revisions → payroll manager runs payroll → finance manager / institution owner approves and finalizes → payslips published to employees.
- **Form 16:** payroll manager uploads (or generates) and publishes → employee downloads under My payslips → Form 16.
- **Admissions → fees:** registrar/principal admits → accountant collects fees → student/parent sees dues and receipts.
- **Transfer / character certificate:** registrar (or principal, vice principal, HOD, academic coordinator) issues from the student's **Certificates** tab. A TC is refused while fee dues are pending: the accountant collects them, or the principal / institution admin waives them with a reason (`certificate.waive_dues`). The student / parent downloads the PDF under **Certificates** (`certificate.view_own`).

## Detailed permissions by role

### Group Owner (`group_owner`, ORGANIZATION)

Owner of the education group / tenant; full tenant access

<details><summary>173 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.action.send_message` — Allow AI to send messages
  - `ai.configure` — Configure AI providers
  - `ai.manage` — Manage organization AI settings (provider, model, enabled features, limits)
  - `ai.use` — Use AI assistants
  - `ai.view_usage` — View AI usage dashboards (tokens by feature / user / day)
- **asset**
  - `asset.assign` — Assign assets
  - `asset.audit` — Run physical asset verification audits
  - `asset.dispose` — Request and approve asset disposal / write-off
  - `asset.maintain` — Raise and manage asset maintenance tickets, AMC and service schedules
  - `asset.manage` — Manage asset categories, the asset register, inventory and transfers
  - `asset.return` — Return assets
  - `asset.view` — View assets
  - `asset.view_own` — View, acknowledge and report issues on assets in own custody
- **attendance**
  - `attendance.import` — Import punches from biometric devices / integrations
  - `attendance.lock` — Lock attendance periods
  - `attendance.manage` — Correct attendance, recompute days and set attendance policies
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.unlock` — Unlock locked attendance periods (audited)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **audit**
  - `audit.view` — View audit logs
- **billing**
  - `billing.pay` — Report UPI payments (UTR) against subscription invoices
  - `billing.view` — View subscription invoices and payment status
- **branding**
  - `branding.manage` — Edit branding settings
  - `branding.view` — View branding settings
- **campus**
  - `campus.create` — Create campuses
  - `campus.delete` — Delete campuses
  - `campus.update` — Update campuses
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
  - `certificate.view_own` — Download own / linked-ward certificates (self-service)
  - `certificate.waive_dues` — Issue a transfer certificate despite pending fee dues
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **communication**
  - `communication.manage` — Configure communication providers and message templates
  - `communication.view` — View communication providers, templates, campaigns and message logs
- **department**
  - `department.create` — Create departments
  - `department.delete` — Delete departments
  - `department.update` — Update departments
  - `department.view` — View departments
- **designation**
  - `designation.manage` — Create and update designations and employee code numbering
  - `designation.view` — View designations
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.manage` — Edit document metadata, expiry reminders and signature requests
  - `document.share` — Grant / revoke explicit per-document access
  - `document.upload` — Upload documents
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.create` — Create employees
  - `employee.delete` — Delete draft employees
  - `employee.export` — Export employee lists
  - `employee.import` — Bulk import employees from CSV
  - `employee.lifecycle` — Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)
  - `employee.transfer` — Request transfers, promotions and designation / reporting changes
  - `employee.update` — Update employees
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view` — View employees
  - `employee.view_own` — View own employee profile (self-service)
  - `employee.view_sensitive` — Reveal statutory ids and bank details (audited)
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
  - `exam.view_own` — View own / ward results and report cards (self-service)
- **feature**
  - `feature.manage` — Enable or disable licensed modules per group / institution
  - `feature.view` — View enabled modules / features
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.concession` — Grant fee concessions and scholarships
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.refund` — Refund and cancel fee receipts
  - `fee.view` — View fee setup, invoices, receipts and dues
  - `fee.view_own` — View and pay own / wards fees (student & parent self-service)
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **form16**
  - `form16.manage` — Upload and publish Form 16 documents
- **group**
  - `group.create` — Create education groups
  - `group.delete` — Delete education groups
  - `group.update` — Update education groups
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **holiday**
  - `holiday.manage` — Manage holiday calendars, holidays and weekly-off patterns
  - `holiday.view` — View holiday calendars
- **hostel**
  - `hostel.allocate` — Allocate / vacate / transfer hostel beds and generate hostel charges
  - `hostel.apply_own` — Apply for an out-pass and raise hostel complaints for oneself
  - `hostel.manage` — Manage hostels, rooms & beds, visitors, in/out register, complaints, roll call
  - `hostel.outpass_approve` — Approve or reject hostel out-pass requests
  - `hostel.view` — View hostels, rooms, allocations, visitors, out-passes and complaints
  - `hostel.view_own` — View own / own wards' hostel room, roommates and out-passes
- **institution**
  - `institution.create` — Create institutions
  - `institution.delete` — Delete institutions
  - `institution.update` — Update institutions
  - `institution.view` — View institutions
- **integration**
  - `integration.manage` — Manage API clients, webhooks and integration credentials
  - `integration.view` — View API clients, webhooks and integration credentials
- **leave**
  - `leave.adjust` — Adjust / encash leave balances and run accrual / year-end
  - `leave.apply` — Apply / cancel leave on behalf of employees
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.manage` — Manage leave types and leave policies
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **library**
  - `library.circulate` — Issue, return, renew books and manage reservations
  - `library.fine` — Collect or waive library fines
  - `library.manage` — Manage library catalogue, copies, policies, imports and stock verification
  - `library.view` — View library catalogue, copies, circulation and reports
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **notification**
  - `notification.manage` — Configure notification rules (event → channels / recipients)
- **organization**
  - `organization.update` — Update the organization profile
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.approve` — Approve payroll
  - `payroll.disburse` — Export bank files and record payroll payments
  - `payroll.lock` — Lock payroll
  - `payroll.manage` — Manage salary components, structures, rules and statutory settings
  - `payroll.process` — Process payroll
  - `payroll.reopen` — Reopen a finalized payroll run (audited, creates a new revision)
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
  - `payroll.view_own` — View and download own payslips and Form 16
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **reimbursement**
  - `reimbursement.claim_own` — Submit own reimbursement claims
- **role**
  - `role.manage` — Create and edit custom roles
  - `role.view` — View roles and permissions
- **salary**
  - `salary.update` — Update salaries
  - `salary.view` — View salaries
- **secret**
  - `secret.manage` — Create, rotate and delete secrets
  - `secret.view` — View configured secrets (masked)
- **shift**
  - `shift.manage` — Manage shifts and shift assignments
  - `shift.view` — View shifts and shift assignments
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
  - `student_attendance.view_own` — View own / ward attendance (student & parent self-service)
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **subscription**
  - `subscription.view` — View the subscription plan, limits and usage
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
  - `timetable.view_own` — View own / ward timetable (student & parent self-service)
- **transport**
  - `transport.allocate` — Allocate students / staff to routes and generate transport charges
  - `transport.manage` — Manage vehicles, drivers, routes & stops, fare slabs, trips and logs
  - `transport.view` — View vehicles, drivers, routes, allocations, trips and transport reports
  - `transport.view_own` — View own / own wards' transport (route, stop, vehicle, driver)
- **user**
  - `user.create` — Invite / create users
  - `user.deactivate` — Deactivate / reactivate users
  - `user.reset_password` — Issue password reset links
  - `user.role.assign` — Assign roles and scopes to users
  - `user.update` — Update user profiles
  - `user.view` — View users
- **ward**
  - `ward.view` — Parent / guardian access to linked children
- **workflow**
  - `workflow.manage` — Create, version and activate approval workflow definitions
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Group Admin (`group_admin`, GROUP)

Administers all institutions in assigned groups

<details><summary>135 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.manage` — Manage organization AI settings (provider, model, enabled features, limits)
  - `ai.use` — Use AI assistants
  - `ai.view_usage` — View AI usage dashboards (tokens by feature / user / day)
- **asset**
  - `asset.assign` — Assign assets
  - `asset.return` — Return assets
  - `asset.view` — View assets
- **attendance**
  - `attendance.import` — Import punches from biometric devices / integrations
  - `attendance.lock` — Lock attendance periods
  - `attendance.manage` — Correct attendance, recompute days and set attendance policies
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.unlock` — Unlock locked attendance periods (audited)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **audit**
  - `audit.view` — View audit logs
- **branding**
  - `branding.manage` — Edit branding settings
  - `branding.view` — View branding settings
- **campus**
  - `campus.create` — Create campuses
  - `campus.delete` — Delete campuses
  - `campus.update` — Update campuses
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
  - `certificate.waive_dues` — Issue a transfer certificate despite pending fee dues
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **communication**
  - `communication.manage` — Configure communication providers and message templates
  - `communication.view` — View communication providers, templates, campaigns and message logs
- **department**
  - `department.create` — Create departments
  - `department.delete` — Delete departments
  - `department.update` — Update departments
  - `department.view` — View departments
- **designation**
  - `designation.view` — View designations
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.manage` — Edit document metadata, expiry reminders and signature requests
  - `document.share` — Grant / revoke explicit per-document access
  - `document.upload` — Upload documents
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.create` — Create employees
  - `employee.delete` — Delete draft employees
  - `employee.export` — Export employee lists
  - `employee.import` — Bulk import employees from CSV
  - `employee.lifecycle` — Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)
  - `employee.transfer` — Request transfers, promotions and designation / reporting changes
  - `employee.update` — Update employees
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view` — View employees
  - `employee.view_own` — View own employee profile (self-service)
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **feature**
  - `feature.manage` — Enable or disable licensed modules per group / institution
  - `feature.view` — View enabled modules / features
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.concession` — Grant fee concessions and scholarships
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.refund` — Refund and cancel fee receipts
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.update` — Update education groups
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **holiday**
  - `holiday.manage` — Manage holiday calendars, holidays and weekly-off patterns
  - `holiday.view` — View holiday calendars
- **hostel**
  - `hostel.allocate` — Allocate / vacate / transfer hostel beds and generate hostel charges
  - `hostel.manage` — Manage hostels, rooms & beds, visitors, in/out register, complaints, roll call
  - `hostel.outpass_approve` — Approve or reject hostel out-pass requests
  - `hostel.view` — View hostels, rooms, allocations, visitors, out-passes and complaints
- **institution**
  - `institution.create` — Create institutions
  - `institution.delete` — Delete institutions
  - `institution.update` — Update institutions
  - `institution.view` — View institutions
- **integration**
  - `integration.view` — View API clients, webhooks and integration credentials
- **leave**
  - `leave.adjust` — Adjust / encash leave balances and run accrual / year-end
  - `leave.apply` — Apply / cancel leave on behalf of employees
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.manage` — Manage leave types and leave policies
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **library**
  - `library.circulate` — Issue, return, renew books and manage reservations
  - `library.fine` — Collect or waive library fines
  - `library.manage` — Manage library catalogue, copies, policies, imports and stock verification
  - `library.view` — View library catalogue, copies, circulation and reports
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **notification**
  - `notification.manage` — Configure notification rules (event → channels / recipients)
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.view` — View payroll
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **role**
  - `role.view` — View roles and permissions
- **salary**
  - `salary.view` — View salaries
- **secret**
  - `secret.view` — View configured secrets (masked)
- **shift**
  - `shift.manage` — Manage shifts and shift assignments
  - `shift.view` — View shifts and shift assignments
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **transport**
  - `transport.allocate` — Allocate students / staff to routes and generate transport charges
  - `transport.manage` — Manage vehicles, drivers, routes & stops, fare slabs, trips and logs
  - `transport.view` — View vehicles, drivers, routes, allocations, trips and transport reports
- **user**
  - `user.create` — Invite / create users
  - `user.deactivate` — Deactivate / reactivate users
  - `user.reset_password` — Issue password reset links
  - `user.role.assign` — Assign roles and scopes to users
  - `user.update` — Update user profiles
  - `user.view` — View users
- **workflow**
  - `workflow.manage` — Create, version and activate approval workflow definitions
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Group HR (`group_hr`, GROUP)

HR across assigned groups

<details><summary>57 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.assign` — Assign assets
  - `asset.return` — Return assets
  - `asset.view` — View assets
- **attendance**
  - `attendance.import` — Import punches from biometric devices / integrations
  - `attendance.lock` — Lock attendance periods
  - `attendance.manage` — Correct attendance, recompute days and set attendance policies
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **designation**
  - `designation.manage` — Create and update designations and employee code numbering
  - `designation.view` — View designations
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.manage` — Edit document metadata, expiry reminders and signature requests
  - `document.share` — Grant / revoke explicit per-document access
  - `document.upload` — Upload documents
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.create` — Create employees
  - `employee.delete` — Delete draft employees
  - `employee.export` — Export employee lists
  - `employee.import` — Bulk import employees from CSV
  - `employee.lifecycle` — Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)
  - `employee.transfer` — Request transfers, promotions and designation / reporting changes
  - `employee.update` — Update employees
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view` — View employees
  - `employee.view_own` — View own employee profile (self-service)
  - `employee.view_sensitive` — Reveal statutory ids and bank details (audited)
- **group**
  - `group.view` — View education groups
- **holiday**
  - `holiday.manage` — Manage holiday calendars, holidays and weekly-off patterns
  - `holiday.view` — View holiday calendars
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.adjust` — Adjust / encash leave balances and run accrual / year-end
  - `leave.apply` — Apply / cancel leave on behalf of employees
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.manage` — Manage leave types and leave policies
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.view` — View programs / courses
- **salary**
  - `salary.update` — Update salaries
  - `salary.view` — View salaries
- **shift**
  - `shift.manage` — Manage shifts and shift assignments
  - `shift.view` — View shifts and shift assignments
- **user**
  - `user.view` — View users
- **workflow**
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Group Finance (`group_finance`, GROUP)

Finance across assigned groups

<details><summary>37 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.view` — View assets
- **attendance**
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
- **audit**
  - `audit.view` — View audit logs
- **billing**
  - `billing.pay` — Report UPI payments (UTR) against subscription invoices
  - `billing.view` — View subscription invoices and payment status
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **designation**
  - `designation.view` — View designations
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.concession` — Grant fee concessions and scholarships
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.refund` — Refund and cancel fee receipts
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.view` — View education groups
- **holiday**
  - `holiday.view` — View holiday calendars
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.view` — View leave requests and balances
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.approve` — Approve payroll
  - `payroll.disburse` — Export bank files and record payroll payments
  - `payroll.lock` — Lock payroll
  - `payroll.reopen` — Reopen a finalized payroll run (audited, creates a new revision)
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
- **program**
  - `program.view` — View programs / courses
- **salary**
  - `salary.view` — View salaries
- **shift**
  - `shift.view` — View shifts and shift assignments
- **student**
  - `student.view` — View students
- **subscription**
  - `subscription.view` — View the subscription plan, limits and usage

</details>

### Institution Owner (`institution_owner`, INSTITUTION)

Owner of assigned institutions

<details><summary>127 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.assign` — Assign assets
  - `asset.return` — Return assets
  - `asset.view` — View assets
- **attendance**
  - `attendance.import` — Import punches from biometric devices / integrations
  - `attendance.lock` — Lock attendance periods
  - `attendance.manage` — Correct attendance, recompute days and set attendance policies
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.unlock` — Unlock locked attendance periods (audited)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **audit**
  - `audit.view` — View audit logs
- **branding**
  - `branding.manage` — Edit branding settings
  - `branding.view` — View branding settings
- **campus**
  - `campus.create` — Create campuses
  - `campus.delete` — Delete campuses
  - `campus.update` — Update campuses
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
  - `certificate.waive_dues` — Issue a transfer certificate despite pending fee dues
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **communication**
  - `communication.view` — View communication providers, templates, campaigns and message logs
- **department**
  - `department.create` — Create departments
  - `department.delete` — Delete departments
  - `department.update` — Update departments
  - `department.view` — View departments
- **designation**
  - `designation.manage` — Create and update designations and employee code numbering
  - `designation.view` — View designations
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.manage` — Edit document metadata, expiry reminders and signature requests
  - `document.share` — Grant / revoke explicit per-document access
  - `document.upload` — Upload documents
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.create` — Create employees
  - `employee.delete` — Delete draft employees
  - `employee.export` — Export employee lists
  - `employee.import` — Bulk import employees from CSV
  - `employee.lifecycle` — Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)
  - `employee.transfer` — Request transfers, promotions and designation / reporting changes
  - `employee.update` — Update employees
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view` — View employees
  - `employee.view_own` — View own employee profile (self-service)
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **feature**
  - `feature.view` — View enabled modules / features
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.concession` — Grant fee concessions and scholarships
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.refund` — Refund and cancel fee receipts
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **holiday**
  - `holiday.manage` — Manage holiday calendars, holidays and weekly-off patterns
  - `holiday.view` — View holiday calendars
- **hostel**
  - `hostel.allocate` — Allocate / vacate / transfer hostel beds and generate hostel charges
  - `hostel.manage` — Manage hostels, rooms & beds, visitors, in/out register, complaints, roll call
  - `hostel.outpass_approve` — Approve or reject hostel out-pass requests
  - `hostel.view` — View hostels, rooms, allocations, visitors, out-passes and complaints
- **institution**
  - `institution.update` — Update institutions
  - `institution.view` — View institutions
- **leave**
  - `leave.adjust` — Adjust / encash leave balances and run accrual / year-end
  - `leave.apply` — Apply / cancel leave on behalf of employees
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.manage` — Manage leave types and leave policies
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **library**
  - `library.circulate` — Issue, return, renew books and manage reservations
  - `library.fine` — Collect or waive library fines
  - `library.manage` — Manage library catalogue, copies, policies, imports and stock verification
  - `library.view` — View library catalogue, copies, circulation and reports
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.approve` — Approve payroll
  - `payroll.lock` — Lock payroll
  - `payroll.view` — View payroll
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **role**
  - `role.view` — View roles and permissions
- **salary**
  - `salary.view` — View salaries
- **shift**
  - `shift.manage` — Manage shifts and shift assignments
  - `shift.view` — View shifts and shift assignments
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **transport**
  - `transport.allocate` — Allocate students / staff to routes and generate transport charges
  - `transport.manage` — Manage vehicles, drivers, routes & stops, fare slabs, trips and logs
  - `transport.view` — View vehicles, drivers, routes, allocations, trips and transport reports
- **user**
  - `user.create` — Invite / create users
  - `user.deactivate` — Deactivate / reactivate users
  - `user.reset_password` — Issue password reset links
  - `user.role.assign` — Assign roles and scopes to users
  - `user.update` — Update user profiles
  - `user.view` — View users
- **workflow**
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Institution Admin (`institution_admin`, INSTITUTION)

Administers assigned institutions only

<details><summary>123 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.assign` — Assign assets
  - `asset.return` — Return assets
  - `asset.view` — View assets
- **attendance**
  - `attendance.import` — Import punches from biometric devices / integrations
  - `attendance.lock` — Lock attendance periods
  - `attendance.manage` — Correct attendance, recompute days and set attendance policies
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **audit**
  - `audit.view` — View audit logs
- **branding**
  - `branding.manage` — Edit branding settings
  - `branding.view` — View branding settings
- **campus**
  - `campus.create` — Create campuses
  - `campus.delete` — Delete campuses
  - `campus.update` — Update campuses
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
  - `certificate.waive_dues` — Issue a transfer certificate despite pending fee dues
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **communication**
  - `communication.view` — View communication providers, templates, campaigns and message logs
- **department**
  - `department.create` — Create departments
  - `department.delete` — Delete departments
  - `department.update` — Update departments
  - `department.view` — View departments
- **designation**
  - `designation.view` — View designations
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.manage` — Edit document metadata, expiry reminders and signature requests
  - `document.share` — Grant / revoke explicit per-document access
  - `document.upload` — Upload documents
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.create` — Create employees
  - `employee.delete` — Delete draft employees
  - `employee.export` — Export employee lists
  - `employee.import` — Bulk import employees from CSV
  - `employee.lifecycle` — Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)
  - `employee.transfer` — Request transfers, promotions and designation / reporting changes
  - `employee.update` — Update employees
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view` — View employees
  - `employee.view_own` — View own employee profile (self-service)
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **feature**
  - `feature.view` — View enabled modules / features
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.concession` — Grant fee concessions and scholarships
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.refund` — Refund and cancel fee receipts
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **holiday**
  - `holiday.manage` — Manage holiday calendars, holidays and weekly-off patterns
  - `holiday.view` — View holiday calendars
- **hostel**
  - `hostel.allocate` — Allocate / vacate / transfer hostel beds and generate hostel charges
  - `hostel.manage` — Manage hostels, rooms & beds, visitors, in/out register, complaints, roll call
  - `hostel.outpass_approve` — Approve or reject hostel out-pass requests
  - `hostel.view` — View hostels, rooms, allocations, visitors, out-passes and complaints
- **institution**
  - `institution.update` — Update institutions
  - `institution.view` — View institutions
- **leave**
  - `leave.adjust` — Adjust / encash leave balances and run accrual / year-end
  - `leave.apply` — Apply / cancel leave on behalf of employees
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.manage` — Manage leave types and leave policies
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **library**
  - `library.circulate` — Issue, return, renew books and manage reservations
  - `library.fine` — Collect or waive library fines
  - `library.manage` — Manage library catalogue, copies, policies, imports and stock verification
  - `library.view` — View library catalogue, copies, circulation and reports
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.view` — View payroll
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **role**
  - `role.view` — View roles and permissions
- **salary**
  - `salary.view` — View salaries
- **shift**
  - `shift.manage` — Manage shifts and shift assignments
  - `shift.view` — View shifts and shift assignments
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **transport**
  - `transport.allocate` — Allocate students / staff to routes and generate transport charges
  - `transport.manage` — Manage vehicles, drivers, routes & stops, fare slabs, trips and logs
  - `transport.view` — View vehicles, drivers, routes, allocations, trips and transport reports
- **user**
  - `user.create` — Invite / create users
  - `user.deactivate` — Deactivate / reactivate users
  - `user.reset_password` — Issue password reset links
  - `user.role.assign` — Assign roles and scopes to users
  - `user.update` — Update user profiles
  - `user.view` — View users
- **workflow**
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Principal (`principal`, INSTITUTION)

Academic head of an institution

<details><summary>58 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **audit**
  - `audit.view` — View audit logs
- **campus**
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
  - `certificate.waive_dues` — Issue a transfer certificate despite pending fee dues
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.update` — Update employees
  - `employee.view` — View employees
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **fee**
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **library**
  - `library.view` — View library catalogue, copies, circulation and reports
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **user**
  - `user.view` — View users

</details>

### Vice Principal (`vice_principal`, INSTITUTION)

Deputy academic head

<details><summary>52 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **user**
  - `user.view` — View users

</details>

### Dean (`dean`, INSTITUTION)

Academic head of a faculty / set of departments

<details><summary>52 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **user**
  - `user.view` — View users

</details>

### Registrar (`registrar`, INSTITUTION)

Student records and academic administration

<details><summary>53 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **user**
  - `user.view` — View users

</details>

### HOD (`hod`, DEPARTMENT)

Head of department; limited to assigned departments

<details><summary>52 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **user**
  - `user.view` — View users

</details>

### Academic Coordinator (`academic_coordinator`, INSTITUTION)

Subjects, timetable, attendance and examinations of an institution

<details><summary>52 permissions</summary>

- **admission**
  - `admission.manage` — Create, decide and enroll admission applications
  - `admission.view` — View admission applications
- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **certificate**
  - `certificate.cancel` — Cancel issued transfer / character certificates
  - `certificate.issue` — Issue and reissue transfer / character certificates
  - `certificate.view` — View transfer / character certificates and download their PDFs
- **class_section**
  - `class_section.create` — Create classes / sections
  - `class_section.delete` — Delete classes / sections
  - `class_section.update` — Update classes / sections
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **exam**
  - `exam.manage` — Manage exam terms, schedules and grading scales; compute results
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.publish` — Lock/unlock marks and publish results
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **guardian**
  - `guardian.manage` — Create and link guardians / parent logins
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.schedule` — Schedule messages
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.create` — Create programs / courses
  - `program.delete` — Delete programs / courses
  - `program.update` — Update programs / courses
  - `program.view` — View programs / courses
- **student**
  - `student.create` — Create students
  - `student.delete` — Delete students
  - `student.import` — Bulk import students from CSV
  - `student.lifecycle` — Promote, withdraw and graduate students
  - `student.update` — Update students
  - `student.view` — View students
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.manage` — Mark any section and edit attendance outside the edit window
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.manage` — Manage subjects, subject-teacher and class-teacher allocations
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.manage` — Manage bell schedules, timetables and substitutions
  - `timetable.view` — View bell schedules, timetables and substitutions
- **user**
  - `user.view` — View users

</details>

### Teacher (`teacher`, DEPARTMENT)

Teaching staff

<details><summary>24 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **exam**
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.view` — View programs / courses
- **student**
  - `student.view` — View students
- **student_attendance**
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.view` — View bell schedules, timetables and substitutions

</details>

### Faculty (`faculty`, DEPARTMENT)

Faculty member (higher education)

<details><summary>24 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **exam**
  - `exam.marks_entry` — Enter marks (teachers: allocated subjects only)
  - `exam.view` — View exam terms, schedules, marks and results
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.view` — View programs / courses
- **student**
  - `student.view` — View students
- **student_attendance**
  - `student_attendance.mark` — Mark student attendance (teachers: allocated sections only)
  - `student_attendance.view` — View student attendance and monthly registers
- **subject**
  - `subject.view` — View subjects and teacher allocations
- **timetable**
  - `timetable.view` — View bell schedules, timetables and substitutions

</details>

### HR Manager (`hr_manager`, INSTITUTION)

Institution HR

<details><summary>57 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.assign` — Assign assets
  - `asset.return` — Return assets
  - `asset.view` — View assets
- **attendance**
  - `attendance.import` — Import punches from biometric devices / integrations
  - `attendance.lock` — Lock attendance periods
  - `attendance.manage` — Correct attendance, recompute days and set attendance policies
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
  - `attendance.view_own` — View own attendance (self-service)
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **designation**
  - `designation.manage` — Create and update designations and employee code numbering
  - `designation.view` — View designations
- **document**
  - `document.delete` — Delete documents
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.manage` — Edit document metadata, expiry reminders and signature requests
  - `document.share` — Grant / revoke explicit per-document access
  - `document.upload` — Upload documents
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.create` — Create employees
  - `employee.delete` — Delete draft employees
  - `employee.export` — Export employee lists
  - `employee.import` — Bulk import employees from CSV
  - `employee.lifecycle` — Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)
  - `employee.transfer` — Request transfers, promotions and designation / reporting changes
  - `employee.update` — Update employees
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view` — View employees
  - `employee.view_own` — View own employee profile (self-service)
  - `employee.view_sensitive` — Reveal statutory ids and bank details (audited)
- **group**
  - `group.view` — View education groups
- **holiday**
  - `holiday.manage` — Manage holiday calendars, holidays and weekly-off patterns
  - `holiday.view` — View holiday calendars
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.adjust` — Adjust / encash leave balances and run accrual / year-end
  - `leave.apply` — Apply / cancel leave on behalf of employees
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.manage` — Manage leave types and leave policies
  - `leave.view` — View leave requests and balances
  - `leave.view_own` — View own leave balances and requests (self-service)
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.view` — View programs / courses
- **salary**
  - `salary.update` — Update salaries
  - `salary.view` — View salaries
- **shift**
  - `shift.manage` — Manage shifts and shift assignments
  - `shift.view` — View shifts and shift assignments
- **user**
  - `user.view` — View users
- **workflow**
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Payroll Manager (`payroll_manager`, INSTITUTION)

Prepares and processes payroll

<details><summary>24 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **attendance**
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.view` — View documents
  - `document.view_confidential` — View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)
- **employee**
  - `employee.view` — View employees
- **form16**
  - `form16.manage` — Upload and publish Form 16 documents
- **group**
  - `group.view` — View education groups
- **holiday**
  - `holiday.view` — View holiday calendars
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.view` — View leave requests and balances
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.disburse` — Export bank files and record payroll payments
  - `payroll.manage` — Manage salary components, structures, rules and statutory settings
  - `payroll.process` — Process payroll
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
- **program**
  - `program.view` — View programs / courses
- **salary**
  - `salary.update` — Update salaries
  - `salary.view` — View salaries
- **shift**
  - `shift.view` — View shifts and shift assignments

</details>

### Finance Manager (`finance_manager`, INSTITUTION)

Approves and locks payroll

<details><summary>36 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.view` — View assets
- **attendance**
  - `attendance.view` — View attendance registers, punches and payroll attendance summaries
- **audit**
  - `audit.view` — View audit logs
- **billing**
  - `billing.pay` — Report UPI payments (UTR) against subscription invoices
  - `billing.view` — View subscription invoices and payment status
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **designation**
  - `designation.view` — View designations
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.concession` — Grant fee concessions and scholarships
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.refund` — Refund and cancel fee receipts
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.view` — View education groups
- **holiday**
  - `holiday.view` — View holiday calendars
- **institution**
  - `institution.view` — View institutions
- **leave**
  - `leave.view` — View leave requests and balances
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.approve` — Approve payroll
  - `payroll.disburse` — Export bank files and record payroll payments
  - `payroll.lock` — Lock payroll
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
- **program**
  - `program.view` — View programs / courses
- **salary**
  - `salary.view` — View salaries
- **shift**
  - `shift.view` — View shifts and shift assignments
- **student**
  - `student.view` — View students
- **subscription**
  - `subscription.view` — View the subscription plan, limits and usage

</details>

### Accountant (`accountant`, INSTITUTION)

Accounting staff

<details><summary>20 permissions</summary>

- **billing**
  - `billing.view` — View subscription invoices and payment status
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.view` — View documents
- **fee**
  - `fee.collect` — Record fee payments and issue receipts
  - `fee.manage` — Manage fee heads, structures, late-fee rules and invoices
  - `fee.view` — View fee setup, invoices, receipts and dues
- **finance**
  - `finance.manage` — Manage chart of accounts, vendors and expenses
  - `finance.post` — Post and cancel journal vouchers
  - `finance.view` — View accounts, vouchers, ledgers and financial reports
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.report` — Payroll registers, statutory and group consolidated reports
  - `payroll.view` — View payroll
- **program**
  - `program.view` — View programs / courses
- **salary**
  - `salary.view` — View salaries
- **student**
  - `student.view` — View students

</details>

### IT Admin (`it_admin`, INSTITUTION)

User accounts and system configuration

<details><summary>26 permissions</summary>

- **ai**
  - `ai.configure` — Configure AI providers
  - `ai.manage` — Manage organization AI settings (provider, model, enabled features, limits)
  - `ai.view_usage` — View AI usage dashboards (tokens by feature / user / day)
- **audit**
  - `audit.view` — View audit logs
- **branding**
  - `branding.view` — View branding settings
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **communication**
  - `communication.manage` — Configure communication providers and message templates
  - `communication.view` — View communication providers, templates, campaigns and message logs
- **department**
  - `department.view` — View departments
- **feature**
  - `feature.view` — View enabled modules / features
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **integration**
  - `integration.manage` — Manage API clients, webhooks and integration credentials
  - `integration.view` — View API clients, webhooks and integration credentials
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.view` — View programs / courses
- **role**
  - `role.view` — View roles and permissions
- **secret**
  - `secret.manage` — Create, rotate and delete secrets
  - `secret.view` — View configured secrets (masked)
- **user**
  - `user.create` — Invite / create users
  - `user.deactivate` — Deactivate / reactivate users
  - `user.reset_password` — Issue password reset links
  - `user.role.assign` — Assign roles and scopes to users
  - `user.update` — Update user profiles
  - `user.view` — View users

</details>

### Asset Manager (`asset_manager`, INSTITUTION)

Manages assets

<details><summary>20 permissions</summary>

- **asset**
  - `asset.assign` — Assign assets
  - `asset.audit` — Run physical asset verification audits
  - `asset.dispose` — Request and approve asset disposal / write-off
  - `asset.maintain` — Raise and manage asset maintenance tickets, AMC and service schedules
  - `asset.manage` — Manage asset categories, the asset register, inventory and transfers
  - `asset.return` — Return assets
  - `asset.view` — View assets
- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **organization**
  - `organization.view` — View the organization profile
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.view` — View programs / courses
- **workflow**
  - `workflow.view` — View approval workflow definitions and all approval requests in scope

</details>

### Transport Manager (`transport_manager`, INSTITUTION)

Manages transport

<details><summary>16 permissions</summary>

- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.download` — Download documents (issues audited short-lived signed URLs)
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.view` — View programs / courses
- **student**
  - `student.view` — View students
- **transport**
  - `transport.allocate` — Allocate students / staff to routes and generate transport charges
  - `transport.manage` — Manage vehicles, drivers, routes & stops, fare slabs, trips and logs
  - `transport.view` — View vehicles, drivers, routes, allocations, trips and transport reports

</details>

### Librarian (`librarian`, INSTITUTION)

Manages the library

<details><summary>18 permissions</summary>

- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **document**
  - `document.upload` — Upload documents
  - `document.view` — View documents
- **employee**
  - `employee.view` — View employees
- **group**
  - `group.view` — View education groups
- **institution**
  - `institution.view` — View institutions
- **library**
  - `library.circulate` — Issue, return, renew books and manage reservations
  - `library.fine` — Collect or waive library fines
  - `library.manage` — Manage library catalogue, copies, policies, imports and stock verification
  - `library.view` — View library catalogue, copies, circulation and reports
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **pdf**
  - `pdf.generate` — Generate PDFs from templates (stored as documents)
- **program**
  - `program.view` — View programs / courses
- **student**
  - `student.view` — View students

</details>

### Hostel Manager (`hostel_manager`, INSTITUTION)

Manages hostels

<details><summary>14 permissions</summary>

- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **employee**
  - `employee.view` — View employees
- **group**
  - `group.view` — View education groups
- **hostel**
  - `hostel.allocate` — Allocate / vacate / transfer hostel beds and generate hostel charges
  - `hostel.manage` — Manage hostels, rooms & beds, visitors, in/out register, complaints, roll call
  - `hostel.outpass_approve` — Approve or reject hostel out-pass requests
  - `hostel.view` — View hostels, rooms, allocations, visitors, out-passes and complaints
- **institution**
  - `institution.view` — View institutions
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.view` — View programs / courses
- **student**
  - `student.view` — View students

</details>

### Hostel Warden (`hostel_warden`, INSTITUTION)

Runs a hostel day to day: allocations, out-pass approval, visitors, roll call

<details><summary>13 permissions</summary>

- **campus**
  - `campus.view` — View campuses
- **class_section**
  - `class_section.view` — View classes / sections
- **department**
  - `department.view` — View departments
- **group**
  - `group.view` — View education groups
- **hostel**
  - `hostel.allocate` — Allocate / vacate / transfer hostel beds and generate hostel charges
  - `hostel.manage` — Manage hostels, rooms & beds, visitors, in/out register, complaints, roll call
  - `hostel.outpass_approve` — Approve or reject hostel out-pass requests
  - `hostel.view` — View hostels, rooms, allocations, visitors, out-passes and complaints
- **institution**
  - `institution.view` — View institutions
- **message**
  - `message.send` — Send messages
- **organization**
  - `organization.view` — View the organization profile
- **program**
  - `program.view` — View programs / courses
- **student**
  - `student.view` — View students

</details>

### Student (`student`, INSTITUTION)

Student self-service

<details><summary>13 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **certificate**
  - `certificate.view_own` — Download own / linked-ward certificates (self-service)
- **document**
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **exam**
  - `exam.view_own` — View own / ward results and report cards (self-service)
- **fee**
  - `fee.view_own` — View and pay own / wards fees (student & parent self-service)
- **hostel**
  - `hostel.apply_own` — Apply for an out-pass and raise hostel complaints for oneself
  - `hostel.view_own` — View own / own wards' hostel room, roommates and out-passes
- **library**
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **organization**
  - `organization.view` — View the organization profile
- **student**
  - `student.view_own` — View own student profile (self-service)
- **student_attendance**
  - `student_attendance.view_own` — View own / ward attendance (student & parent self-service)
- **timetable**
  - `timetable.view_own` — View own / ward timetable (student & parent self-service)
- **transport**
  - `transport.view_own` — View own / own wards' transport (route, stop, vehicle, driver)

</details>

### Parent (`parent`, INSTITUTION)

Parent / guardian self-service

<details><summary>13 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **certificate**
  - `certificate.view_own` — Download own / linked-ward certificates (self-service)
- **document**
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **exam**
  - `exam.view_own` — View own / ward results and report cards (self-service)
- **fee**
  - `fee.view_own` — View and pay own / wards fees (student & parent self-service)
- **hostel**
  - `hostel.apply_own` — Apply for an out-pass and raise hostel complaints for oneself
  - `hostel.view_own` — View own / own wards' hostel room, roommates and out-passes
- **library**
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **organization**
  - `organization.view` — View the organization profile
- **student_attendance**
  - `student_attendance.view_own` — View own / ward attendance (student & parent self-service)
- **timetable**
  - `timetable.view_own` — View own / ward timetable (student & parent self-service)
- **transport**
  - `transport.view_own` — View own / own wards' transport (route, stop, vehicle, driver)
- **ward**
  - `ward.view` — Parent / guardian access to linked children

</details>

### Employee (`employee`, INSTITUTION)

Employee self-service

<details><summary>14 permissions</summary>

- **ai**
  - `ai.use` — Use AI assistants
- **asset**
  - `asset.view_own` — View, acknowledge and report issues on assets in own custody
- **attendance**
  - `attendance.punch_own` — Punch in / out (self-service web / mobile)
  - `attendance.regularize_own` — Request regularization of own attendance (self-service)
  - `attendance.view_own` — View own attendance (self-service)
- **document**
  - `document.view_own` — View documents owned by oneself (owner self-access, e.g. own payslips)
- **employee**
  - `employee.update_own` — Request changes to own personal details (self-service)
  - `employee.view_own` — View own employee profile (self-service)
- **leave**
  - `leave.apply_own` — Apply for and cancel own leave (self-service)
  - `leave.view_own` — View own leave balances and requests (self-service)
- **library**
  - `library.view_own` — Self-service library: own loans, fines, OPAC search and reservations
- **organization**
  - `organization.view` — View the organization profile
- **payroll**
  - `payroll.view_own` — View and download own payslips and Form 16
- **reimbursement**
  - `reimbursement.claim_own` — Submit own reimbursement claims

</details>
