# Education ERP + HRMS + Payroll + Asset + Communication + AI SaaS

## 1. Product Vision

Build a production-ready, multi-tenant SaaS platform for schools, colleges, universities, and multi-institution education groups.

The platform must support:

* Independent schools/colleges
* Education groups containing multiple institutions
* Multiple campuses
* Departments
* Courses/programs
* Students
* Parents/guardians
* Teachers/faculty
* Non-teaching employees
* HR
* Payroll
* Attendance
* Leave
* Holidays
* Shifts
* Recruitment
* Employee onboarding/offboarding
* Performance management
* Assets
* Documents
* Finance
* Fees
* Examination
* Results
* Transport
* Hostel
* Library
* Communication
* Email
* SMS
* WhatsApp
* Push notifications
* AI providers/models
* AI assistants
* AI-powered reporting
* Cloud file storage
* PDF generation
* E-signatures
* Audit logs
* APIs
* Webhooks
* Web/iOS/Android access

The platform must be designed as a true multi-tenant SaaS product and must not be implemented as separate applications for each college.

---

# 2. Multi-Tenant Hierarchy

The core hierarchy must be:

Platform
→ Education Group
→ Institution
→ Campus
→ Department
→ Program/Course
→ Class/Section
→ Student/Employee

Example:

ABBS Group
→ College A
→ College B
→ College C
→ College D

BCC Group
→ College A
→ College B

JP College
→ Independent Institution

A Group Administrator for ABBS must never be able to access BCC or JP data.

An Institution Administrator must only access the institutions explicitly assigned to them.

A Department Head must only access the departments assigned to them.

All tenant authorization must be enforced on the backend.

Never trust tenant_id, group_id, institution_id, department_id, or user permissions supplied by the frontend.

---

# 3. Platform Roles

Implement configurable RBAC + scope-based authorization.

Default roles:

* Platform Super Admin
* Platform Support Admin
* Group Owner
* Group Admin
* Group HR
* Group Finance
* Institution Owner
* Institution Admin
* Principal
* Vice Principal
* Dean
* Registrar
* HOD
* Teacher
* Faculty
* HR Manager
* Payroll Manager
* Finance Manager
* Accountant
* IT Admin
* Asset Manager
* Transport Manager
* Librarian
* Hostel Manager
* Student
* Parent
* Employee

Do not hard-code authorization only by role names.

Use:

Role
→ Permission
→ Scope

Examples:

student.view
student.create
student.update

employee.view
employee.update

payroll.view
payroll.process
payroll.approve
payroll.lock

salary.view
salary.update

asset.view
asset.assign
asset.return

document.view
document.upload
document.delete

message.send
message.schedule

ai.use
ai.configure
ai.action.send_message

---

# 4. Employee/HR Master

Create a comprehensive employee master.

Employee information:

* Employee ID
* Employee Code
* Name
* Photo
* DOB
* Gender
* Blood Group
* Marital Status
* Personal Email
* Official Email
* Mobile
* Address
* Emergency Contact
* PAN
* Aadhaar
* UAN
* PF Number
* ESI Number
* PT Number
* Bank Account
* IFSC
* Qualification
* Experience
* Institution
* Campus
* Department
* Designation
* Grade
* Employee Type
* Joining Date
* Confirmation Date
* Reporting Manager
* HOD
* Work Location
* Shift
* Employment Status

Support:

* Permanent
* Probation
* Contract
* Part-time
* Visiting Faculty
* Guest Faculty
* Consultant
* Intern
* Temporary
* Outsourced Staff

Do not physically delete employees with historical payroll data.

Support statuses:

* Active
* Probation
* On Leave
* Suspended
* Resigned
* Notice Period
* Terminated
* Retired
* Exited
* Archived

---

# 5. Employee Lifecycle

Implement:

Candidate
→ Application
→ Interview
→ Selection
→ Offer
→ Joining
→ Onboarding
→ Employee
→ Attendance
→ Leave
→ Payroll
→ Performance
→ Promotion
→ Salary Revision
→ Transfer
→ Asset Assignment
→ Resignation
→ Notice Period
→ Exit Clearance
→ Full & Final
→ Experience Letter
→ Relieving Letter
→ Alumni/Former Employee

