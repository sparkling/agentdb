# ADR-006: Unified Self-Learning RVF Integration

**Status:** Proposed
**Date:** 2026-02-17
**Author:** System Architect (AgentDB v3)
**Supersedes:** None
**Related:** ADR-003 (RVF Format), ADR-004 (AGI Capabilities), ADR-005 (Self-Learning Pipeline)

## Context

ADR-005 created six standalone self-learning components:

| Component                 | File                             | Purpose                                                                           | Status     |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| `SonaLearningBackend`     | `rvf/SonaLearningBackend.ts`     | Trajectory recording, micro-LoRA, EWC++                                           | Standalone |
| `AdaptiveIndexTuner`      | `rvf/AdaptiveIndexTuner.ts`      | TemporalCompressor + IndexHealthMonitor                                           | Standalone |
| `ContrastiveTrainer`      | `rvf/ContrastiveTrainer.ts`      | InfoNCE loss, hard negative mining, curriculum                                    | Standalone |
| `SemanticQueryRouter`     | `rvf/SemanticQueryRouter.ts`     | Intent-based query routing via HNSW                                               | Standalone |
| `FederatedSessionManager` | `rvf/FederatedSessionManager.ts` | Cross-session LoRA aggregation                                                    | Standalone |
| `RvfSolver`               | `rvf/RvfSolver.ts`               | Three-loop adaptive solver (Thompson Sampling + PolicyKernel + KnowledgeCompiler) | Standalone |

**Problem:** None of these components are imported or invoked by `RvfBackend.ts`.
The RVF backend's `searchAsync()` and `insertAsync()` paths have zero self-learning
integration. Queries are served with static HNSW search; no trajectory recording,
no query enhancement, no adaptive routing, no embedding improvement.

### RvfSolver: Three-Loop Adaptive Architecture

The `@ruvector/rvf-solver` (v0.1.3) provides the core adaptive policy engine.
Understanding its architecture is critical because it serves as the decision-making
backbone for all self-learning integration points:

```
+-----------------------------------------------+
|  Slow Loop: KnowledgeCompiler                  |
|  - Signature-based pattern cache               |
|  - Distills observations into compiled configs  |
+-----------------------------------------------+
        |                          ^
        v                          |
+-----------------------------------------------+
|  Medium Loop: PolicyKernel                     |
|  - Thompson Sampling (safety Beta + cost EMA)  |
|  - 18 context buckets (3 range x 3 distractor  |
|    x 2 noise levels)                           |
|  - Speculative dual-path execution             |
+-----------------------------------------------+
        |                          ^
        v                          |
+-----------------------------------------------+
|  Fast Loop: Constraint Propagation Solver      |
|  - Executes candidate strategies               |
|  - Reports outcomes back to PolicyKernel       |
+-----------------------------------------------+
        |
        v
+-----------------------------------------------+
|  SHAKE-256 Witness Chain (73 bytes/entry)      |
|  - Tamper-evident proof of all operations      |
+-----------------------------------------------+
```

**Thompson Sampling Two-Signal Model:** Each of the 18 context-bucketed bandits
maintains a safety Beta distribution and a cost EMA per arm. The safety signal
captures correctness (did the selected strategy produce a good result?). The
cost signal captures latency/resource usage. Arm selection samples from the
Beta posterior and weighs against cost, naturally balancing exploration vs
exploitation across different query complexity contexts.

**18 Context Buckets (3 range x 3 distractor x 2 noise):** Queries are classified
into one of 18 buckets based on three features: range (narrow/medium/wide search
scope), distractor density (low/medium/high number of near-miss candidates), and
noise level (clean/noisy embeddings). Each bucket maintains independent arm
statistics, enabling context-sensitive policy learning.

**Speculative Dual-Path Execution:** For uncertain decisions (high variance in
Beta posteriors), the solver runs two candidate arms in parallel and picks the
winner. `PolicyState.speculativeAttempts` and `speculativeArm2Wins` track how
often this improves outcomes.

**KnowledgeCompiler Pattern Cache:** The slow loop distills recurring observation
patterns into signature-based compiled configurations. `TrainResult.patternsLearned`
reports how many patterns the ReasoningBank has distilled. These compiled patterns
enable instant decisions for known scenarios, bypassing Thompson Sampling entirely.

