"""Builds the ERP user guide (.docx) from the screenshot crawl in /tmp/erp-guide."""
import io
import json
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/erp-guide'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'ERP-User-Guide.docx'
MANIFEST = sys.argv[3] if len(sys.argv) > 3 else 'scripts/demo/demo-manifest.json'

ROLE_ORDER = [
    'superadmin', 'owner', 'group.admin', 'group.hr', 'group.finance', 'branch.owner',
    'principal', 'admin', 'vice.principal', 'dean', 'registrar', 'hod', 'coordinator',
    'teacher', 'teacher2', 'faculty', 'branch.teacher', 'hr', 'payroll', 'finance', 'accountant',
    'it', 'assets', 'transport', 'librarian', 'hostel', 'warden', 'employee', 'student', 'parent',
]

ROLE_INFO = {
    'platform_super_admin': ('Platform Super Admin', 'Runs the SaaS platform: creates organizations (tenants), plans, subscriptions, UPI billing and platform settings. Does not work inside a school\'s data except through audited support access.'),
    'platform_support_admin': ('Platform Support Admin', 'Helps tenants: read-mostly access to organizations and subscriptions for support.'),
    'group_owner': ('Group Owner', 'Owner of the education group / tenant. Full access to every institution, module and setting of the organization.'),
    'group_admin': ('Group Admin', 'Administers all institutions in the assigned group: structure, users, academics, students and operations.'),
    'group_hr': ('Group HR', 'HR across all institutions of the group: employees, leave, attendance, shifts, holidays and payroll inputs.'),
    'group_finance': ('Group Finance', 'Finance across the group: fees, UPI verification, accounts, vouchers, expenses and payroll approval.'),
    'institution_owner': ('Institution Owner', 'Owner of the assigned institution(s) (for example a branch). Full access inside those institutions only.'),
    'institution_admin': ('Institution Admin', 'Administers the assigned institution: users, structure, students, academics and operations.'),
    'principal': ('Principal', 'Academic head of the institution: students, admissions, academics, exams, approvals and reports.'),
    'vice_principal': ('Vice Principal', 'Deputy academic head: academics, attendance, exams and approvals.'),
    'dean': ('Dean', 'Academic head of a faculty / set of departments.'),
    'registrar': ('Registrar', 'Student records, admissions, certificates and academic administration.'),
    'hod': ('HOD', 'Head of department; works only with the assigned department(s): staff, leave approvals, subjects and timetable.'),
    'academic_coordinator': ('Academic Coordinator', 'Subjects, timetable, attendance and examinations of the institution.'),
    'teacher': ('Teacher', 'Teaching staff: own classes, student attendance, marks, homework, plus employee self-service.'),
    'faculty': ('Faculty', 'Faculty member (higher education): classes, attendance, marks, plus employee self-service.'),
    'hr_manager': ('HR Manager', 'Institution HR: employees, onboarding, leave, attendance, shifts, holidays, documents.'),
    'payroll_manager': ('Payroll Manager', 'Prepares and processes payroll: salary structures, payroll runs, payslips, statutory reports.'),
    'finance_manager': ('Finance Manager', 'Approves and locks payroll; manages fees, accounts and finance reports.'),
    'accountant': ('Accountant', 'Accounting staff: fee collection (UPI), UPI verification, receipts, vouchers, expenses, ledger.'),
    'it_admin': ('IT Admin', 'User accounts, roles, API clients, webhooks and system configuration.'),
    'asset_manager': ('Asset Manager', 'Asset register, movements, maintenance and inventory.'),
    'transport_manager': ('Transport Manager', 'Vehicles, drivers, routes, stops, fares, trips and student transport allocation.'),
    'librarian': ('Librarian', 'Library catalogue, issue/return of books, reservations and fines.'),
    'hostel_manager': ('Hostel Manager', 'Hostels, rooms, beds, mess plans, allocations and hostel fees.'),
    'hostel_warden': ('Hostel Warden', 'Runs a hostel day to day: allocations, out-pass approval, visitors, roll call.'),
    'student': ('Student', 'Student self-service portal: timetable, attendance, marks, fees (pay via UPI), library, hostel, transport.'),
    'parent': ('Parent', 'Parent / guardian portal: children\'s attendance, marks, fees (pay via UPI), messages and requests.'),
    'employee': ('Employee', 'Employee self-service: punch in/out, attendance, leave, payslips, profile, documents.'),
}

WORKSPACE_INFO = {
    'home': 'Sign-in',
    '/platform': 'Platform console (SaaS operator)',
    '/group': 'Group workspace (all institutions of the organization)',
    '/institution': 'Institution workspace (one school / college / branch)',
    '/hr': 'HR & Payroll workspace',
    '/employee': 'Employee self-service (My workspace)',
    '/portal': 'Student / Parent portal',
    '/assets': 'Assets & inventory workspace',
}

