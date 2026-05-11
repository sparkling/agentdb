-- ============================================================================
-- AgentDB State-of-the-Art Memory Schema (PostgreSQL dialect — ADR-0170)
-- ============================================================================
-- Implements 5 cutting-edge memory patterns for autonomous agents:
-- 1. Reflexion-style episodic replay
-- 2. Skill library from trajectories
-- 3. Structured mixed memory (facts + summaries)
-- 4. Episodic segmentation and consolidation
-- 5. Graph-aware recall
-- ============================================================================
--
-- ADR-0170 Phase A.5 — ported from SQLite to PostgreSQL:
--   - INTEGER PRIMARY KEY AUTOINCREMENT      → BIGSERIAL PRIMARY KEY
--   - INTEGER NOT NULL DEFAULT (strftime…)   → BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
--   - BLOB                                   → BYTEA
--   - PRAGMA foreign_keys = ON               → removed (postgres FKs on by default)
--   - INSERT OR IGNORE / INSERT OR REPLACE   → INSERT ... ON CONFLICT ... (controller-level)
--   - FTS5 virtual tables                    → tsvector + GIN indexes (only used where FTS is actually exercised — Phase B per-controller port)
--
-- This file is the BOOTSTRAP schema only — controllers may issue their own
-- DDL/DML in postgres dialect during Phase B. Schema versions and migration
-- bookkeeping are owned by the agentdb migrate CLI (Phase D).
-- ============================================================================

-- ============================================================================
-- Pattern 1: Reflexion-Style Episodic Replay
-- ============================================================================
-- Store self-critique and outcomes after each attempt.
-- Retrieve nearest failures and fixes before the next run.

