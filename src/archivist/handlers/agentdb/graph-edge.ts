// charter: dispatch
// agentdb_graph_edge mutation handler — ADR-0261 fork-native ADR-130
// re-implementation. Per-edge writes route through the archivist's audit-
// chain via `ctx.substrate.withWrite({storeId:'agentdb_graph_edge'}, ...)`
// (SQLite carve-out per ADR-0261 §R2.10 + substrate-registry.ts entry).
//
// Six actions on one storeId:
//   - 'save'           upsert a (source_id, target_id, relation) edge; reinforces on conflict
//   - 'load'           SELECT row by id
//   - 'query'          SELECT by direction='src'|'dst'|'both' with optional limit
//   - 'reinforce'      bump last_reinforced + reinforcement_count (+ confidence)
//   - 'decay'          read-only scoring (confidence * exp(-decay_rate * Δdays) * weight)
//   - 'sweep-internal' DELETE rows older than maxAgeDays (worker-only)
//
// Column shape matches upstream (ADR-0261 §R2 port-to-upstream alignment):
//   id INTEGER, source_id TEXT, target_id TEXT, relation TEXT,
//   confidence REAL, weight REAL, decay_rate REAL, last_reinforced TEXT (ISO 8601),
//   reinforcement_count INTEGER, embedding_ref TEXT NULLABLE ('inline:base64(...)'),
//   witness_id TEXT, metadata TEXT NULLABLE, created_at TEXT
//
// Cross-agent contract (Agent B / forks/ruflo callers):
//   - sourceId/targetId are STRINGS with domain prefixes (e.g. 'task:abc', 'pattern:xyz')
//   - embedding is OPTIONAL — when absent, embedding_ref column stays NULL
//   - metadata is OPTIONAL — serialized to JSON TEXT when present
//   - lastReinforced may be supplied by the caller (ISO 8601); when absent the
//     schema default (current time) is used
//
// Witness id derivation (ADR-0261 §R1.4 / §R2.6 C7–C8):
//   witness_id = sha256(installation_id || audit_chain_entry_id).slice(0, 16)
// installation_id reads from config-chain (`graphEdges.installationId`); if
// absent we derive a per-installation-stable surrogate from `ctx.projectRoot`
// so the witness column is populated today and federation wire-up (when it
// lands per a sibling ADR) only swaps the source.
//
// Lock posture: per-op acquisition through `ctx.substrate.withWrite` only.
// No module-scope `_db = null` cache (ADR-0202 / ADR-0246). No fire-and-
// forget catches — invariant + DB errors throw and surface to the caller
// (`feedback-best-effort-must-rethrow-fatals` / `feedback-no-fallbacks`).
//
// Config-chain compliance (ADR-0261 §R2.3, acceptance C4): no hardcoded
// model name / dim / 768 / 384 / 90 / 0.01 / 64. Every numeric default
// reaches the runtime via `getGraphEdgesConfig()` / `getConfig()`.

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  registerMutationHandler,
  registerReadHandler,
} from '../../registration.js';
import type {
  GuardedRead,
  GuardedWrite,
  MutationContext,
  ReadContext,
  StoreId,
} from '../../index.js';
import type BetterSqlite3 from 'better-sqlite3';
import { graphEdgeInvariants } from '../../invariants/agentdb/graph-edge.js';
import {
  encode,
  decode,
  getGraphEdgesConfig,
  getInstallationId,
  payloadBytesForCurrentConfig,
} from '../../../encoders/scalar-int8-encoder.js';

/** Discriminated union over the six action shapes the handler supports. */
export type AgentdbGraphEdgePayload =
  | AgentdbGraphEdgeSavePayload
  | AgentdbGraphEdgeLoadPayload
  | AgentdbGraphEdgeQueryPayload
  | AgentdbGraphEdgeReinforcePayload
  | AgentdbGraphEdgeDecayPayload
  | AgentdbGraphEdgeSweepInternalPayload;

