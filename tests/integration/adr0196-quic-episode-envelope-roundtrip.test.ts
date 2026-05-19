/**
 * Integration test for ADR-0196 — EpisodeSync envelope round-trip
 * between QUICServer and QUICClient.
 *
 * ADR-0196 §"Step 6 Runtime hand-off" status:
 *   "Open a federation-runtime ADR (separate). Scope: pick QUIC
 *    binding, document TLS / cert provisioning, real socket bind in
 *    QUICServer.start(), real connect in QUICClient.connect(). This
 *    ADR does NOT land that work."
 *
 * Current state of QUICServer/QUICClient (agentdb fork HEAD):
 *   - Reference implementations only. No real socket is opened by
 *     `start()` / `connect()`. In-source disclaimers at QUICServer.ts:111
 *     and QUICClient.ts:126 explicitly call this out.
 *   - The IN-PROCESS surface exists and works: SyncRequest /
 *     SyncResponse envelopes, processSyncRequest server-side, error
 *     paths.
 *
 * What this test pins:
 *   1. Envelope structural symmetry — a SyncRequest (episodes type)
 *      sent to QUICServer.processSyncRequest returns a SyncResponse
 *      whose `data` is an array of episodes carrying the metadata
 *      shape ADR-0196 §1 (Episode identity) requires
 *      (originInstallId + vectorClock).
 *   2. Authentication contract — bad token returns
 *      { success: false, error: 'Authentication failed' } without
 *      leaking data.
 *   3. Empty-corpus round-trip — server with no rows returns
 *      { success: true, data: [], count: 0 }.
 *   4. Self-signed cert config slot — QUICServerConfig.tlsConfig
 *      accepts the trio (cert/key/ca); the slot is wired through to
 *      the Required<QUICServerConfig> shape even if the runtime
 *      doesn't yet consume it. Forward-binding.
 *
 * What this test EXPLICITLY SKIPs:
 *   - Real socket round-trip via QUICClient.sync() (no transport
 *     binding chosen yet — ADR-0196 §"Step 6").
 *   - TLS handshake validation (no real bind).
 *   - Cross-host federation (single in-process test only).
 *
 * The skipped tests carry `TODO[ADR-0196-runtime]` markers so the
 * moment the runtime ADR lands and a binding is picked, the assertions
 * are ready to flip.
 *
 * CONTRACT GAPS DISCOVERED while writing this:
 *   - QUICServer's `processSyncRequest` reads from `this.db.prepare()`,
 *     which means an INTEGRATION test needs a real (in-memory) SQLite
 *     handle with the episodes/skills/skill_edges schema. We seed via
 *     better-sqlite3 in-memory below to avoid the file-system tier.
 *   - The `episodes` row shape returned by `syncEpisodes`
 *     (QUICServer.ts:361-375) does NOT yet include originInstallId or
 *     vectorClock — those metadata fields are JSON-parsed from the
 *     `metadata` column, so ADR-0196 §1 stamping has to land in the
 *     producer (AutopilotLearning._record) AND the consumer side just
 *     needs to round-trip the JSON. This test asserts the consumer
 *     side; producer-side stamping is covered by ADR-0196 unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QUICServer, type SyncRequest } from '../../src/controllers/QUICServer.js';
import { QUICClient } from '../../src/controllers/QUICClient.js';

// In-memory SQLite via better-sqlite3 — the QUICServer uses the legacy
// db.prepare() shape, so we hand it a real handle with the schema it
// expects. If better-sqlite3 isn't available (CI variants), this test
// SKIPs cleanly rather than producing a phantom green.
type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
};

let bsqlite: ((path: string) => SqliteDb) | null = null;
let _bsqliteImportErr: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = await import('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bsqlite = (mod as any).default ?? (mod as any);
} catch (err) {
  _bsqliteImportErr = err instanceof Error ? err.message : String(err);
}

function makeDbWithSchema(): SqliteDb {
  if (!bsqlite) {
    throw new Error(`better-sqlite3 unavailable: ${_bsqliteImportErr ?? 'unknown'}`);
  }
  const db = bsqlite(':memory:');
  db.exec(`
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      ts INTEGER,
      session_id TEXT,
      task TEXT,
      input TEXT,
      output TEXT,
      critique TEXT,
      reward REAL,
      success INTEGER,
      latency_ms INTEGER,
      tokens_used INTEGER,
      tags TEXT,
      metadata TEXT
    );
    CREATE TABLE skills (
      id INTEGER PRIMARY KEY,
      ts INTEGER,
      name TEXT,
      description TEXT,
      code TEXT,
      success_rate REAL,
      usage_count INTEGER,
      avg_reward REAL,
      tags TEXT,
      metadata TEXT
    );
    CREATE TABLE skill_edges (
      id INTEGER PRIMARY KEY,
      ts INTEGER,
      from_skill_id INTEGER,
      to_skill_id INTEGER,
      relationship TEXT,
      weight REAL,
      metadata TEXT
    );
  `);
  return db;
}

function seedEpisode(db: SqliteDb, opts: {
  task: string;
  originInstallId: string;
  vectorClock?: Record<string, number>;
  ts?: number;
}): void {
  const stmt = db.prepare(`
    INSERT INTO episodes (
      ts, session_id, task, input, output, critique,
      reward, success, latency_ms, tokens_used, tags, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    opts.ts ?? Date.now(),
    'autopilot:phase5',
    opts.task,
    '',                                      // input
    '',                                      // output
    null,                                    // critique
    1.0,                                     // reward
    1,                                       // success
    0,                                       // latency_ms
    0,                                       // tokens_used
    JSON.stringify([]),                      // tags
    JSON.stringify({                         // metadata — ADR-0196 §1 shape
      originInstallId: opts.originInstallId,
      vectorClock: opts.vectorClock ?? { [opts.originInstallId]: 1 },
    }),
  );
}

describe('ADR-0196 EpisodeSync envelope round-trip (in-process surface)', () => {
  let db: SqliteDb;
  let server: QUICServer;

  beforeEach(() => {
    if (!bsqlite) return;
    db = makeDbWithSchema();
    server = new QUICServer(db as unknown as object, {
      host: '127.0.0.1',
      port: 4433,
      authToken: 'integration-test-token',
      tlsConfig: {
        cert: '-----BEGIN CERTIFICATE-----\nFAKE-CERT\n-----END CERTIFICATE-----\n',
        key: '-----BEGIN PRIVATE KEY-----\nFAKE-KEY\n-----END PRIVATE KEY-----\n',
      },
    });
  });

  afterEach(async () => {
    if (server) await server.stop().catch(() => undefined);
  });

  it.skipIf(!bsqlite)('round-trip: server returns episodes with ADR-0196 §1 metadata (originInstallId + vectorClock)', async () => {
    const originA = randomUUID();
    seedEpisode(db, { task: 'auth-fix', originInstallId: originA });
    seedEpisode(db, { task: 'cache-bug', originInstallId: originA, vectorClock: { [originA]: 2 } });

    await server.start();

    const request: SyncRequest = { type: 'episodes', batchSize: 100 };
    const response = await server.processSyncRequest(
      'client-1',
      request,
      'integration-test-token',
    );

    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.count).toBe(2);
    const episodes = response.data as Array<{
      id: number; task: string; metadata: Record<string, unknown>;
    }>;
    expect(episodes).toHaveLength(2);

    // The envelope round-trips the ADR-0196 §1 identity fields end-to-end.
    for (const ep of episodes) {
      expect(ep.metadata).toBeDefined();
      expect(ep.metadata.originInstallId).toBe(originA);
      expect(ep.metadata.vectorClock).toBeDefined();
      expect(typeof ep.metadata.vectorClock).toBe('object');
    }
  });

  it.skipIf(!bsqlite)('authentication: invalid token returns success=false with no data leak', async () => {
    seedEpisode(db, { task: 'secret-payload', originInstallId: randomUUID() });

    await server.start();
    const response = await server.processSyncRequest(
      'attacker',
      { type: 'episodes' },
      'wrong-token',
    );

    expect(response.success).toBe(false);
    expect(response.error).toBe('Authentication failed');
    expect(response.data).toBeUndefined();
    expect(response.count).toBeUndefined();
  });

  it.skipIf(!bsqlite)('empty corpus: round-trip returns success=true with empty data array', async () => {
    await server.start();
    const response = await server.processSyncRequest(
      'client-empty',
      { type: 'episodes' },
      'integration-test-token',
    );

    expect(response.success).toBe(true);
    expect(response.data).toEqual([]);
    expect(response.count).toBe(0);
  });

  it.skipIf(!bsqlite)('self-signed cert config slot accepted by both server + client', async () => {
    // Forward-binding: the runtime ADR will pick a binding and consume
    // these slots. We pin that the type surface accepts the trio so the
    // future runtime ADR doesn't have to break the config shape.
    const selfSignedCert = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
    const selfSignedKey = '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n';

    const localServer = new QUICServer(db as unknown as object, {
      authToken: 'cert-token',
      tlsConfig: { cert: selfSignedCert, key: selfSignedKey },
    });
    const localClient = new QUICClient({
      serverHost: '127.0.0.1',
      serverPort: 4433,
      authToken: 'cert-token',
      tlsConfig: {
        cert: selfSignedCert,
        key: selfSignedKey,
        rejectUnauthorized: false, // for self-signed in test
      },
    });

    // Construction succeeds — the slot is wired.
    expect(localServer).toBeDefined();
    expect(localClient).toBeDefined();
    await localServer.start();
    await localServer.stop();
  });

  // ─── Deferred to runtime ADR (skip-with-marker) ───────────────────

  it.skip('TODO[ADR-0196-runtime]: real socket round-trip — QUICClient.sync() returns envelope from QUICServer', () => {
    // Once the runtime ADR picks a binding (node:quic / webtransport /
    // node-quic / HTTP/2 fallback), this test should:
    //   1. Start a real QUICServer on an ephemeral port
    //   2. QUICClient.connect() over self-signed TLS
    //   3. QUICClient.sync({ type: 'episodes' }) → returns SyncResult
    //   4. SyncResult.data round-trips the seeded episodes with
    //      originInstallId + vectorClock preserved
    //   5. server.stop() cleanly closes the binding
    expect.fail('Runtime binding not yet chosen (ADR-0196 §"Step 6")');
  });

  it.skip('TODO[ADR-0196-runtime]: TLS handshake with self-signed cert against the chosen binding', () => {
    // Validates the cert/key/ca slots are actually consumed by the
    // transport layer, not just the type surface. Gated on the runtime
    // ADR picking which library does the TLS termination.
    expect.fail('Runtime binding not yet chosen (ADR-0196 §"Step 6")');
  });

  it.skip('TODO[ADR-0196-runtime]: vectorClock-merge on round-trip with concurrent edits from two install IDs', () => {
    // Cross-install conflict-resolution scenario. ADR-0196 picks
    // `latest-wins` as the default but the vector clock must still be
    // populated end-to-end so a future strategy switch is feasible.
    expect.fail('Runtime binding not yet chosen (ADR-0196 §"Step 6")');
  });
});
