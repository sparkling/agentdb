// charter: dispatch
// memory_store mutation handler (ADR-0180 Phase 3, §Architecture · Audit chain).
// Registers as `GuardedWrite<MemoryStorePayload>` so every write transitions
// through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Body wire-up is pending: the cli's `memory-tools.ts` memory_store handler
// continues to call `routeMemoryOp('store', ...)` until the dispatch boundary
// is exposed publicly (today `dispatchMutation` is intentionally not
// re-exported from `archivist/index.ts`). This file establishes the
// registration shape that the dispatch path will resolve.
//
// Invariants attach via Phase 3 invariants-author (see ADR-0180 §Mutation
// invariants — second correctness gate). The current `invariants: []` is the
// pre-invariant baseline that lets the registration land without coupling.
//
// Type-enforcement: returning `GuardedWrite<MemoryStorePayload>` from
// `registerMutationHandler` produces a branded value that the store barrel's
// `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` typing accepts;
// non-branded exports fail at the boundary (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

export interface MemoryStorePayload {
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly tags?: ReadonlyArray<string>;
  readonly ttl?: number;
  readonly upsert?: boolean;
  readonly generateEmbedding?: boolean;
}

const STORE_ID = 'memory_store' as StoreId;

// TODO(ADR-0180 Phase 3 wire-up): port the body of memory-router.ts
// `case 'store'` (ADR-0094 RC-2 idempotency guard, optional embedding via
// `@claude-flow/memory/embedding-adapter`, ADR-0166 RVF-primary write through
// `storage.store`, scoped-key handling via agentMemoryScope). The router
// branch stays in place until the dispatch boundary is wired through cli;
// this handler is the registration shape the dispatch path will resolve.
export const storeMemoryHandler: GuardedWrite<MemoryStorePayload> =
  registerMutationHandler<MemoryStorePayload>(
    'memory_store',
    async (ctx: MutationContext<false>, payload: MemoryStorePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: memory_store handler body pending Phase 3 wire-up; ' +
          'callers currently route through cli/src/memory/memory-router.ts case \'store\'',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
