/**
 * ADR-060: Attestation Log
 *
 * Append-only audit log for every MutationProof and MutationDenial.
 *
 * ADR-0170 Phase B Wave 1a fix (2026-05-11): ported from SQLite-shape
 * (better-sqlite3 / sql.js) to PostgresBackend (pglite-embedded by default;
 * postgres-server when AGENTDB_POSTGRES_URL is set). The original audit
 * (ADR-0170) missed this file because it lives under `src/security/` rather
 * than `src/controllers/`, but it is constructed at AgentDB.initialize()
 * via factory.ts:createGuardedBackend(), so its SQLite DDL crashed the
 * pglite cluster on first boot (AUTOINCREMENT + strftime not valid in
 * postgres dialect). Phase B Wave 1a fix lands the port atomically.
 *
 * The caller (factory.ts) supplies a PostgresBackend; this class issues
 * its own idempotent `bootstrapSchema()` (mirrors the Wave 1a controller
 * pattern in ReflexionMemory/SkillLibrary/etc.). The `ready` promise is
 * exposed for read-side callers (`query`, `getStats`, `getDenialPatterns`,
 * `prune`) to await before issuing SQL.
 *
 * Mutation hot path (`record`, `recordDenial`) keeps the synchronous
 * `void`-returning contract — GuardedVectorBackend.requireProof() invokes
 * them inside sync wrapper methods (insert/search/remove/...) and cannot
 * be made async without cascading changes through the VectorBackend
 * surface. The implementation runs the INSERT as fire-and-forget
 * (awaits `ready` then issues query; rejections logged to stderr only).
 * The audit log is best-effort by design — a write failure must not abort
 * the mutation it is attesting.
 */

import type { MutationProof, MutationDenial } from './MutationGuard.js';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';

