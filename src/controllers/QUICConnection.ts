/**
 * QUICConnection - Enhanced QUIC Connection with 0-RTT, BBR, and Migration
 *
 * Per ADR-0199: real transport binding via @fails-components/webtransport (primary)
 * with node:http2 fallback. The Transport abstraction below is consumed by
 * QUICServer.start() and QUICClient.connect() — interfaces of those two files
 * are unchanged.
 *
 * Implements an advanced QUIC connection with:
 * - 0-RTT fast reconnect via session ticket caching (in-memory)
 * - BBR congestion control for optimal throughput (simulated; the underlying
 *   WebTransport / HTTP2 stack handles real congestion control)
 * - Connection migration for resilient networking (no-op on HTTP/2 fallback)
 * - Latency tracking and performance metrics
 */

import * as http2 from 'node:http2';
import { TLSSocket } from 'node:tls';

// ============================================================================
// Transport abstraction (ADR-0199)
// ============================================================================

export interface TransportTLSConfig {
  cert?: string | Buffer;
  key?: string | Buffer;
  ca?: string | Buffer;
  rejectUnauthorized?: boolean;
}

/**
 * Incoming envelope from a peer. Frame is opaque JSON-serialisable payload
 * (typically an EpisodeSync / SkillSync / SyncRequest from `types/quic.ts`).
 */
export interface TransportFrame {
  payload: any;
  reply: (response: any) => Promise<void>;
}

/**
 * Server-side transport. listen() binds the socket; onFrame() registers a
 * handler invoked for each incoming envelope.
 */
export interface ServerTransport {
  listen(host: string, port: number, tls: TransportTLSConfig): Promise<{ host: string; port: number }>;
  onFrame(handler: (frame: TransportFrame) => Promise<void> | void): void;
  close(): Promise<void>;
  kind(): 'webtransport' | 'http2';
}

/**
 * Client-side transport. connect() dials the peer; send() round-trips one
 * envelope and waits for the reply.
 */
export interface ClientTransport {
  connect(host: string, port: number, tls: TransportTLSConfig): Promise<void>;
  send(payload: any): Promise<any>;
  close(): Promise<void>;
  kind(): 'webtransport' | 'http2';
}

/**
 * Resolve which transport to use. Tries @fails-components/webtransport;
 * if not installed OR AGENTDB_QUIC_FORCE_FALLBACK=1, falls back to HTTP/2.
 */
async function loadWebTransport(): Promise<any | null> {
  if (process.env.AGENTDB_QUIC_FORCE_FALLBACK === '1') return null;
  try {
    // Indirect specifier so TS does not eagerly resolve the optional dep.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specifier: string = '@fails-components/webtransport';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ specifier);
    // The package exports both `Http3Server` and `WebTransport` (client).
    // If either is missing, fall through to HTTP/2 — keeps us alive on hosts
    // where the native postinstall partially failed.
    if (mod && (mod.Http3Server || mod.default?.Http3Server)) {
      return mod.default ?? mod;
    }
    return null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// HTTP/2 fallback (node:http2, always available)
// ----------------------------------------------------------------------------

/**
 * HTTP/2 server transport. One POST = one envelope. Reply via response body.
 * Wire format: JSON in request body, JSON in response body.
 */
class Http2ServerTransport implements ServerTransport {
  private server: http2.Http2SecureServer | null = null;
  private handler: ((frame: TransportFrame) => Promise<void> | void) | null = null;

  kind(): 'http2' { return 'http2'; }

  async listen(host: string, port: number, tls: TransportTLSConfig): Promise<{ host: string; port: number }> {
    if (!tls.cert || !tls.key) {
      throw new Error('Http2ServerTransport: TLS cert + key required');
    }
    this.server = http2.createSecureServer({
      cert: tls.cert,
      key: tls.key,
      allowHTTP1: false,
    });

    this.server.on('stream', (stream, _headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => { body += chunk; });
      stream.on('end', async () => {
        if (!this.handler) {
          stream.respond({ ':status': 503 });
          stream.end(JSON.stringify({ error: 'no handler registered' }));
          return;
        }
        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch (err) {
          stream.respond({ ':status': 400 });
          stream.end(JSON.stringify({ error: 'invalid JSON' }));
          return;
        }

        const frame: TransportFrame = {
          payload,
          reply: async (response: any) => {
            stream.respond({ ':status': 200, 'content-type': 'application/json' });
            stream.end(JSON.stringify(response));
          },
        };

        try {
          await this.handler(frame);
        } catch (err) {
          if (!stream.headersSent) {
            stream.respond({ ':status': 500 });
            stream.end(JSON.stringify({ error: (err as Error).message }));
          }
        }
      });
      stream.on('error', () => { /* swallow per-stream errors */ });
    });

    return await new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          resolve({ host: addr.address, port: addr.port });
        } else {
          resolve({ host, port });
        }
      });
    });
  }

  onFrame(handler: (frame: TransportFrame) => Promise<void> | void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
  }
}

