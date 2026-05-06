# ADR-010: @ruvector/rvf-solver v0.1.6 Deep Integration

**Status:** Proposed
**Date:** 2026-02-20
**Author:** System Architect (AgentDB v3)
**Supersedes:** None
**Related:** ADR-004 (AGI Capabilities), ADR-006 (Unified Self-Learning), ADR-007 (Full Capability)

## Context

AgentDB depends on `@ruvector/rvf-solver@^0.1.2` for self-learning policy decisions. The package was upgraded to **v0.1.6** (published 2026-02-20), which ships a richer type surface, new acceptance test dimensions, and critical bug fixes while keeping the same WASM ABI.

### Version History (v0.1.2 → v0.1.6)

| Version | Change |
|---------|--------|
| v0.1.2 | Initial release used by AgentDB (WASM path bug present but masked by `isAvailable()` guard) |
| v0.1.4 | Expanded TypeScript types (11 new fields), snake→camel mappers in JS wrapper |
| v0.1.5 | Fixed: WASM binary missing from npm tarball, phantom ESM entry removed, README max instances corrected |
| v0.1.6 | **Fixed: CJS/ESM interop bug** — `import.meta.url` in `pkg/rvf_solver.js` broke `__dirname` on Node.js v22. Rewritten as pure CJS with synchronous `require('node:fs')` + `__dirname`. All versions v0.1.2-v0.1.5 had this bug. |

### Current State

| Layer | File | v0.1.6 Coverage | Gap |
|-------|------|-----------------|-----|
| **Wrapper** | `src/backends/rvf/RvfSolver.ts` | ~65% | 11 types unmapped |
| **Self-Learning** | `src/backends/rvf/SelfLearningRvfBackend.ts` | Phases 1-5 complete | Uses stale types |
| **MCP** | `src/mcp/agentdb-mcp-server.ts` | 0% | No solver tools |
| **Tests** | `tests/backends/self-learning-rvf.test.ts` | ~80% | No acceptance, no witness verification |

### What Changed in v0.1.6

The `@ruvector/rvf-solver` v0.1.6 package (zero dependencies, ~132 KB WASM, `no_std`, pure CJS) expands the type surface from v0.1.2:

**New in `CycleMetrics`:**
| Field | Type | Purpose |
|-------|------|---------|
| `noiseAccuracy` | `number` | Accuracy under injected noise — measures robustness |
| `violations` | `number` | Constraint violations per cycle — safety signal |
| `patternsLearned` | `number` | Patterns distilled per cycle (was only in `TrainResult`) |

**New in `AcceptanceModeResult`:**
| Field | Type | Purpose |
|-------|------|---------|
| `accuracyMaintained` | `boolean` | Accuracy stayed above threshold across all cycles |
| `costImproved` | `boolean` | Cost-per-solve decreased vs. baseline |
| `robustnessImproved` | `boolean` | Noise accuracy improved vs. baseline |
| `zeroViolations` | `boolean` | No constraint violations in any cycle |
| `dimensionsImproved` | `number` | Count of improvement dimensions (0-4) |

**New exported types:**
| Type | Purpose |
|------|---------|
| `SkipMode` | `'none' \| 'weekday' \| 'hybrid'` — PolicyKernel skip strategies |
| `SkipModeStats` | Per-arm Thompson Sampling statistics (typed, was inline `Record`) |
| `CompiledConfig` | KnowledgeCompiler distilled configuration entry |

### v0.1.6 WASM ABI

The WASM binary ABI is unchanged — the same `rvf_solver_*` C-ABI functions. The new fields come from the JSON manifest that `rvf_solver_result_read` already returns; the v0.1.2 wrapper simply discarded them. This means the upgrade is **pure TypeScript type expansion** with zero WASM changes.

## Decision

Upgrade `@ruvector/rvf-solver` from `^0.1.2` to `^0.1.6` and perform a **deep integration** across four layers:

### 1. Type-Complete RvfSolver Wrapper

Update `src/backends/rvf/RvfSolver.ts` to expose all v0.1.6 types:

```typescript
// New types to add
export type SolverSkipMode = 'none' | 'weekday' | 'hybrid';

export interface SolverSkipModeStats {
  attempts: number;
  successes: number;
  totalSteps: number;
  alphaSafety: number;
  betaSafety: number;
  costEma: number;
  earlyCommitWrongs: number;
}

export interface SolverCompiledConfig {
  maxSteps: number;
  avgSteps: number;
  observations: number;
  expectedCorrect: boolean;
  hitCount: number;
  counterexampleCount: number;
  compiledSkip: SolverSkipMode;
}

// Updated CycleMetrics
export interface SolverCycleMetrics {
  cycle: number;
  accuracy: number;
  costPerSolve: number;
  noiseAccuracy: number;     // NEW
  violations: number;        // NEW
  patternsLearned: number;   // NEW
}

// Updated ModeResult
export interface SolverModeResult {
  passed: boolean;
  accuracyMaintained: boolean;   // NEW
  costImproved: boolean;         // NEW
  robustnessImproved: boolean;   // NEW
  zeroViolations: boolean;       // NEW
  dimensionsImproved: number;    // NEW
  cycles: SolverCycleMetrics[];
}
```

