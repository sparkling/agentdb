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
} from '../../index.js';
import { emptyDaaStore, type DaaCognitivePattern, type DaaStore } from './agent-create.js';

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

// Body ported from daa-tools.ts `daa_cognitive_pattern` WRITE path
// (action='change' + agentId + pattern; daa-tools.ts:520-539): load store →
// reject if agent missing → capture previousPattern → agent.cognitivePattern =
// payload.pattern → save. The cli's outer `withDAALock` collapses into the
// single `ctx.substrate.withWrite` because the substrate primitive owns the
// lock semantics.
//
// SCOPE NOTE: only the WRITE path is registered here. The cli tool also serves
// two READ paths — `action='analyze'` (returns the agent's current pattern +
// metrics) and the no-`agentId` static pattern catalogue. Those are non-
// mutating and route through `dispatchRead` under a sibling read handler when
// the read-split lands; they are NOT a daa-store mutation and have no body
// here. This handler rejects payloads that are not a well-formed change
// intent — the dispatch boundary should only route `action='change'` with
// both `agentId` and `pattern` present to a mutation handler.
export const daaCognitivePatternHandler: GuardedWrite<DaaCognitivePatternPayload> =
  registerMutationHandler<DaaCognitivePatternPayload>(
    'daa_cognitive_pattern',
    async (ctx: MutationContext<false>, payload: DaaCognitivePatternPayload): Promise<void> => {
      if (payload.action !== 'change') {
        throw new Error(
          `archivist: daa_cognitive_pattern mutation handler requires action='change'; ` +
            `got action='${payload.action ?? 'analyze'}' (analyze + catalogue are read-only paths)`,
        );
      }
      if (!payload.agentId) {
        throw new Error(
          "archivist: daa_cognitive_pattern action='change' requires agentId",
        );
      }
      if (!payload.pattern) {
        throw new Error(
          "archivist: daa_cognitive_pattern action='change' requires pattern",
        );
      }
      const agentId = payload.agentId;
      const pattern = payload.pattern;

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<DaaStore>({ storeId: STORE_ID, key: 'root' });
        const store: DaaStore = current ?? emptyDaaStore();

        const agent = store.agents[agentId];
        if (!agent) {
          throw new Error(
            `archivist: daa_cognitive_pattern — agent '${agentId}' not found in daa store`,
          );
        }

        agent.cognitivePattern = pattern;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
