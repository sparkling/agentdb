/**
 * ADR-0199 — QUICClient → QUICServer controller-stack roundtrip
 *
 * Complements `quic-transport.test.ts` (which exercises Transport↔Transport
 * directly). This test exercises the full controller stack:
 *
 *   QUICClient.sync()
 *     → QUICClient.sendRequest()           [ADR-0199 data-path wiring]
 *       → transport.send()                 [WebTransport / HTTP/2]
 *         → server.onFrame handler         [registered by QUICServer.start]
 *           → QUICServer.processSyncRequest()
 *             → auth + rate-limit + syncEpisodes
 *           → frame.reply(SyncResponse)
 *
 * Forces AGENTDB_QUIC_FORCE_FALLBACK=1 so HTTP/2 is selected — deterministic
 * on hosts without `@fails-components/webtransport` installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUICServer } from '../../src/controllers/QUICServer.js';
import { QUICClient } from '../../src/controllers/QUICClient.js';

function mintSelfSignedCert(): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adr0199-stack-cert-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} ` +
    `-days 1 -nodes -subj "/CN=localhost" ` +
    `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null`,
    { stdio: 'pipe' },
  );
  return {
    cert: readFileSync(certPath, 'utf8'),
    key: readFileSync(keyPath, 'utf8'),
  };
}

/** Minimal Database mock — QUICServer.syncEpisodes/Skills/Edges call
 *  `this.db.prepare(query).all(...)`. We return an empty result so the
 *  test focuses on the wire roundtrip, not the data layer. */
function mockDatabase() {
  const prepareCallCount = { value: 0 };
  const db = {
    prepare(_query: string) {
      prepareCallCount.value += 1;
      return {
        all: (..._params: unknown[]) => [],
      };
    },
    _prepareCallCount: prepareCallCount,
  };
  return db;
}

describe('ADR-0199 controller-stack roundtrip (QUICClient → QUICServer)', () => {
  let server: QUICServer;
  let client: QUICClient;
  let db: ReturnType<typeof mockDatabase>;

  beforeAll(async () => {
    process.env.AGENTDB_QUIC_FORCE_FALLBACK = '1';
    const { cert, key } = mintSelfSignedCert();

    db = mockDatabase();
    server = new QUICServer(db, {
      host: '127.0.0.1',
      port: 0,
      authToken: 'test-token',
      tlsConfig: { cert, key },
    });
    await server.start();

    const bound = server.getBoundAddress();
    if (!bound) throw new Error('server.getBoundAddress() returned null after start');

    client = new QUICClient({
      serverHost: bound.host,
      serverPort: bound.port,
      authToken: 'test-token',
      tlsConfig: { cert, key, rejectUnauthorized: false },
      maxRetries: 0,
    });
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    try { await client?.disconnect(); } catch { /* idempotent close */ }
    try { await server?.stop(); } catch { /* idempotent close */ }
    delete process.env.AGENTDB_QUIC_FORCE_FALLBACK;
  });

  it('client.sync(episodes) reaches server.processSyncRequest and returns shaped response', async () => {
    const result = await client.sync({ type: 'episodes', since: 0 });
    // The wire roundtrip itself is the assertion: a structured SyncResult
    // came back, not a transport timeout / mock undefined.
    expect(result).toBeDefined();
    expect(result.itemsReceived).toBe(0);
    expect(typeof result.durationMs).toBe('number');
    // syncEpisodes ran db.prepare(query) — proves the request reached the
    // server's data layer (not just the auth/rate-limit gate).
    expect(db._prepareCallCount.value).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it('client.sync(skills) reaches server.processSyncRequest', async () => {
    const before = db._prepareCallCount.value;
    const result = await client.sync({ type: 'skills', since: 0 });
    expect(result).toBeDefined();
    expect(result.itemsReceived).toBe(0);
    expect(db._prepareCallCount.value).toBeGreaterThan(before);
  }, 15_000);

  it('client carries authToken in envelope (server-side auth pass-through)', async () => {
    // Already implicit in the success of the above — the server's
    // `authenticate(clientId, authToken)` would reject and return a
    // structured `{success: false, error: 'Authentication failed'}` if
    // authToken were not carried through transport.send(). This test
    // asserts the negative more loudly by re-issuing with the same token
    // and confirming it still succeeds.
    const result = await client.sync({ type: 'episodes' });
    expect(result.success).toBe(true);
  }, 15_000);
});