The `mapModeResult()` and `mapCycleMetrics()` private helpers read these from the JSON manifest that the WASM already returns (snake_case → camelCase).

### 2. Enhanced Self-Learning Backend

Update `SelfLearningRvfBackend.ts` to use the richer acceptance manifest:

```typescript
// Current regression guard (ADR-006 lines 427-428)
if (!manifest.allPassed) this.useAdaptiveEf = false;

// Enhanced regression guard with v0.1.6 dimensions
private runAcceptanceCheck(): void {
  const manifest = this.solver.acceptance({ cycles: 3, holdoutSize: 30 });

  // Multi-dimensional regression detection
  const modeC = manifest.modeC;
  if (!modeC.accuracyMaintained) {
    this.useAdaptiveEf = false;           // Accuracy regression
  }
  if (!modeC.zeroViolations) {
    this.useAdaptiveEf = false;           // Safety violation
    this.emitEvent('solver:violation');
  }
  if (modeC.dimensionsImproved < 2) {
    this.learningRate *= 0.5;             // Slow down learning
  }
  if (modeC.robustnessImproved && modeC.costImproved) {
    this.learningRate = Math.min(1.0, this.learningRate * 1.1);  // Speed up
  }
}
```

Expose new stats in `getLearningStats()`:

```typescript
getLearningStats(): SelfLearningStats {
  return {
    ...existingStats,
    // v0.1.6 additions
    noiseAccuracy: lastManifest?.modeC.cycles.at(-1)?.noiseAccuracy ?? 0,
    violations: lastManifest?.modeC.cycles.reduce((s, c) => s + c.violations, 0) ?? 0,
    patternsDistilled: lastManifest?.modeC.cycles.at(-1)?.patternsLearned ?? 0,
    dimensionsImproved: lastManifest?.modeC.dimensionsImproved ?? 0,
  };
}
```

### 3. MCP Solver Tools

Add four solver tools to `src/mcp/agentdb-mcp-server.ts`:

| Tool | Input | Output | Description |
|------|-------|--------|-------------|
| `solver_train` | `{ count, minDifficulty?, maxDifficulty?, seed? }` | `SolverTrainResult` | Train on generated puzzles |
| `solver_acceptance` | `{ cycles?, holdoutSize?, trainingPerCycle?, stepBudget? }` | `SolverAcceptanceManifest` | Run A/B/C ablation test |
| `solver_policy` | `{}` | `SolverPolicyState` | Get Thompson Sampling state |
| `solver_witness` | `{}` | `{ entries, bytes, hex }` | Get witness chain summary |

These tools are gated behind `AgentDBSolver.isAvailable()` — they only appear in `tools/list` when the WASM module loads successfully.

### 4. Test Coverage Expansion

Add to `tests/backends/self-learning-rvf.test.ts`:

```typescript
describe('Phase 5: Solver v0.1.6 types', () => {
  it('CycleMetrics includes noiseAccuracy and violations', () => {
    // Verify shape of acceptance manifest
  });

  it('AcceptanceModeResult includes dimensionsImproved', () => {
    // Verify modeC.dimensionsImproved is a number
  });

  it('regression guard disables on violations', () => {
    // Mock manifest with zeroViolations=false, assert useAdaptiveEf=false
  });

  it('witness chain is non-empty after training', () => {
    // Call train, then witnessChain, assert length > 0
  });

  it('policy state has typed SkipModeStats', () => {
    // Verify contextStats values match SkipModeStats shape
  });
});
```

## Implementation Plan

### Phase 1: Wrapper Update (RvfSolver.ts)

| Step | Action | Lines |
|------|--------|-------|
| 1.1 | Add `SolverSkipMode`, `SolverSkipModeStats`, `SolverCompiledConfig` types | +30 |
| 1.2 | Expand `SolverCycleMetrics` with `noiseAccuracy`, `violations`, `patternsLearned` | +3 |
| 1.3 | Expand `SolverModeResult` with 5 new fields | +5 |
| 1.4 | Update `mapModeResult()` to read snake_case variants | +12 |
| 1.5 | Update `mapCycleMetrics()` extraction | +8 |
| 1.6 | Export new types from `backends/index.ts` | +5 |

**Estimated:** ~60 net new lines.

