// charter: substrate-seam
//
// ADR-0180 Phase 4 §Architecture · Substrate — the `SubstrateRegistry`: the
// `Map<StoreId, SubstrateAccess>` keystone that `Archivist.initialize()` builds
// and `Archivist.getSubstrate()` consults. Every dispatched mutation/read
// resolves its substrate here before touching a backend.
//
// Why a registry + a classifier, not a flat 64-entry literal:
//   - The `StoreId` roster is per-handler-granular (`agentdb_pattern_store`,
//     `swarm_init`, `tasks`, `coordination_topology`, `metrics_performance`, …
//     — ~64 today, growing every phase). Hand-maintaining a 64-line literal that
//     drifts every time a handler lands is the wrong shape.
//   - Substrate assignment is *family*-structured, not per-store-arbitrary
//     (ADR-0180 §Architecture · Substrate): RVF-primary for vector/content
//     stores; the 5 PERMANENT_SQLITE_CARVE_OUT controllers per ADR-0166; the
//     ~17-store FS-JSON group per Phase 5. `classifyStore` encodes that
//     structure once.
//   - FS-JSON substrates are *per-path* — each store owns a distinct
//     `.claude-flow/<store>.json` file with its own lock. They cannot share one
//     `SubstrateAccess` the way RVF stores share one `RvfBackend` or carve-out
//     controllers share one `better-sqlite3` handle. So FS-JSON entries are
//     lazily minted on first `getSubstrate()` and cached in the registry Map —
//     honoring the charter's `lazy-init` responsibility (idle stores never open
//     a file).
//
// This module owns the *classification* + the *registry container*. The
// `Archivist` (index.ts) owns construction — it holds the `RvfBackend` /
// `better-sqlite3` instances from `initialize(config)` and passes the family
// substrate factories in. This file deliberately does NOT import the substrate
// factories or the backends: it stays a pure routing-policy module so the
// charter check and the `no-restricted-imports` rule have a small surface.

import type { StoreId } from './types';

// ── Family taxonomy ──────────────────────────────────────────────────────────

/**
 * The three substrate families per ADR-0180 §Architecture · Substrate.
 *
 * - `rvf` — RVF-primary (ADR-0177) for vector + content stores: `memory_*` and
 *   the agentdb_* vector/content write surfaces (pattern/reflexion/skill/
 *   hierarchical/sona-trajectory stores, route/feedback/experience learners'
 *   episodic writes).
 * - `sqlite` — the 5 PERMANENT_SQLITE_CARVE_OUT *controllers* per ADR-0166
 *   (CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem
 *   aggregations, ReasoningBank GROUP-BY). Carve-out is per-controller-operation:
 *   `agentdb_causal_recall` reads route here; the other four controllers' write
 *   storeIds register in Phase 9 (inter-controller writes) and Phase 6.
 * - `fs-json` — the ~17-store file-system-JSON group per ADR-0180 §Migration
 *   concerns Phase 5: claims, tasks, agents/hive-mind, swarm, coordination,
 *   workflow, neural, github, performance, system, config, progress, ruvllm,
 *   daa, wasm, browser, autopilot — plus the daemon metrics files.
 */
export type SubstrateFamily = 'rvf' | 'sqlite' | 'fs-json';

// ── RVF roster ───────────────────────────────────────────────────────────────
//
// Exact storeIds whose primary substrate is RVF. `memory_store` is the canonical
// RVF content store; the agentdb_* entries are the vector/content write surfaces
// (ReasoningBank patterns, ReflexionMemory episodes, SkillLibrary skills,
// HierarchicalMemory tiers, SonaLearningBackend trajectories) plus the learner
// write paths whose *episodic* persistence is RVF (the carve-out is the
// GROUP-BY *aggregation* read, not the per-episode write — ADR-0166
// Amendment 2026-05-11f).

const RVF_STORE_IDS: ReadonlySet<string> = new Set([
  'memory_store',
  'agentdb_pattern_store',
  'agentdb_reflexion_store',
  'agentdb_skill_create',
  'agentdb_hierarchical_store',
  'agentdb_sona_trajectory_store',
  'agentdb_experience_record',
  'agentdb_route',
  'agentdb_feedback',
]);

