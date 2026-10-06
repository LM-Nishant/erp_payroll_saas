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
  department assignments) are enforced by the authorization engine (§5).

Components:

| Piece                               | Responsibility                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TenantContext` (AsyncLocalStorage) | `runWithTenant()`, `getTenantContext()`, `currentOrganizationId()`. Frozen; nested tenant switching throws.                                                                                                                                                                                      |
| `TenantResolver`                    | Resolves the tenant **server-side** per request. `jwt` (default): the organization bound to the authenticated session. `dev-header` (dev/test only, rejected in production): jwt, else `X-Dev-Organization`. `none`: deny all.                                                                   |
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
6. Platform-level (cross-tenant) operations live in `core/platform` using the base client
   with explicit authorization and audit logging (`runAsPlatform`, §5.4).

## 5. Authentication, authorization & audit

### 5.1 Identity & authentication (`src/core/auth`, `src/modules/auth`)

- **Users are platform-level identities** (`users`, global model, unique email). Tenant access
  comes from `organization_memberships` (INVITED / ACTIVE / DISABLED). Platform roles
  (`platform_super_admin`, `platform_support_admin`) are `platform_role_assignments`, defined
  in code (`core/authz/default-roles.ts`), never per tenant.
- Passwords: **argon2id** (`core/auth/password.ts`); policy shared with the web in
  `@erp/shared` (`passwordPolicyViolations`: 12+ chars, 3 character classes, no email name).
- Login → short-lived **JWT access token** (HS256 via `jose`, `ACCESS_TOKEN_TTL_SECONDS`,
  claims: `sub`, `sid`, `org`) + opaque **refresh token** stored only as a SHA-256 hash.
  Each login creates an `auth_sessions` row (device/IP/user agent). Refresh **rotates** the
  token; presenting a rotated token again is treated as theft → the whole session is revoked
  (`REFRESH_TOKEN_REUSED`, audited). Every request re-checks the session is not revoked, so
  logout / revoke / deactivation / password change take effect immediately.
- The browser uses `tokenDelivery: 'cookie'`: the refresh token is an httpOnly,
  `SameSite=Strict` cookie scoped to `/api/v1/auth`; the access token lives in memory only.
- `login_events` records every attempt (ip, user agent, success, failure reason). After
  `AUTH_MAX_FAILED_LOGINS` failures the account is locked for `AUTH_LOCKOUT_MINUTES` (423).
  Public auth endpoints are rate limited per IP (429, `RateLimitStore` — in-memory by
  default; swap for Redis when running several API instances).
- **MFA (TOTP, RFC 6238)**: enroll → activate with a code → 10 single-use recovery codes
  (hashed). Login then returns `{ mfaRequired, mfaToken }` to exchange at `/auth/mfa/verify`.
  TOTP secrets are AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`); codes cannot be replayed.
- Invite / password-reset tokens are single-use and hashed (`user_tokens`). **Until the
  notification engine (Layer 5) exists the API returns them in the response**; Layer 5 must
  deliver them by email and stop returning them.
- A session is bound to one organization. Users in several organizations pick one at login
  (`organization` slug; 409 `ORGANIZATION_SELECTION_REQUIRED` lists the choices).

### 5.2 Authorization: permissions + scopes (`src/core/authz`)

- **Permissions** are declared in `@erp/shared` → `PERMISSIONS` (`<resource>.<action>`, e.g.
  `payroll.approve`; `platform.*` are platform-only). The catalog is synced into the
  `permissions` table at startup (`syncPermissionCatalog`). Default tenant roles (spec §3)
  live in `core/authz/default-roles.ts` and are provisioned per organization by
  `provisionOrganizationRoles(orgId)` (call it when creating an organization).
  **Adding a permission in a later layer** = add it to `PERMISSIONS` + to the relevant
  default roles; existing organizations pick it up on the next provisioning run.
- **Roles** (`roles`, `role_permissions`) are per tenant; system roles are read-only, custom
  roles may only contain permissions their editor holds organization-wide.
- **Assignments**: `user_roles` + `user_scopes`. Each role assignment has ≥1 scope:
  `ORGANIZATION`, `GROUP`, `INSTITUTION`, `CAMPUS`, `DEPARTMENT` (FKs to the hierarchy;
  `PLATFORM` is a platform role assignment). A permission applies only within the scopes
  of the role that grants it. Group scopes cover every institution in the group; campus
  scopes cover their departments; department scopes do **not** grant their institution.
- A `Principal` (user, roles, grants, platform permissions, session) is built per request by
  `principalContext()` and available through `currentPrincipal()`.
- Assigning roles is checked for **privilege escalation**: the assigner needs
  `user.role.assign` and every permission of the role, covering each target scope.

**How modules use it** (the hierarchy modules are the reference implementation):

```ts
// routes: coarse check (permission held in at least one scope)
router.get('/', requirePermission('department.view'), handler);
// optional: requirePermission('x.update', (req) => resourceScopeOf(req)) for fixed resources

// service — lists: filter by the caller's scopes
const scope = await scopeWhere(currentPrincipal(), 'department.view', 'department');
repo.list({ ...filters, scope }); // repository: where = andScope(where, scope)

// service — reads: out-of-scope looks like not found (no existence leak)
if (!(await can(principal, 'department.view', hierarchyResource.department(row))))
  throw new NotFoundError('Department');

// service — writes: authorize against the existing row AND the destination parent
await authorize(principal, 'department.update', hierarchyResource.department(before));
```

