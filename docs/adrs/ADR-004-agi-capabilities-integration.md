# ADR-004: AGI Capabilities Integration for AgentDB v3

**Status:** Accepted
**Date:** 2026-02-17
**Author:** System Architect (AgentDB v3)
**Supersedes:** None
**Related:** ADR-003 (RVF Native Format Integration)

## Context

AgentDB v3 shipped with the RVF backend (ADR-003), providing single-file vector storage with crash safety, COW branching, and lineage tracking. The upstream @ruvector packages have since published AGI-oriented capabilities:

- **@ruvector/rvf-node@0.1.7**: 4 new native N-API methods (metric introspection, HNSW index stats, SHAKE-256 witness verification, state freeze)
- **@ruvector/rvf-solver@0.1.2**: Self-learning temporal solver with Thompson Sampling, context-bucketed bandits, KnowledgeCompiler, and witness chains (now bundles 132KB WASM binary)
- **@ruvector/rvf-wasm@0.1.6**: WASM backend now exports `rvf_witness_verify` and `rvf_witness_count`
- **@ruvector/rvf@0.1.9**: Unified SDK re-exporting both RvfDatabase and RvfSolver

### Package Assessment (2026-02-17)

#### @ruvector/rvf-node@0.1.7 -- 4 New AGI Methods (VERIFIED)

| Method               | Return          | Description                                                         |
| -------------------- | --------------- | ------------------------------------------------------------------- |
| `db.metric()`        | `string`        | Distance metric name (l2, cosine, inner_product)                    |
| `db.indexStats()`    | `IndexStats`    | HNSW stats: layers, M, efConstruction, indexedVectors, needsRebuild |
| `db.verifyWitness()` | `WitnessResult` | SHAKE-256 witness chain integrity: valid, entries, error            |
| `db.freeze()`        | `number`        | Snapshot-freeze state, returns epoch number                         |

All 4 methods tested successfully via `@ruvector/rvf-node` on Linux x86_64.

#### @ruvector/rvf-solver@0.1.1 -- Self-Learning Solver (SDK READY)

| Feature               | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| **Thompson Sampling** | Two-signal model (safety Beta + cost EMA)                                  |
| **Context Bandits**   | 18 bucketed bandits (3 range x 3 distractor x 2 noise)                     |
| **KnowledgeCompiler** | Signature-based pattern cache with hit/counterexample tracking             |
| **Three-Loop Solver** | Fast (constraint prop) / Medium (policy select) / Slow (knowledge distill) |
| **A/B/C Ablation**    | Mode A (heuristic), Mode B (compiler), Mode C (learned Thompson)           |
| **Witness Chain**     | SHAKE-256 tamper-evident chain (73 bytes/entry)                            |

SDK provides TypeScript types. WASM binary must be built from `crates/rvf/rvf-solver-wasm`.

## Decision

Integrate all AGI capabilities into AgentDB v3:

1. **RvfBackend extensions** -- Add 4 new methods wrapping the N-API AGI calls
2. **RvfSolver wrapper** -- New class wrapping @ruvector/rvf-solver with AgentDB patterns
3. **Type definitions** -- AGI-specific interfaces in VectorBackend.ts
4. **CLI integration** -- Solver subcommands under `agentdb rvf`
5. **Detector updates** -- Detect solver availability alongside rvf-node/rvf-wasm
6. **Export surface** -- All AGI types and classes exported from agentdb package

## Implementation

### Phase 1: RvfBackend AGI Extensions

Add to `RvfBackend.ts`:

```typescript
/** Get the distance metric name */
metric(): string

/** Get HNSW index statistics */
indexStats(): IndexStats

/** Verify SHAKE-256 witness chain integrity */
verifyWitness(): WitnessVerification

/** Snapshot-freeze state, returns epoch number */
freeze(): number
```

### Phase 2: RvfSolver Wrapper

New `src/backends/rvf/RvfSolver.ts`:

```typescript
export class AgentDBSolver {
  static create(): Promise<AgentDBSolver>;
  train(options: TrainOptions): TrainResult;
  acceptance(options?: AcceptanceOptions): AcceptanceManifest;
  policy(): PolicyState | null;
  witnessChain(): Uint8Array | null;
  destroy(): void;
}
```

### Phase 3: Type Definitions

```typescript
export interface IndexStats {
  indexedVectors: number;
  layers: number;
  m: number;
  efConstruction: number;
  needsRebuild: boolean;
}

export interface WitnessVerification {
  valid: boolean;
  entries: number;
  error?: string;
}
```

### Phase 4: CLI Integration

New subcommands under `agentdb rvf`:

```bash
agentdb rvf witness <store>    # Verify witness chain
agentdb rvf freeze <store>     # Freeze state
agentdb rvf index-stats <store> # Show HNSW stats
agentdb rvf solver train       # Train solver
agentdb rvf solver test        # Run acceptance test
```

### Phase 5: Detector Updates

Add solver detection to `checkRvf()`:

```typescript
interface RvfAvailability {
  available: boolean;
  node: boolean;
  wasm: boolean;
  solver: boolean; // NEW
  version?: string;
}
```

## Security

- Witness verification is read-only, no attack surface
- Freeze is idempotent (returns epoch, no mutation on second call)
- Solver operates on synthetic data only (no user vectors)
- SHAKE-256 provides 256-bit collision resistance
- All methods bounded by existing path validation and dimension checks

## Performance

| Operation             | Expected Latency                              |
| --------------------- | --------------------------------------------- |
| `metric()`            | <1us (field read)                             |
| `indexStats()`        | <10us (struct read)                           |
| `verifyWitness()`     | O(n) witness entries, <1ms for typical chains |
| `freeze()`            | <100us (epoch increment + sync)               |
| `solver.train(100)`   | ~50ms (WASM, 100 puzzles)                     |
| `solver.acceptance()` | ~500ms (5 cycles x 200 train + 50 test)       |

## Consequences

### Positive

- AgentDB exposes HNSW introspection for debugging and optimization
- Witness chain verification enables tamper-evident audit logs
- State freeze enables reproducible snapshots for CI/CD
- Solver integration brings self-learning capabilities directly into AgentDB

### Negative

- Solver requires WASM binary (not bundled, must be built from source)
- 4 new methods add API surface to maintain
- @ruvector/rvf-solver is 0.1.x (pre-stable)

### Risks

- WASM binary for solver may not be available on all platforms
- Solver accuracy depends on puzzle complexity distribution
