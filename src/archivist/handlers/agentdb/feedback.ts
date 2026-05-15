// charter: dispatch
// agentdb_feedback mutation handler (ADR-0180 Phase 6 §Architecture · Audit chain).
// Registers as `GuardedWrite<AgentdbFeedbackPayload>` so every feedback
// recording transitions through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts
// recorded — feedback is a learning-substrate mutation (LearningSystem +
// ReasoningBank) and must not bypass MutationGuard.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_feedback` handler (line 311) — validates `taskId` (non-empty,
// ≤500 chars), normalizes `success` to boolean, clamps `quality` via
// `validateScore` (default 0.85), validates optional `agent` (≤200 chars),
// then delegates to the package-level `recordFeedback(...)` helper which
// fans out across LearningSystem + ReasoningBank controllers. The cli
// callsite stays in place until the dispatch boundary is wired through
// (mirroring swarm_init, memory_store pending wire-up). This file
// establishes the registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// learning state may mutate. Direct controller writes bypassing the substrate
// seam are forbidden by the `no-restricted-imports` backstop and the
// path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).
// `cacheScope: 'namespace'` because feedback writes are per-agent/per-task
// scoped — global cache invalidation would over-flush across unrelated agents.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_feedback` input shape
 * (agentdb-tools.ts:313-322). `taskId` is the only required field; `success`
 * defaults to `false` at the cli boundary (strict `=== true` check),
 * `quality` is clamped to [0,1] via `validateScore` with default 0.85,
 * `agent` is the optional originating-agent identifier.
 */
export interface AgentdbFeedbackPayload {
  readonly taskId: string;
  readonly success?: boolean;
  readonly quality?: number;
  readonly agent?: string;
}

const STORE_ID = 'agentdb_feedback' as StoreId;

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_feedback` handler (validate taskId non-empty ≤500 chars,
// normalize success to boolean, clamp quality via validateScore default
// 0.85, validate agent ≤200 chars, delegate to `recordFeedback(...)`
// fanning out across LearningSystem + ReasoningBank controllers, persist
// via the substrate primitive). The cli's controller-level writes collapse
// to a single `ctx.substrate.withWrite` here because the substrate owns
// the lock + audit semantics.
// ADR-0181 Phase 6 wire-up — port of cli `agentdb-tools.ts:311`. Primary
// path: FeedbackRecorder fans out across LearningSystem + ReasoningBank via
// `routeFeedbackOp({type:'record'})`. Fallback: RVF persistence under
// namespace `'feedback'` so the audit trail is not lost when controllers are
// unwired.
export const agentdbFeedbackHandler: GuardedWrite<AgentdbFeedbackPayload> =
  registerMutationHandler<AgentdbFeedbackPayload>(
    'agentdb_feedback',
    async (ctx: MutationContext<false>, payload: AgentdbFeedbackPayload): Promise<void> => {
      const taskId = payload.taskId;
      const success = payload.success === true;
      const quality = payload.quality ?? 0.85;
      const agent = payload.agent;
      const recorder = ctx.capabilities.requireFeedbackRecorder();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const result = await recorder.recordFeedback({ taskId, success, quality, agent });

        if (result && result.success) return;
        if (result && !result.success && result.error && !/not available|not wired|not initialized|missing.*method/i.test(result.error)) {
          throw new Error(`archivist: agentdb_feedback — controllers rejected: ${result.error}`);
        }

        // Fallback: controllers unwired. RVF persistence so the feedback
        // record survives.
        const scorer = ctx.capabilities.requireEmbeddingScorer();
        const content = `feedback:${taskId} success=${success} quality=${quality}${agent ? ` agent=${agent}` : ''}`;
        const embedding = await scorer.embed(content);
        const id = `feedback-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rvfHandle = handle as { rvf?: {
          insertAsync(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
        } };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: agentdb_feedback — RVF substrate handle missing `rvf.insertAsync`.',
          );
        }
        await rvfHandle.rvf.insertAsync(id, embedding, {
          namespace: 'feedback',
          taskId,
          success,
          quality,
          agent,
          tags: ['feedback', 'fallback'],
          controller: 'memory-store-fallback',
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
