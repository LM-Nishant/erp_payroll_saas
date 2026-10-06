import { AppError } from '../http/errors';

/** Thrown when code attempts to read or write data outside the current tenant. */
export class TenantIsolationError extends AppError {
  constructor(message: string) {
    super(403, 'TENANT_ISOLATION_VIOLATION', message);
  }
}

/** Thrown when tenant-scoped code runs without a resolved TenantContext (a server bug). */
export class TenantContextMissingError extends AppError {
  constructor() {
    super(500, 'TENANT_CONTEXT_MISSING', 'No tenant context is active for this operation');
  }
}
