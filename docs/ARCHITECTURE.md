# Architecture & Conventions

This document records the **binding technical decisions** for the Education ERP + HRMS +
Payroll SaaS. Every layer of the foundation stack (and every later feature) must follow it.
The product specification lives in [`SPEC.md`](./SPEC.md).

## 1. Repository layout

pnpm workspace monorepo:

| Path              | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/api`        | Node.js + TypeScript (strict) + Express 5 modular monolith                |
| `apps/web`        | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vuetify 3                |
| `packages/shared` | Shared TypeScript types and **zod** schemas (request DTOs, API envelopes) |
| `docs/`           | Spec (`SPEC.md`) and this architecture guide                              |

Runtime: **Node 22 LTS** (`.nvmrc`; satisfies the "Node 20+" requirement — Node 20 is EOL and
pnpm 11 requires ≥ 22.13). Package manager: **pnpm** (version pinned via `packageManager`).

## 2. Backend (apps/api)

```
apps/api/
  prisma/schema.prisma        # single Prisma schema (MySQL 8)
  prisma/migrations/          # committed SQL migrations (prisma migrate)
  prisma/seed.ts|seed-data.ts # idempotent demo seed
  src/
    app.ts                    # createApp(deps) — composable for tests
    server.ts                 # process entrypoint, graceful shutdown
    core/                     # shared platform engines
      config/env.ts           # zod-validated environment
      logger/                 # pino
      http/                   # errors, error handler, request id, validation, pagination
      db/prisma.ts            # BASE (unscoped) Prisma client — core only
      tenancy/                # Multi-Tenant Engine
      queue/                  # Redis (ioredis) + BullMQ wiring
    modules/<module>/         # feature modules
      <module>.routes.ts      # Express router: parse input → call service → envelope
      <module>.service.ts     # business rules, parent/reference validation
      <module>.repository.ts  # data access via tenantDb() only
  test/                       # integration tests (*.int.test.ts) against MySQL
```

- **Modular monolith.** Modules talk to each other through exported services/repositories,
  never by reaching into another module's tables ad hoc. Keep boundaries extractable.
- **Shared engines** (tenancy, auth, audit, workflow, notifications, storage, …) live in
  `src/core/<engine>` and are consumed by modules.
- **Validation:** every request body/query/params is parsed with a zod schema from
  `@erp/shared` via `parseInput()`. Request schemas are `.strict()` — unknown keys are 400s.
- **Errors:** throw `AppError` subclasses (`NotFoundError`, `ConflictError`,
  `InvalidReferenceError`, …). The central error handler produces
  `{ error: { code, message, requestId, details? } }`. Prisma `P2002` → 409, `P2025` → 404.
  5xx messages are never leaked.
- **Responses:** `{ data }` for single resources, `{ data, meta: { page, pageSize, total } }`
  for lists. `POST` → 201, `DELETE` → 204.
- **Routes:** versioned under `/api/v1`, kebab-case plural nouns (`/class-sections`).
  Health: `GET /health` (liveness), `GET /health/ready` (DB readiness).
- **Request id:** `X-Request-Id` is accepted if well-formed, otherwise generated; echoed in
  the response header, logs and error bodies.
- **Logging:** pino / pino-http. Secrets & auth headers are redacted. Logs carry
  `organizationId` once the tenant is resolved.
- **Config:** add every new env var to `core/config/env.ts` (zod) **and** `.env.example`.
  Never commit secrets.

## 3. Database

- **MySQL 8** via **Prisma ORM**; schema changes only through `prisma migrate dev` with the
  generated SQL committed.
- **IDs:** UUID v4 strings stored as `CHAR(36)` (`@default(uuid()) @db.Char(36)`) everywhere.
- **Naming:** tables and columns are `snake_case` (`@@map`/`@map`); Prisma fields camelCase.
- **Timestamps:** `created_at`, `updated_at` (`DATETIME(3)`) on every table.
- **Soft delete:** business tables have `deleted_at`. The tenant client hides soft-deleted
  rows unless a query filters on `deletedAt` explicitly. Unique keys include soft-deleted rows.
- **Tenant columns:** every tenant-owned table carries `organization_id` plus the relevant
  hierarchy FKs (e.g. class sections carry institution, department, program, campus) and
  composite indexes starting with `organization_id`.
- **Referential integrity:** FKs use `onDelete: Restrict`; services refuse to soft-delete
  parents that still have live children (409).

## 4. Multi-Tenant Engine (`src/core/tenancy`)

Hierarchy: **Platform → Organization (tenant) → Group? → Institution → Campus → Department →
Program → Class/Section**.

- An **organization** is the SaaS tenant root: an education group (ABBS, BCC), a society, or
  an independent institution (JP College). Institutions have a nullable `group_id`.
- Isolation boundary = `organization_id`. Finer-grained scopes (group / institution /
  department assignments) are enforced by the authorization engine (Layer 2).

Components:

| Piece                               | Responsibility                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TenantContext` (AsyncLocalStorage) | `runWithTenant()`, `getTenantContext()`, `currentOrganizationId()`. Frozen; nested tenant switching throws.                                                                                                                                                                                      |
| `TenantResolver`                    | Resolves the tenant **server-side** per request. Layer 1: `dev-header` stub (`X-Dev-Organization`, dev/test only, rejected in production) or `none` (deny all). Layer 2 replaces it with a principal (JWT)-based resolver.                                                                       |
| `tenantContext()` middleware        | Runs resolver, verifies org exists & is `ACTIVE`, runs the request inside the context. 401 `TENANT_UNRESOLVED` / 403 `TENANT_INACTIVE`.                                                                                                                                                          |
| `rejectClientTenantIdentifiers`     | 400 if body/query contain `organizationId`/`tenantId` (defense in depth).                                                                                                                                                                                                                        |
| `tenantDb()` (Prisma extension)     | Tenant-scoped client: filters all reads/updates/deletes by `organization_id` (+ soft delete), stamps creates, throws `TenantIsolationError` on cross-tenant filters/writes, nested relation writes, raw SQL, or unregistered models. `Organization` is read-only and limited to the current org. |
| `tenant-models.ts`                  | Registry of tenant-scoped / global / soft-delete models. A unit test fails if a model with `organizationId` is not registered.                                                                                                                                                                   |