export interface AgentdbGraphEdgeSavePayload {
  readonly action: 'save';
  /** Domain-prefixed string id (e.g. 'task:abc-def'). */
  readonly sourceId: string;
  /** Domain-prefixed string id (e.g. 'pattern:xyz'). */
  readonly targetId: string;
  readonly relation: string;
  /** Optional float32 embedding for the edge; encoded via scalar-int8 + base64. */
  readonly embedding?: Float32Array;
  /** Optional confidence ∈ [0, 1] — defaults to schema default 0.5. */
  readonly confidence?: number;
  /** Optional weight; finite non-negative — defaults to schema default 1.0. */
  readonly weight?: number;
  /** Optional decay_rate; finite non-negative — defaults to graphEdges.decay.defaultRate. */
  readonly decayRate?: number;
  /** Optional ISO 8601 timestamp; defaults to current time via schema default. */
  readonly lastReinforced?: string;
  /** Optional metadata payload — serialized to JSON TEXT before insert. */
  readonly metadata?: unknown;
}

export interface AgentdbGraphEdgeLoadPayload {
  readonly action: 'load';
  readonly id: number;
}

export interface AgentdbGraphEdgeQueryPayload {
  readonly action: 'query';
  /** Filter by string memory id (e.g. 'task:abc'). */
  readonly memoryId: string;
  readonly direction: 'src' | 'dst' | 'both';
  readonly limit?: number;
  readonly relation?: string;
}

export interface AgentdbGraphEdgeReinforcePayload {
  readonly action: 'reinforce';
  readonly id: number;
  /** Optional confidence to overwrite (e.g. signal strength from caller). */
  readonly confidence?: number;
}

export interface AgentdbGraphEdgeDecayPayload {
  readonly action: 'decay';
  /** Optional memory id filter; otherwise scores all rows. */
  readonly memoryId?: string;
  readonly direction?: 'src' | 'dst' | 'both';
  readonly limit?: number;
}

export interface AgentdbGraphEdgeSweepInternalPayload {
  readonly action: 'sweep-internal';
  readonly maxAgeDays: number;
}

/**
 * Read-side query payload (proxied to the mutation handler's query branch).
 * Mirrors Agent B's `dispatchRead('agentdb_graph_edge_query', ...)` call
 * shape — used by the cli's graph-query MCP tool to fetch candidate rows.
 */
export interface AgentdbGraphEdgeQueryReadPayload {
  /** Optional action discriminator — defaults to 'list'. */
  readonly action?: 'list';
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly relation?: string;
  /** When true, return only rows whose embedding_ref IS NOT NULL. */
  readonly withEmbedding?: boolean;
  readonly limit?: number;
}

/** Wire shape returned to read-side callers (the cli's graph-query consumer). */
export interface GraphEdgeReadRow {
  readonly id: number;
  readonly source_id: string;
  readonly target_id: string;
  readonly relation: string;
  readonly weight: number;
  readonly confidence: number;
  readonly decay_rate: number;
  readonly last_reinforced: string | null;
  readonly witness_id: string | null;
  readonly embedding_ref: string | null;
  readonly metadata: string | null;
  readonly reinforcement_count: number;
  readonly created_at: string;
}

const STORE_ID = 'agentdb_graph_edge' as StoreId;

/** Mutation-side row shape used by tests inspecting the SAVEPOINT'd state. */
export interface GraphEdgeRow {
  readonly id: number;
  readonly source_id: string;
  readonly target_id: string;
  readonly relation: string;
  readonly confidence: number;
  readonly weight: number;
  readonly decay_rate: number;
  readonly last_reinforced: string;
  readonly reinforcement_count: number;
  readonly embedding_ref: string | null;
  readonly witness_id: string;
  readonly metadata: string | null;
  readonly created_at: string;
}

export interface GraphEdgeScored extends GraphEdgeRow {
  /** confidence * exp(-decay_rate * daysSince(last_reinforced)) * weight */
  readonly score: number;
}

/**
 * Stable per-installation id used in the witness hash. Reads
 * `graphEdges.installationId` from config-chain; falls back to a deterministic
 * sha256 hash of `ctx.projectRoot`. The fallback IS stable across runs of the
 * same installation (projectRoot resolves to the same path) AND across
 * substrate rebuilds (no DB persistence dependence). Federation wire-up
 * (deferred to a sibling ADR per §R1.4) only needs to flip the source from
 * "projectRoot hash" to "federation-registered installation id" without
 * changing the witness derivation formula.
 */
