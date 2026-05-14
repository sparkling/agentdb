// charter: dispatch
// daemon_audit mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers the 30-minute scheduled `audit` worker write as a
// `GuardedWrite<AuditWorkerPayload>` so each security-audit snapshot transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite: `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`
// `runAuditWorkerLocal` method (line 1349), reached via the scheduler entry
// `{ type: 'audit', intervalMs: 30 * 60 * 1000, ... }` (line 108) and the
// dispatch switch at line 1239 (`runAuditWorkerLocal()`). The worker writes
// `.claude-flow/metrics/security-audit.json` via `writeFileSync` — under
// ADR-0180 F4-3 the daemon callsite stays in place; this file establishes the
// registration shape the dispatch path will resolve once wired. The headless
// mode (worker-daemon.ts:1276 `persistHeadlessResult`) writes to the same
// `security-audit.json` filename so a single mutation handler covers both
// execution modes.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/metrics/security-audit.json` may mutate. The underlying
// primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared
// across daemon worker writes under one cross-process O_EXCL sentinel lock.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload for the daemon-scheduled security-audit worker. The
 * `runAuditWorkerLocal` method (worker-daemon.ts:1349-1373) takes no
 * caller-supplied arguments; the payload is intentionally empty so the audit
 * record captures "the scheduler fired" without coupling to internal worker
 * state.
 */
export interface AuditWorkerPayload {
  // intentionally empty — daemon-scheduled, no external inputs
}

const STORE_ID = 'metrics_security_audit' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up, F4-3 deferral): port the body of
// worker-daemon.ts `runAuditWorkerLocal` (lines 1349-1373) once the dispatch
// boundary is wired through the daemon. The current cli body composes a
// `{ timestamp, mode: 'local', checks: { envFilesProtected, gitIgnoreExists,
// noHardcodedSecrets }, riskLevel: 'low', recommendations: [], note }`
// snapshot via two `existsSync` probes and then
// `writeFileSync(.../security-audit.json, ...)`. Probes are read-only
// filesystem reads and therefore stay outside the `withWrite` scope; only the
// final JSON write moves inside. The headless variant
// (`persistHeadlessResult`, worker-daemon.ts:1276) writes the richer
// `{ timestamp, mode: 'headless', findings, rawOutputPreview, ... }` shape to
// the same path; invariants-author should fold both modes into one handler
// body keyed off `ctx`-derived execution-mode metadata.
export const auditWorkerHandler: GuardedWrite<AuditWorkerPayload> =
  registerMutationHandler<AuditWorkerPayload>(
    'daemon_audit',
    async (ctx: MutationContext<false>, _payload: AuditWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daemon_audit handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts ' +
          '\'runAuditWorkerLocal\' method',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
