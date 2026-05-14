// charter: audit-chain
// Type surface for archivist audit-chain entries (ADR-0180 §Audit chain, #16).
// AuditEntry shape is the on-disk JSONL row; replay reads these front-to-back.

export type ProcessRole = 'cli' | 'daemon' | 'hook' | 'admin';

export interface ProcessId {
  readonly pid: number;
  readonly role: ProcessRole;
  readonly sessionId: string;
}

export type AuditState = 'intent' | 'applied' | 'partial' | 'failed' | 'rejected';

export interface InvariantVerdict {
  readonly name: string;
  readonly verdict: 'pass' | { violated: true; detail: string };
}

export interface AuditEntry {
  readonly auditId: string;
  readonly originatingTool: string;
  readonly processId: ProcessId;
  readonly parentAuditId?: string;
  readonly timestamp: number;
  readonly payloadHash: string;
  readonly state: AuditState;
  readonly invariantVerdicts?: ReadonlyArray<InvariantVerdict>;
  readonly guardVerdicts?: ReadonlyArray<unknown>;
  readonly contextVersion: number;
}

export interface AuditLogRotation {
  readonly active: string;
  readonly rotated: ReadonlyArray<string>;
}