**A/B/C Ablation Validation:** The solver's `acceptance()` method validates learning
via three modes:

- **Mode A (fixed):** Static heuristic — no learning baseline
- **Mode B (compiler):** KnowledgeCompiler patterns only — compiled knowledge
- **Mode C (learned):** Full Thompson Sampling + KnowledgeCompiler — complete system

Mode C must outperform both A and B on holdout data, with all operations recorded
in the SHAKE-256 witness chain for tamper-evident auditability.

**Solver API used in integration:**

| Method                       | Returns              | Used In                                          |
| ---------------------------- | -------------------- | ------------------------------------------------ |
| `RvfSolver.create()`         | `Promise<RvfSolver>` | `SelfLearningRvfBackend.create()` initialization |
| `solver.train(options)`      | `TrainResult`        | Background learning cycle (Phase 5)              |
| `solver.acceptance(options)` | `AcceptanceManifest` | Validation after learning cycles                 |
| `solver.policy()`            | `PolicyState`        | Adaptive ef_search selection (Phase 1)           |
| `solver.witnessChain()`      | `Uint8Array`         | Audit trail for learning operations              |
| `solver.destroy()`           | `void`               | `SelfLearningRvfBackend.destroy()` cleanup       |

**PolicyState fields for integration:**

| Field                  | Type                                            | Integration Use                                    |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `contextStats`         | `Record<string, Record<string, SkipModeStats>>` | Per-bucket arm success rates → ef_search selection |
| `speculativeAttempts`  | `number`                                        | Monitor dual-path execution frequency              |
| `speculativeArm2Wins`  | `number`                                        | Track when exploration beats exploitation          |
| `earlyCommitPenalties` | `number`                                        | Detect when the solver is over-committing          |
| `prepass`              | `string`                                        | Current fast-path strategy identifier              |

### State-of-the-Art Research Findings

Deep research into 2024-2026 SoTA across three domains informed this decision:

**Adaptive Vector Search (2024-2026):**

- Ada-ef (Dec 2025): Per-query adaptive ef_search selection yields 1.5-3x
  throughput improvement at equal recall vs static ef values
- VDTuner (VLDB 2024): Bayesian optimization for HNSW M/efConstruction finds
  optimal parameters in <20 iterations
- SingleStore-V (VLDB 2024): Progressive index building with quick initial +
  background refinement reduces cold-start from minutes to milliseconds

**Continual Learning for Retrieval (2024-2026):**

- CL-LoRA (CVPR 2025): Dual-adapter architecture with orthogonal init +
  gradient reassignment achieves SOTA continual learning without replay buffers
- EWC for KG (NeurIPS 2025): EWC reduces catastrophic forgetting by 45.7%;
  semantically coherent task partitioning increases forgetting by 9.8pp
- NV-Retriever (Jul 2024): ~70% of mined hard negatives are false negatives;
  positive-aware filtering is essential
- K-Merge (Oct 2025): Storage-budget-aware LoRA adapter merging for on-device
  scenarios matches our agent architecture
- DPO (2024-2025): Direct Preference Optimization as a contrastive loss
  parameterization eliminates explicit reward models

**Federated & Memory-Augmented Retrieval (2024-2026):**

- SCAFFOLD (2024-2025): Control variates correct for client drift in
  heterogeneous agent sessions; outperforms FedAvg/FedProx
- HiAgent (ACL 2025): Hierarchical working/episodic/long-term memory with
  attention-based promotion/demotion
- RAGRouter (May 2025): Learned routing with RAG capability embeddings
  achieves +3.61% accuracy over static routing
- Faiss OPQ (2024): Orthogonal rotation before quantization improves recall
  by ~60% at equivalent compression ratios

## Decision

Integrate ADR-005 components into `RvfBackend` via a new **`SelfLearningRvfBackend`**
wrapper class that augments the existing `RvfBackend` with self-learning on every
search and insert operation. The integration proceeds in 5 phases.

### Architecture: Data Flow

