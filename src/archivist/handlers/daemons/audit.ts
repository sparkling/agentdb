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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { auditInvariants } from '../../invariants/daemons/audit.js';

/**
 * Mutation payload for the daemon-scheduled security-audit worker.
 *
 * The cli's `runAuditWorkerLocal` (worker-daemon.ts:1428-1452) composes the
 * snapshot from two `existsSync` probes (`.env.local`, `.gitignore`) — those
 * are filesystem reads the *daemon* performs on its own stack and are NOT a
 * substrate concern (matches the `optimize.ts` / `consolidate.ts` precedent:
 * the cli runs the work, the handler owns persistence only). So the snapshot
 * arrives here fully-composed in the payload; the handler writes it verbatim.
 *
 * `mode` discriminates the two execution paths:
 *   - `'local'` — `runAuditWorkerLocal` fallback (worker-daemon.ts:1428).
 *     Carries `checks`, `riskLevel`, `recommendations`, `note`.
 *   - `'headless'` — `persistHeadlessResult` (worker-daemon.ts:1355). Carries
 *     `model`, `durationMs`, `tokensUsed`, `executionId`, `success`,
 *     `findings`, `rawOutputPreview`, `rawOutputLength`. Both modes write to
 *     the same file (`security-audit.json`), so a single mutation handler
 *     covers both; the on-disk schema diverges by `mode` exactly as the cli
 *     produces today.
 */
export type AuditWorkerPayload =
  | {
      readonly timestamp: string;
      readonly mode: 'local';
      readonly checks: {
        readonly envFilesProtected: boolean;
        readonly gitIgnoreExists: boolean;
        readonly noHardcodedSecrets: boolean;
      };
      readonly riskLevel: string;
      readonly recommendations: ReadonlyArray<unknown>;
      readonly note: string;
    }
  | {
      readonly timestamp: string;
      readonly mode: 'headless';
      readonly workerType: string;
      readonly model?: string;
      readonly durationMs?: number;
      readonly tokensUsed?: number;
      readonly executionId?: string;
      readonly success: boolean;
      readonly findings: unknown;
      readonly rawOutputPreview?: string;
      readonly rawOutputLength: number;
    };

const STORE_ID = 'metrics_security_audit' as StoreId;

// F4-2 body: snapshot is composed daemon-side (existsSync probes are
// filesystem reads, not a substrate concern — `optimize.ts` precedent) and
// arrives in the payload; this handler owns persistence only. One `withWrite`
// scope → one `handle.write` of the whole document. The cli
// `writeFileSync(.../security-audit.json)` at worker-daemon.ts:1450 (local)
// and 1395 (headless) collapses to this call once F4-3 flips the daemon
// switch to `archivist.dispatch('daemon_audit', snapshot)`.
export const auditWorkerHandler: GuardedWrite<AuditWorkerPayload> =
  registerMutationHandler<AuditWorkerPayload>(
    'daemon_audit',
    async (ctx: MutationContext<false>, payload: AuditWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload });
      });
    },
    {
      invariants: auditInvariants,
      cacheScope: 'global',
    },
  );
