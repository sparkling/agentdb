# Migration Log — ADR-0161

This log records the file-level dispositions for the agentdb migration from
`forks/agentic-flow/packages/agentdb/` (alpha.10-patch.492) into this fork
(alpha.14 base = `ruvnet/agentdb` HEAD `a478ab3`).

**Source SHA**: `forks/agentic-flow@75b6e041` (HEAD `75b6e04`).
**Mechanic**: file-level three-way merge (NOT cherry-pick replay — empirical
validation showed 8/8 sample patches HARD_CONFLICT under `git apply --check`
forward/reverse/`--3way`; the conceptual changes are present in alpha.13 base
but the patches don't apply mechanically).

## Step 1: Fork-only files lifted

Commit `d7ca0f6`: 20 files / 8,262 insertions.

| File | Disposition | ADR |
|---|---|---|
| `src/backends/ruvector/GuardedVectorBackend.ts` | LIFT | ADR-060 |
| `src/backends/rvf/index.ts` | LIFT | — |
| `src/config/embedding-config.ts` | LIFT | ADR-0052, ADR-0069 |
| `src/consensus/RaftConsensus.ts` | LIFT (TODO-guarded `dcbae20`) | none — dead-stub |
| `src/controllers/HierarchicalMemory.ts` | LIFT | ADR-066 |
| `src/controllers/MemoryConsolidation.ts` | LIFT | ADR-066 |
| `src/controllers/QUICConnection.ts` | LIFT (TODO-guarded `dcbae20`) | none — dead-stub |
| `src/controllers/QUICConnectionPool.ts` | LIFT (TODO-guarded `dcbae20`) | none — dead-stub |
| `src/controllers/QUICStreamManager.ts` | LIFT (TODO-guarded `dcbae20`) | none — dead-stub |
| `src/controllers/StreamingEmbeddingService.ts` | LIFT | ADR-062 |
| `src/optimizations/RVFOptimizer.ts` | LIFT | ADR-062, ADR-065, ADR-0069 |
| `src/security/AttestationLog.ts` | LIFT | ADR-060 |
| `src/security/MutationGuard.ts` | LIFT | ADR-060 |
| `src/security/index.ts` | LIFT | ADR-060 |
| `src/services/GNNService.ts` | LIFT | ADR-062 |
| `src/services/GraphTransformerService.ts` | LIFT | ADR-062 |
| `src/services/SemanticRouter.ts` | LIFT | ADR-062 |
| `src/services/SonaTrajectoryService.ts` | LIFT | ADR-062 |
| `src/utils/LegacyAttentionAdapter.ts` | LIFT | ADR-056 (legacy bridge) |
| `src/utils/vector-math.ts` | LIFT | — (shared util) |

## Step 2: 59 differing-file reconciliations

### Trivial (≤5 lines, 14 files)

| File | Disposition | Commit | ADR |
|---|---|---|---|
| `backends/detector.ts` | SKIP — upstream cleaner; our `(core as any)` cast was stale regression | — | — |
| `backends/rvf/SqlJsRvfBackend.ts` | APPLY | `795aad9` | ADR-0080 |
| `cli/attention-cli-integration.ts` | APPLY | `a6e7996` | ADR-0069 |
| `cli/commands/install-embeddings.ts` | APPLY | `a6e7996` | ADR-0069 |
| `cli/commands/rvf.ts` | APPLY | `a6e7996` | ADR-0069 |
| `cli/lib/config-validator.ts` | APPLY | `a6e7996` | ADR-0069 |
| `cli/lib/help-formatter.ts` | APPLY | `a6e7996` | ADR-0069 |
| `db/migrations/apply-migration.ts` | APPLY | `1c1bb2f` | ADR-0063 M3 |
| `middleware/rate-limit.middleware.ts` | APPLY | `049be89` | ADR-0069 A2 |
| `optimizations/index.ts` | 3-WAY MERGE — kept alpha.14's `ParallelBatchConfig`/`ParallelBatchResult` AND added our `RVFOptimizer`/`RVFConfig` | `1488543` | ADR-0161 |
| `security/input-validation.ts` | APPLY | `1c1bb2f` | ADR-0063 M3 |
| `security/limits.ts` | APPLY | `049be89` | ADR-0069 A2 |
| `simd/simd-vector-ops.ts` | APPLY | `a6e7996` | ADR-0069 |
| `wrappers/agentdb-fast.ts` | APPLY | `a6e7996` | ADR-0069 |

### Small (6-20 lines, 19 files)

| File | Disposition | Commit | ADR |
|---|---|---|---|
| `cli/commands/init.ts` | APPLY | `a6ca0dc` | ADR-0069 + A1 busy_timeout |
| `controllers/QUICServer.ts` | APPLY | `042ac55` | ADR-0069 H6/A2 |
| `backends/ruvector/RuVectorLearning.ts` | APPLY | `96f3d83` | — (isInitialized helper) |
| `db-fallback.ts` | APPLY | `9a7f3a4` | ADR-0080 + MM-002 |
| `cli/commands/simulate-wizard.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `examples/quic-sync-example.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `cli/commands/migrate.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `db-unified.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `backends/rvf/SonaLearningBackend.ts` | APPLY | `96f3d83` | ADR-0069 A4 |
| `wrappers/embedding-service.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `backends/hnswlib/HNSWLibBackend.ts` | APPLY | `a6ca0dc` | ADR-0069 + deriveHNSWParams |
| `benchmark/BenchmarkSuite.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `controllers/HNSWIndex.ts` | APPLY | `a6ca0dc` | ADR-0069 + deriveHNSWParams |
| `cli/lib/attention-config.ts` | APPLY | `a6ca0dc` | ADR-0069 |
| `browser/HNSWIndex.ts` | APPLY | `a6ca0dc` | ADR-0069 (browser-safe lazy) |
| `browser/index.ts` | APPLY | `a6ca0dc` | ADR-0069 (browser-safe lazy) |
| `wrappers/attention-native.ts` | APPLY | `96f3d83` | — (native API contract update) |
| `core/QueryCache.ts` | APPLY | `96f3d83` | MM-002 cleanup interval |
| `model/ModelCacheLoader.ts` | APPLY | `96f3d83` | — (extended cache search paths) |

### Medium (21-100 lines, 14 files)

| File | Disposition | Commit | ADR |
|---|---|---|---|
| `controllers/EnhancedEmbeddingService.ts` | APPLY | `5cbf14c` | — (vector-math extraction) |
| `browser/AttentionBrowser.ts` | APPLY | `133a14e` | ADR-0069 (browser-safe) |
| `cli/agentdb-cli.ts` | APPLY | `133a14e` | ADR-0069 + A1/A2 |
| `mcp/attention-tools-handlers.ts` | APPLY | `133a14e` | ADR-0069 |
| `optimizations/ToolCache.ts` | APPLY | `72ceaae` | MM-002 |
| `controllers/attention/index.ts` | SKIP — alpha.14 is strict superset (legacy + new); our fork's reduced barrel would have removed alpha.14's new exports | — | — |
| `cli/commands/attention.ts` | APPLY | `133a14e` | ADR-0069 |
| `services/enhanced-embeddings.ts` | APPLY | `133a14e` | ADR-0069 |
| `controllers/CausalRecall.ts` | APPLY | `6785d39` | ADR-0040 + vector-math |
| `services/LLMRouter.ts` | APPLY | `133a14e` | ADR-0069 + dotenv refactor |
| `controllers/ExplainableRecall.ts` | APPLY | `6785d39` | ADR-0076 A4 + ADR-0090 B5 |
| `controllers/CausalMemoryGraph.ts` | APPLY | `6785d39` | ADR-0076 A4 + ADR-0090 B5 |
| `controllers/index.ts` | 3-WAY MERGE — kept all alpha.14 exports (SparsificationService, MincutService, MemoryController, attention controllers, prerequisites) AND added our fork's net-new (Causal*, Explainable*, NightlyLearner, LearningSystem, ReasoningBank, HierarchicalMemory, MemoryConsolidation, MutationGuard, AttestationLog, GuardedVectorBackend, vector-math) | `eb5763c` | ADR-0161 |
| `controllers/ReasoningBank.ts` | APPLY | `6785d39` | ADR-0076 A4 + vector-math + try/catch fallbacks |

### Large (100+ lines, 12 files)

| File | Disposition | Commit | ADR / Reason |
|---|---|---|---|
| `controllers/AttentionService.ts` (1503) | **SKIP** — alpha.14 split into modular `attention/{Cache,Config,Core,Helpers,Metrics,WASM}` files; our older monolithic version would regress upstream's Phase-1 NAPI integration. Fork-side ADR-0076 patches in dependent files (CausalMemoryGraph, ExplainableRecall) work via `utils/LegacyAttentionAdapter` which still exists. | — | — |
| `backends/ruvector/RuVectorBackend.ts` (664) | **SKIP** — alpha.14 moved to ruvector 0.1.99+ async API with `RuVectorLearning`/`getEmbeddingConfig`/`deriveHNSWParams`/native version detection. Our fork's `@ruvector/core` integration is materially older. | — | — |
| `controllers/ReflexionMemory.ts` (465) | **SKIP** — upstream alpha.11-14 evolution dominates | — | — |
| `core/AgentDB.ts` (425) | **SKIP** — central file with substantial upstream additions (alpha.11-14); fork-side patches in dependent controllers work without modifying the core class | — | — |
| `controllers/SkillLibrary.ts` (392) | **SKIP** — upstream evolution; if NightlyLearner skill consolidation surfaces a behavioral gap, follow-up commit | — | — |
| `mcp/agentdb-mcp-server.ts` (250) | APPLY | `b9b1815` | fork tool registrations |
| `controllers/WASMVectorSearch.ts` (218) | APPLY | `b9b1815` | fork patches |
| `controllers/NightlyLearner.ts` (192) | APPLY | `eb7f762` | ADR-0040 singleton + skill consolidation + vector-math + LegacyAttentionAdapter |
| `controllers/LearningSystem.ts` (184) | APPLY | `eb7f762` | ADR-0076 A4 + RuVector GNN + Sona |
| `backends/graph/GraphDatabaseAdapter.ts` (180) | APPLY | `eb7f762` | ESM-native existsSync fix + getEmbeddingConfig |
| `index.ts` (135) | 3-WAY MERGE — kept alpha.14's QueryCache, Vector Quantization (full surface), Hybrid Search, full Benchmarking Suite + added fork's net-new (RVFOptimizer, security limits, telemetry, RuVector services, RaftConsensus, SolverBandit, AttentionMetricsCollector, IndexHealthMonitor, AuditLogger, FederatedLearningManager, SelfLearningRvfBackend, NativeAccelerator, embedding-config) | `70fb4cb` | ADR-0161 |
| `backends/factory.ts` (130) | APPLY | `28fa179` | ADR-0060 GuardedVectorBackend + HNSWLibBackend wiring |

## Summary

- **Step 1**: 20 fork-only files lifted (1 commit + 1 follow-up TODO-guard commit)
- **Step 2**: 59 files reconciled
  - 49 APPLY (mechanical fork-side delta — most fall under ADR-0040, ADR-0052, ADR-0060, ADR-0061, ADR-0063, ADR-0066, ADR-0069, ADR-0076, ADR-0078, ADR-0080, ADR-0090, ADR-0094, MM-002)
  - 7 SKIP (kept alpha.14 — `detector.ts`, `controllers/attention/index.ts`, `controllers/AttentionService.ts`, `RuVectorBackend.ts`, `ReflexionMemory.ts`, `core/AgentDB.ts`, `SkillLibrary.ts`)
  - 3 explicit 3-way MERGE (`optimizations/index.ts`, `controllers/index.ts`, top-level `index.ts`) — preserved both alpha.14's surface AND fork additions
- **Total commits**: 27 (1 lift + 1 guard + 25 ADR-cluster reconciliations)
- **Validation**: 0 fork patches replayed via `git cherry-pick` (per ADR-0161, file-level three-way merge is the mechanic; 8/8 sample HARD_CONFLICT validated upfront)

## Empirical commit-replay statistics

- 191 raw fork-only commits in `forks/agentic-flow/packages/agentdb` post `git fetch upstream` (HEAD 5e0497d)
- 117 noise (109 `chore: bump versions to`, 4 `chore(publish): version bumps`, 2 `fork-version`, 1 `chore(preflight)`, 1 `chore(agentdb): Bump`)
- 74 substantive in `packages/agentdb` + 1 unique in `packages/agentdb-onnx` (`c702aa6`) + 0 unique in shim = **75 total substantive commits** (all addressed via file-level reconciliation, not commit replay)

## Pending steps (per ADR-0161)

- Step 3: Lift `agentdb-onnx` into `forks/agentdb/packages/agentdb-onnx/` (4 fixes: `cp -r`, `dependencies` not `peerDep`, ONNXEmbeddingService.ts:18 import rewrite, add `workspaces` field to `forks/agentdb/package.json`)
- Step 4: Build + test
- Steps 5-15: Verdaccio publish, codemod Pass 8, ruflo + agentic-flow consumer cutover, Rust adapter sanity check, plugin adoption, ruflo-patch config flips, acceptance + smoke, decommission vendored, supersede ADR-0160 + memory updates