```
                        ┌──────────────────────────────────────┐
                        │       SelfLearningRvfBackend         │
                        │  (extends/wraps RvfBackend)          │
                        ├──────────────────────────────────────┤
   searchAsync(query)   │                                      │
   ──────────────────>  │  1. SemanticQueryRouter.route(query)  │
                        │     → select search strategy          │
                        │                                      │
                        │  2. SonaLearningBackend.enhance(query)│
                        │     → micro-LoRA query refinement     │
                        │                                      │
                        │  3. RvfBackend.searchAsync(enhanced)  │
                        │     → HNSW search with adaptive ef    │
                        │                                      │
                        │  4. Record trajectory step             │
                        │     → SonaLearningBackend.addStep()   │
                        │                                      │
   <──────────────────  │  5. Return results                    │
                        │                                      │
   insertAsync(id,vec)  │                                      │
   ──────────────────>  │  1. ContrastiveTrainer.project(vec)   │
                        │     → improved embedding (optional)   │
                        │                                      │
                        │  2. RvfBackend.insertAsync(id, vec)   │
                        │     → HNSW insert                     │
                        │                                      │
                        │  3. TemporalCompressor.track(id)      │
                        │     → register for frequency tracking │
                        │                                      │
   <──────────────────  │  4. Return                            │
                        │                                      │
   feedback(quality)    │                                      │
   ──────────────────>  │  1. SonaLearningBackend.endTrajectory │
                        │  2. ContrastiveTrainer.addSample()    │
                        │  3. FederatedSessionManager.record()  │
                        └──────────────────────────────────────┘
```

### Storage Backend: @ruvector (NOT pgvector)

All vector persistence in the RVF stack uses the **@ruvector** ecosystem exclusively.
The system MUST NOT use `pgvector` for any vector storage, indexing, or search operations.

**Rationale:** pgvector is a generic PostgreSQL extension for approximate nearest
neighbor search. It lacks the RVF-specific capabilities that the self-learning
pipeline depends on:

| Capability                  | @ruvector/rvf           | pgvector           |
| --------------------------- | ----------------------- | ------------------ |
| Binary format               | `.rvf` (crash-safe)     | PostgreSQL heap    |
| HNSW implementation         | Custom (SIMD-optimized) | Generic            |
| Witness chain (SHAKE-256)   | Native                  | Not supported      |
| Kernel/eBPF embedding       | Native segments         | Not supported      |
| Segment signing             | Built-in                | Not supported      |
| Product/scalar quantization | Built-in profiles       | Partial (halfvec)  |
| Lineage/provenance tracking | fileId/parentId/derive  | Not supported      |
| Metadata filter expressions | Native RvfFilterExpr    | SQL WHERE clauses  |
| WASM portability            | @ruvector/rvf-wasm      | PostgreSQL-only    |
| Adaptive ef_search (solver) | @ruvector/rvf-solver    | Not supported      |
| N-API native performance    | @ruvector/rvf-node      | libpq + extensions |

**Storage tiers in the @ruvector stack:**

| Tier   | Package              | Runtime | Use Case                              |
| ------ | -------------------- | ------- | ------------------------------------- |
| Native | `@ruvector/rvf-node` | N-API   | Production (SIMD, crash safety)       |
| WASM   | `@ruvector/rvf-wasm` | WASM    | Browser, edge, Cloudflare Workers     |
| Auto   | `@ruvector/rvf`      | auto    | SDK auto-selects node → wasm fallback |

**PostgreSQL persistence:** When relational persistence is required (e.g., metadata,
session state, audit logs), the system uses `@ruvector/rvf` file-based stores or
future `@ruvector` PostgreSQL extensions — never `pgvector`. Vector data remains in
the `.rvf` binary format; PostgreSQL serves only as a coordination/metadata layer
when needed.

**Constraint:** Any future PostgreSQL integration MUST use @ruvector's native
extension that reads/writes `.rvf` segments directly, preserving witness chains,
lineage tracking, and segment signing. Falling back to pgvector would break the
tamper-evident audit trail and lose RVF-specific capabilities (kernel embedding,
eBPF programs, quantization profiles, adaptive ef_search via solver).

### Phase 1: Core Search Integration (~300 lines)

Wire `SonaLearningBackend` and `SemanticQueryRouter` into the search path.

**What changes:**

- Create `SelfLearningRvfBackend` wrapping `RvfBackend`
- `searchAsync()` calls `SonaLearningBackend.enhance(query)` before HNSW search
- Each search starts a trajectory (`beginTrajectory`) and records results as steps
- `SemanticQueryRouter` routes queries to different ef_search values based on
  learned intent (research, exact-match, exploratory → ef 50/100/200)