// ── SQLite carve-out roster ──────────────────────────────────────────────────
//
// The 5 PERMANENT_SQLITE_CARVE_OUT controllers per ADR-0166 are CONTROLLERS,
// not handler storeIds — most have no dispatch handler yet. The only carve-out
// storeId with a registered handler today is `agentdb_causal_recall`
// (causal-recall.ts cites `PERMANENT_SQLITE_CARVE_OUT` explicitly). The other
// entries below are the canonical storeIds those controllers will register
// under in Phase 6 / Phase 9 — pre-listed so the classifier is correct the
// moment the handler lands, not a phase later.
//
// Roster ↔ controller:
//   agentdb_causal_recall      → CausalRecall                (Phase 6, LIVE)
//   agentdb_causal_query       → CausalMemoryGraph reads      (Phase 6)
//   agentdb_causal_edge        → CausalMemoryGraph writes     (Phase 9 inter-controller)
//   agentdb_learner_run        → NightlyLearner.run()         (Phase 9 inter-controller)
//   agentdb_learning_predict   → LearningSystem aggregations  (Phase 6)
//   agentdb_pattern_search     → ReasoningBank GROUP-BY read  (Phase 6)
//
// NOTE: `agentdb_pattern_search` (a GROUP-BY *read* over ReasoningBank) is
// carve-out, while `agentdb_pattern_store` (a per-pattern *write*) is RVF —
// this asymmetry is the ADR-0166 axis-separation, not a bug.

const SQLITE_CARVE_OUT_STORE_IDS: ReadonlySet<string> = new Set([
  'agentdb_causal_recall',
  'agentdb_causal_query',
  'agentdb_causal_edge',
  'agentdb_learner_run',
  'agentdb_learning_predict',
  'agentdb_pattern_search',
]);

// ── Classification ───────────────────────────────────────────────────────────

/**
 * Resolve a `StoreId` to its substrate family per ADR-0180 §Architecture ·
 * Substrate. Explicit-roster membership wins; everything else is FS-JSON (the
 * ~17-store Phase 5 group is large and grows, so it is the structural default
 * rather than an enumerated set).
 *
 * Fail-loud posture (`feedback-no-fallbacks`): this function never returns a
 * placeholder or `undefined` — every `StoreId` deterministically classifies.
 * What CAN fail loud is `Archivist.getSubstrate()` when the resolved family's
 * backend was not supplied to `initialize(config)` (e.g. a carve-out storeId
 * dispatched with no `sqliteDb` in config) — that throws there, not here.
 */
export function classifyStore(storeId: StoreId): SubstrateFamily {
  const id = storeId as string;
  if (RVF_STORE_IDS.has(id)) return 'rvf';
  if (SQLITE_CARVE_OUT_STORE_IDS.has(id)) return 'sqlite';
  // ~17-store FS-JSON group (claims/tasks/agents/swarm/coordination/workflow/
  // neural/github/performance/system/config/progress/ruvllm/daa/wasm/browser/
  // autopilot) + daemon metrics files + hooks lifecycle stores. Structural
  // default — large and growing, so not enumerated.
  return 'fs-json';
}

// ── FS-JSON path derivation ──────────────────────────────────────────────────
//
// FS-JSON substrates are per-path. The path conventions are owned by the
// individual Phase 5 handlers (e.g. coordination → `.claude-flow/coordination/
// store.json`, hive-mind → `.claude-flow/hive-mind/state.json`, agents →
// `.claude-flow/agents.json`). This map captures the conventions known at
// Phase-4 build time; storeIds not listed fall back to the flat
// `.claude-flow/<storeId>.json` convention — which is correct for the uniform
// majority and is overridable here as Phase 5 handlers pin their exact paths.

const FS_JSON_PATH_OVERRIDES: ReadonlyMap<string, string> = new Map([
  // hive-mind family (two co-resident files per ADR-0180 §Migration Phase 4)
  ['hive-mind_spawn', 'hive-mind/state.json'],
  ['hive-mind_shutdown', 'hive-mind/state.json'],
  ['hive-mind_broadcast', 'hive-mind/state.json'],
  ['hive-mind_consensus', 'hive-mind/state.json'],
  ['hive-mind_memory', 'hive-mind/state.json'],
  ['hive-mind_agents', 'agents.json'],
  ['agent_spawn', 'agents.json'],
  // coordination family — single store.json (topology.ts:19)
  ['coordination_topology', 'coordination/store.json'],
  ['coordination_consensus', 'coordination/store.json'],
  ['coordination_node', 'coordination/store.json'],
  ['coordination_load_balance', 'coordination/store.json'],
  ['coordination_sync', 'coordination/store.json'],
  ['coordination_orchestrate', 'coordination/store.json'],
  // daemon metrics — `.claude-flow/metrics/<file>.json`
  ['metrics_codebase_map', 'metrics/codebase-map.json'],
  ['metrics_security_audit', 'metrics/security-audit.json'],
  ['metrics_performance', 'metrics/performance.json'],
  ['metrics_test_gaps', 'metrics/test-gaps.json'],
  ['metrics_benchmark', 'metrics/benchmark.json'],
  // daemon state files — `.claude-flow/data/<file>.json`
  ['daemon_runConsolidate', 'data/consolidation.json'],
  ['daemon_hooks_learning', 'data/hooks-learning.json'],
  ['auto_memory_bridge', 'data/auto-memory-store.json'],
  // hooks lifecycle — `.claude-flow/data/<file>`
  ['hooks_post_edit', 'data/pending-insights.jsonl'],
  ['hooks_pre_task', 'data/intelligence-snapshot.json'],
  ['hooks_session_end', 'data/intelligence-snapshot.json'],
]);