# (pattern, what it does, when it is shown)
GLOSSARY = [
    (r'^sign out$', 'Logs you out and returns to the login screen.', 'Always.'),
    (r'^change password$', 'Opens a dialog to change your own password (current + new password).', 'Always, in the account menu / profile.'),
    (r'^reset password$', 'Sets a new temporary password for another user.', 'Only for users who can manage users (IT admin, admins).'),
    (r'^punch in$', 'Records your arrival time for today (face/selfie capture when enabled).', 'Only when you have NOT punched in yet today. After punching in it is replaced by "Punch out" – both are never shown together.'),
    (r'^punch out$', 'Records your departure time for today.', 'Only after you punched in today and have not punched out yet.'),
    (r'^check in visitor$', 'Registers a visitor entering the hostel.', 'Hostel warden / manager.'),
    (r'^check in$', 'My workspace home: same as Punch in (records today\'s arrival). Hostel/transport: marks a visitor or student as arrived/returned.', 'Only when you have not checked in yet today / while the record is in the "out" state.'),
    (r'^check out$', 'Marks departure (visitor leaves / student leaves on out-pass).', 'Only while the record is checked in / approved.'),
    (r'^approve', 'Accepts a request submitted by SOMEONE ELSE (leave, out-pass, regularization, profile change, expense, payroll…). The request moves to APPROVED.', 'Only to the approver (manager/HOD/HR/warden/finance) and only while the request is PENDING. Never shown on your own request.'),
    (r'^reject', 'Declines a request submitted by someone else; a reason is usually required. The request moves to REJECTED.', 'Only to the approver and only while the request is PENDING.'),
    (r'^cancel receipt$', 'Voids a fee receipt (wrong entry). The invoice becomes due again; the amount is reversed.', 'Accountant/finance, only on ACTIVE receipts.'),
    (r'^cancel expense', 'Voids a posted expense; the accounting voucher is reversed.', 'Accountant/finance, only on POSTED expenses.'),
    (r'^cancel out-pass$', 'The student/warden withdraws an out-pass that is no longer needed.', 'Only while the out-pass is pending/approved and the student has not left.'),
    (r'^cancel reservation$', 'Withdraws a library book reservation.', 'Only while the reservation is active.'),
    (r'^cancel trip$', 'Cancels a planned transport trip.', 'Only for planned/not-completed trips.'),
    (r'^cancel$', 'Inside a dialog: closes the dialog without saving. On a row: WITHDRAWS YOUR OWN request (e.g. your leave) – different from Reject.', 'Dialog: always. Row: only on your own request while it is still pending (or approved but not started).'),
    (r'^close ticket$', 'Marks a support/helpdesk ticket as closed.', 'Only on open tickets.'),
    (r'^close$', 'Closes the dialog / record.', 'Always in dialogs.'),
    (r'^(save|save roll call)$', 'Saves the form / attendance roll call.', 'Inside forms; disabled until required fields are valid.'),
    (r'^submit$', 'Submits the form (for approval where applicable).', 'Inside forms.'),
    (r'^create$', 'Creates the record from the form.', 'Inside "New …" dialogs.'),
    (r'^(add|new|create)\b', 'Opens a form to create a new record of this type.', 'Only if your role has the "create" permission for this module.'),
    (r'^add .*', 'Opens a form to add the item.', 'Only if your role can create/manage this item.'),
    (r'^edit( as json)?$', 'Opens the record in a form to change it.', 'Only if your role has the "update" permission; hidden for read-only roles.'),
    (r'^delete', 'Permanently removes (soft-deletes) the record after confirmation.', 'Only with "delete" permission. Blocked (error) if the record still has dependent data, e.g. a class with students.'),
    (r'^archive$', 'Hides the record from day-to-day lists without deleting it.', 'Only on active records.'),
    (r'^activate$', 'Makes an inactive record active again.', 'Only on INACTIVE records (replaces "Deactivate").'),
    (r'^deactivate$', 'Disables the record (user cannot log in / item cannot be used).', 'Only on ACTIVE records (replaces "Activate").'),
    (r'^block$', 'Blocks a hostel bed so it cannot be allocated.', 'Only on AVAILABLE beds.'),
    (r'^(allocate|allocate room)$', 'Allocates a bed/room/route to a student.', 'Only when beds/seats are available.'),
    (r'^vacate$', 'Ends a hostel allocation; the bed becomes available.', 'Only on ACTIVE allocations.'),
    (r'^end$', 'Ends an allocation / assignment as of today.', 'Only on ACTIVE allocations.'),
    (r'^lock', 'Locks the period (payroll/attendance month) so no further changes are possible.', 'Finance/payroll; only on unlocked periods (replaced by "Unlock").'),
    (r'^unlock$', 'Re-opens a locked period for corrections.', 'Only on locked periods; finance manager.'),
    (r'^generate invoices$', 'Creates fee invoices for all students covered by a fee structure.', 'Accountant/finance on fee structures.'),
    (r'^generate charges$', 'Creates the monthly hostel/transport fee charges.', 'Hostel/transport manager, accountant.'),
    (r'^generate insights$', 'Runs the AI analysis and shows insights.', 'Only when AI tools are enabled.'),
    (r'^generate$', 'Generates the document/report (certificate, payslips, report card…).', 'Only to roles that own the document.'),
    (r'^apply late fees$', 'Adds late fees to overdue invoices according to the late-fee rules.', 'Accountant/finance.'),
    (r'^apply leave$', 'Opens the leave application form (leave type, dates, half-day options, reason).', 'Employees (self-service); requires a leave policy.'),
    (r'^apply on behalf$', 'HR applies leave for an employee.', 'HR only.'),
    (r'^apply$', 'Applies the selected filter / date range.', 'Always on filter bars.'),
    (r'^collect$', 'Records a fee payment for an invoice. Payment mode is UPI only (UPI reference / UTR required).', 'Accountant/finance on unpaid or partially paid invoices.'),
    (r'^refund$', 'Refunds a paid amount (fully or partially).', 'Finance only, on ACTIVE receipts.'),
    (r'^(receipt pdf|download pdf|download invoice|pdf|print / save pdf|labels pdf|download)$', 'Downloads/prints the PDF (receipt, invoice, payslip, certificate, labels).', 'Whenever the document exists.'),
    (r'^regenerate pdf', 'Re-creates the PDF with the current branding/logo.', 'Only to roles that manage the document.'),
    (r'^(csv|excel|xlsx|export csv)$', 'Exports the current list/report to a file.', 'On lists and reports.'),
    (r'^(import|import csv)$', 'Bulk-creates records from a CSV file (with a dry-run option).', 'Only with create permission.'),
    (r'^download template$', 'Downloads the CSV template for bulk import.', 'Next to Import.'),
    (r'^upload', 'Uploads a file (document/photo).', 'Only with document/profile permission.'),
    (r'^request changes$', 'Asks HR to change your profile data (needs HR approval).', 'Employee self-service.'),
    (r'^regularize', 'Requests a correction of a missed/wrong punch for a day (sent to the manager for approval).', 'Employee attendance; only for past days with a missing/incorrect punch.'),
    (r'^refresh$', 'Reloads the data.', 'Always.'),
    (r'^issue$', 'Issues a library book / certificate.', 'Librarian / registrar.'),
    (r'^return$', 'Marks an issued book as returned (fine computed when late).', 'Only on issued books.'),
    (r'^reserve$', 'Reserves a library book that is currently issued.', 'Students/staff on unavailable books.'),
    (r'^resolve$', 'Marks an incident/complaint as resolved.', 'Only on open items.'),
    (r'^(start|resume)$', 'Starts / resumes the trip, exam or process.', 'Only when the item is in the matching state.'),
    (r'^notify parents$', 'Sends a notification to the parents (absence, fees…).', 'Teachers/admins.'),
    (r'^send reminders$', 'Sends fee due reminders to parents.', 'Accountant/finance on defaulters.'),
    (r'^run accrual$', 'Credits the monthly leave accrual to all balances.', 'HR.'),
    (r'^run year-end$', 'Carries forward / lapses leave balances at year end.', 'HR.'),
    (r'^recompute month$', 'Recalculates the attendance summary for the month.', 'HR.'),
    (r'^validate$', 'Checks data before a final step.', 'Admin/payroll.'),
    (r'^rotate$', 'Rotates (regenerates) an API secret.', 'IT admin.'),
    (r'^seed defaults$', 'Creates the default master data.', 'Admins, first-time setup.'),
    (r'^(explain|summarize)$', 'AI assistant explains / summarizes the item.', 'When AI tools are enabled.'),
    (r'^(show|view student|review|configure|versions|search catalogue)$', 'Opens details / the related screen.', 'Always to users who can view it.'),
    (r'^to maintenance$', 'Moves a vehicle/asset to MAINTENANCE status.', 'Only on ACTIVE vehicles/assets.'),
    (r'^(log movement|log service / repair|fuel log)$', 'Records an asset movement / service / fuel entry.', 'Asset / transport manager.'),
    (r'^enroll$', 'Enrolls the student/employee.', 'Admissions / HR.'),
    (r'^adjust$', 'Manually adjusts a balance (leave/stock) with a reason.', 'HR / asset manager.'),
    (r'^upi|verify', 'Verifies a UPI payment (match the UTR with the bank statement) – Verify marks it paid, Reject returns it to the payer.', 'Accountant/finance on payments PENDING verification only.'),
    (r'^overdue', 'Filter: shows only overdue items.', 'Lists with due dates.'),
    (r'^(attendance|marks|timetable|documents|students|staff|roles|trips|stops|boarding|incidents|fines|waitlist|installment|line|head|employee|student|department|other|substitution|exam term|grading scale|job description|salary structure.*|previous school|class .*|nursery.*)$', 'Switches the view / opens the related section or filter.', 'Always to users who can see the page.'),
]

