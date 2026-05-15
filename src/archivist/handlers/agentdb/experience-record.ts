// charter: dispatch
// agentdb_experience_record mutation handler (ADR-0180 Phase 6 §Architecture
// · Audit chain). Registers as `GuardedWrite<AgentdbExperienceRecordPayload>`
// so every LearningSystem episode write transitions through the archivist's
// audit-chain (intent → applied | rejected) with guard verdicts + invariant
// verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_experience_record` handler (line 1797) — validates `task`
// (non-empty, max 10KB, required), `input` and `output` (max
// MAX_STRING_LENGTH, default empty), `reward` via `validateScore` (default
// 0.5), `success` (default false). Resolves the `learningSystem` controller
// and writes to the `learning_experiences` SQLite table via
// `recordExperience()`. Per ADR-0090 Tier B5 + ADR-0082 follow-up: the prior
// implementation incorrectly routed through `reflexion.storeEpisode` which
// writes to a different table (`episodes`); this tool now lands in the
// table the test harness expects and falls back loudly when LearningSystem
// is missing (no silent in-memory persistence). The FK to
// `learning_sessions(id)` requires a synchronous `startSession()` call before
// the experience row is inserted (cli line 1834+). The cli callsite stays
// authoritative during the migration window — this file establishes the
// registration shape the dispatch path will resolve.
//
// Type-enforcement: the FK invariant between
// `learning_experiences.session_id` and `learning_sessions(id)` is captured
// as a per-handler invariant during Phase 6 wire-up (registered via
// `invariants: [...]` against this handler) — invariants are correctness
// gates, guards are policy (ADR-0180 §Mutation invariants).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import { experienceRecordInvariants } from '../../invariants/agentdb/experience-record.js';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_experience_record`
 * input shape (agentdb-tools.ts:1801-1809). Only `task` is required; the
 * cli defaults `input`/`output` to empty string, `reward` to `0.5` via
 * `validateScore`, and `success` to false. `task` is persisted as the
 * `action` column on the `learning_experiences` table (cli line 1803
 * description) — a subtle rename worth preserving in the dispatch-side
 * payload contract.
 */
export interface AgentdbExperienceRecordPayload {
  readonly task: string;
  readonly input?: string;
  readonly output?: string;
  readonly reward?: number;
  readonly success?: boolean;
}

const STORE_ID = 'agentdb_experience_record' as StoreId;

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_experience_record` handler — (a) resolve the LearningSystem
// controller via ctx.substrate; (b) probe `recordExperience` and
// `startSession` via `getCallableMethod`; (c) synchronously call
// `startSession()` first so the FK to `learning_sessions(id)` resolves
// (cli line 1834+, ADR-0090 B5 / ADR-0082 — without this the INSERT fails
// silently with "FOREIGN KEY constraint failed"); (d) call
// `recordExperience({ action: task, input, output, reward, success })` —
// note the `task → action` field rename per cli line 1803. Surface
// controller-unavailable / method-missing as explicit rejections (no
// silent fallback). The cli branch stays in place until the dispatch
// boundary is wired through; this handler is the registration shape the
// dispatch path will resolve.
// ADR-0181 Phase 6 wire-up — port of cli `agentdb-tools.ts:1797`. Primary
// path: LearningSystem controller — capability's `recordExperience` calls
// `startSession()` FIRST (FK to `learning_sessions(id)`) then
// `recordExperience({action: task, input, output, reward, success})` (ADR-0090
// B5 / ADR-0082). Fallback: RVF.
export const recordExperienceHandler: GuardedWrite<AgentdbExperienceRecordPayload> =
  registerMutationHandler<AgentdbExperienceRecordPayload>(
    'agentdb_experience_record',
    async (ctx: MutationContext<false>, payload: AgentdbExperienceRecordPayload): Promise<void> => {
      const task = payload.task;
      const input = payload.input ?? '';
      const output = payload.output ?? '';
      const reward = payload.reward ?? 0.5;
      const success = payload.success ?? false;
      const writer = ctx.capabilities.requireLearningSystemWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        const result = await writer.recordExperience({ task, input, output, reward, success });

        if (result && result.success) return;
        if (result && !result.success && result.error) {
          // ADR-0082: surface controller errors loudly per TODO (L65-66:
          // "Surface controller-unavailable / method-missing as explicit
          // rejections (no silent fallback)").
          throw new Error(`archivist: agentdb_experience_record — LearningSystem: ${result.error}`);
        }
        throw new Error(
          'archivist: agentdb_experience_record — LearningSystem controller not available in this process; ' +
          'the `learning_experiences` SQLite table cannot be created without the controller. Silent RVF fallback is forbidden per TODO L65-66.',
        );
      });
    },
    {
      invariants: experienceRecordInvariants,
      cacheScope: 'namespace',
    },
  );