/**
 * Absolute path of the JSON document a given FS-JSON `StoreId` owns. Joins
 * `projectRoot` + `.claude-flow/` + either the pinned override or the flat
 * `<storeId>.json` default. Caller is `Archivist.initialize()` / `getSubstrate()`
 * when it mints the lazy per-store FS-JSON substrate.
 *
 * `projectRoot` is the wiring point F4-2 Phase B / cli integration supplies via
 * `initialize(config)`. Until then `initialize` defaults it to `process.cwd()`
 * (documented in index.ts).
 */
export function fsJsonPathFor(projectRoot: string, storeId: StoreId): string {
  const id = storeId as string;
  const rel = FS_JSON_PATH_OVERRIDES.get(id) ?? `${id}.json`;
  return joinPath(projectRoot, '.claude-flow', rel);
}

// Local join — avoids a `node:path` import in this routing-policy module so the
// charter surface stays minimal. POSIX-and-Windows-safe enough for the
// `.claude-flow/<rel>` shape (rel never contains `..` or absolute segments).
function joinPath(...segments: ReadonlyArray<string>): string {
  return segments
    .map((s, i) => (i === 0 ? s.replace(/\/+$/, '') : s.replace(/^\/+|\/+$/g, '')))
    .filter((s) => s.length > 0)
    .join('/');
}

// ── Registry container ───────────────────────────────────────────────────────

/**
 * Generic over the branded `SubstrateAccess` type. Kept generic so this module
 * does not import `./types`' `SubstrateAccess` *value* surface — index.ts
 * supplies the concrete type. The registry is a thin `Map` wrapper: explicit
 * pre-population for the shared-instance families (RVF, SQLite carve-out) at
 * `initialize()` time, plus lazy memoized insertion for per-path FS-JSON stores
 * on first `resolve()`.
 *
 * `feedback-data-loss-zero-tolerance` / `feedback-no-fallbacks`: `resolve()`
 * throws if a store classifies into a family whose backend was never supplied —
 * it never hands back a silent no-op substrate.
 */
export class SubstrateRegistry<TSubstrate> {
  private readonly map = new Map<string, TSubstrate>();

  /**
   * Pre-register a shared-instance substrate for an exact `StoreId` (used by
   * `initialize()` for the RVF + SQLite carve-out rosters, which share one
   * backend instance across all their storeIds).
   */
  register(storeId: StoreId, substrate: TSubstrate): void {
    this.map.set(storeId as string, substrate);
  }

  /** Already-registered? Used by the lazy FS-JSON path to memoize. */
  has(storeId: StoreId): boolean {
    return this.map.has(storeId as string);
  }

  /**
   * Resolve a `StoreId` to its `SubstrateAccess`. If pre-registered (RVF /
   * SQLite carve-out, or an already-minted FS-JSON store), returns the cached
   * instance. Otherwise calls `mintLazy(family)` — index.ts supplies a closure
   * that builds the per-path FS-JSON substrate — caches it, and returns it.
   *
   * Throws (no fallback) when `mintLazy` cannot build the substrate for the
   * resolved family (e.g. the family's backend was not in `initialize(config)`).
   */
  resolve(
    storeId: StoreId,
    mintLazy: (family: SubstrateFamily, storeId: StoreId) => TSubstrate,
  ): TSubstrate {
    const existing = this.map.get(storeId as string);
    if (existing !== undefined) return existing;

    const family = classifyStore(storeId);
    const minted = mintLazy(family, storeId);
    this.map.set(storeId as string, minted);
    return minted;
  }

  /** Count of registered substrates — introspection for tests + init logging. */
  get size(): number {
    return this.map.size;
  }
}
