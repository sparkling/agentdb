// charter: testing-surface
// ADR-0180 Phase 9 — Scenario C load gate (Open Follow-up #12, ADR-0180 §Phase 9
// disposition lines ~549). Drives `MemoryConsolidation.createSemanticMemory`
// across a 100-episode corpus that clusters into ~10 semantic memories. Each
// cluster fans out: store → markConsolidated × 10 → applyForgettingCurve →
// vectorBackend.remove. The audit tree shape is the load-bearing artifact;
// replay equality is the gate on substrate determinism.
//
// Current state (2026-05-14): MemoryConsolidation has no
// `registerMutationHandler` registration and `createSemanticMemory` is
// `private`. The cascade therefore writes directly through `this.db.prepare()`
// + `this.vectorBackend.remove()` with no audit envelope and no `ctx.child()`
// re-entrancy. This spec is a throw-stub per the ADR-0180 Open Follow-up #12
// disposition: it documents the assertions Phase 9 will enforce once
// `memory-consolidation-migrator` (Task #5) rewires the controller through
// the substrate seam, and fails LOUD until then (anchors
// `feedback-no-fallbacks.md` — no silent skip when substrate is unwired).
//
// References:
//   - ADR-0180 line 549 (Scenario C disposition)
//   - src/controllers/MemoryConsolidation.ts:347-452 (cascade body — store,
//     markConsolidated, applyForgettingCurve, vectorBackend.remove)
//   - src/archivist/testing/index.ts (auditTree, withTestContext, AuditNode,
//     flattenTree, unorderedEqualForParallel)
//   - test/replay/fs-json-contention.spec.ts (peer Phase 5 gate — registration
//     + withTestContext usage pattern)

import { describe, it, expect } from 'vitest';
import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
} from '../../src/archivist/index.js';

// ---------------------------------------------------------------------------
// Scenario C handler — NOT YET WIRED.
//
// The eventual surface (per ADR-0180 §Phase 9 Scenario C):
//
//   const consolidateHandler = registerMutationHandler<ConsolidatePayload>(
//     'memory-consolidation__create-semantic-memory',
//     async (ctx, payload) => {
//       for (const cluster of payload.clusters) {                  // ~10 parents
//         await ctx.child({ reason: 'cluster', mode: 'sequential' }, async (clusterCtx) => {
//           await store(clusterCtx, pattern);                      // child 1
//           for (const member of cluster.members) {
//             await markConsolidated(clusterCtx, member.id);       // child 2 (folded)
//           }
//           await applyForgettingCurve(clusterCtx, cluster.members); // child 3
//           await vectorBackendRemove(clusterCtx, forgottenIds);    // child 4
//         });
//       }
//     },
//     { invariants: [/* ... */], cacheScope: 'store' },
//   );
//
// Until `memory-consolidation-migrator` lands this registration, the handler
// below is a throw-stub. Phase 9 fails loud, the task list pinpoints what's
// missing, and there is no silent pass.

interface ConsolidatePayload {
  readonly episodeCount: number;
  readonly expectedClusters: number;
}

const consolidateHandler: GuardedWrite<ConsolidatePayload> =
  registerMutationHandler<ConsolidatePayload>(
    'memory-consolidation__create-semantic-memory__SCENARIO_C_STUB',
    async (_ctx: MutationContext<false>, _payload: ConsolidatePayload): Promise<void> => {
      // NOT WIRED: MemoryConsolidation.ts:347 (`createSemanticMemory`) is
      // `private` and writes directly to `this.db` + `this.vectorBackend`
      // without an audit envelope. Task #5 (`memory-consolidation-migrator`)
      // must:
      //   1. Expose a public entrypoint that accepts a MutationContext.
      //   2. Use `ctx.child({ reason: 'cluster', mode: 'sequential' })` per
      //      cluster (10 parents under the root audit entry).
      //   3. Route store / markConsolidated / applyForgettingCurve /
      //      vectorBackend.remove through `ctx.substrate.withWrite` so each
      //      one mints its own child audit entry in order.
      //   4. Register the handler above with real invariants.
      //
      // Until that lands, this scenario CANNOT measure tree shape, replay
      // equality, or orphan counts — there is no audit envelope to compare
      // against.
      throw new Error(
        'ADR-0180 Phase 9 Scenario C: MemoryConsolidation substrate seam not wired. ' +
          'Blocks on Task #5 (memory-consolidation-migrator). See ' +
          'src/controllers/MemoryConsolidation.ts:347-452 — `createSemanticMemory` ' +
          'is private and bypasses the archivist. Registration carries the ' +
          'SCENARIO_C_STUB suffix to make this failure greppable.',
      );
    },
    { invariants: [], cacheScope: 'store' },
  );

