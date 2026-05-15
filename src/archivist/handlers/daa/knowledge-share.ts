// charter: dispatch
// daa_knowledge_share mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaKnowledgeSharePayload>` so every knowledge-share
// transitions through the archivist's audit chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts`
// `daa_knowledge_share` handler — primary write is the AgentDB
// `routeMemoryOp('store', namespace 'daa-knowledge')` call (vector-searchable);
// the backward-compat JSON-store mirror (`store.knowledge[knowledgeId] = ...`)
// runs inside `withDAALock` (ADR-0129 B1 — POSIX O_EXCL lockfile) so parallel
// shares do not lost-update each other. The substrate's `withWrite` subsumes
// `withDAALock` for the JSON-store mirror; the AgentDB tail-call moves to a
// guarded post-write follow-up during wire-up so an AgentDB failure cannot
// corrupt the JSON registry that already committed (and vice versa). cli
// callsites stay in place until the dispatch boundary is wired through cli.
// This file establishes the registration shape the dispatch path will resolve.
//
// FS-JSON store family: shares `.claude-flow/daa/store.json` with the other
// daa_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// the DAA JSON-store mirror may be inserted. Direct `fs.writeFileSync` on
// store.json is forbidden by the path-restricted substrate-internal.ts seam
// (ADR-0180 §Type enforcement). The AgentDB tail-call is a separate substrate
// (vector store) and registers its own mutation under `memory_store`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import { emptyDaaStore, type DaaStore } from './agent-create.js';

/**
 * Mutation payload mirroring the CLI tool's `daa_knowledge_share` input shape
 * (daa-tools.ts:389-396). Defaults applied at the wire-up callsite:
 * `knowledgeDomain='general'`, `knowledgeContent={}`.
 */
export interface DaaKnowledgeSharePayload {
  readonly sourceAgentId: string;
  readonly targetAgentIds: ReadonlyArray<string>;
  readonly knowledgeDomain?: string;
  readonly knowledgeContent?: Record<string, unknown>;
}

const STORE_ID = 'daa' as StoreId;

// Body ported from daa-tools.ts `daa_knowledge_share` handler (lines 398-432):
// mint knowledgeId = `knowledge-${Date.now()}` → build knowledgeEntry → load
// store → store.knowledge[knowledgeId] = entry → save. The cli's outer
// `withDAALock` over the JSON-store mirror collapses into the single
// `ctx.substrate.withWrite`.
//
// SCOPE NOTE: the cli's PRIMARY write is the `routeMemoryOp('store', namespace
// 'daa-knowledge', tags=[domain, sourceId, ...targetIds])` AgentDB tail-call
// (daa-tools.ts:414-424) — a write into a SEPARATE substrate (the AgentDB
// vector store, registered under its own `memory_store` mutation). It is NOT
// part of the daa JSON-store mutation and is intentionally not ported here; it
// lands as a guarded post-write follow-up when the cli dispatch boundary is
// wired, kept outside this withWrite so an AgentDB miss does not roll back the
// JSON-store mirror (and vice versa) — matching the cli's existing try/catch
// independence. The JSON-store mirror written below is the complete daa-store
// body for this handler.
export const daaKnowledgeShareHandler: GuardedWrite<DaaKnowledgeSharePayload> =
  registerMutationHandler<DaaKnowledgeSharePayload>(
    'daa_knowledge_share',
    async (ctx: MutationContext<false>, payload: DaaKnowledgeSharePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<DaaStore>({ storeId: STORE_ID, key: 'root' });
        const store: DaaStore = current ?? emptyDaaStore();

        const knowledgeId = `knowledge-${Date.now()}`;
        store.knowledge[knowledgeId] = {
          domain: payload.knowledgeDomain ?? 'general',
          content: payload.knowledgeContent ?? {},
          sharedBy: payload.sourceAgentId,
          targetAgents: [...payload.targetAgentIds],
          timestamp: new Date().toISOString(),
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
