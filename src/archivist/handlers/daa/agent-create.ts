// charter: dispatch
// daa_agent_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaAgentCreatePayload>` so every DAA agent creation
// transitions through the archivist's audit chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts` `daa_agent_create`
// handler — wraps load → mutate (store.agents[id] = agent) → save under
// `withDAALock` (ADR-0129 B1 — POSIX O_EXCL lockfile, stale-PID recovery).
// The substrate's `withWrite` subsumes `withDAALock`; cli callsites stay in
// place until the dispatch boundary is wired through cli (mirroring claims/
// workflow pending wire-up). This file establishes the registration shape the
// dispatch path will resolve.
//
// FS-JSON store family: DAA state lives in `.claude-flow/daa/store.json` —
// same atomic tmp+rename file family that hive-mind, claims, workflow,
// agents.json share. Routed through `makeFsJsonSubstrate` per ADR-0180 §10
// "~18 stores per primitive".
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// DAA state may mutate. Direct `fs.writeFileSync` on store.json is forbidden
// by the `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Cognitive pattern enum — matches the cli inputSchema enum (daa-tools.ts:162). */
export type DaaCognitivePattern =
  | 'convergent'
  | 'divergent'
  | 'lateral'
  | 'systems'
  | 'critical'
  | 'adaptive';

/**
 * Mutation payload mirroring the CLI tool's `daa_agent_create` input shape
 * (daa-tools.ts:156-168). Defaults applied at the wire-up callsite:
 * `name='DAA-${id}'`, `type='autonomous'`, `cognitivePattern='adaptive'`,
 * `learningRate=0.01`, `enableMemory=true`,
 * `capabilities=['reasoning', 'learning']`.
 */
export interface DaaAgentCreatePayload {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly cognitivePattern?: DaaCognitivePattern;
  readonly learningRate?: number;
  readonly enableMemory?: boolean;
  readonly capabilities?: ReadonlyArray<string>;
}

const STORE_ID = 'daa' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of daa-tools.ts
// `daa_agent_create` callsite (load store → mint DAAAgent with defaults →
// store.agents[id] = agent → save store) once the dispatch boundary is wired
// through cli. The cli's outer `withDAALock` collapses to a single
// `ctx.substrate.withWrite` because the substrate primitive owns the lock
// semantics (ADR-0129 B1 race-fix preserved under the substrate's O_EXCL
// sentinel).
export const daaAgentCreateHandler: GuardedWrite<DaaAgentCreatePayload> =
  registerMutationHandler<DaaAgentCreatePayload>(
    'daa_agent_create',
    async (ctx: MutationContext<false>, _payload: DaaAgentCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daa_agent_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/daa-tools.ts daa_agent_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