- `SonaLearningBackend.tick()` called on configurable interval (default 5s)

**SoTA enhancement — Adaptive ef_search via RvfSolver's PolicyKernel:**
Instead of static ef_search, leverage the `RvfSolver`'s Thompson Sampling
two-signal model to select ef_search per query. Define 4 arms: ef={50, 100,
200, 400}. The safety Beta distribution receives a binary reward (did the
search return relevant results?). The cost EMA tracks search latency.

The solver's 18 context buckets (3 range x 3 distractor x 2 noise) map to
query characteristics:

- **Range** → estimated from `SemanticQueryRouter.route()` top score
  (high score = narrow/focused, low score = wide/exploratory)
- **Distractor** → estimated from number of intents above threshold
  (many near-matches = high distractor density)
- **Noise** → estimated from query embedding norm deviation from unit
  (embeddings far from unit sphere indicate noisy/uncertain queries)

When the solver's Beta posterior has high variance (uncertain which ef is
best), speculative dual-path execution runs two ef values in parallel and
picks the winner — transparently improving decisions while the system learns.

As patterns stabilize, the KnowledgeCompiler distills them into compiled
configs: known query signatures get instant ef assignment without sampling.
`TrainResult.patternsLearned` tracks how many ef-selection patterns have
been compiled.

**Files:**

- NEW: `rvf/SelfLearningRvfBackend.ts` (~300 lines)

### Phase 2: Insert Path & Temporal Compression (~200 lines)

Wire `TemporalCompressor` and `IndexHealthMonitor` into the insert and
maintenance paths.

**What changes:**

- `insertAsync()` registers each vector with `TemporalCompressor` for frequency tracking
- Background task runs `TemporalCompressor` tier transitions on configurable interval
- `IndexHealthMonitor` tracks insert/search latencies and triggers HNSW rebuild
  when health degrades
- `compact()` method also runs temporal compression pass

**SoTA enhancement — Positive-aware frequency (NV-Retriever pattern):**
Track access frequency per vector ID. Vectors that appear in search results
increment their frequency; vectors never retrieved decay. This maps directly to
`TemporalCompressor`'s existing 5-tier system (none/half/pq8/pq4/binary).

**SoTA enhancement — Unreachable node monitoring:**
Add unreachable node ratio to `IndexHealthMonitor`. When compressed vectors are
lazy-deleted from HNSW, their neighbors may become orphaned. Trigger rebuild
when unreachable/total > 0.05.

**Files:**

- EDIT: `rvf/SelfLearningRvfBackend.ts` (+200 lines)

### Phase 3: Contrastive Embedding Improvement (~250 lines)

Wire `ContrastiveTrainer` into the feedback loop to continuously improve
embeddings.

**What changes:**

- When a search trajectory ends with quality feedback, record (query, results,
  quality) as a training sample
- Results with quality > 0.7 become positive pairs (query, top-result)
- Results with quality < 0.3 become negative pairs (query, top-result)
- `ContrastiveTrainer.trainBatch()` runs when sample buffer reaches threshold
- Trained projection is applied to future queries via `project()` before search

**SoTA enhancement — Positive-aware hard negative filtering (NV-Retriever):**
Before adding a candidate to the hard negative set, check its similarity to all
known positives. If max similarity > 0.85, skip it (likely a false negative).
This eliminates ~70% of false negatives that poison training.

**SoTA enhancement — DPO preference loss:**
When two search trajectories for similar queries have different quality scores,
create a preference pair. The DPO loss directly optimizes the projection to
prefer the higher-quality result's embedding region:

```
L_DPO = -log(σ(β * (sim(q, y_w) - sim(q, y_l))))
```

This is implemented as an additional term in `ContrastiveTrainer.trainBatch()`.

**Files:**

- EDIT: `rvf/SelfLearningRvfBackend.ts` (+150 lines)
- EDIT: `rvf/ContrastiveTrainer.ts` (+100 lines for DPO loss + false-negative filter)

### Phase 4: Federated Session Lifecycle (~200 lines)

Wire `FederatedSessionManager` into the backend lifecycle.

**What changes:**

