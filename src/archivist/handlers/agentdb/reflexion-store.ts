// charter: dispatch
// agentdb_reflexion_store mutation handler (ADR-0180 Phase 6 §Architecture ·
// Audit chain). Registers as `GuardedWrite<AgentdbReflexionStorePayload>` so
// every ReflexionMemory episode write transitions through the archivist's
// audit-chain (intent → applied | rejected) with guard verdicts + invariant
// verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_reflexion-store` handler (line 1003) — validates `session_id`
// (non-empty, max 500 chars), `task` (non-empty, max 10KB), `reward` via
// `validateScore` (default 0.5), then resolves the `reflexion` controller and
// invokes `storeEpisode(...)` (the v3 rename from legacy `.store`, with both
// names probed via `getCallableMethod`). Payload shape was migrated from
// snake_case `{session_id, task, reward, success}` to camelCase
// `{sessionId, ...}`; the cli still passes both for backward compatibility
// against pre-rename controllers (ADR-0090 B5). A 2-second timeout wraps the
// call so a stalled controller cannot block the dispatch boundary. The cli
// callsite stays authoritative during the migration window — this file
// establishes the registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// reflexion state may mutate at the dispatch boundary. The 2-second timeout
// the cli enforces will move to the substrate primitive's `withWrite`
// timeout option during wire-up; until then the cli wrapper continues to own
// the timeout semantics.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_reflexion-store` input
 * shape (agentdb-tools.ts:1007-1014). All four fields are required at the cli
 * surface; the dispatch boundary preserves the contract. `reward` is clamped
 * to [0,1] via `validateScore` at the cli boundary today and will move into
 * a per-handler invariant during Phase 6 wire-up.
 */
export interface AgentdbReflexionStorePayload {
  readonly session_id: string;
  readonly task: string;
  readonly reward: number;
  readonly success: boolean;
}

const STORE_ID = 'agentdb_reflexion_store' as StoreId;

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_reflexion-store` handler — (a) resolve the ReflexionMemory
// controller via ctx.substrate; (b) probe for `storeEpisode` (v3) then
// `store` (legacy) via `getCallableMethod`; (c) call the resolved method
// with both camelCase `{sessionId, task, reward, success}` and legacy
// snake_case `session_id` for backward compatibility per ADR-0090 B5;
// (d) wrap in the substrate's `withWrite` timeout (replaces the cli's ad-hoc
// 2-second `Promise.race` against a setTimeout reject — the substrate owns
// the timeout semantics in the migrated path). The cli branch stays in
// place until the dispatch boundary is wired through; this handler is the
// registration shape the dispatch path will resolve.
// ADR-0181 Phase 6 wire-up — port of cli `agentdb-tools.ts:1003`. Primary
// path: ReflexionMemory controller writes via `storeEpisode` (v3) or `store`
// (legacy) through the ReflexionStoreWriter capability (2-second timeout
// preserved cli-side). Fallback path: substrate.withWrite RVF when controller
// is unwired.
export const storeReflexionHandler: GuardedWrite<AgentdbReflexionStorePayload> =
  registerMutationHandler<AgentdbReflexionStorePayload>(
    'agentdb_reflexion_store',
    async (ctx: MutationContext<false>, payload: AgentdbReflexionStorePayload): Promise<void> => {
      const writer = ctx.capabilities.requireReflexionStoreWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const result = await writer.storeEpisode({
          sessionId: payload.session_id,
          task: payload.task,
          reward: payload.reward,
          success: payload.success,
        });

        if (result && result.success) return;
        if (result && !result.success && result.error && !/not available|not wired|not initialized|missing.*method|timed out/i.test(result.error)) {
          throw new Error(`archivist: agentdb_reflexion_store — Reflexion rejected: ${result.error}`);
        }

        // Fallback: controller unwired / missing method / timed out. RVF
        // persistence ensures the episode is observable.
        const scorer = ctx.capabilities.requireEmbeddingScorer();
        const embedding = await scorer.embed(payload.task);
        const id = `reflexion-${payload.session_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rvfHandle = handle as { rvf?: {
          insertAsync(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
        } };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: agentdb_reflexion_store — RVF substrate handle missing `rvf.insertAsync`.',
          );
        }
        await rvfHandle.rvf.insertAsync(id, embedding, {
          namespace: 'reflexion',
          sessionId: payload.session_id,
          task: payload.task,
          reward: payload.reward,
          success: payload.success,
          tags: ['reflexion', 'episode', 'fallback'],
          controller: 'memory-store-fallback',
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