Every transition must be auditable.

---

# 6. Recruitment

Support:

* Job openings
* Departments
* Designations
* Candidate applications
* Resume upload
* Screening
* Interview rounds
* Interview evaluation
* Selection
* Rejection
* Offer generation
* Joining date
* Candidate documents

---

# 7. Offer Letter

Create configurable templates.

Variables:

{{employee.name}}
{{employee.designation}}
{{employee.department}}
{{employee.joiningDate}}
{{employee.salary}}
{{institution.name}}
{{institution.logo}}
{{institution.address}}

Generate PDF and store in cloud document storage.

Support:

* Draft
* Review
* Approval
* Signature
* Published
* Revoked

---

# 8. Onboarding

Create configurable onboarding checklists.

Example:

* Personal information
* PAN
* Aadhaar
* Bank details
* Education certificates
* Previous employment documents
* Employment agreement
* Policy acceptance
* IT account
* Email account
* ID card
* Asset assignment
* Department assignment
* Orientation
* Training

Each institution can have its own onboarding workflow.

---

# 9. Attendance

Support:

* Manual attendance
* Web check-in/check-out
* Mobile check-in/check-out
* Biometric integration
* RFID
* QR
* API integration

Support:

* Present
* Absent
* Half Day
* Late
* Early Leaving
* Work From Home
* On Duty
* Holiday
* Leave
* Comp Off

Support attendance regularization.

Attendance must feed payroll.

---

# 10. Shift Management

Support:

* General shift
* Morning shift
* Evening shift
* Night shift
* Custom shifts

Each shift should support:

* Start time
* End time
* Break duration
* Grace period
* Overtime rules
* Late rules
* Early departure rules

Support employee shift assignment and roster management.

---

# 11. Holiday Management

Create holiday calendars.

Support:

* National holidays
* State holidays
* Institution holidays
* Academic holidays
* Optional holidays
* Restricted holidays

Different institutions and employee groups must be able to have different holiday calendars.

---

# 12. Leave Management

Create configurable leave types:

* Casual Leave
* Sick Leave
* Earned Leave
* Privilege Leave
* Maternity Leave
* Paternity Leave
* Comp Off
* Study Leave
* Duty Leave
* Academic Leave
* Special Leave
* Loss of Pay

Configure:

* Annual entitlement
* Monthly accrual
* Carry forward
* Maximum carry forward
* Encashment
* Approval workflow
* Attachment requirement
* Half-day support

Support:

Employee
→ Manager
→ HOD
→ HR
→ Principal

with configurable workflows.

---

# 13. Payroll

Build a complete payroll engine.

Modules:

* Payroll Dashboard
* Pay Schedule
* Salary Structures
* Salary Components
* Employee Salary
* Attendance Inputs
* Leave Inputs
* LOP
* Overtime
* Variable Pay
* Bonus
* Reimbursements
* Loans
* Salary Advances
* Arrears
* Salary Revisions
* Payroll Runs
* Payroll Approval
* Payroll Lock
* Payslips
* Bank Payment
* Statutory Compliance
* Tax
* Form 16
* Full & Final Settlement
* Payroll Reports

---

# 14. Salary Components

Support configurable:

Earnings:

* Basic
* HRA
* DA
* Conveyance
* Special Allowance
* Academic Allowance
* Medical
* Telephone
* Transport
* Other Allowance
* Bonus
* Incentive
* Overtime
* Extra Lecture
* Exam Duty
* Research Incentive

Benefits:

* NPS
* VPF
* Other Benefits

Deductions:

* PF
* ESI
* Professional Tax
* TDS
* Loan EMI
* Salary Advance
* Insurance
* Other deductions

Each component must support:

* Fixed amount
* Percentage
* Formula
* Monthly
* Annual
* One-time
* Recurring
* Taxable/non-taxable
* Employer contribution
* Employee contribution
* Effective date

