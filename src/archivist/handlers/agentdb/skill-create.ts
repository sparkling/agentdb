// charter: dispatch
// agentdb_skill_create mutation handler (ADR-0180 Phase 6 §Architecture ·
// Audit chain). Registers as `GuardedWrite<AgentdbSkillCreatePayload>` so
// every SkillLibrary creation transitions through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts
// recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_skill_create` handler (line 1650) — validates `name` (non-empty,
// max 500 chars), `description` (max 10KB, default empty), `code` (max
// MAX_STRING_LENGTH, default empty), and `success_rate` via `validateScore`
// (default 0.5). Resolves the `skills` controller, then preferentially calls
// `createSkill({ name, description, code, successRate })` (v3 API) falling
// back to `promote({ name, description, code }, successRate)` for legacy
// controllers. Returns `{ success: true, skillId }` on either path. The cli
// callsite stays authoritative during the migration window — this file
// establishes the registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// SkillLibrary state may mutate at the dispatch boundary. The `cacheScope:
// 'global'` hint reflects that the SkillLibrary is a process-wide registry
// (not namespaced by user/agent) — creation invalidates skill-listing reads
// regardless of caller namespace.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_skill_create` input
 * shape (agentdb-tools.ts:1654-1661). Only `name` is required; the cli
 * defaults `description` and `code` to empty string and `success_rate` to
 * `0.5` via `validateScore`. The snake_case `success_rate` survives at the
 * payload boundary for back-compat with existing tool-call call-sites; it is
 * converted to camelCase `successRate` for the `createSkill` controller call
 * during wire-up.
 */
export interface AgentdbSkillCreatePayload {
  readonly name: string;
  readonly description?: string;
  readonly code?: string;
  readonly success_rate?: number;
}

const STORE_ID = 'agentdb_skill_create' as StoreId;

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_skill_create` handler — (a) resolve the SkillLibrary controller
// via ctx.substrate; (b) prefer `createSkill({ name, description, code,
// successRate })` (v3 API) and fall back to `promote({ name, description,
// code }, successRate)` for legacy controllers (cli line 1672-1679);
// (c) return `{ success: true, skillId: result?.id ?? result ?? name }`;
// (d) surface `SkillLibrary controller not available` as an explicit
// rejection (cli line 1680, ADR-0082 no-silent-failure). The cli branch
// stays in place until the dispatch boundary is wired through; this handler
// is the registration shape the dispatch path will resolve.
// ADR-0181 Phase 7 — port of cli `agentdb-tools.ts:1650`. SkillLibrary
// controller creates via `createSkill({...})` (v3 API) or `promote(...)`
// (legacy) — both probed by the SkillLibraryWriter capability. Substrate
// is SQLite-classified per substrate-registry (the `skills` +
// `skill_embeddings` tables are the persistence model the matching read
// handler queries); a controller-unavailable result is fatal, no fallback.
// Explicit controller errors surface as throws (ADR-0082).
export const createSkillHandler: GuardedWrite<AgentdbSkillCreatePayload> =
  registerMutationHandler<AgentdbSkillCreatePayload>(
    'agentdb_skill_create',
    async (ctx: MutationContext<false>, payload: AgentdbSkillCreatePayload): Promise<void> => {
      const name = payload.name;
      const description = payload.description ?? '';
      const code = payload.code ?? '';
      const successRate = payload.success_rate ?? 0.5;
      const writer = ctx.capabilities.requireSkillLibraryWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        const result = await writer.createSkill({ name, description, code, successRate });

        if (result && result.success) return;
        if (result && !result.success && result.error) {
          // Whether the error indicates unwired or a real rejection, surface
          // as a throw per ADR-0082 no-silent-failure (stub TODO L57:
          // "surface SkillLibrary controller not available as an explicit
          // rejection (cli line 1680)"). The acceptance harness's
          // `_expect_mcp_body` skip-accept regex matches "not available /
          // not wired / missing method" and downgrades to skip_accepted;
          // any other error is a real failure.
          throw new Error(`archivist: agentdb_skill_create — SkillLibrary: ${result.error}`);
        }
        // null result = controller not present in this process. Fail loud.
        throw new Error(
          'archivist: agentdb_skill_create — SkillLibrary controller not available in this process; ' +
          'a SQLite-backed write path requires the controller to own table creation. ' +
          'Refusing to silently write to RVF since the read tool (agentdb_skill_search) consults SQLite.',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