ICON_ONLY = {
    'mdi-delete': ('Delete (bin icon)', 'Deletes the row after confirmation.', 'Only with delete permission; refused if the record still has dependent data.'),
    'mdi-delete-outline': ('Delete (bin icon)', 'Deletes the row after confirmation.', 'Only with delete permission.'),
    'mdi-pencil': ('Edit (pencil icon)', 'Opens the row in an edit form.', 'Only with update permission.'),
    'mdi-close': ('Close (X icon)', 'Closes the dialog / removes the chip.', 'Always.'),
    'mdi-calendar-star': ('Holidays (calendar-star icon)', 'Opens the holidays of the calendar.', 'HR / admins.'),
}


def clean(label):
    label = label.replace(' (disabled)', '')
    return re.sub(r'\s+[A-Z]{2,}[A-Z0-9-]*-\d+[A-Z0-9-]*$', '', label).strip()


def describe(label, icon):
    if not label:
        return ICON_ONLY.get(icon, (icon or 'Icon', 'Icon action.', '—'))
    low = clean(label).lower()
    for pat, what, when in GLOSSARY:
        if re.search(pat, low):
            return clean(label), what, when
    return clean(label), 'Opens / performs “%s” for this screen.' % clean(label), 'When your role has access.'


WHERE = {'toolbar': 'Page toolbar', 'row': 'Row action', 'dialog': 'In dialog', 'tab': 'Tab'}


