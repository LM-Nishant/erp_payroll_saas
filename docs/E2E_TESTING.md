# Frontend end-to-end tests (Playwright)

The `apps/e2e` package drives the real web UI in Chromium against a running API + web stack and
the demo dataset. Every check signs in through the login form as a demo user (password
`password123`, see [DEMO_ACCOUNTS.md](DEMO_ACCOUNTS.md)) and records every `/api/` response, so
tests assert both what the screen shows and what the API answered.

## Prerequisites

1. Dependencies: `pnpm install`, then `pnpm --filter @erp/e2e exec playwright install chromium`.
2. Servers running (the suite never starts them): API on `:3100` and web on `:5180`
   (`pnpm dev:api`, `pnpm dev:web`; the web dev server proxies `/api` to the API).
3. Demo data: a database seeded by `pnpm demo:seed` (7 organizations, ~56 users, every password
   `password123`). The seed writes `scripts/demo/demo-manifest.json`, which drives the suite. A
   fresh `pnpm demo:seed -- --reset` is only needed for a brand-new database — the suite is
   repeatable on an already-seeded (even demo-in-use) database: every flow creates uniquely named,
   timestamped records and undoes the changes that would alter the demo (payroll run reopened +
   cancelled, attendance month unlocked, new leave policy deactivated, hostel bed vacated,
   branding restored).

## Running

```bash
pnpm test:e2e                                    # whole suite (HTML report in apps/e2e/playwright-report)
pnpm test:e2e -- tests/modules/payroll.spec.ts   # one spec
pnpm test:e2e -- tests/modules/hr.spec.ts:92     # one test (file:line)
pnpm test:e2e -- --grep "sunrise"                # by title
pnpm --filter @erp/e2e e2e:report                # open the last HTML report
```

| Variable       | Default                           | Purpose                      |
| -------------- | --------------------------------- | ---------------------------- |
| `E2E_BASE_URL` | `http://localhost:5180`           | Web app under test           |
| `E2E_WORKERS`  | `2`                               | Parallel workers             |
| `E2E_MANIFEST` | `scripts/demo/demo-manifest.json` | Demo manifest to read        |
| `E2E_PASSWORD` | `password123`                     | Password for every demo user |

Notes:

- Run one Playwright process at a time. Module flows mutate the shared demo database (each spec
  file is serial and uses unique, timestamped names, so files are repeatable without re-seeding).
- Logins are rate-limited (20/min per IP); the login helper waits and retries on `429`. Each
  `describe` block signs in once and reuses the page, so keep `E2E_WORKERS` at 1–2. A full run
  (≈390 tests) takes roughly 40–60 minutes with 2 workers.
- Attendance punching requires a selfie face match in the demo institutions, so the self-service
  test asserts that the selfie step is requested; it never punches without one.
- The payroll flow runs the Greenwood month two months before today (a closed period) and finishes
  by reopening/cancelling what it created and unlocking the attendance month. If it is interrupted
  mid-flow, run `node apps/e2e/scripts/cancel-payroll-run.mjs` (API helper that cancels a leftover
  `E2E run …` for that month) and unlock the month under HR › Attendance › Period locks.
- Artifacts (`test-results/`, `playwright-report/`) are git-ignored.

## Layout and adding cases

- `src/manifest.ts` loads the manifest and computes each user's expected workspaces and menus
  from `apps/web/src/navigation/menus.ts`, so licensing/role expectations are never hard-coded.
- `src/app.ts` – `AppSession` (login, router navigation, `settle()`, API call recorder, error
  alerts). `src/session.ts` – `signedIn(email)`: one sign-in shared by a `describe` block.
- `src/ui.ts` – Vuetify helpers: `dialog`, `fill`, `pick`, `saveDialog`, `rows`, `expectRow`,
  `expectClean` (no error alert and no failed API call since a mark), `expectDownload`,
  `expectSignedPdf`, `uniq`.

To add a functional case, add a `test` to the module's spec in `tests/modules/` (or a new
`<module>.spec.ts`) signed in as the role that owns the function:

```ts
test.describe('Library · librarian@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('librarian@greenwood.demo');
  test('creates a title', async () => {
    const s = session();
    await s.go('/institution/library/catalogue');
    const mark = s.mark();
    // … drive the UI with fill/pick/saveDialog, then expectRow(s.page, name)
    await expectClean(s, mark, 'title create');
  });
});
```

New users or organizations added to the demo seed are picked up automatically by the per-user
matrix. Fix genuine app bugs rather than weakening a test; mark a real product gap with
`test.fixme` and a reason.

## Known fixmes (product gaps)

