import type { DocumentScanStatus } from '@erp/shared';

/**
 * Virus-scanning hook. The default scanner does nothing (`SKIPPED`). Plug in a real scanner
 * (ClamAV, a cloud AV service…) with `setVirusScanner`. A scanner may return `PENDING` and
 * report later via `recordScanResult` (core/documents) — downloads are blocked while a version
 * is PENDING or INFECTED.
 */
export interface ScanRequest {
  organizationId: string;
  key: string;
  mimeType: string;
  sizeBytes: number;
  /** Lazily read the object's bytes. */
  read: () => Promise<Buffer>;
}

export interface VirusScanner {
  readonly name: string;
  scan(request: ScanRequest): Promise<DocumentScanStatus>;
}

export const noopVirusScanner: VirusScanner = {
  name: 'noop',
  scan: async () => 'SKIPPED',
};

let scanner: VirusScanner = noopVirusScanner;

export function setVirusScanner(next: VirusScanner): void {
  scanner = next;
}

export function virusScanner(): VirusScanner {
  return scanner;
}