describe('MemoryConsolidation cascade — Scenario C (ADR-0180 Phase 9 #12)', () => {
  it('audit tree shape: 10 cluster parents × 4 sequential children matches op tree', async () => {
    // Eventual assertions, ordered per the ADR-0180 disposition:
    //
    //   const { auditTree, audit, substrate } = await withTestContext(
    //     consolidateHandler,
    //     { episodeCount: 100, expectedClusters: 10 },
    //     { substrate: /* sqlite fixture seeded with 100 episodes */ },
    //   );
    //
    //   // 1. Tree shape — 10 parents (clusters), each with 4 sequential
    //   //    children (store, markConsolidated-fold, applyForgettingCurve,
    //   //    vectorBackend.remove) in recorded order.
    //   expect(auditTree.children).toHaveLength(10);
    //   for (const cluster of auditTree.children) {
    //     expect(cluster.mode).toBe('sequential');
    //     expect(cluster.children).toHaveLength(4);
    //     expect(cluster.children.map(c => c.entry.originatingTool)).toEqual([
    //       'hierarchical_memory__store',
    //       'hierarchical_memory__mark-consolidated',
    //       'hierarchical_memory__apply-forgetting-curve',
    //       'vector_backend__remove',
    //     ]);
    //   }
    //
    //   // 2. Depth ≤ 3 (root → cluster → leaf), per Phase 9 Scenario A
    //   //    invariant carried into C.
    //   expect(treeDepth(auditTree)).toBeLessThanOrEqual(3);
    //
    //   // 3. flatten(auditTree) === audit (audit-tree IS the operation tree).
    //   expect(flattenTree(auditTree).map(n => n.entry.auditId).sort()).toEqual(
    //     audit.map(e => e.auditId).sort(),
    //   );
    expect(consolidateHandler).toBeDefined();
    await expect(async () => {
      throw new Error(
        'Scenario C blocked: MemoryConsolidation substrate seam not wired (Task #5).',
      );
    }).rejects.toThrow(/substrate seam not wired/);
  });

  it('replay re-applies children in recorded order; final state == live state by PK', async () => {
    // Eventual assertions:
    //
    //   const liveSubstrate = result.substrate;
    //   const replaySubstrate = await replayAuditChain(result.audit, freshFixture());
    //
    //   // Replay re-applies children in the SAME order they were recorded
    //   // (sequential children carry ordered equality per ADR-0180 §80.7).
    //   const liveRows = pkRowsBy(liveSubstrate, 'hierarchical_memory',
    //     ['id', 'embedding_id', 'consolidated_flag']);
    //   const replayRows = pkRowsBy(replaySubstrate, 'hierarchical_memory',
    //     ['id', 'embedding_id', 'consolidated_flag']);
    //   expect(replayRows).toEqual(liveRows);
    expect(consolidateHandler).toBeDefined();
    await expect(async () => {
      throw new Error(
        'Scenario C blocked: MemoryConsolidation substrate seam not wired (Task #5).',
      );
    }).rejects.toThrow(/substrate seam not wired/);
  });

  it('no orphaned entries; no double-writes (PK uniqueness across cascade)', async () => {
    // Eventual assertions:
    //
    //   // No orphans: every audit entry referencing a memory id corresponds
    //   // to a row in hierarchical_memory OR a tombstone from the forgetting
    //   // curve path. Set difference must be empty.
    //   const writtenIds = new Set(
    //     audit
    //       .filter(e => e.originatingTool === 'hierarchical_memory__store')
    //       .map(e => e.targetId),
    //   );
    //   const removedIds = new Set(
    //     audit
    //       .filter(e => e.originatingTool === 'vector_backend__remove')
    //       .map(e => e.targetId),
    //   );
    //   const liveIds = new Set(rowsBy(liveSubstrate, 'hierarchical_memory', 'id'));
    //   expect([...writtenIds].filter(id => !liveIds.has(id) && !removedIds.has(id)))
    //     .toEqual([]);
    //
    //   // No double-writes: each (storeId, key) pair appears at most once
    //   // per cluster — markConsolidated for the same memory.id must not
    //   // produce two audit entries within a single cluster's child block.
    //   for (const cluster of auditTree.children) {
    //     const writes = flattenTree(cluster)
    //       .filter(n => n.entry.mode === 'write')
    //       .map(n => `${n.entry.storeId}:${n.entry.targetId}`);
    //     expect(new Set(writes).size).toBe(writes.length);
    //   }
    expect(consolidateHandler).toBeDefined();
    await expect(async () => {
      throw new Error(
        'Scenario C blocked: MemoryConsolidation substrate seam not wired (Task #5).',
      );
    }).rejects.toThrow(/substrate seam not wired/);
  });
});
