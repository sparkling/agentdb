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

import type { StoreId } from './types.js';

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
// whose persistence model is RVF + HNSW (ReasoningBank patterns,
// SonaLearningBackend trajectories) plus the learner write paths whose
// *episodic* persistence is RVF (the carve-out is the GROUP-BY *aggregation*
// read, not the per-episode write — ADR-0166 Amendment 2026-05-11f).
//
// ADR-0181 Phase 7 correction: ReflexionMemory (`episodes` +
// `episode_embeddings`), SkillLibrary (`skills` + `skill_embeddings`), and
// HierarchicalMemory (`hierarchical_memory`) all persist into the SQLite
// carve-out tables AgentDB's `memory init` schema creates — the read tools
// (agentdb_reflexion_retrieve / agentdb_skill_search / agentdb_hierarchical_recall)
// are already classified `sqlite` and SQL-port their re-embed + cosine path off
// those tables. Routing the matching write storeIds to RVF would have
// silently desynced reads from writes (write-to-RVF, read-from-SQLite — the
// `episodes` table would stay empty even after successful writes). They live
// alongside the read storeIds in `SQLITE_CARVE_OUT_STORE_IDS` below.

const RVF_STORE_IDS: ReadonlySet<string> = new Set([
  'memory_store',
  'agentdb_pattern_store',
  // ADR-0181 Item 6 (2026-05-16) — `agentdb_sona_trajectory_store` removed
  // from RVF and added to SQLITE_CARVE_OUT_STORE_IDS below. The
  // SonaTrajectoryService now persists the trajectory corpus to a
  // `sona_trajectories` SQLite table (dual-write alongside the in-memory
  // Map). The matching read handler (sibling registerReadHandler for the
  // 'stats' action) reads through the merged in-memory + SQLite getStats()
  // surface — both sides now share the SQLite handle, so the read↔write
  // pair classifies as carve-out together (matches Phase 7 reflexion /
  // skill / hierarchical pattern).
  // ADR-0181 Item 5 Phase 2 (2026-05-16) — `agentdb_experience_record`
  // similarly removed from RVF and added to SQLITE_CARVE_OUT_STORE_IDS
  // below. LearningSystem (commits 1-5) now persists to the four
  // learning_* SQLite tables; the cli's `agentdb_experience_record` MCP
  // tool now gates behind ensureSqliteWired() (forks/ruflo cfc519f42)
  // and the dispatch substrate must classify accordingly so the
  // archivist's withWrite scope shares the same SQLite handle.
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
//   agentdb_causal_recall        → CausalRecall                  (Phase 6, LIVE)
//   agentdb_causal_query         → CausalMemoryGraph reads       (Phase 6)
//   agentdb_causal_edge          → CausalMemoryGraph writes      (Phase 9 inter-controller)
//   agentdb_causal_experiment    → CausalMemoryGraph A/B exps    (ADR-0181 Item 4 — NightlyLearner substrate-seam wrap)
//   agentdb_learner_run          → NightlyLearner.run()          (Phase 9 inter-controller)
//   agentdb_learning_predict     → LearningSystem aggregations   (Phase 6)
//   agentdb_pattern_search       → ReasoningBank GROUP-BY read   (Phase 6)
//   agentdb_reflexion_retrieve   → episodes ⨝ episode_embeddings (Phase 5, LIVE)
//   agentdb_skill_search         → skills ⨝ skill_embeddings     (Phase 5, LIVE)
//   agentdb_reflexion_store      → ReflexionMemory.storeEpisode  (Phase 7, LIVE)
//   agentdb_skill_create         → SkillLibrary.createSkill      (Phase 7, LIVE)
//   agentdb_hierarchical_store   → HierarchicalMemory.store      (Phase 7, LIVE)
//   agentdb_sona_trajectory_store → SonaTrajectoryService.recordTrajectory (Item 6, LIVE 2026-05-16)
//   agentdb_experience_record    → LearningSystem.recordExperience  (Item 5 Phase 2, LIVE 2026-05-16)
//
// NOTE: `agentdb_pattern_search` (a GROUP-BY *read* over ReasoningBank) is
// carve-out, while `agentdb_pattern_store` (a per-pattern *write*) is RVF —
// this asymmetry is the ADR-0166 axis-separation, not a bug. The
// reflexion/skill/hierarchical READ+WRITE pair is in carve-out together
// (per Phase 7) — those controllers' SQLite tables ARE the persistence model,
// not a derived index, so the read and write must classify the same family.

const SQLITE_CARVE_OUT_STORE_IDS: ReadonlySet<string> = new Set([
  'agentdb_causal_recall',
  'agentdb_causal_query',
  'agentdb_causal_edge',
  // ADR-0181 Item 4 (2026-05-16): `causal_experiments` UPDATE/INSERT writes
  // from NightlyLearner.{completeExperiments,createExperiments}. Distinct
  // storeId from `agentdb_causal_edge` so per-storeId invariants can target
  // the experiments table separately from the edges table even though both
  // share the same SQLite handle.
  'agentdb_causal_experiment',
  'agentdb_learner_run',
  'agentdb_learning_predict',
  'agentdb_pattern_search',
  // ADR-0181 Phase 5 fix (phase5-agentdb caught the gap): these two handlers
  // use `ctx.substrate.query<T>({ predicate: { sql: ... } })` for re-embed +
  // cosine-rerank against SQLite carve-out tables (episodes/episode_embeddings
  // for reflexion-retrieve.ts L171; skills/skill_embeddings for skill-search.ts
  // L171). Without them in the carve-out roster, classifyStore() falls through
  // to fs-json which throws on .query() — runtime dispatch failure.
  'agentdb_reflexion_retrieve',
  'agentdb_skill_search',
  // ADR-0181 Phase 7 fix: the matching WRITE storeIds for the reflexion +
  // skill + hierarchical controllers. AgentDB's `memory init` provisions
  // SQLite tables (`episodes`/`episode_embeddings`, `skills`/`skill_embeddings`,
  // `hierarchical_memory`) and the cli's controllers (ReflexionMemory,
  // SkillLibrary, HierarchicalMemory) own table-population through them. Read
  // sibling handlers were already SQLite-classified above; routing the writers
  // to RVF previously silently desynced (write-to-RVF, read-from-SQLite). The
  // controllers expose write methods (storeEpisode / createSkill / store) that
  // the dispatch path invokes through the SQLite-classified `withWrite` scope.
  'agentdb_reflexion_store',
  'agentdb_skill_create',
  'agentdb_hierarchical_store',
  // ADR-0181 Item 6 (2026-05-16): SonaTrajectoryService gained a
  // `sona_trajectories` SQLite table (dual-write alongside the in-memory
  // Map). The persistence model is now SQLite — `getStats()` SELECTs back
  // the durable count + agentTypes (merged with same-process Map).
  // Sibling registerReadHandler at handlers/agentdb/sona-trajectory-store.ts
  // owns the 'stats' action; the cli wrapper routes 'record' →
  // dispatch and 'stats' → dispatchRead (split-by-action matches Item 2's
  // agentdb_neural_patterns/agentdb_gnn_stats split).
  'agentdb_sona_trajectory_store',
  // ADR-0181 Item 5 Phase 2 (2026-05-16): LearningSystem persists to four
  // learning_* SQLite tables (commits 1-5 retired the pglite/PostgresBackend
  // path per ADR-0177). The cli wrapper at agentdb-tools.ts:1933 gates
  // behind ensureSqliteWired (forks/ruflo cfc519f42); the substrate seam
  // must classify the storeId accordingly so the archivist's withWrite
  // scope shares the same SQLite handle the cli uses for INSERTs.
  // Same shape as Phase 7's reflexion/skill/hierarchical move.
  'agentdb_experience_record',
  // ADR-0261 (2026-05-27): fork-native ADR-130 re-implementation. The
  // `graph_edges` table (src/schemas/graph-edges.sql) FK-references
  // `memory_entries(id)` — the FK requires the shared better-sqlite3 handle
  // per ADR-0166, which is the SQLite-carve-out family. Writes route through
  // the `agentdb_graph_edge` handler under a SAVEPOINT (per-op acquisition,
  // ADR-0202 / ADR-0246) — no module-scope cache, no separate DB connection.
  'agentdb_graph_edge',
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
  ['hive-mind_init', 'hive-mind/state.json'],
  ['hive-mind_spawn', 'hive-mind/state.json'],
  ['hive-mind_shutdown', 'hive-mind/state.json'],
  ['hive-mind_broadcast', 'hive-mind/state.json'],
  ['hive-mind_consensus', 'hive-mind/state.json'],
  ['hive-mind_memory', 'hive-mind/state.json'],
  // agents store — single store.json shared by `hive-mind_agents` (the
  // task_*/hive-mind_* cross-store agent-sync target) and `agent_spawn` (the
  // agent_* lifecycle store). Mirrors the cli `agent-tools.ts`
  // `.claude-flow/agents/store.json` layout (AGENT_DIR='agents' +
  // AGENT_FILE='store.json' at agent-tools.ts:16-17). Without these overrides
  // the substrate falls back to flat `.claude-flow/agents.json` while the
  // cli's `loadAgentStore()` reads `.claude-flow/agents/store.json` — flips
  // for task_complete / task_assign / agent_* / hive-mind_* would silently
  // diverge on-disk state from the cli's read path. (ADR-0181 Phase 5
  // path-alignment — same shape as the claims/tasks/workflow/neural entries.)
  ['hive-mind_agents', 'agents/store.json'],
  ['agent_spawn', 'agents/store.json'],
  // coordination family — single store.json (topology.ts:19)
  ['coordination_topology', 'coordination/store.json'],
  ['coordination_consensus', 'coordination/store.json'],
  ['coordination_node', 'coordination/store.json'],
  ['coordination_load_balance', 'coordination/store.json'],
  ['coordination_sync', 'coordination/store.json'],
  ['coordination_orchestrate', 'coordination/store.json'],
  // workflow family — single store.json shared by all 8 workflow_* handlers
  // (handlers/workflow/shared.ts `WorkflowStore`); mirrors the cli
  // `workflow-tools.ts` `.claude-flow/workflows/store.json` layout
  // (`WORKFLOW_DIR = 'workflows'` + `WORKFLOW_FILE = 'store.json'`). Without
  // these overrides each storeId falls back to a flat per-store file, both
  // wrong-path AND fragmenting the store the cli keeps unified.
  ['workflow_run', 'workflows/store.json'],
  ['workflow_create', 'workflows/store.json'],
  ['workflow_execute', 'workflows/store.json'],
  ['workflow_pause', 'workflows/store.json'],
  ['workflow_resume', 'workflows/store.json'],
  ['workflow_cancel', 'workflows/store.json'],
  ['workflow_delete', 'workflows/store.json'],
  ['workflow_template', 'workflows/store.json'],
  // neural family — single models.json shared by all four neural_* handlers
  // (train / compress / optimize / patterns each use `NEURAL_STORE_ID = 'neural'`,
  // handlers/neural/train.ts). Mirrors the cli `neural-tools.ts` layout:
  // `loadNeuralStore`/`saveNeuralStore` round-trip `.claude-flow/neural/models.json`
  // for BOTH `store.models` and `store.patterns` — the cli's `PATTERNS_FILE`
  // constant is dead (never read), so `neural_patterns` also lands in models.json.
  ['neural', 'neural/models.json'],
  // github family — single store.json shared by repo-analyze / pr-manage /
  // issue-track (handlers/github/shared.ts `GITHUB_STORE_ID`); mirrors the cli
  // `github-tools.ts` `.claude-flow/github/store.json` layout. `github_workflow`
  // touches no local store (Phase 2 carry-forward — gh-process backend only).
  ['github', 'github/store.json'],
  // ruvllm family — three per-WASM-type stores (handlers/ruvllm/shared.ts);
  // mirrors the cli `ruvllm-store.ts` `.claude-flow/ruvllm/{hnsw,sona,microlora}-store.json`
  // layout. Each create handler + its paired operate handler share one storeId
  // so a create-then-operate lifecycle lands in one file.
  ['ruvllm_hnsw', 'ruvllm/hnsw-store.json'],
  ['ruvllm_sona', 'ruvllm/sona-store.json'],
  ['ruvllm_microlora', 'ruvllm/microlora-store.json'],
  // wasm family — single store.json shared by all five wasm_* handlers
  // (handlers/wasm/shared.ts `WASM_STORE_ID = 'wasm_agent_create'`); mirrors the
  // cli `wasm-agent-tools.ts` `.claude-flow/wasm-agents/store.json` layout.
  ['wasm_agent_create', 'wasm-agents/store.json'],
  // daa family — single store.json shared by all six FS-JSON daa_* handlers
  // (`STORE_ID = 'daa'` in handlers/daa/*.ts); mirrors the cli `daa-tools.ts`
  // `.claude-flow/daa/store.json` layout (STORAGE_DIR + DAA_DIR + DAA_FILE).
  ['daa', 'daa/store.json'],
  // tasks family — single store.json shared by all seven FS-JSON task_*
  // handlers (`STORE_ID = 'tasks'` in handlers/tasks/*.ts); mirrors the cli
  // `task-tools.ts` `.claude-flow/tasks/store.json` layout (STORAGE_DIR +
  // TASK_DIR + TASK_FILE = '.claude-flow' + 'tasks' + 'store.json'). Without
  // this entry the substrate falls back to flat `.claude-flow/tasks.json`
  // while the cli's post-dispatch envelope re-reads at
  // `.claude-flow/tasks/store.json` and returns stale empty state. (ADR-0181
  // Phase 5 path-alignment — same shape as the claims/workflow/neural
  // entries below.)
  ['tasks', 'tasks/store.json'],
  // claims family — single claims.json shared by all eight FS-JSON claims_*
  // mutation handlers (`STORE_ID = 'claims'` in handlers/claims/*.ts); mirrors
  // the cli `claims-tools.ts` `.claude-flow/claims/claims.json` layout
  // (`CLAIMS_DIR = '.claude-flow/claims'` + `CLAIMS_FILE = 'claims.json'`).
  // Without this entry the substrate falls back to flat `.claude-flow/claims.json`
  // while the cli's 4 read-only tools (claims_list/stealable/load/board) keep
  // reading `.claude-flow/claims/claims.json` — post-dispatch envelope reads
  // would return stale empty state. (ADR-0181 Phase 5 path-alignment.)
  ['claims', 'claims/claims.json'],
  // system family — single metrics.json shared by the three system_* mutation
  // handlers (`STORE_ID = 'system_metrics'` in handlers/system/{metrics,health,
  // reset}.ts); mirrors the cli `system-tools.ts` `.claude-flow/system/metrics.json`
  // layout (STORAGE_DIR + SYSTEM_DIR + METRICS_FILE).
  ['system_metrics', 'system/metrics.json'],
  // autopilot family — the cli keeps state + event-log in two files
  // (`data/autopilot-state.json` + `data/autopilot-log.json`); the archivist
  // folds both into one substrate document (top-level `state` + `log` keys —
  // handlers/autopilot/shared.ts) so the state-save + log-append of enable /
  // disable / reset commit atomically in one `withWrite` scope. Shared by the
  // four FS-JSON autopilot_* handlers (`AUTOPILOT_STORE_ID = 'autopilot_enable'`);
  // `autopilot_learn` is AgentDB-backed, not FS-JSON (Phase 3/4 carry-forward).
  ['autopilot_enable', 'data/autopilot-store.json'],
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

// ── Project-root-relative FS-JSON overrides ──────────────────────────────────
//
// The swarm family is the LONE FS-JSON store whose cli path lives OUTSIDE
// `.claude-flow/` (cli `swarm-tools.ts` uses `SWARM_DIR = '.swarm'` per ADR-0069
// A4, a sibling of `.claude-flow/`). The standard `FS_JSON_PATH_OVERRIDES` map
// hard-prefixes `.claude-flow/`, so it structurally cannot express swarm's
// path. This second map's entries resolve relative to `projectRoot` directly,
// skipping the `.claude-flow/` segment.
//
// Strict scope: project-root-relative status is OPT-IN per storeId via this
// map. The standard map's 25+ entries keep their existing `.claude-flow/`-
// prefixed resolution unchanged. Future families outside `.claude-flow/` are a
// SEPARATE decision (`feedback-no-fallbacks`: nothing else silently widens).
//
// Both swarm_init and swarm_shutdown share `.swarm/swarm-state.json` (cli's
// `SWARM_STATE_FILE`), matching the cli's unified-file layout.
const FS_JSON_PATH_OVERRIDES_PROJECT_ROOT: ReadonlyMap<string, string> = new Map([
  ['swarm_init', '.swarm/swarm-state.json'],
  ['swarm_shutdown', '.swarm/swarm-state.json'],
]);

/**
 * Absolute path of the JSON document a given FS-JSON `StoreId` owns. The
 * standard resolution is `projectRoot` + `.claude-flow/` + (override or flat
 * `<storeId>.json`). Storeids explicitly listed in
 * `FS_JSON_PATH_OVERRIDES_PROJECT_ROOT` (currently only the swarm family)
 * resolve project-root-relative WITHOUT the `.claude-flow/` segment — used
 * exclusively by stores whose cli path lives outside `.claude-flow/`.
 *
 * Caller is `Archivist.initialize()` / `getSubstrate()` when it mints the lazy
 * per-store FS-JSON substrate. `projectRoot` is the wiring point F4-2 Phase B /
 * cli integration supplies via `initialize(config)`. Until then `initialize`
 * defaults it to `process.cwd()` (documented in index.ts).
 */
export function fsJsonPathFor(projectRoot: string, storeId: StoreId): string {
  const id = storeId as string;
  const projectRootRel = FS_JSON_PATH_OVERRIDES_PROJECT_ROOT.get(id);
  if (projectRootRel !== undefined) {
    return joinPath(projectRoot, projectRootRel);
  }
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

// ── Path-alignment validation (ADR-0181 Phase 5 DA-memo CF#6) ────────────────
//
// FS_JSON_PATH_OVERRIDES has been the source of four documented mismatch
// incidents (Phase 2's queen-audit caught one; Phase 5 caught three more —
// claims/tasks/hive-mind_agents/agent_spawn). Same shape every time: cli
// `loadXxxStore()` direct FS read uses `.claude-flow/<family>/<file>.json`
// while the archivist `withWrite({storeId})` resolves to flat
// `.claude-flow/<storeId>.json` because the storeId has no override entry.
// Post-dispatch envelope reads stale empty state.
//
// Cross-package introspection (compare archivist's resolved path to the cli's
// `loadXxxStore` path) is impractical from inside this module. What IS
// practical at register-time / init-time is structural validation of every
// override entry: catches typos, accidental absolute paths, path-traversal
// attempts, and entries whose value drifts away from the conventional
// `<family>/<file>.json` shape.
//
// `auditFsJsonPathOverrides()` below returns a structured report so callers
// (Archivist.initialize, tests) can decide between throw / log / aggregate.
// Strict callers throw on any violation per `feedback-no-fallbacks`.

export interface PathAlignmentViolation {
  readonly storeId: string;
  readonly relPath: string;
  readonly map: 'claude-flow' | 'project-root';
  readonly reason:
    | 'empty-relative-path'
    | 'absolute-path'
    | 'path-traversal'
    | 'leading-or-trailing-slash'
    | 'backslash-separator';
}

export interface PathAlignmentReport {
  readonly checked: number;
  readonly violations: ReadonlyArray<PathAlignmentViolation>;
}

/**
 * Pure structural inspector for a single override entry. Exported so tests
 * can exercise every violation branch without having to mutate the private
 * `FS_JSON_PATH_OVERRIDES` constant.
 */
export function inspectOverrideEntry(
  storeId: string,
  rel: string,
  map: 'claude-flow' | 'project-root',
): PathAlignmentViolation | null {
  if (rel.length === 0) {
    return { storeId, relPath: rel, map, reason: 'empty-relative-path' };
  }
  // Absolute path is wrong — fsJsonPathFor would lose the projectRoot prefix
  // on POSIX (joinPath strips leading `/`) but on Windows the resolution is
  // ambiguous. Either way it indicates a bad override.
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) {
    return { storeId, relPath: rel, map, reason: 'absolute-path' };
  }
  if (rel.startsWith('/') || rel.endsWith('/')) {
    return { storeId, relPath: rel, map, reason: 'leading-or-trailing-slash' };
  }
  if (rel.includes('\\')) {
    return { storeId, relPath: rel, map, reason: 'backslash-separator' };
  }
  // `..` segments would let an override escape `.claude-flow/` (or the project
  // root). The few legitimate outside-`.claude-flow/` paths are explicitly
  // routed through FS_JSON_PATH_OVERRIDES_PROJECT_ROOT instead.
  const segments = rel.split('/');
  if (segments.some((s) => s === '..')) {
    return { storeId, relPath: rel, map, reason: 'path-traversal' };
  }
  return null;
}

/**
 * Audit every entry in `FS_JSON_PATH_OVERRIDES` and
 * `FS_JSON_PATH_OVERRIDES_PROJECT_ROOT` for structural well-formedness.
 *
 * Catches: typos producing absolute paths, leading/trailing slashes that
 * confuse `joinPath`, backslash separators, `..` segments that would escape
 * the project root, and empty values.
 *
 * Does NOT catch: cli/archivist path divergence (cross-package introspection
 * isn't practical here — that gap belongs to a manifest test or a per-PR
 * cli-side audit). The four documented Phase-2/Phase-5 incidents would NOT
 * have been caught by structural validation; this guard catches the next
 * class of bug, not the prior one.
 */
export function auditFsJsonPathOverrides(): PathAlignmentReport {
  const violations: PathAlignmentViolation[] = [];
  let checked = 0;

  for (const [storeId, rel] of FS_JSON_PATH_OVERRIDES) {
    checked++;
    const v = inspectOverrideEntry(storeId, rel, 'claude-flow');
    if (v) violations.push(v);
  }
  for (const [storeId, rel] of FS_JSON_PATH_OVERRIDES_PROJECT_ROOT) {
    checked++;
    const v = inspectOverrideEntry(storeId, rel, 'project-root');
    if (v) violations.push(v);
  }

  return { checked, violations };
}

/**
 * Convenience wrapper for `Archivist.initialize()` startup-check use:
 * audits both override maps and throws fail-loud (per
 * `feedback-no-fallbacks`) if any violation is found. The thrown message
 * lists every violation so the operator sees the full picture in one
 * stack — not "fix one, restart, fix the next."
 */
export function assertFsJsonPathOverridesAligned(): void {
  const report = auditFsJsonPathOverrides();
  if (report.violations.length === 0) return;
  const lines = report.violations.map(
    (v) => `  - storeId='${v.storeId}' (${v.map}) relPath='${v.relPath}': ${v.reason}`,
  );
  throw new Error(
    `archivist: FS_JSON_PATH_OVERRIDES startup-alignment check failed (${report.violations.length}/${report.checked} violations):\n${lines.join('\n')}`,
  );
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