Never hard-code salary formulas in application code.

Create a configurable salary rule/formula engine.

---

# 15. Salary Structure

Support multiple salary structures by:

* Institution
* Department
* Designation
* Employee Grade
* Employee Type

Maintain complete salary history.

Never overwrite previous salary structures.

Example:

2024 → ₹6.5L
2025 → ₹7.2L
2026 → ₹8.0L
2027 → ₹9.2L

---

# 16. Salary Revision

Support:

* Annual increment
* Promotion
* Correction
* Market adjustment
* Role change
* Institution transfer

Fields:

* Old salary
* New salary
* Effective date
* Reason
* Approval
* Approved by
* Document

Calculate arrears automatically where applicable.

---

# 17. Payroll Run

Workflow:

OPEN
→ INPUT COLLECTION
→ CALCULATION
→ DRAFT
→ REVIEW
→ APPROVAL
→ LOCK
→ PAYMENT
→ PAYSLIPS
→ STATUTORY REPORTS
→ CLOSED

A locked payroll cannot be edited directly.

Corrections must use:

* Adjustment
* Arrear
* Off-cycle payroll
* Reversal/recalculation

Maintain immutable audit history.

---

# 18. Payroll Calculations

Payroll must consider:

* Working days
* Present days
* Paid leave
* Unpaid leave
* LOP
* Overtime
* Variable pay
* Bonus
* Reimbursements
* Loans
* Advances
* Salary revisions
* Arrears
* Statutory deductions
* Tax

Final:

Gross

* Employee deductions

- applicable additions
  = Net Pay

Also calculate employer cost.

---

# 19. India Payroll Compliance

Design a configurable statutory engine capable of supporting:

* EPF
* ESI
* Professional Tax
* Labour Welfare Fund
* TDS
* Form 16
* Form 24Q
* Statutory bonus
* Gratuity
* Other applicable statutory components

Do not hard-code statutory percentages permanently.

Use:

Statutory Rule
→ State
→ Financial Year
→ Effective Date
→ Version

Tax and statutory rules must be updateable.

All statutory calculations must be independently tested and validated before production.

---

# 20. Form 16

Support:

* Employee PAN
* Employer TAN
* Financial year
* TDS data
* Part A upload/import
* Part B generation
* Consolidation
* Digital signature workflow
* Publish
* Employee notification
* Employee download

Store Form 16 in employee documents.

Do not assume tax filing itself is performed by this application unless a separate authorized integration is implemented.

---

# 21. Employee Self-Service

Employee portal:

* Dashboard
* Profile
* Attendance
* Leave
* Holiday Calendar
* Salary Structure
* Payslips
* Annual Earnings
* Tax
* Investment Declaration
* Investment Proofs
* Form 16
* Reimbursements
* Loans
* Documents
* Assets
* Performance
* Requests
* Notifications

Employees must only see their own confidential information.

---

# 22. Employee Mobile App

Build iOS and Android support.

Use:

Ionic + Vue + Capacitor

Mobile modules:

* Login
* Dashboard
* Check-in
* Check-out
* Attendance
* Leave
* Holidays
* Payslips
* Salary
* Form 16
* Documents
* Assets
* Reimbursements
* Loans
* Notifications
* Approvals

Use secure token storage.

Do not expose API secrets in the mobile application.

---

# 23. Asset Management

Build a complete asset lifecycle system.

Categories:

* Laptop
* Desktop
* Mobile
* Tablet
* Monitor
* Printer
* Projector
* Camera
* Furniture
* Vehicle
* Lab Equipment
* Networking Equipment
* Other

Asset fields:

* Asset ID
* Asset Tag
* QR/Barcode
* Category
* Brand
* Model
* Serial Number
* Purchase Date
* Purchase Cost
* Vendor
* Warranty
* Location
* Condition
* Current Status

---

# 24. Asset Lifecycle

PURCHASED
→ IN STOCK
→ ASSIGNED
→ MAINTENANCE
→ REASSIGNED
→ RETURNED
→ DISPOSED

Support:

* Assignment
* Handover
* Return
* Transfer
* Maintenance
* Warranty
* Repair
* Depreciation
* Disposal
* Asset audit

---

# 25. Asset Assignment

Example:

Employee:
Rahul Sharma

Asset:
Dell Latitude 5440

Asset ID:
AST-LAP-000124

Assignment date:
01-Feb-2026

Condition:
Good

Accessories:

* Charger
* Bag
* Mouse

Generate asset handover PDF.

Employee must be able to digitally acknowledge receipt.

---

# 26. Asset Return

During resignation/exit:

Check:

* Laptop
* Charger
* Bag
* Phone
* ID Card
* Other equipment

Record:

* Returned
* Damaged
* Missing
* Recovery amount

Recovery amount must be available as an input to Full & Final Settlement.

---

# 27. Asset Maintenance

Track:

* Issue
* Maintenance ticket
* Vendor
* Repair cost
* Warranty
* Service date
* Next service
* Status

Maintain complete asset history.

---

# 28. Asset Depreciation

Support configurable depreciation:

* Straight line
* Useful life
* Residual value
* Depreciation rate

Show:

Purchase value
→ Depreciation
→ Current book value

---

# 29. Document Management

Use cloud object storage such as AWS S3.

Do not store large files directly in MySQL.

Database stores metadata.

Example:

document_id
tenant_id
group_id
institution_id
employee_id
document_type
file_name
mime_type
storage_key
file_size
version
uploaded_by
created_at

---

# 30. Storage Architecture

Use:

Frontend
→ Backend
→ Private Object Storage

Example:

AWS S3

Use private buckets.

Never expose permanent public URLs for sensitive documents.

Use short-lived signed URLs after authorization.

---

# 31. File Path Strategy

Use logical tenant paths:

tenant/{groupId}/institution/{institutionId}/employees/{employeeId}/documents/{documentId}

Never trust user-provided storage paths.

---

# 32. Document Permissions

Every document must support:

* Owner
* Role
* Department
* Institution
* Group

Example:

Salary document:

Employee → own document
HR → institution
Finance → institution/group
Principal → institution
Group Finance → group

Other employees → denied

---

# 33. Document Versioning

Support:

Version 1
Version 2
Version 3

Record:

* Uploaded by
* Uploaded date
* Reason
* Version
* Previous document
* Current document

Do not silently replace important HR documents.

---

# 34. Document Expiry

Support:

* Issue date
* Expiry date
* Reminder days

Examples:

* Passport
* Driving licence
* Contract
* Insurance
* Professional certification
* Vehicle documents

Automatically notify responsible users before expiry.

---

# 35. Employee Documents

Support:

Identity:

* PAN
* Aadhaar
* Passport
* Driving Licence

Education:

* Degree
* Marksheet
* Certificates

Employment:

* Offer Letter
* Appointment Letter
* Employment Agreement
* Salary Revision
* Promotion
* Transfer
* Warning
* Experience
* Relieving
* Full & Final

Payroll:

* Payslips
* Form 16
* Tax documents
* Investment proofs

---

# 36. PDF Engine

Create a central PDF generation service.

Templates:

* Offer Letter
* Appointment Letter
* Salary Revision Letter
* Promotion Letter
* Transfer Letter
* Payslip
* Form 16
* Experience Letter
* Relieving Letter
* Full & Final
* Asset Handover
* Asset Return
* Student Result
* Certificate
* Fee Receipt
* Invoice

All PDFs must automatically support:

* Group logo
* Institution logo
* Institution name
* Address
* Signature
* Authorized person
* Date
* Custom branding

---

# 37. E-Signature

Support document signing workflows.

Examples:

* Offer Letter
* Appointment Letter
* Salary Revision
* Policy Acceptance
* Asset Handover
* Exit Documents

Workflow:

Generate
→ Review
→ Send for signature
→ Employee sign
→ Authorized person sign
→ Final PDF
→ Store

---

# 38. Communication Hub

Create a common communication engine.

Channels:

* Email
* SMS
* WhatsApp
* Push
* In-app notification