- `SelfLearningRvfBackend.beginSession(agentId)` creates a federated session
- All trajectories within the session are recorded to the session handle
- `endSession()` aggregates session data into the `FederatedCoordinator`
- New sessions receive warm-start patterns from the coordinator
- LoRA adapters are managed per agent type (coder, researcher, tester)

**SoTA enhancement — SCAFFOLD aggregation:**
Replace simple weighted averaging with SCAFFOLD control variates. Each agent
session maintains a local control variate `c_i`. On aggregation:

```
delta_corrected = local_update + c_global - c_local
c_global += (1/N) * (c_local_new - c_local_old)
```

This corrects for client drift when heterogeneous agents (coder vs researcher)
push embeddings in conflicting directions.

**SoTA enhancement — K-Merge adapter management:**
When the number of LoRA adapters exceeds storage budget, use K-Merge to decide:
merge incoming adapter with the most similar existing one via TIES (sign-based
consensus with sparsification), or replace the least-used adapter.

**Files:**

- EDIT: `rvf/SelfLearningRvfBackend.ts` (+150 lines)
- EDIT: `rvf/FederatedSessionManager.ts` (+50 lines for SCAFFOLD + K-Merge)

### Phase 5: Background Learning Cycle & Solver Training (~200 lines)

Wire all components into a unified background learning cycle, with
`RvfSolver.train()` driving policy improvement and `RvfSolver.acceptance()`
providing periodic validation.

**What changes:**

- `SelfLearningRvfBackend.tick()` orchestrates (mirrors the solver's
  fast/medium/slow loop structure):
  1. **Fast loop** — `SonaLearningBackend.tick()`: background LoRA update
  2. **Fast loop** — `ContrastiveTrainer.trainBatch()`: if sample buffer is full
  3. **Medium loop** — `RvfSolver.train()`: feed recent search outcomes into
     the PolicyKernel's Thompson Sampling bandits, updating per-context-bucket
     arm statistics (safety Beta + cost EMA)
  4. **Slow loop** — `TemporalCompressor`: tier transitions for decayed vectors
  5. **Slow loop** — `IndexHealthMonitor`: health assessment + rebuild recommendation
  6. **Slow loop** — `FederatedSessionManager`: auto-consolidation if interval elapsed
- Configurable tick interval (default 5000ms)
- `forceLearn()` runs all steps immediately, including a `solver.train()` pass
- `getStats()` returns unified statistics including `solver.policy()` state:
  `contextStats` (per-bucket arm success rates), `speculativeAttempts`,
  `speculativeArm2Wins`, `earlyCommitPenalties`, and `patternsLearned`

**Solver-driven validation cycle:**
Periodically (every N ticks, configurable), run `solver.acceptance()` with
a small holdout set to validate that the learned policy (Mode C) outperforms
the fixed baseline (Mode A) and compiler-only (Mode B). If Mode C regresses
below Mode A accuracy, disable adaptive ef_search and fall back to static
values until the next successful acceptance run. The `AcceptanceManifest`
is recorded in the SHAKE-256 witness chain (`witnessEntries`, `witnessChainBytes`)
for tamper-evident auditability of the learning process itself.

```typescript
// Periodic validation example
const manifest = solver.acceptance({
  cycles: 3,
  holdoutSize: 30,
  trainingPerCycle: 100,
});
if (
  !manifest.allPassed ||
  manifest.modeC.finalAccuracy < manifest.modeA.finalAccuracy
) {
  // Regression detected: disable adaptive ef until next successful validation
  this.useAdaptiveEf = false;
}
```

**SoTA enhancement — CL-LoRA dual-adapter protection:**
During background learning, apply gradient reassignment for the shared
micro-LoRA adapter: project out gradient components that conflict with previous
task knowledge (using EWC Fisher diagonal as mask). This prevents the shared
adapter from being overwritten by the most recent agent session.

**Files:**

- EDIT: `rvf/SelfLearningRvfBackend.ts` (+200 lines)

### Summary: SelfLearningRvfBackend API Surface

