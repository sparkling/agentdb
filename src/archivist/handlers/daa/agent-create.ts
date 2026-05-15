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

/** Persisted DAA agent record — mirrors `DAAAgent` at daa-tools.ts:21-37. */
interface DaaAgentRecord {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'idle' | 'learning' | 'terminated';
  cognitivePattern: string;
  learningRate: number;
  memory: boolean;
  capabilities: string[];
  metrics: { tasksCompleted: number; successRate: number; adaptations: number };
  createdAt: string;
  lastActivity: string;
}

/** Persisted DAA workflow record — mirrors `DAAWorkflow` at daa-tools.ts:39-46. */
interface DaaWorkflowRecord {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: Array<{ name: string; status: string; output?: string }>;
  strategy: string;
  createdAt: string;
}

/**
 * Persisted DAA knowledge record. The cli's `DAAStore.knowledge` field type
 * (daa-tools.ts:51) names only `{ domain, content, sharedBy, timestamp }`, but
 * the `knowledgeEntry` the cli actually writes (daa-tools.ts:404-410) also
 * carries `targetAgents` — TS structural typing lets the wider object assign
 * into the narrower field. This type matches what the cli persists to disk so
 * the handler round-trips the on-disk shape faithfully.
 */
export interface DaaKnowledgeRecord {
  domain: string;
  content: unknown;
  sharedBy: string;
  targetAgents?: ReadonlyArray<string>;
  timestamp: string;
}

/** Top-level shape of `.claude-flow/daa/store.json` — mirrors `DAAStore` at daa-tools.ts:48-53. */
export interface DaaStore {
  agents: Record<string, DaaAgentRecord>;
  workflows: Record<string, DaaWorkflowRecord>;
  knowledge: Record<string, DaaKnowledgeRecord>;
  version: string;
}

/** Empty DAA store — the load-time default when the file does not yet exist. */
export const emptyDaaStore = (): DaaStore => ({
  agents: {},
  workflows: {},
  knowledge: {},
  version: '3.0.0',
});

// Body ported from daa-tools.ts `daa_agent_create` handler (lines 169-209):
// load store → mint DAAAgent with defaults → store.agents[id] = agent → save.
// The cli's outer `withDAALock` (ADR-0129 B1 O_EXCL sentinel) collapses into
// the single `ctx.substrate.withWrite` because the substrate primitive owns
// the cross-process lock semantics.
export const daaAgentCreateHandler: GuardedWrite<DaaAgentCreatePayload> =
  registerMutationHandler<DaaAgentCreatePayload>(
    'daa_agent_create',
    async (ctx: MutationContext<false>, payload: DaaAgentCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<DaaStore>({ storeId: STORE_ID, key: 'root' });
        const store: DaaStore = current ?? emptyDaaStore();

        const now = new Date().toISOString();
        store.agents[payload.id] = {
          id: payload.id,
          name: payload.name ?? `DAA-${payload.id}`,
          type: payload.type ?? 'autonomous',
          status: 'active',
          cognitivePattern: payload.cognitivePattern ?? 'adaptive',
          learningRate: payload.learningRate ?? 0.01,
          memory: payload.enableMemory ?? true,
          capabilities: [...(payload.capabilities ?? ['reasoning', 'learning'])],
          metrics: { tasksCompleted: 0, successRate: 1.0, adaptations: 0 },
          createdAt: now,
          lastActivity: now,
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