Do not call external providers directly from education modules.

Use:

Education Module
→ Notification Engine
→ Communication Router
→ Provider

---

# 39. Communication Providers

Make providers pluggable.

Email:

* SMTP
* SendGrid
* Amazon SES
* Other providers

SMS:

* Configurable provider
* API key
* Sender ID
* Template configuration

WhatsApp:

* Meta/WhatsApp Business
* Other supported providers

Every provider must implement a common interface.

---

# 40. Message Templates

Support variables:

{{student.name}}
{{parent.name}}
{{employee.name}}
{{employee.designation}}
{{fee.amount}}
{{attendance.percentage}}
{{institution.name}}
{{institution.logo}}
{{date}}
{{exam.name}}

Templates must support versioning.

---

# 41. Communication Automation

Examples:

IF attendance < 75%
→ send parent notification

IF fee overdue
→ send reminder

IF payslip published
→ notify employee

IF Form 16 published
→ notify employee

IF document expires in 30 days
→ notify HR

IF employee joins
→ onboarding notification

IF employee exits
→ asset clearance notification

---

# 42. Communication Logs

Store:

* Tenant
* Institution
* Channel
* Recipient
* Template
* Provider
* Status
* Provider message ID
* Sent time
* Delivered time
* Failed time
* Error code

Never log API keys, access tokens, passwords or secrets.

---

# 43. AI Hub

Create:

AI Providers
AI Models
AI Assistants
AI Prompts
AI Tools
AI Knowledge Base
AI Conversations
AI Usage
AI Cost
AI Permissions

Support configurable providers such as:

* OpenAI
* Google
* Anthropic
* Azure OpenAI
* Other providers

---

# 44. Bring Your Own AI Key

Support:

Platform AI Key

and

Customer BYOK.

Configuration:

Provider
API Key
Model
Endpoint if applicable
Configuration

Secrets must be encrypted.

Never return raw API keys to frontend after saving.

---

# 45. AI Gateway

Do not call provider APIs from individual modules.

Use:

Application
→ AI Gateway
→ Provider Adapter
→ AI Provider

Implement:

OpenAIAdapter
GoogleAdapter
AnthropicAdapter
AzureAdapter

---

# 46. AI Assistants

Create:

* Student Assistant
* Parent Assistant
* Teacher Assistant
* HR Assistant
* Payroll Assistant
* Principal Assistant
* Group Management Assistant
* Finance Assistant
* Asset Assistant

Every assistant must have:

* Model
* Prompt
* Tools
* Knowledge sources
* Permissions
* Scope

---

# 47. AI Tool Security

AI must never directly receive unrestricted database access.

Use tools:

getStudent()
getAttendance()
getFeeStatus()
getResult()
getEmployee()
getPayrollSummary()
getAsset()
getDocument()
generateReport()
createMessageDraft()

Every tool must perform authorization again.

---

# 48. AI Actions

High-impact actions require confirmation.

Examples:

AI can prepare:

* WhatsApp campaign
* SMS campaign
* Email campaign
* Payroll report
* Asset recovery report

But should not automatically execute sensitive bulk actions.

Use:

AI
→ Draft
→ Preview
→ User Confirmation
→ Execute

---

# 49. AI Communication Example

User:

"Find all employees whose investment proof is pending and create a reminder."

AI:

1. Query authorized employee records.
2. Identify pending proofs.
3. Create message.
4. Show recipient count.
5. Show preview.
6. Ask for confirmation.
7. Send after confirmation.

---

# 50. AI Payroll Example

User:

"Show total payroll cost for all ABBS colleges this month."

AI should call authorized payroll reporting tools and return:

College A
College B
College C
College D
Total

Never expose another tenant's data.

---

# 51. Education Modules

The HR/payroll system must integrate with:

* Students
* Admissions
* Academics
* Attendance
* Examination
* Results
* Fees
* Transport
* Hostel
* Library

Faculty workload can also feed payroll.

Examples:

* Extra lecture
* Exam duty
* Invigilation
* Research incentive

---

# 52. Group Management

Group administrators must be able to view:

* All institutions
* Employees
* Students
* Payroll
* Attendance
* Leave
* Assets
* Finance
* Communication
* Reports

But institutions must remain isolated.

---

# 53. Group Payroll

Provide consolidated reports:

Institution
Employees
Gross Salary
Employer Cost
PF
ESI
TDS
PT
Net Pay

Example:

ABBS College A → ₹28L
ABBS College B → ₹21L
ABBS College C → ₹14L
ABBS College D → ₹9L

Total → ₹72L

---

# 54. Reporting

Every major module should support:

* Dashboard
* Filters
* Date range
* Group
* Institution
* Campus
* Department
* Employee
* Designation
* Status

Exports:

* PDF
* Excel
* CSV
* Print

---

# 55. Audit System

Audit all critical operations:

* Salary changes
* Payroll creation
* Payroll approval
* Payroll locking
* Payroll reopening
* Employee creation
* Employee termination
* Asset assignment
* Asset return
* Document upload
* Document deletion
* Form 16 publishing
* Communication sending
* AI actions
* Permission changes
* Integration changes

Store:

* User
* Timestamp
* IP
* Action
* Entity
* Old value
* New value
* Reason

Never store secrets in audit logs.

---

# 56. Notifications

Central notification service.

Events:

employee.created
employee.joined
employee.exit
leave.submitted
leave.approved
leave.rejected
payroll.approved
payslip.published
form16.published
asset.assigned
asset.returned
document.expiring
message.failed

Channels:

Email
SMS
WhatsApp
Push
In-app

---

# 57. Database Architecture

Use MySQL.

Organize modules logically.

Core:

organizations
groups
institutions
campuses
departments
users
roles
permissions
user_roles
user_scopes

HR:

employees
employee_profiles
employee_departments
employee_positions
employee_salary_history
employee_movements
employee_documents

Attendance:

attendance
shifts
shift_assignments
holidays
leave_types
leave_policies
leave_balances
leave_requests

Payroll:

salary_structures
salary_components
salary_rules
employee_salary
payroll_runs
payroll_items
payroll_adjustments
payroll_approvals
payroll_payments
payslips
tax_records
statutory_records
form16_records
loans
loan_installments
reimbursements
reimbursement_claims

Assets:

assets
asset_categories
asset_assignments
asset_returns
asset_maintenance
asset_depreciation
asset_disposals
asset_audits

Documents:

documents
document_versions
document_permissions
document_expiry
document_signatures

Communication:

communication_providers
provider_credentials
message_templates
message_template_versions
campaigns
campaign_recipients
message_logs
delivery_events
notification_rules
notification_jobs

AI:

ai_providers
ai_credentials
ai_models
ai_assistants
ai_prompts
ai_tools
ai_knowledge_bases
ai_documents
ai_conversations
ai_messages
ai_usage
ai_costs

Integrations:

integration_credentials
webhooks
webhook_events
api_clients
api_scopes
api_usage

Audit:

audit_logs

---

# 58. File Storage

Use object storage.

Recommended initial architecture:

AWS S3

Use:

* Private bucket
* Encryption
* Versioning
* Lifecycle policies
* Backup
* Signed URLs
* File metadata
* Tenant isolation

Do not store files as database BLOBs unless there is a specific reason.

---

# 59. Backend Architecture

Start as a modular monolith.

Backend:

Node.js
TypeScript
Express or equivalent framework
MySQL
Redis
Queue system
Object storage

Modules:

auth
organizations
institutions
students
academics
employees
attendance
leave
holidays
shifts
recruitment
onboarding
performance
payroll
assets
documents
communication
finance
transport
library
hostel
reports
ai
integrations
audit

Do not start with microservices.

Design module boundaries so services can be extracted later if required.

---

# 60. Frontend

Web:

Vue 3
TypeScript
Pinia
Vue Router
Vuetify or equivalent UI framework

Layouts:

PlatformLayout
GroupLayout
InstitutionLayout
EmployeeLayout
StudentLayout
ParentLayout
TeacherLayout

Sidebar/menu must be permission-driven.