```typescript
class SelfLearningRvfBackend implements VectorBackendAsync {
  // Standard VectorBackendAsync (delegates to RvfBackend)
  insertAsync(id, embedding, metadata): Promise<void>;
  insertBatchAsync(items): Promise<void>;
  searchAsync(query, k, options): Promise<SearchResult[]>;
  removeAsync(id): Promise<boolean>;
  getStats(): VectorStats;
  getStatsAsync(): Promise<VectorStats>;

  // Session lifecycle
  beginSession(agentId: string): Promise<string>;
  endSession(sessionId: string, quality: number): Promise<void>;

  // Trajectory feedback
  recordFeedback(queryId: string, quality: number): void;

  // Learning control
  tick(): Promise<void>;
  forceLearn(): Promise<void>;

  // Solver: adaptive policy
  getSolverPolicy(): PolicyState | null;
  runAcceptance(options?: AcceptanceOptions): AcceptanceManifest;
  getWitnessChain(): Uint8Array | null;

  // Statistics
  getLearningStats(): LearningStats;

  // Configuration
  static create(config: SelfLearningConfig): Promise<SelfLearningRvfBackend>;

  // Cleanup
  destroy(): Promise<void>;
}

interface SelfLearningConfig extends RvfConfig {
  /** Enable/disable self-learning (default: true) */
  learning?: boolean;
  /** Background tick interval in ms (default: 5000) */
  tickIntervalMs?: number;
  /** SONA embedding dimension for learning (default: matches vector dim) */
  learningDimension?: number;
  /** Minimum trajectory quality to trigger positive training (default: 0.7) */
  positiveThreshold?: number;
  /** Maximum trajectory quality to trigger negative training (default: 0.3) */
  negativeThreshold?: number;
  /** Contrastive training batch size (default: 32) */
  trainingBatchSize?: number;
  /** Maximum LoRA adapters before K-Merge (default: 10) */
  maxAdapters?: number;
  /** Enable federated session management (default: false) */
  federated?: boolean;
  /** Solver training count per tick (default: 50) */
  solverTrainCount?: number;
  /** Solver difficulty range for training (default: 1-5) */
  solverMinDifficulty?: number;
  solverMaxDifficulty?: number;
  /** Acceptance validation interval in ticks (default: 100) */
  acceptanceIntervalTicks?: number;
  /** Acceptance holdout size (default: 30) */
  acceptanceHoldoutSize?: number;
  /** RNG seed for solver reproducibility (default: random) */
  solverSeed?: bigint | number;
}
```

## Security

- All existing `RvfBackend` security measures are preserved (path validation,
  batch limits, metadata sanitization, dimension validation)
- `SelfLearningRvfBackend` operates on embeddings only; no user text enters
  the learning pipeline
- Trajectory quality scores are clamped to [0, 1]
- LoRA rank bounded (1-64); adapter count bounded by `maxAdapters`
- SCAFFOLD control variates are bounded by per-agent gradient clipping
- K-Merge adapter merging uses sign-based consensus, preventing any single
  agent from dominating the merged adapter
- Background tick cannot run concurrently (mutex guard)
- All new state is in-memory; no additional file I/O beyond RvfBackend's .rvf
- **Solver tamper evidence:** Every `train()` and `acceptance()` operation is
  recorded in the SHAKE-256 witness chain (73 bytes/entry, cryptographically
  linked). `witnessChain()` returns a copy safe to persist or audit externally.
  The chain proves that learning operations occurred in sequence and were not
  retroactively modified
- **Solver instance limits:** Up to 8 concurrent `RvfSolver` instances are
  supported; excess `create()` calls are rejected. The ~160 KB WASM binary
  is loaded once and shared across instances
- **Solver difficulty bounds:** `TrainOptions.minDifficulty` and
  `maxDifficulty` are clamped to [1, 10]; `AcceptanceOptions.stepBudget`
  limits constraint propagation steps per puzzle to prevent runaway computation
- **Acceptance regression guard:** If `solver.acceptance()` shows Mode C
  (learned) regressing below Mode A (fixed baseline), adaptive ef_search is
  automatically disabled — the system never degrades below static performance
- **No pgvector dependency:** Vector storage and search exclusively use the
  `@ruvector/rvf` stack (N-API or WASM). The pgvector PostgreSQL extension is
  explicitly prohibited — it cannot maintain witness chain integrity, segment
  signing, or RVF lineage provenance. Any future PostgreSQL integration must
  use @ruvector's native PostgreSQL extension that preserves `.rvf` format
  guarantees end-to-end

## Performance