// ---------------------------------------------------------------------------
// Schema (postgres dialect)
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mutation_attestations (
  id BIGSERIAL PRIMARY KEY,
  ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  operation TEXT NOT NULL,
  proof_hash TEXT,
  agent_id TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL CHECK (status IN ('proved','denied')),
  denial_reason TEXT,
  denial_code TEXT,
  wasm_proof_id BIGINT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_attestations_ts ON mutation_attestations(ts);
CREATE INDEX IF NOT EXISTS idx_attestations_agent ON mutation_attestations(agent_id);
CREATE INDEX IF NOT EXISTS idx_attestations_status ON mutation_attestations(status);
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttestationQueryOptions {
  agentId?: string;
  namespace?: string;
  status?: 'proved' | 'denied';
  since?: number;
  limit?: number;
}

export interface DenialPattern {
  code: string;
  count: number;
  lastSeen: number;
}

export interface AttestationStats {
  total: number;
  proved: number;
  denied: number;
  uniqueAgents: number;
  oldestTs: number;
}

// ---------------------------------------------------------------------------
// AttestationLog
// ---------------------------------------------------------------------------

export class AttestationLog {
  private readonly backend: PostgresBackend;
  /**
   * Awaited by every read-side method (`query`, `getStats`, `getDenialPatterns`,
   * `prune`) and the fire-and-forget write path before issuing SQL. Resolves
   * when `backend.initialize()` has returned and the `mutation_attestations`
   * table + indexes exist.
   */
  readonly ready: Promise<void>;

  constructor(backend: PostgresBackend) {
    this.backend = backend;
    this.ready = this.bootstrapSchema();
  }

  private async bootstrapSchema(): Promise<void> {
    try {
      await this.backend.initialize();
      await this.backend.exec(CREATE_TABLE_SQL);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`AttestationLog schema creation failed: ${msg}`);
    }
  }

  /**
   * Record a successful mutation proof. Fire-and-forget — runs async,
   * logs to stderr on failure, never throws into the mutation hot path.
   * Synchronous `void` return preserved per GuardedVectorBackend's
   * sync mutation contract.
   */
  record(proof: MutationProof): void {
    const ts = Math.floor(proof.timestamp / 1000);
    const params = [
      ts,
      proof.operation,
      proof.structuralHash,
      proof.attestation.agentId,
      proof.attestation.namespace,
      proof.wasmProofId ?? null,
      JSON.stringify({ invariantChecks: proof.invariantChecks }),
    ];
    this.ready
      .then(() =>
        this.backend.query(
          `INSERT INTO mutation_attestations
            (ts, operation, proof_hash, agent_id, namespace, status, wasm_proof_id, metadata)
           VALUES ($1, $2, $3, $4, $5, 'proved', $6, $7)`,
          params,
        ),
      )
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[AttestationLog] record() failed (best-effort, non-fatal): ${msg}`);
      });
  }

  /**
   * Record a denied mutation. Same fire-and-forget contract as `record`.
   */
  recordDenial(denial: MutationDenial, agentId: string, namespace: string): void {
    const ts = Math.floor(denial.timestamp / 1000);
    const params = [
      ts,
      denial.operation,
      agentId,
      namespace,
      denial.reason,
      denial.code,
      denial.field ? JSON.stringify({ field: denial.field }) : null,
    ];
    this.ready
      .then(() =>
        this.backend.query(
          `INSERT INTO mutation_attestations
            (ts, operation, agent_id, namespace, status, denial_reason, denial_code, metadata)
           VALUES ($1, $2, $3, $4, 'denied', $5, $6, $7)`,
          params,
        ),
      )
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[AttestationLog] recordDenial() failed (best-effort, non-fatal): ${msg}`);
      });
  }

  /**
   * Query attestation records with optional filters.
   * All filters use parameterized queries to prevent injection.
   */
  async query(opts: AttestationQueryOptions = {}): Promise<any[]> {
    await this.ready;

    const conditions: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (opts.agentId !== undefined) {
      conditions.push(`agent_id = $${i++}`);
      params.push(opts.agentId);
    }

    if (opts.namespace !== undefined) {
      conditions.push(`namespace = $${i++}`);
      params.push(opts.namespace);
    }

    if (opts.status !== undefined) {
      conditions.push(`status = $${i++}`);
      params.push(opts.status);
    }

    if (opts.since !== undefined) {
      conditions.push(`ts >= $${i++}`);
      params.push(Math.floor(opts.since / 1000));
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    let limit = '';
    if (opts.limit !== undefined && opts.limit > 0) {
      limit = `LIMIT $${i++}`;
      params.push(opts.limit);
    }

    const sql = `SELECT * FROM mutation_attestations ${where} ORDER BY ts DESC ${limit}`;
    const res = await this.backend.query(sql, params);
    return res.rows as any[];
  }

  /**
   * Aggregate denial patterns grouped by denial_code.
   */
  async getDenialPatterns(since?: number): Promise<DenialPattern[]> {
    await this.ready;

    let sql: string;
    const params: any[] = [];

    if (since !== undefined) {
      sql = `
        SELECT
          denial_code AS code,
          COUNT(*) AS count,
          MAX(ts) AS "lastSeen"
        FROM mutation_attestations
        WHERE status = 'denied' AND ts >= $1
        GROUP BY denial_code
        ORDER BY count DESC
      `;
      params.push(Math.floor(since / 1000));
    } else {
      sql = `
        SELECT
          denial_code AS code,
          COUNT(*) AS count,
          MAX(ts) AS "lastSeen"
        FROM mutation_attestations
        WHERE status = 'denied'
        GROUP BY denial_code
        ORDER BY count DESC
      `;
    }

    const res = await this.backend.query(sql, params);
    // pglite / pg return COUNT as either number or string; normalize.
    return (res.rows as any[]).map((row) => ({
      code: row.code,
      count: Number(row.count ?? 0),
      lastSeen: Number(row.lastSeen ?? 0),
    }));
  }

  /**
   * Delete attestation records older than the given age in milliseconds.
   * Returns the number of deleted rows.
   */
  async prune(olderThanMs: number): Promise<number> {
    await this.ready;

    const cutoffTs = Math.floor((Date.now() - olderThanMs) / 1000);
    // pglite/pg both return the row count via rowCount on the result; the
    // PostgresBackend wrapper exposes the underlying client through .query.
    // The rows returned by a DELETE with no RETURNING clause is empty, so
    // we rely on the rowCount field on the raw client result. Wrap in a
    // RETURNING + count approach to remain client-agnostic.
    const res = await this.backend.query(
      `WITH deleted AS (
         DELETE FROM mutation_attestations WHERE ts < $1 RETURNING id
       )
       SELECT COUNT(*)::BIGINT AS count FROM deleted`,
      [cutoffTs],
    );
    const row = (res.rows as any[])[0];
    return Number(row?.count ?? 0);
  }

  /**
   * Summary statistics for the attestation log.
   */
  async getStats(): Promise<AttestationStats> {
    await this.ready;

    const res = await this.backend.query(`
      SELECT
        COUNT(*)::BIGINT AS total,
        SUM(CASE WHEN status = 'proved' THEN 1 ELSE 0 END)::BIGINT AS proved,
        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END)::BIGINT AS denied,
        COUNT(DISTINCT agent_id)::BIGINT AS "uniqueAgents",
        MIN(ts) AS "oldestTs"
      FROM mutation_attestations
    `);
    const row = (res.rows as any[])[0] ?? {};

    return {
      total: Number(row.total ?? 0),
      proved: Number(row.proved ?? 0),
      denied: Number(row.denied ?? 0),
      uniqueAgents: Number(row.uniqueAgents ?? 0),
      oldestTs: Number(row.oldestTs ?? 0),
    };
  }
}