def set_cell_bg(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), color)
    tcPr.append(shd)


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = 'Light Grid Accent 1'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ''
        r = c.paragraphs[0].add_run(h)
        r.bold = True
        r.font.size = Pt(9)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ''
            r = cells[i].paragraphs[0].add_run(str(v))
            r.font.size = Pt(8.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph()
    return t


IMG_CACHE = {}


def picture(doc, path, width=6.3, max_px=1050, quality=50):
    if path not in IMG_CACHE:
        im = Image.open(path).convert('RGB')
        if im.width > max_px:
            im = im.resize((max_px, int(im.height * max_px / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=quality, optimize=True)
        IMG_CACHE[path] = (buf.getvalue(), im.width, im.height)
    data, w, h = IMG_CACHE[path]
    wid = min(width, width * w / 1150) if w < 700 else width
    if h / w * wid > 8.2:
        wid = 8.2 * w / h
    doc.add_picture(io.BytesIO(data), width=Inches(wid))
    p = doc.paragraphs[-1]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    # Thin border around the screenshot.
    inline = p.runs[0]._r


def caption(doc, text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.italic = True
    r.font.size = Pt(8.5)
    r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def add_toc(doc):
    p = doc.add_paragraph()
    run = p.add_run()
    fld = OxmlElement('w:fldChar')
    fld.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = 'TOC \\o "1-2" \\h \\z \\u'
    sep = OxmlElement('w:fldChar')
    sep.set(qn('w:fldCharType'), 'separate')
    t = OxmlElement('w:t')
    t.text = 'Right-click here and choose "Update Field" to build the table of contents.'
    end = OxmlElement('w:fldChar')
    end.set(qn('w:fldCharType'), 'end')
    for el in (fld, instr, sep, t, end):
        run._r.append(el)
    settings = doc.settings.element
    upd = OxmlElement('w:updateFields')
    upd.set(qn('w:val'), 'true')
    settings.append(upd)


def bullet(doc, text, bold_prefix=None):
    p = doc.add_paragraph(style='List Bullet')
    if bold_prefix:
        p.add_run(bold_prefix).bold = True
    p.add_run(text)
    return p


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def suffix(layout, path):
    if layout != 'home' and path.startswith(layout):
        return path[len(layout):] or '/'
    return path


def main():
    manifest = json.load(open(MANIFEST))
    users = {u['email']: u for u in manifest['users']}
    roles = []
    for key in ROLE_ORDER:
        f = os.path.join(SRC, key, 'pages.json')
        if os.path.exists(f):
            roles.append((key, json.load(open(f))))

    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.8)
    sec.top_margin = sec.bottom_margin = Inches(0.7)
    st = doc.styles['Normal']
    st.font.name = 'Calibri'
    st.font.size = Pt(10.5)

    # ---------- Cover ----------
    for _ in range(6):
        doc.add_paragraph()
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run('Education ERP · HRMS · Payroll')
    r.bold = True
    r.font.size = Pt(30)
    r.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run('User Guide – every role, every screen, every action button')
    r.font.size = Pt(16)
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run('Demo tenant: Greenwood International School · Screenshots taken from the live application')
    r.font.size = Pt(11)
    r.italic = True
    page_break(doc)

    doc.add_heading('Contents', level=1)
    add_toc(doc)
    page_break(doc)

    # ---------- 1. Getting started ----------
    doc.add_heading('1. Getting started', level=1)
    doc.add_paragraph(
        'The application is a multi-tenant SaaS. Every organization (school group, college, company) is a '
        'separate tenant and can only see its own data. Inside a tenant, what you see depends on the ROLE(S) '
        'assigned to your user and the SCOPE of each role (whole organization, a group, one institution, or a '
        'department). Menus, pages and action buttons are shown only when your role has the matching permission '
        'and the module is enabled for your institution.')
    doc.add_heading('1.1 How to log in', level=2)
    for s in [
        'Open the web address of the application (demo: %s).' % manifest.get('webUrl', 'http://localhost:5180'),
        'Enter your e-mail and password (demo password for every demo user: %s) and click CONTINUE.' % manifest.get('password', 'password123'),
        'After login you land on the workspace chooser. Pick a workspace card (for example Institution, HR & Payroll, My workspace or Portal).',
        'Use the left sidebar to move between pages of the workspace. The top bar shows the institution switcher, notifications, and your account menu (change password, sign out).',
    ]:
        stepp(doc, n, s)
    if roles:
        first = roles[1][1] if len(roles) > 1 else roles[0][1]
        key = roles[1][0] if len(roles) > 1 else roles[0][0]
        lp = first['pages'][0]['shots'][0]['file']
        picture(doc, os.path.join(SRC, key, lp), width=5.5)
        caption(doc, 'Login screen')
        hp = first['pages'][1]['shots'][0]['file']
        picture(doc, os.path.join(SRC, key, hp), width=6.2)
        caption(doc, 'Workspace chooser after login (Group Owner)')

    doc.add_heading('1.2 Workspaces', level=2)
    table(doc, ['Workspace', 'Address', 'Who uses it'], [
        ('Platform console', '/platform', 'SaaS operator (super admin): organizations, plans, subscriptions, UPI billing.'),
        ('Group', '/group', 'Owner, group admin/HR/finance: all institutions of the organization at once.'),
        ('Institution', '/institution', 'Principal, admin, registrar, teachers, accountant, managers: one institution.'),
        ('HR & Payroll', '/hr', 'HR, payroll, finance: employees, leave, attendance, payroll.'),
        ('My workspace', '/employee', 'Every staff member: punch in/out, my attendance, leave, payslips, profile.'),
        ('Portal', '/portal', 'Students and parents: timetable, attendance, marks, fees (UPI), messages.'),
        ('Assets', '/assets', 'Asset manager, admins, HR/finance: asset register, movements, maintenance, inventory.'),
    ], [1.3, 1.0, 4.4])

    # ---------- 2. Key concepts ----------
    page_break(doc)
    doc.add_heading('2. Action buttons – key rules', level=1)
    doc.add_paragraph('Buttons are context-sensitive: a button appears only when (a) your role has the permission, '
                      '(b) the module is enabled, and (c) the record is in a state where the action makes sense.')
    doc.add_heading('2.1 Approve vs Reject vs Cancel', level=2)
    table(doc, ['Button', 'Who sees it', 'On whose request', 'Result'], [
        ('Approve', 'Approver (reporting manager, HOD, HR, warden, finance)', 'Someone else\'s PENDING request', 'Status → APPROVED (leave balance deducted, out-pass allowed, payroll approved…)'),
        ('Reject', 'Approver', 'Someone else\'s PENDING request', 'Status → REJECTED with a reason. The requester is notified.'),
        ('Cancel (on a row)', 'The requester', 'Your OWN request', 'You withdraw it before it is used. Status → CANCELLED. No approver decision.'),
        ('Cancel (in a dialog)', 'Everyone', '—', 'Just closes the dialog without saving anything.'),
        ('Cancel receipt / Cancel expense', 'Accountant / finance', 'A posted financial record', 'Voids the record and reverses the accounting entry (audited).'),
    ], [1.3, 1.7, 1.5, 2.3])
    doc.add_paragraph('Example: an employee applies for leave → the employee sees "Cancel" on their own pending leave; '
                      'the HOD/HR sees "Approve" and "Reject" on the same leave in the Approvals page. Once decided, '
                      'Approve/Reject disappear for everyone.')
    doc.add_heading('2.2 Condition-based buttons', level=2)
    table(doc, ['Button(s)', 'Shown only when'], [
        ('Punch in / Punch out', 'Punch in before you have punched today; Punch out after punching in. Never both at the same time. Hidden on holidays/weekly-offs/approved leave days when punching is not allowed.'),
        ('Absent / Present marks', 'Attendance is shown only for past days and today; future days are never shown as absent. Today is not "absent" until the day is over.'),
        ('Regularize', 'Only for past days with a missing or wrong punch.'),
        ('Approve / Reject', 'Only for approvers and only on PENDING requests of other users.'),
        ('Cancel (row)', 'Only on your own pending (or approved but not yet started) request.'),
        ('Activate / Deactivate', 'Exactly one of them, depending on the current status.'),
        ('Lock / Unlock', 'Exactly one of them, depending on whether the payroll/attendance period is locked.'),
        ('Verify / Reject UPI', 'Only on UPI payments waiting for verification.'),
        ('Collect', 'Only on invoices with an outstanding balance.'),
        ('Edit / Delete', 'Only with update/delete permission. Delete is refused if the record still has children (e.g. class with students).'),
        ('Allocate / Vacate / Block', 'Allocate when beds/seats are free; Vacate on active allocations; Block on available beds.'),
        ('Check in / Check out', 'Check out when the person is inside; Check in when they are out.'),
    ], [1.8, 4.9])
    doc.add_heading('2.3 Payments are UPI only', level=2)
    for s in [
        'Every payment in the application (student fees, hostel/transport charges, subscriptions) is made by UPI. Cash, cheque and card options do not exist.',
        'Parent/student: Portal → Fees → "Pay … via UPI" shows the institution\'s UPI QR code / UPI ID and the amount. Pay from any UPI app, then enter the 12-digit UTR / UPI reference and submit.',
        'The payment appears in Finance → UPI verifications as PENDING. The accountant matches the UTR with the bank statement and clicks Verify (invoice becomes paid and a receipt is issued) or Reject (with a reason; the parent can pay again).',
        'At the counter, the accountant uses Collect fee (UPI) and records the UPI reference of the payment received.',
        'Finance → UPI settings holds the institution\'s UPI ID (VPA), payee name and QR used on invoices.',
    ]:
        bullet(doc, s)
    doc.add_heading('2.4 Dashboard with date ranges', level=2)
    doc.add_paragraph('The workspace dashboard has an Overview panel. Choose Today, Yesterday, Tomorrow, This week, '
                      'This month, Last month or Custom (From/To + Apply). Cards show, for the selected range and '
                      'institution: fee collection, expenses, payroll and payouts, cash flow, total and present/'
                      'absent students and employees, employees on leave, hostel bed availability and transport '
                      'availability, plus a daily trend chart (ranges up to 62 days). Each card links to the detailed page. '
                      'Every role only sees the cards it has permission for (e.g. HR sees payroll and employees, '
                      'accountant sees fees, expenses, payroll and cash flow).')

    # ---------- 3. Role quick reference ----------
    page_break(doc)
    doc.add_heading('3. Roles and demo users', level=1)
    rows = []
    for key, d in roles:
        u = users.get(d['email'], {})
        rk = (d.get('roles') or [{}])
        rn = ', '.join(ROLE_INFO.get(r.get('key'), (r.get('key'),))[0] + ' (' + r.get('scopeName', '') + ')' for r in rk)
        ws = ', '.join(sorted({p['layout'] for p in d['pages'] if p['layout'] != 'home'}))
        rows.append((d['name'], d['email'], rn, ws))
    table(doc, ['Name', 'Login e-mail', 'Role (scope)', 'Workspaces'], rows, [1.3, 1.9, 2.3, 1.3])
    doc.add_paragraph('Password for all demo users: %s' % manifest.get('password', 'password123'))

    # ---------- 4. Per role ----------
    shown = {}  # signature -> (role title, page title)
    chapter = 4
    for key, d in roles:
        page_break(doc)
        rk = d.get('roles') or [{}]
        primary = ROLE_INFO.get(rk[0].get('key'), (rk[0].get('key', key), ''))
        doc.add_heading('%d. %s – %s' % (chapter, primary[0], d['name']), level=1)
        role_title = '%s (%s)' % (primary[0], d['email'])
        table(doc, ['', ''], [
            ('Login', '%s / %s' % (d['email'], manifest.get('password', 'password123'))),
            ('Role(s)', '; '.join('%s – scope: %s' % (ROLE_INFO.get(r.get('key'), (r.get('key'),))[0], r.get('scopeName', '')) for r in rk)),
            ('What this role does', ' '.join(ROLE_INFO.get(r.get('key'), ('', ''))[1] for r in rk)),
        ], [1.5, 5.2])

        by_layout = {}
        for p in d['pages']:
            by_layout.setdefault(p['layout'], []).append(p)
        doc.add_paragraph().add_run('Menus available to this role').bold = True
        mrows = []
        for lay, ps in by_layout.items():
            if lay == 'home':
                continue
            mrows.append((WORKSPACE_INFO.get(lay, lay), ', '.join(p['menu'] for p in ps)))
        if mrows:
            table(doc, ['Workspace', 'Menu items'], mrows, [1.8, 4.9])

        home = by_layout.get('home', [])
        if len(home) > 1:
            picture(doc, os.path.join(SRC, key, home[1]['shots'][0]['file']), width=6.0)
            caption(doc, 'Workspace chooser for %s' % d['name'])

        seen_suffix = {}
        sub = 0
        for lay, ps in by_layout.items():
            if lay == 'home':
                continue
            sub += 1
            doc.add_heading('%d.%d %s' % (chapter, sub, WORKSPACE_INFO.get(lay, lay)), level=2)
            for p in ps:
                sfx = suffix(lay, p['path'])
                if sfx in seen_suffix and sfx != '/':
                    doc.add_paragraph('%s – same screen and buttons as described above in %s.' % (p['menu'], seen_suffix[sfx]))
                    continue
                seen_suffix[sfx] = WORKSPACE_INFO.get(lay, lay)
                doc.add_heading(p['menu'], level=3)
                for shot in p['shots']:
                    btns = shot['buttons']
                    sig = (sfx, shot['title'], tuple(sorted({(clean(b['label']), b.get('icon') or '', b['where']) for b in btns if b['where'] != 'tab'})))
                    if shot['kind'] != 'page':
                        doc.add_paragraph().add_run(shot['title']).bold = True
                    if sig in shown and shot['kind'] in ('dialog', 'form'):
                        doc.add_paragraph('Same as shown for %s → %s.' % shown[sig])
                        continue
                    picture(doc, os.path.join(SRC, key, shot['file']))
                    caption(doc, '%s – %s (%s)' % (d['name'], shot['title'], p['path']))
                    shown.setdefault(sig, (role_title, p['menu']))
                    if shot.get('fields'):
                        doc.add_paragraph('Fields: ' + ', '.join(shot['fields']))
                    rows = []
                    seen_rows = set()
                    for b in btns:
                        if b['where'] == 'tab':
                            continue
                        name, what, when = describe(clean(b['label']), b.get('icon'))
                        k = (name, b['where'])
                        if k in seen_rows or name.lower() in ('sign out',):
                            continue
                        seen_rows.add(k)
                        if '(disabled)' in b['label']:
                            when = 'Shown but disabled right now (no data / condition not met). ' + when
                        rows.append((name, WHERE[b['where']], what, when))
                    tabs = [b['label'] for b in btns if b['where'] == 'tab']
                    if tabs and shot['kind'] == 'page':
                        doc.add_paragraph('Tabs on this page: ' + ', '.join(dict.fromkeys(clean(t) for t in tabs)))
                    if rows:
                        table(doc, ['Button', 'Where', 'What it does', 'When it is shown'], rows, [1.3, 0.9, 2.5, 2.0])
                    elif shot['kind'] == 'page':
                        doc.add_paragraph('View-only page for this role (no action buttons).')
        chapter += 1

    doc.save(OUT)
    print('saved', OUT, os.path.getsize(OUT) // 1024, 'KB')




# ---------------------------------------------------------------------------------------------
# Part 2: step-by-step workflows captured from the e2e suite (GUIDE_STEPS=<dir>).
# ---------------------------------------------------------------------------------------------

MODULE_NAMES = {
    'login': 'Login & sign-in', 'passwords': 'Passwords', 'users': 'Users & roles',
    'users-branding': 'Users & branding', 'admin-group': 'Group administration',
    'platform': 'Platform', 'platform-admin': 'Platform administration', 'subscription': 'Subscription & UPI billing',
    'licence': 'Licences & features', 'students': 'Students', 'admissions-actions': 'Admissions',
    'academics': 'Academics (classes, subjects, timetable)', 'education-depth': 'Academics in depth',
    'student-attendance': 'Student attendance', 'exams': 'Examinations & results', 'certificates': 'Certificates',
    'fees': 'Fees', 'fees-depth': 'Fees in depth (UPI, refunds, concessions)', 'finance': 'Finance & accounts',
    'hr': 'HR (employees, departments, designations)', 'hr-attendance': 'Employee attendance & regularization',
    'leave': 'Leave', 'leave-balances': 'Leave balances', 'payroll': 'Payroll', 'self-service': 'Employee self-service',
    'portal': 'Student / parent portal', 'hostel': 'Hostel', 'transport': 'Transport', 'library': 'Library',
    'assets': 'Assets', 'assets-lifecycle': 'Asset lifecycle', 'documents': 'Documents',
    'communication': 'Communication & messages', 'notifications-approvals': 'Notifications & approvals',
    'notification-links': 'Notification links', 'home-widgets': 'Home widgets', 'dashboard': 'Dashboard',
    'roles': 'Role access', 'education-roles': 'Education roles access', 'smoke-greenwood': 'Smoke test (all pages)',
    'company-acme': 'Company (non-school) tenant',
}
SKIP_MODULES = {'roles', 'education-roles', 'smoke-greenwood', 'licence', 'notification-links'}


def path_titles(src):
    titles = {}
    if not src or not os.path.isdir(src):
        return titles
    for k in os.listdir(src):
        f = os.path.join(src, k, 'pages.json')
        if os.path.exists(f):
            for p in json.load(open(f))['pages']:
                titles.setdefault(p['path'], (p['menu'], WORKSPACE_INFO.get(p['layout'], p['layout'])))
    return titles


def role_label(users, email):
    u = users.get(email or '', {})
    rk = (u.get('roles') or [{}])[0].get('key')
    name = ROLE_INFO.get(rk, (rk or 'User',))[0]
    return '%s – %s (%s)' % (name, u.get('name', ''), email) if email else 'User'


def stepp(doc, n, text):
    para = doc.add_paragraph()
    para.paragraph_format.left_indent = Inches(0.3)
    para.paragraph_format.first_line_indent = Inches(-0.3)
    para.add_run('%d.  ' % n).bold = True
    if text:
        para.add_run(text)
    return para


def build_workflows(steps_dir, out, manifest_path, crawl_dir=None):
    manifest = json.load(open(manifest_path))
    users = {u['email']: u for u in manifest['users']}
    titles = path_titles(crawl_dir)
    recs = [json.loads(l) for l in open(os.path.join(steps_dir, 'steps.jsonl')) if l.strip()]
    recs.sort(key=lambda r: (r.get('pid', 0), r.get('seq', 0)))
    tests = {}
    order = []
    for r in recs:
        if not r.get('testId'):
            continue
        k = r['testId']
        if k not in tests:
            tests[k] = {'file': r['file'], 'title': r['title'], 'steps': []}
            order.append(k)
        tests[k]['steps'].append(r)
    modules = {}
    for k in order:
        t = tests[k]
        res = [s for s in t['steps'] if s['action'] == 'result']
        if res and res[-1].get('status') not in ('passed', None):
            continue
        mod = os.path.basename(t['file']).replace('.spec.ts', '')
        if mod in SKIP_MODULES:
            continue
        modules.setdefault(mod, []).append(t)

    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.8)
    sec.top_margin = sec.bottom_margin = Inches(0.7)
    doc.styles['Normal'].font.name = 'Calibri'
    doc.styles['Normal'].font.size = Pt(10.5)
    for _ in range(6):
        doc.add_paragraph()
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run('Education ERP · HRMS · Payroll')
    r.bold = True
    r.font.size = Pt(30)
    r.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    t.add_run('Step-by-step workflows – create, edit, delete, apply, approve, reject, cancel, pay, verify').font.size = Pt(15)
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run('Every case below was performed live in the application by the named role. The button '
                  'clicked in each step is outlined in red in the screenshot.')
    r.italic = True
    page_break(doc)
    doc.add_heading('Contents', level=1)
    add_toc(doc)
    page_break(doc)
    doc.add_heading('How to read this guide', level=1)
    for s in [
        'Each chapter is a module (Leave, Fees, Hostel…). Each section is one case, performed by the role named in the heading – log in as that role to repeat it (demo password: %s).' % manifest.get('password', 'password123'),
        '"Open" steps tell you which menu page to go to; "Enter" and "Choose" steps fill the form; "Click" steps show a screenshot with the button outlined in red and explain what the button does.',
        'The "Result" screenshot shows what you should see after the case is completed.',
        'Values like "E2E-…" are sample data; enter your own real values.',
    ]:
        bullet(doc, s)

    ch = 0
    for mod in sorted(modules, key=lambda m: MODULE_NAMES.get(m, m)):
        cases = modules[mod]
        ch += 1
        page_break(doc)
        doc.add_heading('%d. %s' % (ch, MODULE_NAMES.get(mod, mod.replace('-', ' ').title())), level=1)
        doc.add_paragraph('Cases in this chapter:')
        for i, c in enumerate(cases, 1):
            email = next((s.get('user') for s in c['steps'] if s.get('user')), None)
            bullet(doc, '%s  (%s)' % (c['title'][-1], role_label(users, email).split(' – ')[0]), '%d.%d ' % (ch, i))
        for i, c in enumerate(cases, 1):
            email = next((s.get('user') for s in c['steps'] if s.get('user')), None)
            doc.add_heading('%d.%d %s' % (ch, i, c['title'][-1][:1].upper() + c['title'][-1][1:]), level=2)
            p = doc.add_paragraph()
            p.add_run('Performed by: ').bold = True
            p.add_run(role_label(users, email))
            if len(c['title']) > 1:
                p = doc.add_paragraph()
                p.add_run('Scenario: ').bold = True
                p.add_run(' › '.join(c['title'][:-1]))
            n = 0
            pending_open = None
            last_shot_text = None
            for s in c['steps']:
                a = s['action']
                if a == 'open':
                    pending_open = s.get('text')
                    continue
                if a == 'select':
                    n += 1
                    fld = pending_open or 'the list'
                    stepp(doc, n, 'Choose "%s" in %s.' % (s.get('text', '')[:70], fld))
                    pending_open = None
                    continue
                if a == 'nav':
                    menu, ws = titles.get(s['path'], (s['path'], ''))
                    n += 1
                    stepp(doc, n, 'Open %s%s.' % (menu, (' in the ' + ws) if ws else ''))
                    continue
                if a == 'fill':
                    n += 1
                    stepp(doc, n, 'Enter "%s" in %s.' % (s.get('value', ''), s.get('text') or 'the field'))
                    continue
                if a == 'check':
                    n += 1
                    stepp(doc, n, 'Tick %s.' % (s.get('text') or 'the checkbox'))
                    continue
                if a == 'upload':
                    n += 1
                    stepp(doc, n, 'Choose the file to upload.')
                    continue
                if a == 'click':
                    label, what, _ = describe(clean(s.get('text', '')), s.get('icon'))
                    where = ''
                    if s.get('dialog'):
                        where = ' in the "%s" dialog' % s['dialog']
                    elif s.get('row'):
                        where = ' on the row "%s"' % s['row']
                    n += 1
                    para = stepp(doc, n, '')
                    para.add_run('Click ')
                    para.add_run(label).bold = True
                    para.add_run(where + '. ')
                    if not what.startswith('Opens / performs') and not what.startswith('Switches'):
                        r = para.add_run(what)
                        r.italic = True
                    key = (label, s.get('path'), s.get('dialog'))
                    if key != last_shot_text and os.path.exists(os.path.join(steps_dir, s['shot'])):
                        picture(doc, os.path.join(steps_dir, s['shot']), width=5.6)
                    last_shot_text = key
                    continue
                if a == 'result' and os.path.exists(os.path.join(steps_dir, s.get('shot', ''))):
                    doc.add_paragraph().add_run('Result').bold = True
                    picture(doc, os.path.join(steps_dir, s['shot']), width=5.6)
    doc.save(out)
    print('saved', out, os.path.getsize(out) // 1024, 'KB', sum(len(v) for v in modules.values()), 'cases')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'workflows':
        # build_guide.py workflows <steps_dir> <out.docx> <manifest> [crawl_dir]
        build_workflows(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        main()