CREATE TABLE IF NOT EXISTS episodes (
  id BIGSERIAL PRIMARY KEY,
  ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  session_id TEXT NOT NULL,
  task TEXT NOT NULL,
  input TEXT,
  output TEXT,
  critique TEXT,
  reward REAL DEFAULT 0.0,
  success BOOLEAN DEFAULT FALSE,
  latency_ms BIGINT,
  tokens_used BIGINT,
  tags TEXT, -- JSON array of tags
  metadata JSONB,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_episodes_ts ON episodes(ts DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_reward ON episodes(reward DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task);

-- Vector embeddings for episodes (768-dim default for nomic-embed-text-v1.5)
-- Phase C will replace the BYTEA blob with a pgvector `vector(N)` column.
CREATE TABLE IF NOT EXISTS episode_embeddings (
  episode_id BIGINT PRIMARY KEY,
  embedding BYTEA NOT NULL, -- Float32Array as BYTEA (Phase A bootstrap; Phase C → vector)
  embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
  FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

-- ============================================================================
-- Pattern 2: Skill Library from Trajectories
-- ============================================================================
-- Promote high-reward traces into reusable "skills" with typed IO.

CREATE TABLE IF NOT EXISTS skills (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  signature JSONB NOT NULL, -- {inputs: {...}, outputs: {...}}
  code TEXT, -- Tool call manifest or code template
  success_rate REAL DEFAULT 0.0,
  uses BIGINT DEFAULT 0,
  avg_reward REAL DEFAULT 0.0,
  avg_latency_ms BIGINT DEFAULT 0,
  created_from_episode BIGINT, -- Source episode ID
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  last_used_at BIGINT,
  metadata JSONB,
  FOREIGN KEY(created_from_episode) REFERENCES episodes(id)
);

CREATE INDEX IF NOT EXISTS idx_skills_success ON skills(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_skills_uses ON skills(uses DESC);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

-- Skill relationships and composition
CREATE TABLE IF NOT EXISTS skill_links (
  id BIGSERIAL PRIMARY KEY,
  parent_skill_id BIGINT NOT NULL,
  child_skill_id BIGINT NOT NULL,
  relationship TEXT NOT NULL, -- 'prerequisite', 'alternative', 'refinement', 'composition'
  weight REAL DEFAULT 1.0,
  metadata JSONB,
  FOREIGN KEY(parent_skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY(child_skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE(parent_skill_id, child_skill_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_skill_links_parent ON skill_links(parent_skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_links_child ON skill_links(child_skill_id);

-- Skill embeddings for semantic search (Phase A bootstrap; Phase C → vector)
CREATE TABLE IF NOT EXISTS skill_embeddings (
  skill_id BIGINT PRIMARY KEY,
  embedding BYTEA NOT NULL,
  embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
  FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ============================================================================
-- Pattern 3: Structured Mixed Memory (Facts + Summaries)
-- ============================================================================
-- Combine facts, summaries, and vectors to avoid over-embedding.

-- Atomic facts as triples (subject-predicate-object)
CREATE TABLE IF NOT EXISTS facts (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  source_type TEXT, -- 'episode', 'skill', 'external', 'inferred'
  source_id BIGINT,
  confidence REAL DEFAULT 1.0,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  expires_at BIGINT, -- TTL for temporal facts
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object);
CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_facts_expires ON facts(expires_at) WHERE expires_at IS NOT NULL;

-- Notes and summaries with semantic embeddings
CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  text TEXT NOT NULL,
  summary TEXT, -- Condensed version for context
  note_type TEXT DEFAULT 'general', -- 'insight', 'constraint', 'goal', 'observation'
  importance REAL DEFAULT 0.5,
  access_count BIGINT DEFAULT 0,
  last_accessed_at BIGINT,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type);
CREATE INDEX IF NOT EXISTS idx_notes_importance ON notes(importance DESC);
CREATE INDEX IF NOT EXISTS idx_notes_accessed ON notes(last_accessed_at DESC);
-- tsvector FTS index over notes.title + notes.text + notes.summary
-- (replaces SQLite FTS5 virtual table). Lucene-grade ranking, multilingual
-- stemming. The text-search expression is recomputed on read; controllers
-- that need ts_rank() include the full to_tsvector(...) expression in their
-- WHERE/ORDER BY (Phase B per-controller port owns the query rewrite).
CREATE INDEX IF NOT EXISTS idx_notes_fts
  ON notes
  USING GIN (to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(text, '') || ' ' || COALESCE(summary, '')));

-- Note embeddings (only for summaries to reduce storage) — Phase A bootstrap
CREATE TABLE IF NOT EXISTS note_embeddings (
  note_id BIGINT PRIMARY KEY,
  embedding BYTEA NOT NULL,
  embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
);

-- ============================================================================
-- Pattern 4: Episodic Segmentation and Consolidation
-- ============================================================================
-- Segment long tasks into events and consolidate into compact memories.

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  episode_id BIGINT, -- Link to parent episode
  step BIGINT NOT NULL,
  phase TEXT, -- 'planning', 'execution', 'reflection', 'learning'
  role TEXT, -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  features JSONB, -- Extracted features for learning
  tool_calls JSONB, -- Tool invocations in this event
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, step);
CREATE INDEX IF NOT EXISTS idx_events_phase ON events(phase);
CREATE INDEX IF NOT EXISTS idx_events_episode ON events(episode_id);

-- Consolidated memories from event windows
CREATE TABLE IF NOT EXISTS consolidated_memories (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_event_id BIGINT NOT NULL,
  end_event_id BIGINT NOT NULL,
  phase TEXT,
  summary TEXT NOT NULL,
  key_insights JSONB, -- Extracted learnings
  success_patterns JSONB, -- What worked
  failure_patterns JSONB, -- What didn't work
  quality_score REAL DEFAULT 0.5,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  FOREIGN KEY(start_event_id) REFERENCES events(id),
  FOREIGN KEY(end_event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_consolidated_session ON consolidated_memories(session_id);
CREATE INDEX IF NOT EXISTS idx_consolidated_quality ON consolidated_memories(quality_score DESC);

-- ============================================================================
-- Pattern 5: Graph-Aware Recall (Lightweight GraphRAG)
-- ============================================================================
-- Build a lightweight GraphRAG overlay for experiences.

CREATE TABLE IF NOT EXISTS exp_nodes (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL, -- 'task', 'skill', 'concept', 'tool', 'outcome'
  label TEXT NOT NULL,
  payload JSONB,
  centrality REAL DEFAULT 0.0, -- Graph importance metric
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_exp_nodes_kind ON exp_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_exp_nodes_label ON exp_nodes(label);
CREATE INDEX IF NOT EXISTS idx_exp_nodes_centrality ON exp_nodes(centrality DESC);

CREATE TABLE IF NOT EXISTS exp_edges (
  id BIGSERIAL PRIMARY KEY,
  src_node_id BIGINT NOT NULL,
  dst_node_id BIGINT NOT NULL,
  relationship TEXT NOT NULL, -- 'requires', 'produces', 'similar_to', 'refines', 'part_of'
  weight REAL DEFAULT 1.0,
  metadata JSONB,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  FOREIGN KEY(src_node_id) REFERENCES exp_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(dst_node_id) REFERENCES exp_nodes(id) ON DELETE CASCADE,
  UNIQUE(src_node_id, dst_node_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_exp_edges_src ON exp_edges(src_node_id);
CREATE INDEX IF NOT EXISTS idx_exp_edges_dst ON exp_edges(dst_node_id);
CREATE INDEX IF NOT EXISTS idx_exp_edges_rel ON exp_edges(relationship);

-- Node embeddings for graph-augmented retrieval (Phase A bootstrap)
CREATE TABLE IF NOT EXISTS exp_node_embeddings (
  node_id BIGINT PRIMARY KEY,
  embedding BYTEA NOT NULL,
  embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
  FOREIGN KEY(node_id) REFERENCES exp_nodes(id) ON DELETE CASCADE
);

-- ============================================================================
-- Memory Management and Scoring
-- ============================================================================

-- Track memory quality scores and usage statistics
CREATE TABLE IF NOT EXISTS memory_scores (
  id BIGSERIAL PRIMARY KEY,
  memory_type TEXT NOT NULL, -- 'episode', 'skill', 'note', 'consolidated'
  memory_id BIGINT NOT NULL,
  quality_score REAL NOT NULL,
  novelty_score REAL,
  relevance_score REAL,
  utility_score REAL,
  computed_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_memory_scores_type ON memory_scores(memory_type, memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_scores_quality ON memory_scores(quality_score DESC);

-- Memory access patterns for adaptive retrieval
CREATE TABLE IF NOT EXISTS memory_access_log (
  id BIGSERIAL PRIMARY KEY,
  memory_type TEXT NOT NULL,
  memory_id BIGINT NOT NULL,
  query TEXT,
  relevance_score REAL,
  was_useful BOOLEAN,
  feedback JSONB,
  accessed_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_access_log_type ON memory_access_log(memory_type, memory_id);
CREATE INDEX IF NOT EXISTS idx_access_log_time ON memory_access_log(accessed_at DESC);

-- ============================================================================
-- Consolidation and Maintenance
-- ============================================================================

-- Track consolidation jobs and their results
CREATE TABLE IF NOT EXISTS consolidation_runs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL, -- 'episode_to_skill', 'event_to_memory', 'deduplication', 'pruning'
  records_processed BIGINT DEFAULT 0,
  records_created BIGINT DEFAULT 0,
  records_deleted BIGINT DEFAULT 0,
  duration_ms BIGINT,
  status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  error TEXT,
  started_at BIGINT,
  completed_at BIGINT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_consolidation_status ON consolidation_runs(status);
CREATE INDEX IF NOT EXISTS idx_consolidation_type ON consolidation_runs(job_type);

-- ============================================================================
-- Views for Common Queries
-- ============================================================================

-- High-value episodes for skill creation
-- NOTE: SQLite's strftime('%s','now')-86400*7 maps to postgres
--       EXTRACT(EPOCH FROM NOW())::BIGINT - 86400*7
--       GROUP_CONCAT becomes string_agg(... , ',')
CREATE OR REPLACE VIEW skill_candidates AS
SELECT
  task,
  COUNT(*) as attempt_count,
  AVG(reward) as avg_reward,
  AVG(CASE WHEN success THEN 1 ELSE 0 END) as success_rate,
  MAX(id) as latest_episode_id,
  string_agg(id::TEXT, ',') as episode_ids
FROM episodes
WHERE ts > EXTRACT(EPOCH FROM NOW())::BIGINT - 86400 * 7 -- Last 7 days
GROUP BY task
HAVING COUNT(*) >= 3 AND AVG(reward) >= 0.7;

-- Top performing skills
CREATE OR REPLACE VIEW top_skills AS
SELECT
  s.*,
  COALESCE(s.success_rate, 0) * 0.4 +
  COALESCE(s.uses, 0) * 0.0001 +
  COALESCE(s.avg_reward, 0) * 0.6 as composite_score
FROM skills s
ORDER BY composite_score DESC;

-- Recent high-quality memories
CREATE OR REPLACE VIEW recent_quality_memories AS
SELECT
  'episode' as type, id, task as title, critique as content, reward as score, created_at
FROM episodes
WHERE reward >= 0.7 AND ts > EXTRACT(EPOCH FROM NOW())::BIGINT - 86400 * 3
UNION ALL
SELECT
  'note' as type, id, title, summary as content, importance as score, created_at
FROM notes
WHERE importance >= 0.7 AND created_at > EXTRACT(EPOCH FROM NOW())::BIGINT - 86400 * 3
UNION ALL
SELECT
  'consolidated' as type, id, session_id as title, summary as content, quality_score as score, created_at
FROM consolidated_memories
WHERE quality_score >= 0.7 AND created_at > EXTRACT(EPOCH FROM NOW())::BIGINT - 86400 * 3
ORDER BY created_at DESC;

-- ============================================================================
-- Triggers for Auto-Maintenance (PostgreSQL syntax — replaces SQLite triggers)
-- ============================================================================
-- PostgreSQL triggers require a function + CREATE TRIGGER pair. Each
-- function emits a trigger-fragment that updates the relevant row.

-- Update skill usage statistics
CREATE OR REPLACE FUNCTION trg_skill_last_used()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_used_at := EXTRACT(EPOCH FROM NOW())::BIGINT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_skill_last_used ON skills;
CREATE TRIGGER update_skill_last_used
BEFORE UPDATE OF uses ON skills
FOR EACH ROW EXECUTE FUNCTION trg_skill_last_used();

-- Update note access tracking
CREATE OR REPLACE FUNCTION trg_note_access()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_accessed_at := EXTRACT(EPOCH FROM NOW())::BIGINT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_note_access ON notes;
CREATE TRIGGER update_note_access
BEFORE UPDATE OF access_count ON notes
FOR EACH ROW EXECUTE FUNCTION trg_note_access();

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION trg_skill_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := EXTRACT(EPOCH FROM NOW())::BIGINT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_skill_timestamp ON skills;
CREATE TRIGGER update_skill_timestamp
BEFORE UPDATE ON skills
FOR EACH ROW EXECUTE FUNCTION trg_skill_timestamp();

CREATE OR REPLACE FUNCTION trg_note_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := EXTRACT(EPOCH FROM NOW())::BIGINT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_note_timestamp ON notes;
CREATE TRIGGER update_note_timestamp
BEFORE UPDATE ON notes
FOR EACH ROW EXECUTE FUNCTION trg_note_timestamp();

-- ============================================================================
-- Initialization Complete
-- ============================================================================
-- Schema version: 2.0.0 (ADR-0170 postgres dialect)
-- Compatible with: PostgreSQL 15+ (pglite or server)
-- pgvector integration: Phase C (replaces BYTEA embedding columns with vector(N))
--
-- Performance Optimization:
-- For production deployments, apply composite index migration for 30-50% query speedup:
--   - Migration file: db/migrations/003_composite_indexes.sql (port to postgres dialect — Phase B)
--   - Trade-off: 2x slower writes, +15-20% storage (acceptable for read-heavy workloads)
-- ============================================================================