### Phase 2: Self-Learning Enhancement (SelfLearningRvfBackend.ts)

| Step | Action | Lines |
|------|--------|-------|
| 2.1 | Replace `SolverModeResult.finalAccuracy` with `accuracyMaintained` check | ~5 |
| 2.2 | Add violation detection → `emitEvent('solver:violation')` | +8 |
| 2.3 | Add `dimensionsImproved` → learning rate modulation | +6 |
| 2.4 | Expand `getLearningStats()` with v0.1.6 fields | +10 |

**Estimated:** ~30 net new lines.

### Phase 3: MCP Tools (agentdb-mcp-server.ts)

| Step | Action | Lines |
|------|--------|-------|
| 3.1 | Add solver_train tool definition + handler | +40 |
| 3.2 | Add solver_acceptance tool definition + handler | +45 |
| 3.3 | Add solver_policy tool definition + handler | +25 |
| 3.4 | Add solver_witness tool definition + handler | +25 |
| 3.5 | Gated registration via `AgentDBSolver.isAvailable()` | +8 |

**Estimated:** ~145 net new lines.

### Phase 4: Tests

| Step | Action | Lines |
|------|--------|-------|
| 4.1 | v0.1.4 type shape assertions | +30 |
| 4.2 | Regression guard violation scenario | +20 |
| 4.3 | Witness chain non-empty assertion | +15 |
| 4.4 | MCP tool integration test stubs | +40 |

**Estimated:** ~105 net new lines.

## Files Modified

| File | Action | Net Lines |
|------|--------|-----------|
| `package.json` | Bump `@ruvector/rvf-solver` to `^0.1.4` | ~1 |
| `src/backends/rvf/RvfSolver.ts` | Add 11 types, update mappers | +60 |
| `src/backends/index.ts` | Export new types | +5 |
| `src/backends/rvf/SelfLearningRvfBackend.ts` | Enhanced regression guard + stats | +30 |
| `src/mcp/agentdb-mcp-server.ts` | 4 new solver MCP tools | +145 |
| `tests/backends/self-learning-rvf.test.ts` | v0.1.4 coverage + regression scenarios | +105 |

**Total:** ~346 net new lines across 6 files.

## Consequences

### Positive

- **Complete type coverage** — all v0.1.4 fields mapped with safe defaults for backward compat
- **Richer regression detection** — multi-dimensional acceptance (accuracy + cost + robustness + violations) replaces single-axis `finalAccuracy` check
- **MCP observability** — solver becomes inspectable and trainable via MCP tools, enabling chat-ui users to trigger training and view policy state
- **Witness chain audit** — MCP exposes tamper-evident proof for compliance/debugging
- **Zero WASM changes** — pure TypeScript expansion; the WASM binary ABI is identical

### Negative

- **4 new MCP tools** add API surface to maintain
- **Solver is still optional** — tests must handle `isAvailable() === false` gracefully
- **v0.1.4 is pre-1.0** — API may evolve; wrapper provides an isolation layer

### Risks

| Risk | Mitigation |
|------|------------|
| v0.1.4 WASM binary missing in some envs | Lazy-load with `isAvailable()` guard; all solver MCP tools gated |
| Acceptance `noiseAccuracy` is 0 on older data | Default to `0` in mapper; regression guard ignores if `noiseAccuracy === 0` |
| `dimensionsImproved` interpretation may change | Pin to `>=2` threshold with config override |

## Verification

1. **Type check:** `npx tsc --noEmit` — 0 new errors in `src/`
2. **Unit tests:** `npx vitest run tests/backends/self-learning-rvf.test.ts` — all pass
3. **MCP smoke test:** Start MCP server, call `solver_train { count: 10 }`, verify `TrainResult` shape
4. **Witness integrity:** After training, call `solver_witness`, verify `entries > 0`
5. **Regression guard:** Mock manifest with `zeroViolations: false`, assert `useAdaptiveEf === false`
6. **Backward compat:** Existing `RvfSolver.ts` callers see new optional fields, no breakage

## References

- [@ruvector/rvf-solver](https://www.npmjs.com/package/@ruvector/rvf-solver) v0.1.4 — Thompson Sampling, PolicyKernel, ReasoningBank, SHAKE-256 witness chains (~160 KB WASM)
- [ADR-004](./ADR-004-agi-capabilities-integration.md) — AGI Capabilities Integration (initial RvfSolver wrapper)
- [ADR-006](./ADR-006-unified-self-learning-rvf-integration.md) — Unified Self-Learning RVF Integration (SelfLearningRvfBackend Phases 1-5)
- [ADR-007](./ADR-007-ruvector-full-capability-integration.md) — Full Capability Integration (current utilization audit)
- [ruvector/ruvector](https://github.com/ruvnet/ruvector) — RuVector source repository