Rules for all modules:

1. **Never** import `core/db/prisma` (the unscoped client) from `src/modules/**` — ESLint
   enforces this. Use `tenantDb()` and `withTenant(data)` for creates.
2. **Never** accept tenant or hierarchy-owner ids from the client for authorization. Parent
   references in payloads (e.g. `institutionId`) must be **looked up through `tenantDb()`**
   and rejected with `InvalidReferenceError` (422) if not visible. Derive denormalized
   hierarchy FKs from the verified parent server-side.
3. Use **scalar foreign keys**, not nested relation writes (`connect`/`create`), on tenant
   models — the extension rejects nested writes.
4. Register every new model in `tenant-models.ts` (tenant-scoped or global).
5. Background jobs carry `organizationId` in their payload and run inside
   `runWithTenant({ organizationId, source: 'system' }, …)`.
6. Platform-level (cross-tenant) operations live in core/platform code using the base client
   with explicit authorization and audit logging.

## 5. Queues & cache

Redis via **ioredis** and **BullMQ** (`src/core/queue`). Layer 1 only wires configuration
(`REDIS_URL`, `QUEUE_PREFIX`, `createQueue()`); connections are lazy.

## 6. Frontend (apps/web)

- Vue 3 `<script setup lang="ts">`, Pinia stores, Vue Router, Vuetify 3 (auto-import).
- Layout shells: `PlatformLayout`, `GroupLayout`, `InstitutionLayout`, `EmployeeLayout`
  (Student/Parent/Teacher layouts come later). Sidebar menus are data-driven
  (`src/navigation/menus.ts`) and filtered by permission codes.
- API calls go through `src/api/client.ts`. In dev the selected demo organization is sent as
  `X-Dev-Organization`; this is replaced by auth tokens in Layer 2. The server is always the
  authority on tenant and permissions.
- Shared DTO types/schemas come from `@erp/shared`.

## 7. Testing & quality

- **Vitest** everywhere; **supertest** for HTTP. API has two projects:
  - `unit` (`src/**/*.test.ts`) — no database required.
  - `integration` (`test/**/*.int.test.ts`) — runs against `TEST_DATABASE_URL`, which is
    **reset** (`prisma migrate reset`) before the run. Skipped locally when unset; required in CI.
- Every module must have isolation tests proving another tenant cannot read/write its data.
- **ESLint** (flat config, typescript-eslint, eslint-plugin-vue) + **Prettier**.
- **CI** (GitHub Actions): install → lint → format check → typecheck → test (MySQL 8.4
  service container) → build.

## 8. Foundation stack

1. Scaffold + multi-tenancy engine + group/institution hierarchy
2. Auth (JWT access/refresh, TOTP MFA, sessions, login history) + RBAC + scope authz + users + audit
3. Module licensing / subscriptions + branding + secret management
4. Cloud file storage + document management
5. Workflow + notification engines + integration framework
6. HR employee master
7. Attendance / leave / holiday / shift
8. Payroll rule engine