---

# 61. Mobile

Use Ionic + Vue + Capacitor for iOS and Android.

Mobile must consume the same backend APIs.

Do not duplicate business logic in mobile.

Backend remains the source of truth.

---

# 62. Security Requirements

Implement:

* Tenant isolation
* RBAC
* Scope authorization
* MFA
* Secure sessions
* Password policies
* Rate limiting
* API validation
* SQL injection protection
* XSS protection
* Secure file access
* Encrypted secrets
* Audit logging
* Backup
* Disaster recovery
* Login history
* Device/session management

Sensitive fields must have additional protection.

---

# 63. SaaS Subscription

Support:

* Plans
* Trials
* Billing
* Invoices
* Payment status
* Module licensing
* Student limits
* Employee limits
* AI limits
* Communication limits
* Storage limits

Example:

Starter
→ 1 institution

Professional
→ multiple institutions

Enterprise
→ education group

---

# 64. Module Licensing

Each group/institution may have:

education.enabled
hr.enabled
payroll.enabled
assets.enabled
transport.enabled
hostel.enabled
library.enabled
ai.enabled
whatsapp.enabled
sms.enabled

The backend must enforce feature access.

---

# 65. Acceptance Criteria

Before considering the platform production-ready:

1. ABBS Group can create four colleges.
2. ABBS Group Admin can see all four colleges.
3. BCC Admin cannot see ABBS data.
4. JP College can operate independently.
5. Each institution can have separate branding.
6. Each institution can have separate holiday calendars.
7. Each institution can have separate salary policies.
8. Employees can be transferred between group institutions.
9. Payroll history remains intact after transfer.
10. Salary revisions preserve history.
11. Attendance feeds payroll.
12. Leave feeds payroll.
13. LOP feeds payroll.
14. Payroll can be approved and locked.
15. Locked payroll cannot be silently edited.
16. Payslips are generated automatically.
17. Employees can download payslips.
18. Form 16 can be stored/published securely.
19. Employees can access their documents.
20. HR can access authorized employee documents.
21. Assets can be assigned to employees.
22. Assets can be returned during exit.
23. Asset recovery can flow into Full & Final.
24. Offer letters can be generated.
25. Experience letters can be generated.
26. Relieving letters can be generated.
27. Documents are stored in private cloud storage.
28. Signed URLs are used for downloads.
29. Communication providers are configurable.
30. AI providers are configurable.
31. API keys are encrypted.
32. AI respects tenant permissions.
33. AI actions require confirmation where appropriate.
34. All sensitive operations are audited.
35. Web, iOS and Android use the same backend.
36. Reports can be exported as PDF/Excel/CSV.
37. Institution logos appear on generated PDFs.
38. Group-level consolidated reports work.
39. Communication usage is tracked.
40. AI usage/cost is tracked.

---

# 66. Development Principle

Do not build this as a collection of independent CRUD screens.

Build reusable platform engines:

1. Multi-Tenant Engine
2. Authorization Engine
3. Workflow Engine
4. Notification Engine
5. Communication Engine
6. Document Engine
7. PDF Engine
8. Payroll Rule Engine
9. Integration Engine
10. AI Gateway
11. Reporting Engine
12. Audit Engine
13. File Storage Engine
14. Subscription/Feature Engine

Then Education, HR, Payroll, Assets and other modules use those engines.

This architecture will allow the same SaaS to support:

School
→ College
→ Multi-college Group
→ University
→ Education Society

without creating separate applications.

---

# 67. First Implementation Priority

Before implementing students, exams or transport, implement these foundations:

1. Multi-tenancy
2. Group/institution hierarchy
3. Authentication
4. RBAC + scopes
5. User management
6. Module licensing
7. Branding
8. Cloud file storage
9. Document permissions
10. Audit logs
11. Workflow engine
12. Notification engine
13. Integration framework
14. Secret management
15. HR employee master
16. Attendance/leave/holiday/shift foundation
17. Payroll rule engine

Only after these foundations are stable should the education modules and advanced payroll features be implemented.
