// charter: dispatch
// daa_cognitive_pattern mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaCognitivePatternPayload>` so every pattern
// change transitions through the archivist's audit chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts`
// `daa_cognitive_pattern` handler — single tool that branches on `action`:
//   - `action='change'` is a write (mutates `agent.cognitivePattern`) under
//     `withDAALock` (ADR-0129 B1 — POSIX O_EXCL lockfile)
//   - `action='analyze'` is a read (returns current pattern + metrics) with no
//     mutation, lock-free per the cli's existing pattern (read-only paths
//     observe a slightly-stale pre-image — no write happens)
//   - no `agentId` returns the static pattern catalogue (also a read)
// This handler covers the write path. The read paths stay at the cli boundary
// until the read-handler split lands (mirroring how claims_status / hive-mind_
// status separated reads from mutation siblings). The substrate's `withWrite`
// subsumes `withDAALock`; cli callsites stay in place until the dispatch
// boundary is wired through cli. This file establishes the registration shape
// the dispatch path will resolve.
//
// FS-JSON store family: shares `.claude-flow/daa/store.json` with the other
// daa_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// agent.cognitivePattern may mutate. Direct `fs.writeFileSync` on store.json
// is forbidden by the path-restricted substrate-internal.ts seam
// (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { DaaCognitivePattern } from './agent-create';

/** Action discriminator — matches the cli inputSchema enum (daa-tools.ts:511). */
export type DaaCognitivePatternAction = 'analyze' | 'change';

/**
 * Mutation payload mirroring the CLI tool's `daa_cognitive_pattern` input
 * shape (daa-tools.ts:507-513). Defaults applied at the wire-up callsite:
 * `action='analyze'`. Wire-up rejects `action='change'` with missing
 * `pattern` or missing `agentId`; the dispatch boundary refuses
 * `action='analyze'` here because reads route through `dispatchRead`.
 */
export interface DaaCognitivePatternPayload {
  readonly agentId?: string;
  readonly action?: DaaCognitivePatternAction;
  readonly pattern?: DaaCognitivePattern;
}

const STORE_ID = 'daa' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of daa-tools.ts
// `daa_cognitive_pattern` write path (action='change' + agentId + pattern):
// load store → reject if agent missing → capture previousPattern →
// agent.cognitivePattern = payload.pattern → save → return
// `{ previousPattern, newPattern, changedAt }`. The cli's outer `withDAALock`
// collapses to a single `ctx.substrate.withWrite` because the substrate
// primitive owns the lock semantics. The read paths (action='analyze',
// no-agentId catalogue) move to a sibling read handler when the read-split
// lands — registering under the same tool name is rejected here because
// `dispatch` and `dispatchRead` are channel-separated (ADR-0180 §Audit chain).
export const daaCognitivePatternHandler: GuardedWrite<DaaCognitivePatternPayload> =
  registerMutationHandler<DaaCognitivePatternPayload>(
    'daa_cognitive_pattern',
    async (ctx: MutationContext<false>, _payload: DaaCognitivePatternPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daa_cognitive_pattern handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/daa-tools.ts daa_cognitive_pattern handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
