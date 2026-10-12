# User guide

A practical guide for the people who use the product every day: platform staff, school and
company owners, administrators, HR and payroll teams, accountants, teachers, employees, students
and parents. It explains what each screen is for and how to complete common tasks.

> Menu names, button labels and field names in this guide match what you see in the app. If a
> menu item described here is missing on your screen, read
> [Why is a menu item missing?](#why-is-a-menu-item-missing) first.

## Contents

1. [Introduction](#1-introduction)
2. [Getting started](#2-getting-started)
3. [Licensing and plans](#3-licensing-and-plans)
4. [Roles and permissions](#4-roles-and-permissions)
5. [Platform administration](#5-platform-administration-super-admin)
6. [Organization setup](#6-organization-setup-owner--admin)
7. [Module how-tos](#7-module-how-tos)
   - [Students and admissions](#71-students-and-admissions)
   - [Academics: classes, subjects, timetable, attendance, exams](#72-academics)
   - [HR: employees, attendance, shifts, holidays, leave](#73-hr)
   - [Payroll](#74-payroll)
   - [Fees and finance](#75-fees-and-finance)
   - [Library](#76-library)
   - [Transport](#77-transport)
   - [Hostel](#78-hostel)
   - [Assets](#79-assets)
   - [Documents](#710-documents)
   - [Communication](#711-communication)
   - [AI assistant and AI tools](#712-ai-assistant-and-ai-tools)
   - [Approvals](#713-approvals)
   - [Notifications](#714-notifications)
8. [Self-service](#8-self-service)
9. [Demo walkthrough](#9-demo-walkthrough)
10. [FAQ and troubleshooting](#10-faq-and-troubleshooting)

---

## 1. Introduction

The product is a cloud application (SaaS) that runs a school, a group of schools or colleges, or a
company. In one place it covers:

- **Education ERP** – admissions, students, classes and sections, subjects, timetable, student
  attendance, exams, results and report cards, fees.
- **HRMS** – employees, departments, designations, attendance (including selfie/face punch),
  shifts, holidays and leave.
- **Payroll** – salary components and structures, employee salaries, monthly payroll runs with
  approval, payslips, Form 16 and statutory reports.
- **Other modules** – finance (accounts, vouchers, expenses), library, transport, hostel, assets,
  documents, communication (email/SMS/WhatsApp) and AI tools.

### Key concepts

| Concept                          | What it means                                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization** (tenant)        | Your customer account, e.g. "Greenwood International School" or "Acme Technologies". All data belongs to exactly one organization and is never visible to another. At sign-in the organization is identified by its **slug**. |
| **Group**                        | A set of institutions run together, e.g. "Greenwood Education Trust" or "Brightway Education Group". Group-level users see all institutions in the group.                                                                     |
| **Institution** (company/branch) | One school, college or company unit with its own staff, students, payroll and settings. For company organizations this is called **Company / branch**.                                                                        |
| **Branch** (campus)              | A physical location of an institution, e.g. "Noida Branch". Managed under **Institution → Branches**.                                                                                                                         |
| **Department**                   | A unit inside an institution (Academics, Accounts, IT…). Some roles (HOD, Teacher) can be limited to their department.                                                                                                        |
| **Scope**                        | Where a role applies: the whole organization, a group, one or more institutions, or departments. A role never gives access outside its scope.                                                                                 |

### Education vs company organizations

When the platform team creates an organization they choose its **Organization type**:

- **Education (school / college / group)** – the full education menus (Students, Admissions,
  Classes & sections, Exams, Fees…) are shown, wording uses "Institution" and "Group".
- **Company (HRMS & payroll)** – education menus are hidden. Wording changes: the **Group**
  workspace is called **Head office**, **Institution** is called **Company**, and the Institutions
  page is called **Companies / branches**.

### Workspaces

After signing in you see a **home page** with one tile per workspace you are allowed to use. Each
workspace has its own left-hand menu.

| Workspace                               | Who uses it                            | What is inside                                                                                  |
| --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Platform**                            | Platform (SaaS provider) staff only    | Organizations, Plans, Invoices, Billing settings                                                |
| **Group** / **Head office**             | Owners, group admins, group HR/finance | Group dashboard, institutions, users, modules, branding, subscription, cross-institution views  |
| **Institution** / **Company**           | Principals, institution admins, staff  | Day-to-day school/company work: students, academics, fees, finance, library, transport, hostel… |
| **HR**                                  | HR, payroll and finance teams          | Employees, departments, attendance, leave, shifts, holidays, payroll                            |
| **Employee**                            | Every staff member with a login        | My profile, My attendance, My leave, My salary, My payslips, My assets, My library              |
| **Student / Parent**, **Parent portal** | Students and parents                   | Profile/children, timetable, attendance, results, fees, library, transport, hostel              |
| **Assets**                              | Asset managers, admins, HR             | Asset register, categories, assignments, maintenance, inventory, audit, disposal, reports       |

---

## 2. Getting started

### Signing in

1. Open the web app (for the demo: <http://localhost:5180>).
2. On **Sign in**, enter your **Email** and **Password** and click **Continue**.
3. If your email belongs to more than one organization, an **Organization** list appears – pick
   one and click **Continue** again.
4. If two-factor authentication is turned on for your account, enter the 6-digit
   **Authentication code** from your authenticator app and click **Verify**. Lost your phone? Use
   the option to enter a **Recovery code** instead.
5. You land on the home page. Click a workspace tile to start.

Notes:

- After several wrong passwords the account is temporarily locked ("Too many failed attempts. Try
  again later."). Wait and try again, or ask your administrator.
- Platform administrators (e.g. `superadmin@erp.local`) sign in without an organization and only
  see the **Platform** workspace.

### Switching workspace and signing out

- The top bar shows the workspace name and your organization's display name.
- Click the **⇄ Switch workspace** icon (top right) to go back to the home page and pick another
  workspace.
- Click the **Sign out** icon (top right) or the **Sign out** button on the home page to log out.
- The **bell** icon shows your notifications (see [Notifications](#714-notifications)).

### Your profile

- **Staff:** **Employee → My profile** shows your employment details. Personal fields can be
  changed with **Request changes** (HR approves them). Upload a clear profile photo – it is needed
  for selfie attendance.
- **Students:** **Student / Parent → My profile**. **Parents:** **Parent portal → My children**.

### Passwords and two-factor authentication

- **Password rules** (enforced for every new or changed password): at least **12 characters**,
  containing **3 of** lowercase, uppercase, digit and symbol, and **not containing the part of
  your email before the @**.
- The demo password `password123` is **for the demo data only** – it would not be accepted for a
  real account.
- **Change password** and **two-factor (authenticator app) set-up** are supported by the system
  but do not yet have a screen in the web app. Ask your administrator or platform support if you
  need either.
- **Forgot password:** there is no "Forgot password" link on the sign-in page. Ask your
  administrator; they can re-issue your access (see
  [Forgot password](#forgot-my-password)).

---

## 3. Licensing and plans

Every organization has one **subscription** to a **plan**. The plan decides which **modules** are
available and how much you can use (limits).

### Standard plans

| Plan             | Modules included                                                                              | Main limits                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Starter**      | Education, Documents, Communication, Email                                                    | 1 institution, 1,000 students, 100 employees, no AI          |
| **Professional** | Starter + HR, Payroll, Assets, Library, Transport, Hostel, Finance (fees & accounts), SMS, AI | 10 institutions, 20,000 students, 2,000 employees, AI tokens |
| **Enterprise**   | Every module, including WhatsApp                                                              | Unlimited                                                    |

The platform team can edit these plans or create custom ones (see
[Plans](#plans-and-licences)).

### Add-ons

Extra modules can be added on top of a plan without changing plan, e.g. Acme Technologies is on
**Starter** with **HR** and **Payroll** add-ons. Some modules need another module: **Payroll needs
HR**, and **Email/SMS/WhatsApp need Communication**.

### Turning modules on or off (Modules page)

Owners and group admins can switch licensed modules off – for the whole organization or for one
institution – under **Group → Modules**:

1. Choose the **Level** (the organization, or one institution).
2. Each row shows the module, whether it is **Licensed**, whether it is **Enabled**, and the
   **Source** of the setting (plan, organization or institution override).
3. Flip the **Enabled** switch. A module that is not licensed (lock icon) cannot be switched on.
4. Click **Inherit** to remove an override and fall back to the level above.

Example: Brightway switches **Hostel** off only at Brightway South School, and **AI** off for the
whole organization.

### Subscription status – what users see

Open **Group → Subscription** to see your plan, status, licensed modules, **Usage & limits** and
**Invoices**.

| Status        | What it means                               | What users see                                                                                                 |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **TRIAL**     | Free trial of the plan                      | All plan modules work. Subscription page shows "Trial ends …". When the trial expires, modules stop working.   |
| **ACTIVE**    | Paid and current                            | All plan modules and add-ons work.                                                                             |
| **PAST_DUE**  | A platform invoice is unpaid (grace period) | Modules **keep working**; an open invoice is shown under **Subscription → Invoices** with **Pay via UPI**.     |
| **CANCELLED** | Subscription ended                          | **No module works**: module menus disappear and module screens/APIs return "not enabled". Sign-in still works. |

The platform team can also **Suspend** or **Archive** an entire organization; then nobody in it
can work until it is re-activated.

### Paying a platform invoice (UPI)

1. **Group → Subscription → Invoices**, click **Pay via UPI** on the open invoice.
2. Scan the QR code with any UPI app (GPay, PhonePe, Paytm, BHIM) or click **Open UPI app**.
3. After paying, enter the 12-digit **UPI transaction ID (UTR)** and an optional **Note**, then
   click **I have paid — submit**.
4. The platform team verifies the payment and marks the invoice paid. Use **Download invoice** for
   the PDF.

### Why is a menu item missing?

A menu item is shown only when **all** of these are true:

1. Your organization's plan or add-ons **license** the module.
2. The module is **enabled** for your organization and institution (Modules page).
3. The subscription is **TRIAL** (not expired), **ACTIVE** or **PAST_DUE**.
4. One of your **roles** has the permission for that screen.
5. For education screens: your organization is an **Education** organization (or licenses the
   education module).

---

## 4. Roles and permissions

Access is given by **roles**. Each role is a fixed bundle of permissions and is assigned **with a
scope** (organization, group, institution or department). A person can hold several roles – e.g.
"Teacher" plus "Employee".

### Built-in roles

| Role                                             | Typical scope | What it can do                                                                                                                                       | Main workspaces / menus                                               |
| ------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Platform Super Admin**                         | Platform      | Manage organizations, plans, subscriptions, invoices and billing settings                                                                            | Platform                                                              |
| **Platform Support Admin**                       | Platform      | View organizations (read-only support)                                                                                                               | Platform → Organizations                                              |
| **Group Owner**                                  | Organization  | Everything inside the organization                                                                                                                   | All workspaces and menus                                              |
| **Group Admin**                                  | Group         | Run all institutions in the group: create institutions, users, modules, branding, communication, integrations, secrets, AI settings, academics, fees | Group, Institution, HR (not payroll processing), Assets               |
| **Group HR**                                     | Group         | Employees, designations, attendance, leave, shifts, holidays, salaries (view/update), payroll reports, documents                                     | Group, Institution, HR, Assets                                        |
| **Group Finance**                                | Group         | Approve, lock, disburse and **reopen** payroll; fees and finance; subscription and platform billing                                                  | Group (incl. Subscription, Payroll summary, fees/finance), HR payroll |
| **Institution Owner**                            | Institution   | Everything an Institution Admin can do, plus designations, **approve and lock payroll**, unlock attendance                                           | Institution, HR, Group (read)                                         |
| **Institution Admin**                            | Institution   | Users, students, admissions, employees, academics, fees & finance, library, transport, hostel, documents, branding, time office; views payroll       | Institution, HR, Assets                                               |
| **Principal**                                    | Institution   | Academic lead + update employees, audit view, library view, fees/finance view                                                                        | Institution, Group, HR (view)                                         |
| **Vice Principal / Dean / Academic Coordinator** | Institution   | Students, admissions, classes, subjects, timetable, student attendance, exams; view staff attendance & leave                                         | Institution, Group, HR (view)                                         |
| **Registrar**                                    | Institution   | Same as academic lead, plus delete documents (student records)                                                                                       | Institution, Group                                                    |
| **HOD**                                          | Department    | Academic lead, limited to assigned departments                                                                                                       | Institution, Group                                                    |
| **Teacher / Faculty**                            | Department    | View students; mark student attendance and enter marks **for allocated sections only**; timetable; upload documents                                  | Institution (incl. **My classes**, **Marks entry**)                   |
| **HR Manager**                                   | Institution   | Same as Group HR, for one institution                                                                                                                | HR, Institution, Assets                                               |
| **Payroll Manager**                              | Institution   | Salary components, structures, employee salary, payroll runs (prepare/compute/submit), Form 16, bank file – **cannot approve its own runs**          | HR (payroll menus)                                                    |
| **Finance Manager**                              | Institution   | **Approve and lock payroll**, disburse, fees & finance, platform billing                                                                             | HR (payroll), Institution (fees & finance), Group → Subscription      |
| **Accountant**                                   | Institution   | Fees (manage, collect), finance (accounts, vouchers, post), payroll reports                                                                          | Institution (fees & finance)                                          |
| **IT Admin**                                     | Institution   | Users and roles, secrets, integrations (API & webhooks), communication providers, AI settings                                                        | Group (Users, Secrets, API & webhooks, Communication, AI)             |
| **Asset Manager**                                | Institution   | Full asset management incl. audit and disposal                                                                                                       | Assets                                                                |
| **Transport Manager**                            | Institution   | Vehicles, drivers, routes, allocations, trips                                                                                                        | Institution → Transport                                               |
| **Librarian**                                    | Institution   | Full library: catalogue, copies, issue/return desk, fines, settings                                                                                  | Institution → Library menus                                           |
| **Hostel Manager**                               | Institution   | Full hostel management                                                                                                                               | Institution → Hostel                                                  |
| **Hostel Warden**                                | Institution   | Room allocation, out-pass approval, visitors, roll call                                                                                              | Institution → Hostel                                                  |
| **Employee**                                     | Institution   | Self-service: own profile, punch attendance, apply leave, see salary/payslips, own assets and documents                                              | Employee                                                              |
| **Student**                                      | Institution   | Own profile, timetable, attendance, results, fees, library, transport, hostel                                                                        | Student / Parent                                                      |
| **Parent**                                       | Institution   | Same as Student but for their children (wards)                                                                                                       | Parent portal                                                         |

Every user also sees **Approvals** and **Notifications** for items addressed to them.

### Adding a user and assigning roles

Who: Group Owner, Group Admin, Institution Owner/Admin, IT Admin.

1. Go to **Group → Users** (or **Institution → Users**).
2. Click **Add user**. Enter **Full name** and **Email (login)**.
3. **Initial password (optional)** – type a password that follows the
   [password rules](#passwords-and-two-factor-authentication), or leave it empty to send an
   invite email instead.
4. Under **Roles**, click **Add role**, then choose:
   - **Role** – e.g. HR Manager.
   - **Applies to** – Organization ("Everything"), Group, Institution or Department.
   - The specific group(s)/institution(s)/department(s).
5. Add more rows if the person needs several roles, then click **Save**.

To change roles later, click **Roles** on the user's row, edit the rows, **Save**. Use
**Deactivate** / **Reactivate** to block or restore a user (you cannot deactivate yourself).
Deactivating signs the user out everywhere.

> Staff logins are easiest to create from the employee record: **HR → Employees → (employee) →
> Login access → Create login**. This creates the user with the **Employee** role linked to that
> employee, so they can punch attendance, apply for leave and see payslips.

---

## 5. Platform administration (super admin)

Sign in as a platform administrator; you will only see the **Platform** workspace.

### Creating an organization

1. **Platform → Organizations → New organization**.
2. Fill in:
   - **Organization name**
   - **Slug (login identifier)** – used at sign-in; **cannot be changed later**.
   - **Organization type** – Education (school / college / group) or Company (HRMS & payroll).
   - **Plan** and **Subscription** (trial or active).
   - **Owner name**, **Owner e-mail**, **Owner role** – Group owner (full tenant access) or
     Institution owner.
3. Click **Create**. The owner receives an invitation (or is created with the details you set).
4. The owner then signs in and completes [organization setup](#6-organization-setup-owner--admin).

Open an organization from the list to see the **Overview**. From there you can:

- **Edit organization** (name, type), **Invite owner** / **Send invite** for additional owners.
- **Suspend**, **Activate** or **Archive** the organization (a **Reason** is required and audited).
- **Configure subscription** – change **Plan**, **Status** (TRIAL, ACTIVE, PAST_DUE, CANCELLED),
  **Add-on modules (on top of the plan)** and per-organization **limits**. A **Reason** is
  required.
- **New invoice** – raise a platform invoice for this organization.

### Plans and licences

**Platform → Plans → New plan** (or click a plan to edit). Fields: **Key** (e.g.
`custom_logicmines`), **Name**, **Description**, **Price**, **Currency**, **Billing**, **Trial
days**, **Status**, **Modules** (tick the modules included) and limits (tick **Unlimited** or enter
a number). Click **Save**. Changes apply to every organization on that plan.

### Billing and invoices

- **Platform → Billing settings** – your **Seller name**, **GSTIN**, **Address**, **Contact
  email/phone**, **Default GST %**, **Terms printed on invoices**, and **UPI payments** (**UPI ID
  (VPA)** and **Payee name**). Organizations scan a QR for this UPI ID and submit the UTR.
- **New invoice** (from an organization's page): add lines (**Description**, **Qty**, **Unit
  price**), **GST %**, **Period start/end**, **Due date**, **Notes (shown on invoice)**, **Reason
  (audit)**. Choose **Issue now (visible to organization)** or **Save as draft**, then **Create
  invoice**.
- **Platform → Invoices** – filter by **Status** (DRAFT, OPEN, PAYMENT_SUBMITTED, PAID, OVERDUE,
  VOID). Actions: **Issue**, **Download PDF**, **Void**, **Reject** (a submitted UTR that cannot be
  verified) or **Mark paid** / **Verify & mark paid** (enter **Payment method**, **Payment
  reference / UTR**, **Paid on**).

### Support access

Platform support staff can open an organization in read-only mode for troubleshooting. Each support
session is short-lived and recorded in the audit log. Support access is currently started by the
platform team through the API, not from a screen.

---

## 6. Organization setup (owner / admin)

Recommended order for a new organization:

1. Branding → 2. Institutions → 3. Branches → 4. Departments → 5. Employee types and designations
   → 6. Classes & sections (education) → 7. Users and roles → 8. Modules.

### 6.1 Branding (logo and colours)

**Group → Branding** (or **Institution → Branding** for one institution).

1. Choose the **Level** – organization, a group, or an institution. Empty fields inherit from the
   level above.
2. Under **Profile (empty fields inherit)** set **Display name**, **Short name**, **Primary /
   Secondary / Accent color**, **Letterhead text**, **Footer text**, **Address**, **Contact
   email/phone**, **Website**.
3. Under **Logo**, **Upload logo (PNG or JPEG, max 2 MB)** and click **Upload** (or **Remove**).
4. Check the **Resolved preview**, then **Save**.

The logo, colours, letterhead and footer are printed on generated PDFs – payslips, fee receipts,
report cards, letters, invoices and asset labels. Upload the institution's own logo if each school
should have its own letterhead.

### 6.2 Institutions (companies)

**Group → Institutions** (company orgs: **Head office → Companies / branches**).

1. Click **New institution** (or **New company / branch**).
2. Enter **Name \***, **Code \*** (used as the employee code prefix, e.g. GWIS-MAIN), **Type**,
   **Email**, **Phone**, **Address**, **Status**.
3. **Save**. The number of institutions is limited by your plan.

### 6.3 Branches

**Institution → Branches → New branch**: **Name \*** (e.g. Noida Branch), **Code \*** (e.g.
NOIDA), **Address**, **Status**, and tick **Main branch** for the head campus. **Save**.

### 6.4 Academic year

There is no separate "academic year" setup screen. The academic year (e.g. `2026-27`) is entered
where it matters: when creating classes & sections, admission applications, fee structures,
concessions and exam terms. Use the same format everywhere.

### 6.5 Classes and sections (education)

**Institution → Classes & sections** (also under Group).

**Quick setup – many classes at once:**

1. Click **Add classes & sections**.
2. Pick the **Institution**, **Department / wing** (it will be created if new), and **Academic
   year**.
3. **Classes (one per line)** – e.g. `Class 1`, `Class 2` … or `B.Com`, `BBA`.
4. **Sections in every class** – comma separated, e.g. `A, B`.
5. **Seats per section** (optional), then **Create**.

Result: Class 1 – Section A and B, Class 2 – Section A and B, and so on. Use **Add section** on a
class to add another section later (e.g. "Class 1 C"), or **Edit class** to change **Name**,
**Code**, **Level** or **Duration (months, optional)**.

### 6.6 Departments, employee types and designations

- **Departments** (**HR → Departments** or **Institution → Departments**): **New department**
  with **Name \*** (e.g. Information Technology), **Code \*** (e.g. IT), **Description**. Inside a
  department use **Add role** to list job roles such as "Frontend Developer" (FE-DEV).
- **Employee types** (**HR → Employee types → New employee type**): **Name \*** (e.g.
  Permanent), **Code \*** (e.g. PERM), **Category \*** (used by statutory rules and attendance
  policies), **Description**, **Status**.
- **Designations** (**HR → Designations → New designation**): **Name \***, **Code \***,
  **Category**, **Level**, **Department** (empty = all), **Institution** (empty =
  organization-wide).
- **Employee code numbering** (on the Designations page, **Configure**): **Prefix**, **Digits**,
  **Next number** per institution. New employees get codes automatically if you leave the code
  blank.

---

## 7. Module how-tos

In each section: **Who** = roles that normally do this work. Most list pages offer a **Search**
box and an **Institution** filter – if you can't find a record, check the institution filter
first.

### 7.1 Students and admissions

**Who:** Institution Admin, Principal, Vice Principal, Registrar, Academic Coordinator, HOD
(teachers can view students).

**Admit a new student (application flow):**

1. **Institution → Admissions → New application**.
2. Enter **Applicant first/last name**, **Program** / **Desired class**, **Academic year**,
   **Guardian name**, **Guardian relation**, **Guardian phone**. **Create**.
3. Move the application through **Review** → **Approve** (or **Reject**).
4. Click **Enroll** to create the student record.

**Previous school records:** on **Admissions**, click **Previous school** on an application →
**Add previous school** – **School name**, **Board**, **City / location**, **Last class**, **Year**,
**Marks %**, **Grade**, **Old TC no.**, **TC date**, optionally **Upload previous school TC (PDF /
image)**, **Remarks**. **Save**. Records added on the application move to the student on
**Enroll**. You can also add, edit or delete them later on the student's **Previous schools** tab.

**Add a student directly:** **Institution → Students → New student** – **First name**, **Last
name**, **Class section**, **Roll no**, **Academic year**, **Email**, **Phone**. **Create**.

**Student record** (click a student):

- **Profile** – details and status. Buttons **Graduate** and **Withdraw** end the enrolment.
- **Guardians** – **Add guardian** with **Name**, **Relation**, **Phone**, **Email**, **Primary
  guardian**, **Can pick up**.
- **Enrollment history** – classes over the years.
- **Previous schools** – earlier schools (board, last class, year, marks, old TC no.) with the
  uploaded old TC (click the file name to download it).
- **Certificates** – transfer certificates (TC) and character certificates (see below).
- **Login access** – shows the linked student login. Create the login first under **Users** with
  the **Student** role (parents: **Parent** role); linking the login to the student record is
  currently done by your administrator/support.

**Transfer certificate (TC) and character certificate:** open the student → **Certificates**.

1. **Issue TC** – **Issue date**, **Date of leaving**, **Reason for leaving**, **Conduct**, **Class
   last studied**, **Qualified for promotion**, **Remarks** → **Issue**. Issuing a TC withdraws the
   student and closes the current enrolment. A student can have only one valid TC.
2. **Fee dues check:** if fees due on or before the leaving date are unpaid, the dialog warns and
   the TC is refused ("Fee dues of … are pending"). Collect the fees first, or – Principal /
   Institution Admin only – tick **Waive pending fee dues for this TC** and enter a **Waiver
   reason**. The waived amount is printed on the certificate and recorded in the audit log.
3. **Issue character certificate** – **Conduct** and **Remarks** (no dues check; any number can be
   issued).
4. Every certificate gets a number from the institution's series (e.g. `GWIS-MAIN/TC/2026/0001`,
   `GWIS-MAIN/CC/2026/0001`). **PDF** downloads the branded certificate (logo, institution name).
5. **Cancel** (with a reason) marks a certificate CANCELLED – it stays on record but students and
   parents can no longer download it. Cancelling a TC does not re-activate the student.
6. **Reissue** (with a reason) cancels the certificate and issues a new number with corrected
   details; the new row shows **Replaces …**.

Permissions: `certificate.view`, `certificate.issue`, `certificate.cancel` (principal, vice
principal, dean, registrar, HOD, academic coordinator, institution/group admins),
`certificate.waive_dues` (principal and institution/group admins), `certificate.view_own`
(students and parents).

### 7.2 Academics

**Who:** Academic Coordinator, Principal, Vice Principal, Dean, HOD set up; Teachers mark
attendance and enter marks.

**Subjects:** **Institution → Subjects → New subject** – **Name**, **Code**, **Program**,
**Type**, **Credits**, **Max marks**, **Pass marks**, **Status**.

**Allocation (who teaches what):** **Institution → Allocation** – pick a **Class section**, set
the **Class teacher**, then **Allocate** a **Subject** to a **Teacher**. Teachers can only mark
attendance and enter marks for sections allocated to them.

**Timetable:** **Institution → Timetable**.

1. Set up periods under **Bell schedule**.
2. Choose a **Class section** and **Add period**: **Subject**, **Teacher**, **Room**.
3. Check **Clashes** (teacher or room double-booked). You can **Save anyway** if intended.
4. For an absent teacher use **Substitution**: **Date**, **Period**, **Substitute teacher**,
   **Reason**. See all under **Substitutions**. Teachers see theirs under **My timetable**.

**Student attendance:** **Institution → Student attendance** (teachers: **My classes →
Attendance**).

1. Pick **Class section**, **Date** and optionally **Period (blank = daily)**.
2. Use **All present** / **All absent**, then adjust individual students.
3. Tick **Notify guardians of absentees** if you want parents informed, then **Save attendance**.
4. **Monthly register** shows the month view.

**Exams and results:**

1. **Institution → Exams**. Under **Grading scale** define grades (mark one as **Default for the
   institution**).
2. Under **Exam term**, **Create** a term: **Name**, **Type**, **Academic year**, **Start date**,
   **End date**, **Grading scale**.
3. Set the **Class section schedule** for each paper and **Save schedule**.
4. Teachers: **Institution → Marks entry** (or **My classes → Marks**) – choose the **Exam term**
   and **Paper (section · subject)**, enter marks, **Save marks**, then **Lock** when final
   (**Unlock** if a correction is needed and allowed).
5. Back in **Exams**: **Compute results**, review under **Results**, then **Publish** so students
   and parents can see them.
6. **Institution → Report cards** – choose **Exam term** and **Class section**; **All PDFs**
   downloads every report card (with your logo).

### 7.3 HR

**Who:** HR Manager / Group HR (full), Institution Admin and Owner, Principal (view and update).
Requires the **HR** module.

**Add an employee:** **HR → Employees → New employee**.

- **First name \***, **Middle name**, **Last name**, **Employee code** (leave empty to generate
  from the numbering sequence), **Employee type**, **Employment category**, **Department**,
  **Designation**, **Campus**, **Reporting manager**, **Date of joining**, **Probation ends**,
  **Notice period (days)**, **Work email**, **Work phone**, **Initial status**. **Save**.
- Bulk: **Import CSV** (use **Download template**, tick **Dry run (validate only)** first).
  **Export CSV** downloads the list.

**Employee record** (click an employee) – tabs and actions include:

- **Edit personal & statutory details** – PAN, Aadhaar, UAN, PF and ESIC numbers, bank details
  (protected; click **Reveal** to view).
- **Positions & history**, **Transfer / move** (new institution, campus, department, designation
  or manager with **Effective date** and **Reason \***), **Movements**.
- **Salary history** and **New revision**.
- **Letters** – **Offer letter**, **Experience letter**, **Relieving letter** via **Generate
  letter**, or **Or draft a custom letter with AI**.
- **Lifecycle** / **Checklist** – exit with **Exit type** and **Last working date**.
- **Documents**, **Change requests** (approve employee profile changes).
- **Login access** – **Create login** (new user with the Employee role) or link an **Existing
  user**; **Unlink** removes the link but keeps the user.

**Attendance:** **HR → Attendance** tabs:

- **Register** – month view per employee; correct a day with **Status** and **Reason \***.
- **Regularizations** – approve employee requests for missed punches.
- **Period locks** – lock a month before payroll; **Unlock attendance period** needs a reason and
  the unlock permission (owner/group admin).
- **Import** – upload a **Biometric CSV**.
- **Policy** – **Allow web punch**, **Allow mobile punch**, **Require selfie matched to profile
  photo for self punches** (face punch – employees must upload a clear profile photo first),
  **Absent days are loss of pay**, **Late marks per half-day deduction**, **Timezone**.
- **Payroll summary** – payable days per employee (fed into payroll); **Recompute month** after
  corrections.

**Shifts:** **HR → Shifts → New shift** – **Name \***, **Code \***, **Start**, **End** (end before
start = overnight), **Break (min)**, **Grace in/out (min)**, **Full day / Half day (min)**,
**Overtime after (min)**, **Institution default shift**. **Assign shift** to an **Employee** or
**Department** with **Effective from**, optionally a **Rotation**.

**Holiday calendars:** **HR → Holiday calendars → New calendar** – **Name \***, **Year**, **Scope
\*** (Group or Institution), weekly offs (or **Inherit weekly offs**). **Add** holidays with
**Date**, **Name**, **Type**. **Resolve** shows the effective calendar for a date range.

**Leave:**

- **HR → Leave setup** – **New leave type** (**Code \***, **Name \***, **Paid leave**, **Half day
  allowed**, **Encashable**, **Document required**…) and **New policy** (accrual, **Carry-forward
  cap**, **Max consecutive days**, **Minimum notice (days)**, **Sandwich rule**, **Cannot be
  clubbed with**…). Use **Run accrual** monthly and **Run year-end** at the end of the leave year.
- **HR → Leave** – all requests; **Apply on behalf** of an employee; **Balances & ledger**,
  **Adjust balance**, **Encashment**, **Cancel leave**.
- Employees apply in **Employee → My leave**; requests go to [Approvals](#713-approvals).

### 7.4 Payroll

**Who:** Payroll Manager (prepares), Finance Manager / Institution Owner (approves and locks),
Group Finance (can also reopen), HR (salary view/update). Requires **HR** and **Payroll** modules.

**Step 1 – Salary components:** **HR → Salary components**.

- Click **Seed defaults** once to create standard Indian components (Basic, HRA, PF, ESI, PT, TDS
  …).
- **New component**: **Name**, **Code**, **Type** (earning/deduction…), **Calculation** (fixed
  **Monthly amount**, **Percentage** **Of** CTC/BASIC/GROSS/another code, slab or **Formula**),
  **Taxable**, **Pro-rated by payable days**, **Show on payslip**, **Display order**, statutory
  flags (**PF**, **ESI**, **PT**, **LWF**, **TDS**).
- **Payroll settings** (per institution): **Require attendance lock**, **Rounding**, **State
  (PT/LWF)**. **Save settings**.

**Step 2 – Salary structures:** **HR → Salary structures → New structure** – **Name**, **Code**
(e.g. STD_CTC), **Institution**, **Employment type**, **Grade**, **Effective from**, then **Add
component** rows with a calculation (e.g. Special allowance = `max(CTC - BASIC - HRA, 0)`).
Use **New version** to change a structure from a future date without altering history.

**Step 3 – Employee salary:** **HR → Employee salary**, pick the **Employee**.

1. Click **Assign** (first time) or **Request revision** (later).
2. Choose the **Structure**, **Effective from** and **Annual CTC**.
3. Under **Components for this employee**:
   - **Untick** a component that does not apply – e.g. **PF not applicable** for an employee who
     opted out. (Employee and employer halves of PF/ESI/LWF switch together.)
   - Leave **Monthly amount** empty to use the structure's calculation, or type a fixed amount.
   - **Add component** to give this employee an extra component (e.g. a special allowance); the
     amount is **Required** for extras. Remove it with **×**.
4. Pick the **Tax regime** and enter a **Reason \*** – the reason is **required** for every
   assignment and revision.
5. **Save**. Revisions go through approval; back-dated revisions create arrears.
6. Use **Preview → Compute preview** for any **Period start** to see each component, gross,
   deductions, net, payable days and LOP.

The **Salary history (immutable)** table shows every version with its overrides and **Not
applicable** components.

**Step 4 – Monthly payroll run (maker–checker):** **HR → Payroll runs**.

1. **New run** – **Institution**, **Period start**, **Label (optional)**. **Create**. (Use **Group
   batch** to create one run per institution of a group.)
2. Open the run. **Compute** (or **Recompute** after changes). Review each employee; add
   **Adjustments** (one-time bonus or deduction with **Reason (required)**).
3. **Submit for approval** (maker = Payroll Manager).
4. The checker (Finance Manager / Institution Owner) opens the run or **Approvals** and clicks
   **Approve** or **Reject**. A Payroll Manager cannot approve their own run.
5. **Finalize & lock** – payroll becomes read-only and payslips are generated.
6. **Payments** – download the **Bank file (CSV)**, then enter the **Payment reference (UTR)**
   and click **Mark all paid**.
7. **Payslips** – download or **Regenerate payslips**. **Reports** – Payroll register, Component
   summary and statutory summaries (PF, ESI, PT, TDS…).
8. Mistake after finalizing? Group Finance / owner can **Reopen…** with a reason (audited).

If **Require attendance lock** is on, lock the month in **HR → Attendance → Period locks** before
computing.

**Payslips & Form 16:** **HR → Payslips & Form 16**. **Add Form 16** – **Employee**, **Financial
year (YYYY-YY)**, upload **Form 16 PDF** (or **Generate placeholder**), then **Publish** so the
employee sees it in **My payslips**.

**Group view:** **Group → Payroll summary** – totals per institution for a **Month** (tick
**Include unapproved** to see drafts).

### 7.5 Fees and finance

**Who:** Accountant, Finance Manager, Institution Admin (fees); Principal (view). Requires the
**Finance** module; fee screens are for education organizations.

**Set up fees:**

1. **Fee heads → New fee head** – **Name**, **Code**, **Category**, **Amount**, **Tax %**,
   **Refundable**, **Order**. **Late-fee rules** tab → **New late-fee rule** (**Mode**, **Amount**,
   **Grace days**, **Max amount**).
2. **Fee structures → New structure** – **Name**, **Code**, **Academic year**, **Class section
   (blank = whole institution)**, then **Installment** rows (**Label**, **Due date**) with **Head**
   lines (**Fee head**, **Amount**) and a **Late-fee rule**. **Create**, then **Activate**.
3. Click **Generate invoices** to bill every student in scope.
4. **Concessions → New concession** – **Name**, **Kind**, **Type**/**Value** (percent or amount),
   **Fee head (blank = all heads)**, **Student category (e.g. EWS, STAFF_WARD)**, **Reason**.

**Daily work:**

- **Collect fee** – search the student, tick dues, choose **Mode** (cash, cheque, UPI, card…),
  **Amount**, **Reference (cheque / UTR / txn)**, **Bank**, **Remarks**. Save, then **Receipt
  PDF**.
- **Fee invoices** – view by **Status**/**Overdue**; **Ad-hoc invoice** for one-off charges;
  **Cancel invoice**.
- **Fee receipts** – reprint (**Receipt PDF**), **Refund** or **Cancel receipt** (with
  **Reason**).
- **Fee defaulters** – filter by **Min days overdue**; **Apply late fees**, **Send reminders**,
  **Collect**.
- **Fee reports** – choose **Report** and dates; export **CSV**, **Excel** or **PDF**.

**Online payment by parents:** parents open **My fees**, tick dues and click **Pay ₹… online**. In
the demo a test gateway is used – **Complete payment** simulates success and a receipt is issued
automatically.

**Accounts:**

- **Accounts** – chart of accounts; **New account** (**Code**, **Name**, **Type**, **Parent
  group**; tick **Group (no postings)** for headings).
- **Vouchers → New voucher** – **Type**, **Date**, **Narration**, **Line** items with
  **Account**, **Debit**, **Credit** (must balance). Tick **Post immediately** or **Post** later;
  **Cancel voucher** reverses it. Fee collections post automatically.
- **Expenses** – **Record expense** (**Expense head**, **Vendor**, **Amount**, **Paid by**,
  **Reference**); manage suppliers under **Vendors → New vendor**.
- **Ledger** and **Trial balance** – choose dates/**Account**; export **CSV**, **Excel**, **PDF**.

### 7.6 Library

**Who:** Librarian (full), Institution Admin; staff and students use self-service. Requires the
**Library** module.

- **Catalogue → New title** – **Title**, **Authors (separate with ;)**, **ISBN / ISSN**,
  **Publisher**, **Edition**, **Year**, **Category**, **Call number**, **Tags**, **Type** (book,
  e-book with **Link (URL)** or **File**…). **Import** for bulk. On a title: **Add copies**
  (**Number of copies**, **Rack**, **Shelf**, **Price**) and **Labels PDF** for barcode labels.
- **Issue / Return desk** – scan or type the **Barcode / accession number**, find the member by
  name/admission no/employee code, then **Issue**, **Return** (record **Condition** and any
  **Damage / replacement charge**) or **Renew**.
- **Reservations**, **Library members**, **Copies**.
- **Overdues & fines** – **Collect** or **Waive** fines.
- **Library settings** – **Loan days**, **Max books**, **Renewals allowed**, **Fine per day (₹)**,
  **Max fine per loan (₹)**, **Reservation hold days**; stock verification (**Start**, **Record
  scans**, **Complete & reconcile**).
- **Library reports** – export **CSV** / **XLSX**.

### 7.7 Transport

**Who:** Transport Manager, Institution Admin. Requires the **Transport** module.

**Institution → Transport** has tabs: **Dashboard**, **Vehicles** (**New vehicle**, documents
with expiry alerts, **Fuel log**), **Drivers** (**New driver / staff**), **Routes & stops** (**New
route**, **Stops**, **Fare slabs (by distance)**), **Allocations** (**Allocate transport** to a
student or employee with **Route**, **Stop**, **Pickup**/**Drop**, **Fare override**), **Trips &
logs** (**New trip**, **Boarding**, **Absent**, **Log incident**, **Notify parents** with
**Delay (minutes)** and **Message**), **Maintenance** (**Log service / repair**) and **Reports**
(route utilisation, running cost, **Transport charges** per **Period (YYYY-MM)**).

### 7.8 Hostel

**Who:** Hostel Manager (full), Hostel Warden (day-to-day). Requires the **Hostel** module.

**Institution → Hostel** tabs: **Dashboard**, **Hostels / rooms** (**New hostel**, **New room**:
**Room no**, **Floor**, **Beds**, **Monthly rent**, **Amenities**; **Mess plans**), **Allocations**
(**Allocate room** – **Student**, **Room**, **Mess plan (optional)**), **Out-passes** (**Approve** /
**Reject** student requests), **Visitors** (**Check in visitor**, **Leave**), **Complaints**,
**Roll call** (**Save roll call**) and **Reports** (occupancy, **Hostel charges**).

### 7.9 Assets

**Who:** Asset Manager (full); Institution Admin and HR can view, check out and check in. Requires
the **Assets** module. Open the **Assets** workspace.

- **Categories → New category** – **Name**, **Code**, **Tag prefix**, **Digits**,
  **Depreciation** (**Rate %**, **Useful life (yrs)**, **Residual %**) and custom fields.
- **Assets → New asset** – **Name \***, **Category \***, **Institution \***, **Tag (auto if
  blank)**, **Make**, **Model**, **Serial no**, **Purchase date**, **Cost (₹)**, **Vendor**,
  **Invoice no**, **Warranty expiry**, **Location (building / room)**, **Campus**, **Department**.
- **QR labels** – select assets and click **Print labels**, or open an asset and click **Label**,
  to get a PDF of QR code labels to stick on the items.
- On an asset: **Check out** to an employee/department/room (the employee acknowledges it in **My
  assets**), **Check in**, **Transfer**, **Maintenance**, **Depreciation**, **Upload invoice**,
  **Handover form**, **Mark lost**, **Dispose / write off**.
- **Maintenance → New ticket**; **Inventory** for consumables (**New item**, stock **Post**,
  **Below reorder level**); **Audit → New audit** (scan tags and mark **Found**/**Missing**, then
  **Complete**); **Disposal** (**Approve**/**Reject**); **Reports** (**CSV**, **Excel**, **PDF**).

### 7.10 Documents

**Who:** anyone with document access; staff upload, self-service users see only their own
documents. Requires the **Documents** module.

**Group / Institution / HR → Documents** (self-service: **Documents** in the Employee or Student /
Parent workspace):

1. **Upload document** – **File**, **Title (defaults to file name)**, **Category**,
   **Confidentiality**, **Belongs to** (e.g. an employee or student), **Expiry date (optional)**.
2. On a document: **Download**, **Upload new version**, **Versions** (and **Restore as new
   version**), **Delete**.

### 7.11 Communication

**Who:** Group Admin and IT Admin manage; Institution Admin views. Requires the **Communication**
module; Email, SMS and WhatsApp are separate licensed channels.

**Group → Communication**:

- **Providers** – **Add provider** for a **Channel** (email/SMS/WhatsApp) with **Config (JSON)**,
  **Credentials** (write-only) and **Priority (lower first)**.
- **Templates** – **New template**: **Key** (e.g. `auth.invite`), **Name**, **Channel**,
  **Subject**, **HTML body** (wrapped in your branded layout), **Sample variables (JSON)**. Use
  **Preview current version** and **Draft with AI** (if AI is licensed).
- **Message log** – every email/SMS/WhatsApp sent and its status.

Messages are sent from the module screens, e.g. **Notify guardians of absentees** (student
attendance), **Send reminders** (fee defaulters), **Notify parents** (transport), invites and
password emails. There is no separate bulk-announcement composer screen yet.

### 7.12 AI assistant and AI tools

Requires the **AI** module (Professional/Enterprise).

- **Ask AI** – a chat panel available from the app bar. Ask questions such as "how many students
  are absent today?"; answers only use data you are allowed to see. Start a **New chat** or reopen
  **Conversations**.
- **AI tools** (Group / HR) – **Payroll anomalies** (pick a **Payroll run**, **Explain**),
  **Student insights** (**Generate insights**), **Resume / JD summary**, **Job description**,
  **Summarize** pasted text, and **Draft with AI** for letters and templates.
- **AI settings** (Group Admin / IT Admin) – **AI enabled for this organization**, **Provider**
  (mock = demo answers, no data leaves the server), **Model**, **Allow sending organization data
  to the external provider**, **Enabled AI features**, **Max tokens per request**.
- **AI usage** – tokens **By day**, **By feature**, **By user**. Monthly token limits come from
  your plan.

### 7.13 Approvals

Every workspace has **Approvals**. Leave requests, attendance regularizations, salary revisions,
payroll runs, asset transfers/disposals and similar requests flow here.

- **Pending my approval** – open a request and choose **Approve**, **Reject**, **Send back** (for
  changes), **Delegate** (to another person) or add a **Comment**.
- **My requests** – track what you submitted; **Resubmit** a sent-back request or **Cancel
  request**.

### 7.14 Notifications

The **bell** icon in the top bar shows unread notifications (approvals waiting, payslips
published, etc.). Click one to open it, **Mark all read**, or **View all** for the full list with
**Unread only** filter.

---

## 8. Self-service

### Employees (Employee workspace)

| Menu                                   | What you can do                                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**                               | Today's status (**Checked in / Checked out**), **Check in / Check out** button, **Regularize / history**, leave balances, **Apply leave**.                                                    |
| **My profile**                         | View your details, upload a profile photo, **Request changes** to personal data (HR approves).                                                                                                |
| **My attendance**                      | **Punch in** / **Punch out** (if selfie punch is required, allow the camera and click **Capture & punch**). View the month; **Regularize** a missed punch with a **Reason \***; **Withdraw**. |
| **My leave**                           | **Apply leave** – **Leave type \***, **From \***, **To \***, half-day options, **Reason \***. You're warned if the request breaks the policy. Cancel pending requests.                        |
| **My salary**                          | Current salary structure and **Salary revisions**; **Annual statement** for a **Financial year**; **Print / save PDF**.                                                                       |
| **My payslips**                        | **Payslips** – download each month's **PDF**. **Form 16** – download published Form 16s.                                                                                                      |
| **My assets**                          | Assets issued to you: **Acknowledge**, **Handover form**, **Report issue**.                                                                                                                   |
| **Documents**                          | Documents that belong to you (payslips, letters…).                                                                                                                                            |
| **My library** / **Library catalogue** | Your loans and reservations; search the catalogue and **Reserve**.                                                                                                                            |

### Students (Student / Parent workspace)

**My profile** (admission no, class, roll no), **Timetable**, **Attendance**, **Results** (with
**Report card** PDF once published), **Documents**, **My fees** (dues, receipts, **Pay … online**),
**My library**, **Library catalogue**, **Certificates** (download your issued TC / character
certificate PDF), **My transport** (route, stop, vehicle, driver contact), **My
hostel** (room, **Apply for out-pass**, **Raise a complaint**).

### Parents (Parent portal)

**My children** lists your wards. On Timetable, Attendance, Results and Fees choose the **Child**
at the top to switch between children. Parents can pay fees online, apply for hostel
out-passes and download their children's issued certificates under **Certificates**.

---

## 9. Demo walkthrough

The demo database contains seven organizations that show every licensing case. All accounts and
the exact menus each one sees are listed in [`DEMO_ACCOUNTS.md`](DEMO_ACCOUNTS.md). Every demo
account uses the password `password123`.

### Suggested 15-minute demo

| Min   | Sign in as                                              | Show                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–2   | `superadmin@erp.local`                                  | **Platform → Organizations** (7 tenants, plans, statuses), **Plans**, **Invoices**, **Billing settings** (UPI).                                                                                                   |
| 2–5   | `owner@greenwood.demo` (Enterprise)                     | Home page with all workspaces. **Group → Modules** (everything licensed), **Branding**, **Institutions** (main + Whitefield branch), **Users → Roles**.                                                           |
| 5–7   | `teacher@greenwood.demo`                                | **Institution → My classes** → **Attendance** and **Marks**; **Timetable**. Then `parent@greenwood.demo` → **Results**, **My fees → Pay online**.                                                                 |
| 7–10  | `payroll@greenwood.demo`, then `finance@greenwood.demo` | Payroll maker–checker: **HR → Employee salary** (untick PF, Reason required), **Payroll runs** → Compute → Submit; finance user **Approve** → **Finalize & lock**. `employee@greenwood.demo` → **My payslips**.   |
| 10–11 | `owner@sunrise.demo` (Starter)                          | Only education, documents and communication menus; no HR workspace, no fees, no library.                                                                                                                          |
| 11–12 | `hr@acme.demo` (Company, HRMS-only)                     | Company wording (**Head office**, **Companies / branches**); HR and Payroll via add-ons; no Students/Exams; Communication switched off by override.                                                               |
| 12–13 | `admin@brightway.demo` (add-on/override)                | **Group → Modules**, set **Level** = Brightway South School → Hostel disabled (source INSTITUTION); AI off for the organization. `south.hostel@brightway.demo` has no Hostel; `north.hostel@brightway.demo` does. |
| 13–14 | `owner@lakeside.demo` (PAST_DUE)                        | Modules still work; **Group → Subscription** shows PAST_DUE and an open invoice → **Pay via UPI**.                                                                                                                |
| 14    | `owner@maple.demo` (TRIAL)                              | **Subscription** shows "Trial ends …" with full Professional modules.                                                                                                                                             |
| 15    | `owner@oldtown.demo` (CANCELLED)                        | Can sign in, but all module menus are gone; module screens report "not enabled".                                                                                                                                  |

---

## 10. FAQ and troubleshooting

### A menu item or workspace is missing

Check, in this order: (1) Is the module in your plan/add-ons? (**Group → Subscription**) (2) Is it
switched off for your organization or institution? (**Group → Modules**) (3) Is the subscription
cancelled or the trial expired? (4) Does your role include it? (see the
[roles table](#built-in-roles)) (5) Is it an education screen in a company organization? See
[Why is a menu item missing?](#why-is-a-menu-item-missing).

### "Request validation failed"

A required field is empty or has the wrong format. Look for fields marked **\*** or highlighted in
red – for example **Reason \*** on salary revisions, a date in the wrong format, an academic year
not like `2026-27`, an invalid email, or a password that breaks the
[password rules](#passwords-and-two-factor-authentication). Correct it and save again.

### "403", "not enabled" or "This module is not enabled for your organization"

The module is not licensed or is switched off at your level (error code `FEATURE_DISABLED`). Ask
your owner to enable it on **Modules**, or to upgrade the plan / buy an add-on from the platform
team.

### "You do not have access to this page" / "Forbidden"

Your role doesn't include this action, or the record is outside your scope (e.g. another
institution or department). Ask an administrator to add the right role with the right **Applies
to** scope on **Users → Roles**.

### Forgot my password

There is no self-service "Forgot password" link yet. Contact your administrator or platform
support; they can issue a password-reset email or re-invite you. After signing in, use a strong
password that follows the rules.

### I can't see a student, employee or record I know exists

- Check the **Institution** filter at the top of the page – you may be looking at another
  institution.
- Your role may be limited to one institution or department (e.g. HOD/Teacher). Teachers only see
  attendance and marks for sections allocated to them.
- Check status filters (e.g. withdrawn students, exited employees, cancelled invoices).

### My punch is rejected

Your institution may require a selfie matched to your profile photo. Upload a clear front-facing
profile photo under **My profile**, allow camera access in the browser, and try again. If web punch
is not allowed by policy, ask HR to record or regularize your attendance.

### Payroll won't compute

If **Require attendance lock** is on, lock the month first (**HR → Attendance → Period locks**).
Make sure every employee has a salary assigned (**HR → Employee salary**). Check warnings in the
**Preview**.

### Can I reverse a finalized payroll?

Only users with the reopen permission (Group Finance, Group Owner) can **Reopen…** a finalized run,
and a reason is recorded in the audit log.