| Operation              | Without Learning | With Learning | Overhead                                     |
| ---------------------- | ---------------- | ------------- | -------------------------------------------- |
| `searchAsync()`        | ~0.5ms           | ~1.2ms        | +0.7ms (enhance + trajectory + ef selection) |
| `insertAsync()`        | ~0.3ms           | ~0.35ms       | +0.05ms (frequency tracking)                 |
| `tick()` (background)  | N/A              | ~15ms         | Non-blocking (includes solver.train)         |
| `trainBatch()`         | N/A              | ~15ms         | Per 32-sample batch                          |
| `endSession()`         | N/A              | ~5ms          | Per session aggregation                      |
| `solver.train(50)`     | N/A              | ~3ms          | 50 puzzles per tick (WASM)                   |
| `solver.acceptance(3)` | N/A              | ~50ms         | 3 cycles x (200 train + 50 holdout)          |
| `solver.policy()`      | N/A              | <0.1ms        | Read-only snapshot of PolicyState            |

The ~0.7ms search overhead breaks down as:

- SemanticQueryRouter.route(): ~0.1ms (pre-computed centroids)
- SonaLearningBackend.enhance(): ~0.3ms (micro-LoRA N-API)
- Solver ef_search selection: ~0.05ms (sample from Beta posterior or
  KnowledgeCompiler lookup for compiled patterns)
- Trajectory bookkeeping: ~0.25ms

When speculative dual-path execution triggers (high Beta variance), two
ef_search values run in parallel — the latency is max(ef_a, ef_b) not
sum, with `speculativeArm2Wins` tracking how often the second arm wins.

The solver's ~160 KB WASM binary loads once on first `create()` call;
subsequent instances reuse the loaded module with negligible overhead.

All learning operations run asynchronously and do not block the search path.

## Testing Strategy

Each phase adds tests following existing patterns in `tests/backends/`:

- **Phase 1**: Search integration tests — verify query enhancement improves
  results, trajectory recording captures search events, router selects
  appropriate ef values
- **Phase 2**: Compression tests — verify frequency tracking, tier transitions,
  health monitoring triggers
- **Phase 3**: Training tests — verify positive/negative sample collection,
  DPO loss reduces preference violations, false-negative filtering works
- **Phase 4**: Session tests — verify warm-start patterns improve cold-start
  quality, SCAFFOLD corrects for heterogeneous agents
- **Phase 5**: Integration tests — end-to-end: insert vectors, search, provide
  feedback, verify learning improves subsequent search quality

Target: 50+ tests across all phases, all passing with `npm test`.

## Consequences

### Positive

- Every search and insert operation contributes to continuous improvement
- Queries are enhanced before search (micro-LoRA), yielding better results
- Embeddings improve over time (contrastive training from feedback)
- Unused vectors are automatically compressed (temporal decay)
- Cross-agent knowledge transfer via federated session management
- Adaptive ef_search selection via Thompson Sampling's two-signal model
  (safety Beta + cost EMA) across 18 context buckets reduces latency while
  maintaining recall quality
- KnowledgeCompiler compiles stable patterns into instant ef assignments,
  eliminating sampling overhead for known query signatures
- Speculative dual-path execution resolves uncertainty without sacrificing
  latency (parallel ef exploration, pick the winner)
- A/B/C ablation via `solver.acceptance()` provides built-in validation
  that learning is genuinely improving over static baselines
- SHAKE-256 witness chain (73 bytes/entry) provides tamper-evident audit
  trail for all learning operations
- All improvements are transparent — existing `VectorBackendAsync` callers
  work without code changes
- Exclusive use of @ruvector stack ensures witness chain integrity, segment
  signing, lineage provenance, and adaptive solver capabilities are preserved
  end-to-end — capabilities that pgvector cannot provide

### Negative

- ~0.7ms additional search latency (acceptable for <2ms total)
- Increased memory usage for trajectory buffers, training samples, and
  solver PolicyState (18 buckets x N arms of Beta distribution parameters)
- More complex initialization (create requires async factory + WASM load)
- Background tick requires lifecycle management (destroy on shutdown, which
  calls `solver.destroy()` to free WASM resources)
- Maximum 8 concurrent solver instances per process

### Risks