| Spec                    | Test                                                 | Reason                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/communication` | composes and sends an announcement to a class        | No announcement / broadcast composer in the app (the API has `/communication/campaigns`, the UI only manages providers, templates and the log).                |
| `modules/leave`         | student applies leave and the class teacher approves | No student leave model, API or page — only staff leave exists.                                                                                                 |
| `modules/self-service`  | punches in with a matching selfie                    | Face match is ON in the demo attendance policies and only a face descriptor computed from a live camera frame is sent; headless Chromium has no face to match. |

## Coverage matrix

Per-user checks (`users.spec.ts`, every one of the 56 manifest users, including the platform
operators): login lands on the expected workspaces → each workspace menu equals the expected
licensed + permitted menu → every visible menu page opens with no error alert, 4xx/5xx or
`FEATURE_DISABLED` → every page of an unlicensed module is blocked when opened by URL.

| Organization (plan / status)                                     | Users                                    | Licence focus                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Greenwood (enterprise, main + branch)                            | all roles                                | every module visible; module smoke + all functional flows                         |
| Sunrise (starter)                                                | teacher, owner, admin, student, parent … | only education/documents/communication; HR/payroll/finance/transport URLs blocked |
| Acme (company, starter + HR/payroll add-ons, communication off)  | owner, HR, payroll, employee …           | no students/academics/communication; students URL blocked                         |
| Brightway (professional + WhatsApp, AI off, hostel off at South) | owner, hostel manager, student …         | no AI; South hostel writes blocked by API and surfaced                            |
| Lakeside (starter, PAST_DUE)                                     | owner …                                  | payment-overdue banner, modules still work                                        |
| Maple (professional, TRIAL)                                      | owner …                                  | trial banner with end date                                                        |
| Oldtown (CANCELLED)                                              | owner …                                  | cancelled banner, no licensed modules                                             |
| Platform                                                         | superadmin, support                      | platform console; support is read-only                                            |

Named scenario specs: `login` (wrong password, unknown e-mail, sign-in/sign-out, signed-out redirect), `licence` (menu +
direct-URL + API-level blocks), `roles` (key pages per role and a forbidden page each),
`subscription` (ACTIVE / PAST_DUE / TRIAL / CANCELLED), `smoke-greenwood` (seeded rows on every
module's main list), `education-roles` (every user of an education-licensed org: each
education page its roles permit opens cleanly, every other one is blocked by URL, and
create/manage buttons show only when permitted — expectations come from `DEFAULT_TENANT_ROLES`;
warm the Vite dev server with one pass first, a cold server reloads pages mid-test).

Functional flows (`tests/modules/`, Greenwood):

| Spec               | Actors                                    | Flow                                                                                                         |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| academics          | principal                                 | class + sections, extra section, subject, subject-teacher allocation, timetable cell                         |
| students           | registrar                                 | admission apply → review → approve → enroll; student create/edit/profile                                     |
| admissions-actions | principal                                 | per-status action buttons; reject → reopen → approve → enroll (class picker) → view student; reject → delete |
| student-attendance | teacher, student                          | mark a section with an absentee, register read-back, student view                                            |
| exams              | principal, teacher, student               | term + paper, marks entry + lock, compute + publish, report card PDF, student result                         |
| leave              | employee, HR                              | apply ×2 → approve / reject → outcomes → cancel; student leave is `fixme`                                    |
| fees               | admin, accountant, student, parent        | fee head + structure, generate invoices, part payment, receipt PDF, portal fees                              |
| hostel             | hostel manager, warden                    | hostel, room, mess plan, allocate, out-pass, complaint, vacate                                               |
| library            | librarian, student                        | title + copies, labels PDF, issue, return, fines/reports, OPAC                                               |
| transport          | transport manager                         | vehicle, driver, route + stops, fare slab, allocate, end allocation                                          |
| hr                 | HR, admin, owner                          | department, designation, employee type, shift, holiday, leave type, employee create/edit                     |
| payroll            | HR, payroll, finance, group finance/admin | component, structure, salary (PF opt-out), revision, run maker-checker → finalize, payslip, Form 16, reopen  |
| finance            | owner, accountant, finance manager        | account, voucher post/cancel, vendor, expense, trial balance export, ledger                                  |
| assets             | assets manager, employee                  | asset, QR label PDF, check-out/in, maintenance, register labels, My assets                                   |
| documents          | registrar, employee                       | upload, signed download, new version, delete; employee read-only                                             |
| communication      | owner                                     | e-mail template, preview, publish version, logs; announcement composer is `fixme`                            |
| users-branding     | owner, admin, new user                    | add user with role, new user signs in, change role, deactivate; branding update + restore                    |
| platform           | superadmin, support                       | create org, add-on, invoice + PDF + mark paid, plan, invoices/billing, archive; support read-only            |
| self-service       | employee, student, parent                 | profile, salary PDF, payslip PDF, selfie punch prompt; portal profile/timetable/results/fees                 |
| hr-attendance      | employee, HR, owner                       | regularization request → approve / reject → register override; mark absent + restore; policy; lock/unlock    |
| leave-balances     | HR, employee                              | balances & ledger lookup, +1 / −1 adjustment; employee blocked from the HR leave register                    |
| home-widgets       | employee, HR (Greenwood + Acme), student  | home / HR dashboard highlights (holidays, leave, birthdays, anniversaries, joiners) match the API            |
| company-acme       | Acme owner, HR, employee                  | company terminology, no education, branch, department, employee type, designation, employee in branch, photo |
