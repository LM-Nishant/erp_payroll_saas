# Education ERP + HRMS + Payroll SaaS

Multi-tenant SaaS platform for schools, colleges, universities and multi-institution
education groups. See [`docs/SPEC.md`](docs/SPEC.md) for the product specification and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for binding technical conventions.

## Stack

- **API:** Node 22, TypeScript, Express 5, Prisma (MySQL 8), zod, pino, Redis/BullMQ
- **Web:** Vue 3, Vite, Pinia, Vue Router, Vuetify 3
- **Shared:** `@erp/shared` zod schemas & types
- **Tooling:** pnpm workspaces, Vitest + supertest, ESLint + Prettier, GitHub Actions

## Prerequisites

- Node.js 22.13+ (`nvm use`)
- pnpm (`corepack enable` — version pinned in `package.json`)
- MySQL 8 and Redis — via Docker (`docker compose up -d`) or local installs

## Setup

```bash
pnpm install
docker compose up -d                  # MySQL 8.4 on :3306 (erp/erp), Redis on :6379
cp .env.example apps/api/.env         # adjust if your DB credentials differ
pnpm db:migrate                       # apply Prisma migrations to DATABASE_URL
pnpm db:seed                          # demo orgs (ABBS, BCC, JP College), roles, users
pnpm dev:api                          # http://localhost:3000
pnpm dev:web                          # http://localhost:5173 (proxies /api to :3000)
```

Without Docker, create a MySQL user that can create databases (Prisma needs a shadow DB for
`migrate dev` and the integration tests reset `erp_test`), and point `DATABASE_URL` /
`TEST_DATABASE_URL` at it.

## Scripts

| Command           | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `pnpm lint`       | ESLint (zero warnings)                                     |
| `pnpm format`     | Prettier write (`format:check` in CI)                      |
| `pnpm typecheck`  | `tsc` / `vue-tsc` across all packages                      |
| `pnpm test`       | All tests (API integration tests need `TEST_DATABASE_URL`) |
| `pnpm test:unit`  | Unit tests only — no database required                     |
| `pnpm build`      | Build all apps                                             |
| `pnpm db:migrate` | `prisma migrate dev` (create/apply migrations)             |
| `pnpm db:deploy`  | `prisma migrate deploy` (CI/production)                    |
| `pnpm db:seed`    | Seed demo hierarchy, default roles and users (idempotent)  |

> ⚠️ The integration suite **resets** the database in `TEST_DATABASE_URL` (the URL must
> contain `test`). Never point it at a real database.

## Trying the API

`pnpm db:seed` creates demo users (password `Demo-Passw0rd!`, override with
`SEED_DEMO_PASSWORD`; the default is refused in production):

| Email                   | Role (scope)                                        |
| ----------------------- | --------------------------------------------------- |
| `platform@erp.test`     | Platform Super Admin (no tenant access by default)  |
| `owner@abbs.test`       | Group Owner — ABBS (organization-wide)              |
| `group.admin@abbs.test` | Group Admin — ABBS Group (all 4 ABBS colleges)      |
| `eng.admin@abbs.test`   | Institution Admin — ABBS College of Engineering     |
| `cse.hod@abbs.test`     | HOD — CSE department of ABBS College of Engineering |
| `admin@bcc.test`        | Group Admin — BCC Group                             |
| `admin@jp-college.test` | Institution Owner — JP College                      |

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"group.admin@abbs.test","password":"Demo-Passw0rd!"}' | jq -r .data.accessToken)
curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/me
curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/institutions   # 4 ABBS colleges
curl localhost:3000/health/ready
```

The web app (`pnpm dev:web`) has a login page (with the MFA step) and a permission-driven
sidebar.

**Creating an organization (tenant):** sign in as `platform@erp.test` and go to
**Organizations → New organization**. Enter the name, slug, plan, trial or active status and the
first owner. Roles and the subscription are provisioned automatically, and the owner gets an invite
e-mail (with `MAIL_DRIVER=log` the link appears in the API log). On the organization page you can
rename, suspend, activate or archive it, invite more owners, and configure the plan, add-on
modules and limit overrides. The API equivalent is `POST /api/v1/platform/organizations`.

With `TENANT_RESOLVER=dev-header` (dev/test only, refused in production) a request without a
token may send `X-Dev-Organization: <slug>` and acts as an all-permissions dev principal.

Endpoints (under `/api/v1`):

- `auth/*` — login, MFA verify, refresh, logout, sessions, login history, MFA enrollment,
  password change/reset, invite acceptance. `me` — current user, roles, scopes, permissions.
- Tenant hierarchy: `organization`, `groups`, `institutions`, `campuses`, `departments`,
  `programs`, `class-sections` (list/get/create/patch/soft delete, scope-filtered).
- `users`, `roles`, `permissions`, `audit-logs`; `platform/*` for platform admins.

## Foundation status (layers 1–8)

The foundation was built as an 8-PR stack:

1. Scaffold, multi-tenancy engine (`tenantDb()` / `withTenant()`), group → institution → campus →
   department hierarchy.
2. Auth (JWT + refresh, TOTP MFA, sessions), RBAC with scoped grants, users, audit log.
3. Module licensing / subscriptions, branding, secret management.
4. Cloud file storage, document management, PDF engine.
5. Queue, workflow, notification and communication engines, integrations (API clients,
   webhooks).
6. HR employee master: lifecycle, transfers, effective-dated assignments, salary history.
7. Attendance, leave, holidays and shifts, including the payroll attendance feed and period
   locks.
8. Payroll rule engine. This covers:
   - salary components, rules and structures, with a safe formula evaluator and dependency
     graph;
   - India statutory packs (PF, ESI, PT, TDS, LWF);
   - payroll runs and group batches with maker-checker approval, DB-enforced locking and
     audited reopen;
   - revisions with arrears, loans and reimbursements;
   - branded payslips and Form 16;
   - payroll reports (CSV, Excel, PDF) and the group consolidated summary.

**Acceptance criteria (§65) covered by the foundation:**

- multi-tenant isolation;
- group/institution hierarchy and scoped roles;
- module licensing and branding;
- employee master with history;
- attendance, leave and holiday;
- separate salary policies per institution (7);
- salary revisions with preserved history and arrears (10);
- payroll computed from attendance/LOP (11–13);
- locked payroll and audited reopen (14–15);
- branded payslips with employee self-access (16–17);
- Form 16 publication (18);
- workflow approvals, notifications, documents, audit, and API/webhooks;
- student master, guardian/parent login links and admissions pipeline;
- library: catalogue, copies/barcodes, circulation, reservations, fines, OPAC and portal
  “My library” (demo data: `node scripts/demo/seed-library.mjs`, see ARCHITECTURE §17).

**Remaining (future work per §67):**

- education modules still to expand: academics, fees, exams, timetable, transport,
  hostel, LMS;
- asset management;
- the AI gateway;
- the generic reporting/BI engine;
- the mobile app;
- real Form 16 generation (currently a placeholder PDF);
- full income-tax declarations and proofs;
- bank-specific payment file formats.

## AI assistant (demo)

The `ai` module works out of the box with a deterministic **mock** provider (no keys needed).
Seed demo AI settings and conversations against a running API with
`API_URL=http://127.0.0.1:3100 node scripts/demo/seed-ai.mjs`. To use OpenAI / Azure OpenAI / any
OpenAI-compatible endpoint, add a secret of kind `ai.openai` (value = API key, optional metadata
`{"model":"gpt-4o-mini","baseUrl":"…"}`) on the Secrets page, then set provider `openai` and enable
data sharing on **AI settings**. See docs/ARCHITECTURE.md §16.