- Every tenant-owned record of a later layer that belongs to the hierarchy must carry the
  relevant hierarchy FKs (`institution_id`, `department_id`, …) so it can be scoped. Add the
  model to `ScopedModel`/`COLUMNS` in `engine.ts` (or build the `where` from
  `accessFor()`), and a `hierarchyResource` helper.
- Organization-wide resources (roles, audit logs, settings) use `authorize(p, perm, {})`,
  which only an `ORGANIZATION`-scoped grant satisfies.
- The web menu and route guards use `GET /api/v1/me` (`permissions`, `roles[].scopes`);
  they are convenience only — the API is always authoritative.

### 5.3 Audit engine (`src/core/audit`)

- `audit_logs` is **append-only**: no update/delete API, and DB triggers reject UPDATE and
  DELETE. Rows hold organization, actor (user + actor type), action, entity type/id,
  before/after **diff** (changed keys only), reason, metadata, ip, user agent, request id.
- Sensitive keys (password, hash, secret, token, otp, api key, bank account, …) are
  redacted automatically (`redact.ts`) — still never pass raw secrets.
- Call `audit.record({ action: '<entity>.<verb>', entityType, entityId, before, after })` for
  **every mutation** of business data and every security event. Actor, organization, IP,
  user agent and request id come from the request context. Audit writes run after the
  mutation (not in the same transaction) and failures propagate as errors.
- Already audited automatically: login success and lockout (every attempt, incl. failures,
  is in `login_events`), MFA changes, refresh-token
  reuse, password change/reset, user create/update/(de)activate, role & scope changes, role
  edits, hierarchy create/update/delete, platform tenant access.
- Read via `GET /api/v1/audit-logs` (organization-wide `audit.view`) and
  `GET /api/v1/platform/audit-logs` (`platform.audit.view`).

### 5.4 Platform (cross-tenant) access (`src/core/platform`)

- Platform admins have **no tenant access** by default (tenant routes return 401).
- `POST /api/v1/platform/organizations/:id/access { reason }` opens a short-lived
  (`PLATFORM_ACCESS_TTL_MINUTES`), non-refreshable tenant session; it is audited in the
  target organization, and every action in it carries the reason in audit metadata.
- Background/system code that must act inside a tenant with platform authority uses
  `runAsPlatform({ organizationId, reason }, fn)` — always audited (`platform.run_as`).

### 5.5 Rules for later layers

1. Declare permissions in `@erp/shared` and add them to default roles; guard every route with
   `requirePermission` and enforce scope in the service (`scopeWhere` / `can` / `authorize`).
2. Never trust client-supplied scope or tenant ids; resolve parents through `tenantDb()` and
   authorize against the resolved resource.
3. `audit.record()` every mutation; never log secrets.
4. Tests: use `signIn(app, email, password)` (test/helpers) with the seeded demo users for
   RBAC/scope tests; `asTenant()` (dev header, all permissions) only for tenant-isolation
   tests. Call `syncPermissionCatalog()` + `provisionOrganizationRoles()` for new orgs.

## 6. Queues & cache

Redis via **ioredis** and **BullMQ** (`src/core/queue`). Layer 1 only wires configuration
(`REDIS_URL`, `QUEUE_PREFIX`, `createQueue()`); connections are lazy.

## 7. Frontend (apps/web)

- Vue 3 `<script setup lang="ts">`, Pinia stores, Vue Router, Vuetify 3 (auto-import).
- Layout shells: `PlatformLayout`, `GroupLayout`, `InstitutionLayout`, `EmployeeLayout`
  (Student/Parent/Teacher layouts come later). Sidebar menus are data-driven
  (`src/navigation/menus.ts`) and filtered by the permission codes from `GET /api/v1/me`.
- Auth: `useAuthStore` (`src/stores/auth.ts`) keeps the access token in memory and refreshes
  via the httpOnly cookie (single-flight; the client retries once on `TOKEN_EXPIRED`).
  Routes declare `meta.permission`; the global guard (`navigation/guard.ts`) redirects to
  `/login` or `/forbidden`. Login page handles organization selection and the MFA step.
- API calls go through `src/api/client.ts` (`apiFetch`). The client never sends tenant ids;
  the server is always the authority on tenant, permissions and scopes.
- Shared DTO types/schemas come from `@erp/shared`.

## 8. Testing & quality

- **Vitest** everywhere; **supertest** for HTTP. API has two projects:
  - `unit` (`src/**/*.test.ts`) — no database required.
  - `integration` (`test/**/*.int.test.ts`) — runs against `TEST_DATABASE_URL`, which is
    **reset** (`prisma migrate reset`) before the run. Skipped locally when unset; required in CI.
- Every module must have isolation tests proving another tenant cannot read/write its data.
- **ESLint** (flat config, typescript-eslint, eslint-plugin-vue) + **Prettier**.
- **CI** (GitHub Actions): install → lint → format check → typecheck → test (MySQL 8.4
  service container) → build.

## 9. Foundation stack

1. Scaffold + multi-tenancy engine + group/institution hierarchy
2. Auth (JWT access/refresh, TOTP MFA, sessions, login history) + RBAC + scope authz + users + audit
3. Module licensing / subscriptions + branding + secret management
4. Cloud file storage + document management
5. Workflow + notification engines + integration framework
6. HR employee master
7. Attendance / leave / holiday / shift
8. Payroll rule engine
