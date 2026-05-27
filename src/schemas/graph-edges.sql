-- ============================================================================
-- AgentDB Graph Edges Schema (ADR-0261 — fork-native ADR-130 re-implementation)
-- ============================================================================
-- Reinforcement-decay retrieval ("graph that forgets") in memory-entry-row
-- space. Distinct from `causal_edges` (controller-id space, causal inference
-- math) — see ADR-0261 §1.8 for the 5-surface landscape.
--
-- Scoring at query time:
--   score = confidence * exp(-decay_rate * days_since(last_reinforced)) * weight
--
-- Writes route through the archivist `agentdb_graph_edge` handler. Encoded
-- embedding payload (scalar-int8) is base64-wrapped with an `inline:` prefix
-- and stored in `embedding_ref` (upstream's column shape; nullable). Witness
-- id derived from `sha256(installation_id || audit_chain_entry_id).slice(0,16)`
-- per ADR-0261 §1.4 (federation-stable shape; federation wire-up itself
-- deferred).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- Reinforcement-decay edges between memory_entries rows.
--
-- IMPLEMENTATION NOTE (ADR-0261 §R2 port-to-upstream alignment):
-- Columns are TEXT to match upstream's domain-prefixed UUID convention
-- (`task:`/`pattern:`/`memory:`/etc.). FK to memory_entries is omitted
-- because the cli's memory_entries table lives in a different package;
-- referential integrity is enforced at the handler / invariant layer
-- (callers must supply non-empty string ids). This matches the existing
-- `causal_edges` pattern at `frontier-schema.sql:42-44` which explicitly
-- comments "Foreign keys removed to allow flexible causal edges between
-- any concepts".
--
-- `last_reinforced` is ISO 8601 TEXT (upstream's convention). The previous
-- INTEGER unix-seconds shape was Agent A's divergence; reverted here so the
-- cross-agent contract (Agent B passes `new Date().toISOString()`) lands
-- intact.
--
-- `embedding_ref` is nullable TEXT with the `inline:base64(scalar-int8-payload)`
-- format. Upstream uses TEXT so a future external-store backing (e.g.
-- federation-shared blob store) needs no schema change.
CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  weight REAL NOT NULL DEFAULT 1.0,
  decay_rate REAL NOT NULL DEFAULT 0.01,
  last_reinforced TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  embedding_ref TEXT,
  witness_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Idempotent reinforcement: a (source_id, target_id, relation) tuple is the upsert key.
-- ON CONFLICT in the handler bumps reinforcement_count + last_reinforced.
CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_triple
  ON graph_edges(source_id, target_id, relation);

-- Sweep + retention scans walk DESC by last_reinforced.
CREATE INDEX IF NOT EXISTS idx_graph_edges_last_reinforced
  ON graph_edges(last_reinforced DESC);

-- Federation / audit-chain reverse lookups by witness id.
CREATE INDEX IF NOT EXISTS idx_graph_edges_witness
  ON graph_edges(witness_id);

-- Direction filters (`query` action's `direction: 'src'|'dst'|'both'`).
-- Index alias `_src` retained from earlier naming for stability; indexes
-- the renamed source_id column.
CREATE INDEX IF NOT EXISTS idx_graph_edges_src
  ON graph_edges(source_id);

CREATE INDEX IF NOT EXISTS idx_graph_edges_dst
  ON graph_edges(target_id);