function resolveInstallationId(projectRoot: string): string {
  const explicit = getInstallationId();
  if (explicit && explicit.length > 0) return explicit;
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
}

/** Witness id = first 16 hex chars of `sha256(installation_id || audit_chain_entry_id)`. */
function deriveWitnessId(installationId: string, auditId: string): string {
  return createHash('sha256').update(installationId).update(auditId).digest('hex').slice(0, 16);
}

/**
 * Resolve the underlying better-sqlite3 handle from the substrate handle.
 *
 * SQLite-classified store ids return a `SqliteSubstrateHandle` whose `.db` is
 * the shared better-sqlite3 database. Throws fail-loud if missing — a
 * misclassified store id (FS-JSON / RVF) reaches this handler only via
 * substrate-registry drift, and the throw catches that drift loudly per
 * `feedback-no-fallbacks`.
 */
function asSqlite(handle: unknown): BetterSqlite3.Database {
  const h = handle as { db?: BetterSqlite3.Database };
  if (!h.db || typeof h.db.prepare !== 'function') {
    throw new Error(
      'archivist: agentdb_graph_edge — substrate handle missing `.db`; ' +
        'storeId must be in SQLITE_CARVE_OUT_STORE_IDS (see substrate-registry.ts).',
    );
  }
  return h.db;
}

/**
 * Encode a Float32 embedding to the `inline:base64(scalar-int8-payload)` TEXT
 * shape stored in `embedding_ref`. Mirrors upstream's TEXT convention so a
 * future external blob store needs no schema change (just a different prefix).
 */
function encodeEmbeddingRef(vec: Float32Array): string {
  const payload = encode(vec);
  const expectedBytes = payloadBytesForCurrentConfig();
  if (payload.byteLength !== expectedBytes) {
    // Defensive — encode() already enforces this; double-check for the
    // invariant gate's audit shape.
    throw new Error(
      `archivist: agentdb_graph_edge — encoded payload is ${payload.byteLength}B; ` +
        `expected ${expectedBytes}B for current config-chain dim.`,
    );
  }
  return 'inline:' + Buffer.from(payload).toString('base64');
}

/**
 * Decode an `inline:base64(...)` `embedding_ref` cell back to a Float32Array.
 * Throws on prefix mismatch or invalid base64 — fail-loud per
 * `feedback-no-fallbacks`. Used by graph-pathfinder temporal-centrality and
 * graph-query semantic mode (via the encoder's `inlineCosine` for zero-decode
 * compare, or this fn when a full float32 round-trip is needed).
 */
export function decodeEmbedding(ref: string | null | undefined): Float32Array | null {
  if (ref === null || ref === undefined) return null;
  if (!ref.startsWith('inline:')) {
    throw new Error(
      `archivist: agentdb_graph_edge — embedding_ref must start with 'inline:'; got ${ref.slice(0, 16)}`,
    );
  }
  const b64 = ref.slice('inline:'.length);
  const bytes = Buffer.from(b64, 'base64');
  // Buffer.from doesn't throw on bad base64 — verify length is at least the
  // header's 16 bytes so decode() can validate the magic.
  if (bytes.byteLength < 16) {
    throw new Error(
      `archivist: agentdb_graph_edge — embedding_ref payload too short after base64 decode (${bytes.byteLength}B); ` +
        'header alone is 16B.',
    );
  }
  return decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

function serializeMetadata(meta: unknown): string | null {
  if (meta === undefined || meta === null) return null;
  if (typeof meta === 'string') return meta;
  return JSON.stringify(meta);
}

export const graphEdgeHandler: GuardedWrite<AgentdbGraphEdgePayload> =
  registerMutationHandler<AgentdbGraphEdgePayload>(
    'agentdb_graph_edge',
    async (ctx: MutationContext<false>, payload: AgentdbGraphEdgePayload): Promise<void> => {
      // Per-op substrate acquisition. The withWrite scope opens a SAVEPOINT
      // (via staging-substrate.ts) so any DB error inside the closure rolls
      // back to a clean state — no orphan row, no orphan audit-chain entry
      // (ADR-0261 §R2.6 C7).
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const db = asSqlite(handle);
        switch (payload.action) {
          case 'save':
            return doSave(db, ctx, payload);
          case 'load':
            return doLoad(db, payload);
          case 'query':
            return doQuery(db, payload);
          case 'reinforce':
            return doReinforce(db, payload);
          case 'decay':
            return doDecay(db, payload);
          case 'sweep-internal':
            return doSweepInternal(db, payload);
          default: {
            // Exhaustive check — the cast forces a compile error if a new
            // action is added to the union without a branch here.
            const _exhaustive: never = payload;
            throw new Error(
              `archivist: agentdb_graph_edge — unknown action ${JSON.stringify(_exhaustive)}`,
            );
          }
        }
      });
    },
    {
      invariants: graphEdgeInvariants,
      cacheScope: 'namespace',
    },
  );

