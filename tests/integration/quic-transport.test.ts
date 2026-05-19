/**
 * ADR-0199 — QUIC transport binding integration test
 *
 * Exercises the Transport abstraction in QUICConnection.ts:
 *   1. Mint a self-signed cert via node:crypto (no system CA).
 *   2. Start a server transport on an ephemeral port.
 *   3. Connect a client transport.
 *   4. Push one EpisodeSync envelope from client → server.
 *   5. Assert the server received it and the client got the reply.
 *
 * Runs against whichever transport the factory selects. By default we
 * force AGENTDB_QUIC_FORCE_FALLBACK=1 so the test is deterministic on hosts
 * without @fails-components/webtransport installed. A second pass (when
 * the binding is available) covers the WebTransport path separately.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, createPrivateKey, X509Certificate } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createServerTransport,
  createClientTransport,
  type ServerTransport,
  type ClientTransport,
  type TransportFrame,
} from '../../src/controllers/QUICConnection.js';

// ----------------------------------------------------------------------------
// Self-signed cert mint via openssl (always available on dev/CI hosts).
// node:crypto's X509Certificate does not create certs; openssl does.
// ----------------------------------------------------------------------------

function mintSelfSignedCert(): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adr0199-cert-'));
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

// ----------------------------------------------------------------------------
// Fake EpisodeSync envelope — same shape as types/quic.ts, condensed.
// ----------------------------------------------------------------------------

function fakeEpisodeSync() {
  return {
    type: 'episode_sync',
    data: {
      operation: 'CREATE',
      episodeId: 42,
      episodeData: {
        agentId: 'test-agent',
        sessionId: 'test-session',
        task: 'integration-test',
        input: 'hello',
        output: 'world',
        reward: 1.0,
        success: true,
        latencyMs: 12,
        timestamp: Date.now(),
        vectorClock: { 'install-A': 1 },
      },
      causalClock: { 'install-A': 1 },
      signature: new Uint8Array([1, 2, 3]),
    },
  };
}

describe('ADR-0199 transport (HTTP/2 fallback)', () => {
  let server: ServerTransport;
  let client: ClientTransport;
  let receivedPayload: any = null;
  let port: number = 0;

  // Force HTTP/2 fallback so the test is deterministic regardless of whether
  // @fails-components/webtransport is installed.
  beforeAll(async () => {
    process.env.AGENTDB_QUIC_FORCE_FALLBACK = '1';

    const { cert, key } = mintSelfSignedCert();

    server = await createServerTransport();
    expect(server.kind()).toBe('http2');

    server.onFrame(async (frame: TransportFrame) => {
      receivedPayload = frame.payload;
      await frame.reply({ success: true, echoedType: frame.payload?.type });
    });

    const bound = await server.listen('127.0.0.1', 0, { cert, key });
    port = bound.port;
    expect(port).toBeGreaterThan(0);

    client = await createClientTransport();
    expect(client.kind()).toBe('http2');

    await client.connect('127.0.0.1', port, { ca: cert, rejectUnauthorized: true });
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    delete process.env.AGENTDB_QUIC_FORCE_FALLBACK;
  });

  it('round-trips one EpisodeSync envelope', async () => {
    const envelope = fakeEpisodeSync();
    // Uint8Array doesn't survive JSON serialization as-is; convert to array first.
    const wireEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        signature: Array.from(envelope.data.signature),
      },
    };

    const reply = await client.send(wireEnvelope);

    expect(reply).toEqual({ success: true, echoedType: 'episode_sync' });
    expect(receivedPayload).not.toBeNull();
    expect(receivedPayload.type).toBe('episode_sync');
    expect(receivedPayload.data.operation).toBe('CREATE');
    expect(receivedPayload.data.episodeId).toBe(42);
    expect(receivedPayload.data.episodeData.task).toBe('integration-test');
  });

  it('reports the transport kind for both ends', () => {
    expect(server.kind()).toBe('http2');
    expect(client.kind()).toBe('http2');
  });
});
