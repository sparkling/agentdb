// charter: guard-policy
// Shared type surface for guards — kept separate from `guards.ts` runtime so the
// branded handler types in `types.ts` can reference `GuardVerdict` without a cycle.
// Mirrors ADR-0180 Follow-up #6's discriminated-union sketch (lines ~385-401).

export type GuardName = 'size' | 'quality' | 'pii' | 'schema' | 'rate-limit';
export type GuardOutcome = 'pass' | 'warn' | 'veto';

interface GuardVerdictBase {
  readonly guard: GuardName | string;
  readonly outcome: GuardOutcome;
  readonly reason?: string;
}

export interface SizeVerdict extends GuardVerdictBase {
  readonly guard: 'size';
  readonly bytes: number;
  readonly limit: number;
}

export interface QualityVerdict extends GuardVerdictBase {
  readonly guard: 'quality';
  readonly score: number;
  readonly threshold: number;
}

export interface PiiVerdict extends GuardVerdictBase {
  readonly guard: 'pii';
  readonly matches: ReadonlyArray<{ readonly kind: string; readonly offset: number }>;
}

export interface SchemaVerdict extends GuardVerdictBase {
  readonly guard: 'schema';
  readonly errors?: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

export interface RateLimitVerdict extends GuardVerdictBase {
  readonly guard: 'rate-limit';
  readonly tokensRemaining: number;
  readonly resetAtMs: number;
}

export interface PluginVerdict extends GuardVerdictBase {
  readonly guard: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type GuardVerdict =
  | SizeVerdict
  | QualityVerdict
  | PiiVerdict
  | SchemaVerdict
  | RateLimitVerdict
  | PluginVerdict;