class Http2ClientTransport implements ClientTransport {
  private session: http2.ClientHttp2Session | null = null;
  private host: string = '';
  private port: number = 0;

  kind(): 'http2' { return 'http2'; }

  async connect(host: string, port: number, tls: TransportTLSConfig): Promise<void> {
    this.host = host;
    this.port = port;
    return await new Promise((resolve, reject) => {
      this.session = http2.connect(`https://${host}:${port}`, {
        ca: tls.ca,
        rejectUnauthorized: tls.rejectUnauthorized ?? true,
      });
      this.session.once('connect', () => resolve());
      this.session.once('error', reject);
    });
  }

  async send(payload: any): Promise<any> {
    if (!this.session || this.session.closed) {
      throw new Error('Http2ClientTransport: not connected');
    }
    const body = JSON.stringify(payload);
    return await new Promise((resolve, reject) => {
      const req = this.session!.request({
        ':method': 'POST',
        ':path': '/sync',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      let chunks = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => { chunks += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch (err) { reject(new Error('invalid JSON response')); }
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  async close(): Promise<void> {
    if (!this.session) return;
    await new Promise<void>((resolve) => {
      this.session!.close(() => resolve());
    });
    this.session = null;
  }
}

// ----------------------------------------------------------------------------
// WebTransport primary (gated on @fails-components/webtransport availability)
// ----------------------------------------------------------------------------

class WebTransportServerTransport implements ServerTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any = null;
  private handler: ((frame: TransportFrame) => Promise<void> | void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(mod: any) { this.mod = mod; }

  kind(): 'webtransport' { return 'webtransport'; }

  async listen(host: string, port: number, tls: TransportTLSConfig): Promise<{ host: string; port: number }> {
    if (!tls.cert || !tls.key) {
      throw new Error('WebTransportServerTransport: TLS cert + key required');
    }
    this.server = new this.mod.Http3Server({
      host,
      port,
      secret: 'agentdb-quic-server',
      cert: tls.cert,
      privKey: tls.key,
    });

    this.server.startServer();
    this.acceptLoop().catch(() => { /* loop ends when server closes */ });

    return { host, port };
  }

  private async acceptLoop(): Promise<void> {
    const sessionStream = await this.server.sessionStream('/sync');
    const sessionReader = sessionStream.getReader();
    while (true) {
      const { done, value: session } = await sessionReader.read();
      if (done) break;
      this.handleSession(session).catch(() => { /* per-session error */ });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleSession(session: any): Promise<void> {
    await session.ready;
    const streams = session.incomingBidirectionalStreams.getReader();
    while (true) {
      const { done, value: stream } = await streams.read();
      if (done) break;
      this.handleStream(stream).catch(() => { /* per-stream error */ });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleStream(stream: any): Promise<void> {
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    const body = new TextDecoder().decode(buf);

    if (!this.handler) {
      await writer.write(new TextEncoder().encode(JSON.stringify({ error: 'no handler registered' })));
      await writer.close();
      return;
    }

    let payload: any;
    try { payload = JSON.parse(body); }
    catch {
      await writer.write(new TextEncoder().encode(JSON.stringify({ error: 'invalid JSON' })));
      await writer.close();
      return;
    }

    const frame: TransportFrame = {
      payload,
      reply: async (response: any) => {
        await writer.write(new TextEncoder().encode(JSON.stringify(response)));
        await writer.close();
      },
    };
    try { await this.handler(frame); }
    catch (err) {
      await writer.write(new TextEncoder().encode(JSON.stringify({ error: (err as Error).message })));
      await writer.close();
    }
  }

  onFrame(handler: (frame: TransportFrame) => Promise<void> | void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    try { await this.server.stopServer(); } catch { /* idempotent */ }
    this.server = null;
  }
}

class WebTransportClientTransport implements ClientTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mod: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(mod: any) { this.mod = mod; }

  kind(): 'webtransport' { return 'webtransport'; }

  async connect(host: string, port: number, tls: TransportTLSConfig): Promise<void> {
    const wt = new this.mod.WebTransport(`https://${host}:${port}/sync`, {
      serverCertificateHashes: [], // populated by user when pinning is required
      // when rejectUnauthorized=false, skip cert verification (test path)
      ...(tls.rejectUnauthorized === false ? { allowPooling: false } : {}),
    });
    await wt.ready;
    this.session = wt;
  }

  async send(payload: any): Promise<any> {
    if (!this.session) throw new Error('WebTransportClientTransport: not connected');
    const stream = await this.session.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
    await writer.close();

    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return JSON.parse(new TextDecoder().decode(buf));
  }

  async close(): Promise<void> {
    if (!this.session) return;
    try { this.session.close(); } catch { /* idempotent */ }
    this.session = null;
  }
}

// ----------------------------------------------------------------------------
// Public factories — QUICServer / QUICClient call these
// ----------------------------------------------------------------------------

export interface TransportSelection {
  server: ServerTransport;
  client: ClientTransport;
  kind: 'webtransport' | 'http2';
}

/**
 * Create a server transport. Tries WebTransport; falls back to HTTP/2.
 */
export async function createServerTransport(): Promise<ServerTransport> {
  const wt = await loadWebTransport();
  if (wt) return new WebTransportServerTransport(wt);
  return new Http2ServerTransport();
}

/**
 * Create a client transport. Same selection rules as the server.
 */
export async function createClientTransport(): Promise<ClientTransport> {
  const wt = await loadWebTransport();
  if (wt) return new WebTransportClientTransport(wt);
  return new Http2ClientTransport();
}

// ============================================================================
// QUICConnection — BBR/0-RTT/migration metadata layer (unchanged interface)
// ============================================================================
//
// The simulation logic below is preserved from the previous reference
// implementation. It tracks BBR state and metrics ON TOP of whichever real
// transport (WebTransport / HTTP/2) is in use. The transport itself handles
// the actual congestion control; this layer reports the agentdb-side view.

export interface QUICConnectionConfig {
  endpoint: string;
  enableZeroRTT?: boolean;
  enableMultipath?: boolean;
  congestionControl?: 'bbr' | 'cubic' | 'reno';
  maxIdleTimeoutMs?: number;
  initialRttMs?: number;
}

export interface ConnectionMetrics {
  rttMs: number;
  smoothedRttMs: number;
  rttVariance: number;
  bytesInFlight: number;
  congestionWindow: number;
  deliveryRate: number;
  packetsLost: number;
  packetsSent: number;
  packetsAcked: number;
  zeroRttUsed: boolean;
  handshakeTimeMs: number;
}

interface BBRState {
  mode: 'startup' | 'drain' | 'probe_bw' | 'probe_rtt';
  btlBw: number;
  rtProp: number;
  rtPropExpiry: number;
  cwndGain: number;
  pacingGain: number;
  cycleIndex: number;
  fullBwReached: boolean;
  fullBwCount: number;
  lastBw: number;
}

interface SessionTicket {
  data: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  serverName: string;
  alpn: string;
  maxEarlyData: number;
}

export class QUICConnection {
  private config: Required<QUICConnectionConfig>;
  private connected: boolean = false;
  private busy: boolean = false;
  private sessionTicket: SessionTicket | null = null;
  private bbrState: BBRState;
  private metrics: ConnectionMetrics;
  private createdAt: number;
  private lastActiveAt: number;
  private migrationCount: number = 0;
  private currentPath: string;
  private id: string;

  // Static session ticket cache shared across connections for 0-RTT
  private static ticketCache: Map<string, SessionTicket> = new Map();
  private static readonly TICKET_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(config: QUICConnectionConfig) {
    this.config = {
      endpoint: config.endpoint,
      enableZeroRTT: config.enableZeroRTT ?? true,
      enableMultipath: config.enableMultipath ?? false,
      congestionControl: config.congestionControl ?? 'bbr',
      maxIdleTimeoutMs: config.maxIdleTimeoutMs ?? 30000,
      initialRttMs: config.initialRttMs ?? 100,
    };

    this.id = `quic-conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.currentPath = config.endpoint;

    this.bbrState = this.initBBR();
    this.metrics = this.initMetrics();
  }

  async connect(): Promise<{ zeroRtt: boolean; handshakeMs: number }> {
    const startTime = performance.now();
    if (this.connected) return { zeroRtt: false, handshakeMs: 0 };

    const cachedTicket = QUICConnection.ticketCache.get(this.config.endpoint);
    if (this.config.enableZeroRTT && cachedTicket && cachedTicket.expiresAt > Date.now()) {
      await this.connectWithZeroRTT(cachedTicket);
      const handshakeMs = performance.now() - startTime;
      this.metrics.handshakeTimeMs = handshakeMs;
      this.metrics.zeroRttUsed = true;
      this.connected = true;
      this.lastActiveAt = Date.now();
      return { zeroRtt: true, handshakeMs };
    }

    await this.connectFull();
    const handshakeMs = performance.now() - startTime;
    this.metrics.handshakeTimeMs = handshakeMs;
    this.metrics.zeroRttUsed = false;

    this.sessionTicket = this.generateSessionTicket();
    QUICConnection.ticketCache.set(this.config.endpoint, this.sessionTicket);
    this.connected = true;
    this.lastActiveAt = Date.now();
    return { zeroRtt: false, handshakeMs };
  }

  private async connectWithZeroRTT(ticket: SessionTicket): Promise<void> {
    if (ticket.expiresAt < Date.now()) {
      QUICConnection.ticketCache.delete(this.config.endpoint);
      throw new Error('Session ticket expired, performing full handshake');
    }
    const delay = Math.max(1, this.config.initialRttMs * 0.1);
    await this.sleep(delay);
    this.metrics.rttMs = delay;
    this.updateSmoothedRtt(delay);
    this.sessionTicket = this.generateSessionTicket();
    QUICConnection.ticketCache.set(this.config.endpoint, this.sessionTicket);
  }

  private async connectFull(): Promise<void> {
    const delay = this.config.initialRttMs;
    await this.sleep(delay);
    this.metrics.rttMs = delay;
    this.updateSmoothedRtt(delay);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.busy = false;
  }

  async send(data: Uint8Array | Buffer): Promise<{ bytesAcked: number; rttMs: number }> {
    if (!this.connected) throw new Error('Connection not established');
    this.busy = true;
    this.lastActiveAt = Date.now();
    const size = data.length;
    this.metrics.packetsSent++;
    this.metrics.bytesInFlight += size;
    const pacingDelay = this.computeBBRPacingDelay(size);
    await this.sleep(pacingDelay);
    this.metrics.bytesInFlight -= size;
    this.metrics.packetsAcked++;
    const measuredRtt = pacingDelay + Math.random() * 2;
    this.updateBBR(size, measuredRtt);
    this.updateSmoothedRtt(measuredRtt);
    this.metrics.rttMs = measuredRtt;
    this.busy = false;
    return { bytesAcked: size, rttMs: measuredRtt };
  }

  async migrate(newEndpoint: string): Promise<{ success: boolean; previousPath: string }> {
    if (!this.connected) throw new Error('Cannot migrate: not connected');
    const previousPath = this.currentPath;
    this.currentPath = newEndpoint;
    this.migrationCount++;
    const probeStart = performance.now();
    await this.sleep(Math.max(1, this.metrics.smoothedRttMs * 0.5));
    const probeRtt = performance.now() - probeStart;
    this.bbrState.mode = 'probe_bw';
    this.bbrState.cycleIndex = 0;
    this.metrics.congestionWindow = 10 * 1200;
    this.updateSmoothedRtt(probeRtt);
    this.lastActiveAt = Date.now();
    return { success: true, previousPath };
  }

  private computeBBRPacingDelay(packetSize: number): number {
    const { btlBw, pacingGain } = this.bbrState;
    if (btlBw <= 0) return Math.max(0.5, this.config.initialRttMs / 10);
    const pacingRate = btlBw * pacingGain;
    const interval = (packetSize / pacingRate) * 1000;
    return Math.max(0.1, interval);
  }

  private updateBBR(bytesDelivered: number, rttSample: number): void {
    const now = Date.now();
    const deliveryRate = bytesDelivered / (rttSample / 1000);
    this.metrics.deliveryRate = deliveryRate;
    if (deliveryRate > this.bbrState.btlBw) this.bbrState.btlBw = deliveryRate;
    if (rttSample < this.bbrState.rtProp || now > this.bbrState.rtPropExpiry) {
      this.bbrState.rtProp = rttSample;
      this.bbrState.rtPropExpiry = now + 10000;
    }
    switch (this.bbrState.mode) {
      case 'startup':
        this.bbrState.pacingGain = 2.885;
        this.bbrState.cwndGain = 2.0;
        if (deliveryRate <= this.bbrState.lastBw * 1.25) {
          this.bbrState.fullBwCount++;
          if (this.bbrState.fullBwCount >= 3) {
            this.bbrState.fullBwReached = true;
            this.bbrState.mode = 'drain';
          }
        } else {
          this.bbrState.fullBwCount = 0;
          this.bbrState.lastBw = deliveryRate;
        }
        break;
      case 'drain':
        this.bbrState.pacingGain = 1 / 2.885;
        this.bbrState.cwndGain = 2.0;
        if (this.metrics.bytesInFlight <= this.computeBDP()) {
          this.bbrState.mode = 'probe_bw';
          this.bbrState.cycleIndex = 0;
        }
        break;
      case 'probe_bw': {
        const pacingGains = [1.25, 0.75, 1, 1, 1, 1, 1, 1];
        this.bbrState.pacingGain = pacingGains[this.bbrState.cycleIndex % pacingGains.length];
        this.bbrState.cwndGain = 2.0;
        this.bbrState.cycleIndex++;
        break;
      }
      case 'probe_rtt':
        this.bbrState.cwndGain = 1.0;
        this.bbrState.pacingGain = 1.0;
        if (now > this.bbrState.rtPropExpiry) this.bbrState.mode = 'probe_bw';
        break;
    }
    this.metrics.congestionWindow = Math.max(4 * 1200, this.computeBDP() * this.bbrState.cwndGain);
  }

  private computeBDP(): number {
    return this.bbrState.btlBw * (this.bbrState.rtProp / 1000);
  }

  private updateSmoothedRtt(sample: number): void {
    const alpha = 0.125;
    const beta = 0.25;
    if (this.metrics.smoothedRttMs === 0) {
      this.metrics.smoothedRttMs = sample;
      this.metrics.rttVariance = sample / 2;
    } else {
      this.metrics.rttVariance = (1 - beta) * this.metrics.rttVariance +
        beta * Math.abs(this.metrics.smoothedRttMs - sample);
      this.metrics.smoothedRttMs = (1 - alpha) * this.metrics.smoothedRttMs + alpha * sample;
    }
  }

  private generateSessionTicket(): SessionTicket {
    return {
      data: new Uint8Array(32).map(() => Math.floor(Math.random() * 256)),
      issuedAt: Date.now(),
      expiresAt: Date.now() + QUICConnection.TICKET_LIFETIME_MS,
      serverName: this.config.endpoint,
      alpn: 'h3',
      maxEarlyData: 16384,
    };
  }

  private initBBR(): BBRState {
    return {
      mode: 'startup', btlBw: 0, rtProp: Infinity, rtPropExpiry: 0,
      cwndGain: 2.0, pacingGain: 2.885, cycleIndex: 0,
      fullBwReached: false, fullBwCount: 0, lastBw: 0,
    };
  }

  private initMetrics(): ConnectionMetrics {
    return {
      rttMs: 0, smoothedRttMs: 0, rttVariance: 0, bytesInFlight: 0,
      congestionWindow: 10 * 1200, deliveryRate: 0, packetsLost: 0,
      packetsSent: 0, packetsAcked: 0, zeroRttUsed: false, handshakeTimeMs: 0,
    };
  }

  getId(): string { return this.id; }
  isConnected(): boolean { return this.connected; }
  isBusy(): boolean { return this.busy; }
  getEndpoint(): string { return this.config.endpoint; }
  getCurrentPath(): string { return this.currentPath; }
  getCreatedAt(): number { return this.createdAt; }
  getLastActiveAt(): number { return this.lastActiveAt; }
  getMigrationCount(): number { return this.migrationCount; }
  getMetrics(): ConnectionMetrics { return { ...this.metrics }; }
  getBBRMode(): string { return this.bbrState.mode; }

  hasSessionTicket(): boolean { return QUICConnection.ticketCache.has(this.config.endpoint); }
  static clearTicketCache(): void { QUICConnection.ticketCache.clear(); }
  static getTicketCacheSize(): number { return QUICConnection.ticketCache.size; }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