- **Learning instability**: Multiple adaptive systems (SONA, contrastive,
  federated, solver) could interact unpredictably. Mitigated by EWC++
  protection, gradient reassignment, quality-gated training (only > 0.7
  quality triggers positive samples), and solver acceptance regression
  guard (auto-disable adaptive ef if Mode C < Mode A).
- **Memory growth**: Trajectory buffers and training samples accumulate.
  Mitigated by configurable capacity limits and TemporalCompressor tier
  transitions.
- **N-API binary compatibility**: SonaEngine and RVF depend on platform-specific
  N-API binaries. Mitigated by WASM fallback. The solver itself is pure WASM
  (~160 KB `no_std`), running on any WebAssembly runtime (Node.js, browsers,
  Deno, Cloudflare Workers, edge runtimes).
- **Cold start**: New installations have no learned patterns. Mitigated by
  conservative defaults — learning is additive, never degrades below baseline
  RvfBackend performance. The solver starts with uniform Beta priors
  (Beta(1,1)) and converges within ~100 queries.
- **Solver over-commitment**: Early-commit penalties (`earlyCommitPenalties`,
  `earlyCommitsWrong` in PolicyState) can accumulate if the solver commits
  to arms prematurely. Mitigated by monitoring the wrong/total ratio and
  increasing the speculation threshold when it exceeds 0.2.

## References

- [@ruvector/rvf-solver](https://www.npmjs.com/package/@ruvector/rvf-solver) v0.1.3 — Three-loop adaptive solver with Thompson Sampling, PolicyKernel, KnowledgeCompiler, ReasoningBank, and SHAKE-256 witness chains
- [Ada-ef: Distribution-Aware Adaptive HNSW Search](https://arxiv.org/html/2512.06636v1) (Dec 2025)
- [VDTuner: Automated Performance Tuning for Vector Databases](https://arxiv.org/html/2404.10413v1) (VLDB 2024)
- [CL-LoRA: Continual Low-Rank Adaptation](https://openaccess.thecvf.com/content/CVPR2025/papers/He_CL-LoRA_Continual_Low-Rank_Adaptation_for_Rehearsal-Free_Class-Incremental_Learning_CVPR_2025_paper.pdf) (CVPR 2025)
- [EWC for Knowledge Graph Continual Learning](https://arxiv.org/abs/2512.01890) (NeurIPS 2025)
- [NV-Retriever: Positive-Aware Hard Negative Mining](https://arxiv.org/pdf/2407.15831) (Jul 2024)
- [K-Merge: Online Continual Merging of Adapters](https://arxiv.org/abs/2510.13537) (Oct 2025)
- [RAGRouter: Learning to Route Queries](https://arxiv.org/abs/2505.23052) (May 2025)
- [SCAFFOLD: Stochastic Controlled Averaging for Federated Learning](https://arxiv.org/abs/1910.06378)
- [HiAgent: Hierarchical Working Memory Management](https://aclanthology.org/2025.acl-long.1575.pdf) (ACL 2025)
- [Faiss: Billion-Scale Similarity Search](https://arxiv.org/html/2401.08281v4) (Jan 2024)
- [UI-Mem: Self-Evolving Experience Memory](https://arxiv.org/html/2602.05832) (Feb 2026)
- [SingleStore-V: Progressive Index Building](https://cs.purdue.edu/homes/csjgwang/pubs/VLDB24_SingleStoreVec.pdf) (VLDB 2024)
- [MoLE: Mixture of LoRA Experts](https://aclanthology.org/2025.findings-emnlp.718.pdf) (EMNLP 2025)
- [ACGCL: Adversarial Curriculum Graph Contrastive Learning](https://proceedings.iclr.cc/paper_files/paper/2025/file/b010241b9f1cdfc7d4c392db899cef86-Paper-Conference.pdf) (ICLR 2025)
- [EvicPress: Joint KV-Cache Compression and Eviction](https://arxiv.org/html/2512.14946) (Dec 2025)
- [P-HNSW: Crash-Consistent HNSW on Persistent Memory](https://www.mdpi.com/2076-3417/15/19/10554) (Sep 2025)
- [Comparative Analysis of FedAvg, FedProx, and SCAFFOLD](https://www.sciencexcel.com/articles/cnpC3r6PRmZB7rAWkyFDlXlb506SbsezBR9bhAjX.pdf)