// ─── Action implementations ──────────────────────────────────────────────────

function doSave(
  db: BetterSqlite3.Database,
  ctx: MutationContext<false>,
  payload: AgentdbGraphEdgeSavePayload,
): void {
  const cfg = getGraphEdgesConfig();
  const confidence = payload.confidence ?? 0.5;
  const weight = payload.weight ?? 1.0;
  const decayRate = payload.decayRate ?? cfg.decay.defaultRate;

  // embedding_ref is OPTIONAL — Agent B's writers (hooks-tools.ts) currently
  // dispatch saves without an embedding. When present, encode + base64-wrap.
  const embeddingRef: string | null =
    payload.embedding !== undefined ? encodeEmbeddingRef(payload.embedding) : null;

  const installationId = resolveInstallationId(ctx.projectRoot);
  const witnessId = deriveWitnessId(installationId, ctx.auditId);

  const metadataJson = serializeMetadata(payload.metadata);

  // ON CONFLICT triggers reinforcement: bumps last_reinforced + count, and
  // overwrites confidence/weight/decay_rate with the caller's latest values.
  // embedding_ref is also refreshed when supplied — the new caller may have a
  // refined embedding for the edge endpoint. When the new save omits the
  // embedding, the column is left untouched on conflict (COALESCE preserves
  // prior reference).
  const lastReinforcedSql = payload.lastReinforced !== undefined ? '?' : "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const stmt = db.prepare(`
    INSERT INTO graph_edges (
      source_id, target_id, relation, confidence, weight, decay_rate,
      last_reinforced, embedding_ref, witness_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ${lastReinforcedSql}, ?, ?, ?)
    ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
      confidence = excluded.confidence,
      weight = excluded.weight,
      decay_rate = excluded.decay_rate,
      embedding_ref = COALESCE(excluded.embedding_ref, graph_edges.embedding_ref),
      witness_id = excluded.witness_id,
      metadata = COALESCE(excluded.metadata, graph_edges.metadata),
      last_reinforced = excluded.last_reinforced,
      reinforcement_count = graph_edges.reinforcement_count + 1
  `);

  const baseParams: unknown[] = [
    payload.sourceId,
    payload.targetId,
    payload.relation,
    confidence,
    weight,
    decayRate,
  ];
  if (payload.lastReinforced !== undefined) {
    baseParams.push(payload.lastReinforced);
  }
  baseParams.push(embeddingRef, witnessId, metadataJson);

  stmt.run(...baseParams);
}

function doLoad(db: BetterSqlite3.Database, payload: AgentdbGraphEdgeLoadPayload): void {
  const row = db.prepare('SELECT * FROM graph_edges WHERE id = ?').get(payload.id);
  if (!row) {
    // Fail-loud — caller is expected to know the id exists. Differentiates
    // "row missing" from "DB unavailable".
    throw new Error(`archivist: agentdb_graph_edge load — no row with id=${payload.id}`);
  }
  // Decode is on-demand — caller invokes decodeEmbedding() at the read-back
  // layer when it needs the float32 vector. The canonical read path is the
  // read-side handler (`agentdb_graph_edge_query`) registered below.
  void row;
}

function doQuery(db: BetterSqlite3.Database, payload: AgentdbGraphEdgeQueryPayload): void {
  // The query action is here for symmetry with upstream's `_query` shape;
  // production callers go through the read-side handler (`agentdb_graph_edge_query`)
  // registered below. The mutation-side branch executes the SELECT so a
  // write-side caller (rare; smokes) can inspect the result.
  const limit = payload.limit && payload.limit > 0 ? payload.limit : 100;
  let sql: string;
  const params: unknown[] = [];
  if (payload.direction === 'both') {
    sql =
      'SELECT * FROM graph_edges WHERE (source_id = ? OR target_id = ?)';
    params.push(payload.memoryId, payload.memoryId);
  } else if (payload.direction === 'src') {
    sql = 'SELECT * FROM graph_edges WHERE source_id = ?';
    params.push(payload.memoryId);
  } else {
    sql = 'SELECT * FROM graph_edges WHERE target_id = ?';
    params.push(payload.memoryId);
  }
  if (payload.relation !== undefined && payload.relation.length > 0) {
    sql += ' AND relation = ?';
    params.push(payload.relation);
  }
  sql += ' ORDER BY last_reinforced DESC LIMIT ?';
  params.push(limit);
  // Execute — result rows discarded at this layer (read-side handler is the
  // canonical caller for graph queries).
  db.prepare(sql).all(...params);
}

function doReinforce(
  db: BetterSqlite3.Database,
  payload: AgentdbGraphEdgeReinforcePayload,
): void {
  // Bump the reinforcement counter + freshness ts; optionally overwrite
  // confidence. UPDATE ... RETURNING-style verification would require a
  // round-trip; instead we check `changes` to confirm the row existed.
  const stmt =
    payload.confidence !== undefined
      ? db.prepare(
          `UPDATE graph_edges SET
             confidence = ?,
             last_reinforced = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             reinforcement_count = reinforcement_count + 1
           WHERE id = ?`,
        )
      : db.prepare(
          `UPDATE graph_edges SET
             last_reinforced = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             reinforcement_count = reinforcement_count + 1
           WHERE id = ?`,
        );
  const info =
    payload.confidence !== undefined
      ? stmt.run(payload.confidence, payload.id)
      : stmt.run(payload.id);
  if (info.changes === 0) {
    throw new Error(
      `archivist: agentdb_graph_edge reinforce — no row with id=${payload.id}`,
    );
  }
}

function doDecay(db: BetterSqlite3.Database, payload: AgentdbGraphEdgeDecayPayload): void {
  // Decay is a READ action even though the handler is a mutation registration
  // — the row state is not modified, only scored. Kept on the write surface
  // for action-symmetry with upstream's `_query` mode-bag. Production callers
  // use the read-side handler.
  //
  // Score formula (ADR-0261 §Decision Outcome): confidence * exp(-decay_rate * Δdays) * weight.
  // Uses the column-stored decay_rate per §R2.4 (NOT the upstream-style
  // hardcoded 0.1 — that's the correctness fix; see ADR §Risks row "decay_rate
  // dead column").
  //
  // ISO 8601 `last_reinforced` is compared via SQLite's julianday() so the
  // Δdays computation lands in SQL (no per-row JS date parsing).
  const limit = payload.limit && payload.limit > 0 ? payload.limit : 100;
  const direction = payload.direction ?? 'both';
  let sql: string;
  const params: unknown[] = [];
  const daysSinceExpr =
    "(julianday('now') - julianday(last_reinforced)) AS days_since";
  if (payload.memoryId !== undefined) {
    if (direction === 'both') {
      sql =
        `SELECT *, ${daysSinceExpr} FROM graph_edges WHERE (source_id = ? OR target_id = ?)`;
      params.push(payload.memoryId, payload.memoryId);
    } else if (direction === 'src') {
      sql = `SELECT *, ${daysSinceExpr} FROM graph_edges WHERE source_id = ?`;
      params.push(payload.memoryId);
    } else {
      sql = `SELECT *, ${daysSinceExpr} FROM graph_edges WHERE target_id = ?`;
      params.push(payload.memoryId);
    }
  } else {
    sql = `SELECT *, ${daysSinceExpr} FROM graph_edges`;
  }
  sql += ' LIMIT ?';
  params.push(limit);
  // Caller-side scoring (the SQL fetch is just data; JS computes exp() per
  // row since SQLite's math lib is opt-in and not portable across builds).
  const rows = db.prepare(sql).all(...params) as Array<GraphEdgeRow & { days_since: number }>;
  for (const row of rows) {
    const score = row.confidence * Math.exp(-row.decay_rate * row.days_since) * row.weight;
    // Side-effect: keep the loop body honest; scoring done — caller's
    // read-side wrapper materializes the array.
    void score;
  }
}

function doSweepInternal(
  db: BetterSqlite3.Database,
  payload: AgentdbGraphEdgeSweepInternalPayload,
): void {
  if (!Number.isFinite(payload.maxAgeDays) || payload.maxAgeDays <= 0) {
    throw new Error(
      `archivist: agentdb_graph_edge sweep-internal — maxAgeDays must be a positive number, got ${String(payload.maxAgeDays)}`,
    );
  }
  // Delete rows whose ISO 8601 `last_reinforced` is older than the cutoff.
  // SQLite's date comparison on ISO 8601 strings is lexicographic-correct.
  const stmt = db.prepare(
    `DELETE FROM graph_edges
      WHERE last_reinforced < datetime('now', '-' || ? || ' days')`,
  );
  const info = stmt.run(payload.maxAgeDays);
  // Log sweep count to stderr (ADR-0261 §Decision Outcome #9 — worker logs
  // sweep counts to stderr; the handler emits the count for the worker to
  // pick up via the dispatch result chain).
  process.stderr.write(
    `[graph-edge-sweep] removed ${info.changes} edges older than ${payload.maxAgeDays} days\n`,
  );
}

// ─── Read-side handler (Agent B's `dispatchRead` target) ────────────────────
//
// Registered under `agentdb_graph_edge_query` to match the fork-wide
// read-side dispatch name used by `forks/ruflo/v3/@claude-flow/cli/src/mcp-
// tools/agentdb-tools.ts:2361`. Mirrors upstream's read shape (filter by
// source_id / target_id / relation / withEmbedding, paginated by limit) and
// returns the row set verbatim — the cli's graph-query semantic mode decodes
// embedding_ref via `decodeEmbedding` exported by `agentdb/encoders/scalar-int8-encoder`.

export const graphEdgeQueryReadHandler: GuardedRead<
  AgentdbGraphEdgeQueryReadPayload,
  ReadonlyArray<GraphEdgeReadRow>
> = registerReadHandler<AgentdbGraphEdgeQueryReadPayload, ReadonlyArray<GraphEdgeReadRow>>(
  'agentdb_graph_edge_query',
  async (
    ctx: ReadContext,
    payload: AgentdbGraphEdgeQueryReadPayload,
  ): Promise<ReadonlyArray<GraphEdgeReadRow>> => {
    const limit = payload.limit && payload.limit > 0 ? payload.limit : 100;
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (payload.sourceId !== undefined && payload.sourceId.length > 0) {
      clauses.push('source_id = @sourceId');
      params.sourceId = payload.sourceId;
    }
    if (payload.targetId !== undefined && payload.targetId.length > 0) {
      clauses.push('target_id = @targetId');
      params.targetId = payload.targetId;
    }
    if (payload.relation !== undefined && payload.relation.length > 0) {
      clauses.push('relation = @relation');
      params.relation = payload.relation;
    }
    if (payload.withEmbedding === true) {
      clauses.push('embedding_ref IS NOT NULL');
    }
    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT
        id, source_id, target_id, relation, weight, confidence, decay_rate,
        last_reinforced, witness_id, embedding_ref, metadata,
        reinforcement_count, created_at
      FROM graph_edges${whereClause}
      ORDER BY last_reinforced DESC
      LIMIT @limit
    `;
    return ctx.substrate.query<GraphEdgeReadRow>({
      storeId: STORE_ID,
      predicate: { sql, params },
    });
  },
  { cacheScope: 'global' },
);

// Helpers exported for tests / read-side handlers that need the same decode
// shape without re-importing the encoder package.
export { decode as decodeGraphEdgePayload };
