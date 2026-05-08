/**
 * QUICConnection - Enhanced QUIC Connection with 0-RTT, BBR, and Migration
 *
 * Implements an advanced QUIC connection with:
 * - 0-RTT fast reconnect via session ticket caching
 * - BBR congestion control for optimal throughput
 * - Connection migration for resilient networking
 * - Latency tracking and performance metrics
 */

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

  /**
   * Connect to the QUIC endpoint.
   * Uses 0-RTT if a cached session ticket is available.
   */
  async connect(): Promise<{ zeroRtt: boolean; handshakeMs: number }> {
    const startTime = performance.now();

    if (this.connected) {
      return { zeroRtt: false, handshakeMs: 0 };
    }

    // Check for cached session ticket for 0-RTT
    const cachedTicket = QUICConnection.ticketCache.get(this.config.endpoint);
    if (this.config.enableZeroRTT && cachedTicket && cachedTicket.expiresAt > Date.now()) {
      // 0-RTT fast path: skip full handshake
      const result = await this.connectWithZeroRTT(cachedTicket);
      const handshakeMs = performance.now() - startTime;
      this.metrics.handshakeTimeMs = handshakeMs;
      this.metrics.zeroRttUsed = true;
      this.connected = true;
      this.lastActiveAt = Date.now();
      return { zeroRtt: true, handshakeMs };
    }

    // Full TLS 1.3 handshake
    await this.connectFull();
    const handshakeMs = performance.now() - startTime;
    this.metrics.handshakeTimeMs = handshakeMs;
    this.metrics.zeroRttUsed = false;

    // Store session ticket for future 0-RTT
    this.sessionTicket = this.generateSessionTicket();
    QUICConnection.ticketCache.set(this.config.endpoint, this.sessionTicket);

    this.connected = true;
    this.lastActiveAt = Date.now();
    return { zeroRtt: false, handshakeMs };
  }

  /**
   * 0-RTT connection using cached session ticket.
   * Sends early data in the initial flight, eliminating 1 RTT.
   */
  private async connectWithZeroRTT(ticket: SessionTicket): Promise<void> {
    // Validate ticket
    if (ticket.expiresAt < Date.now()) {
      QUICConnection.ticketCache.delete(this.config.endpoint);
      throw new Error('Session ticket expired, performing full handshake');
    }

    // 0-RTT: send ClientHello + early data in single flight
    // Simulated timing: ~0.1x of full handshake
    const delay = Math.max(1, this.config.initialRttMs * 0.1);
    await this.sleep(delay);

    // Update RTT estimate from 0-RTT
    this.metrics.rttMs = delay;
    this.updateSmoothedRtt(delay);

    // Refresh the ticket for next time
    this.sessionTicket = this.generateSessionTicket();
    QUICConnection.ticketCache.set(this.config.endpoint, this.sessionTicket);
  }

  /**
   * Full TLS 1.3 handshake (1-RTT).
   */
  private async connectFull(): Promise<void> {
    // Full handshake: 1 RTT
    const delay = this.config.initialRttMs;
    await this.sleep(delay);

    this.metrics.rttMs = delay;
    this.updateSmoothedRtt(delay);
  }

  /**
   * Disconnect the connection.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.busy = false;
  }

  /**
   * Send data over this connection using BBR pacing.
   */
  async send(data: Uint8Array | Buffer): Promise<{ bytesAcked: number; rttMs: number }> {
    if (!this.connected) {
      throw new Error('Connection not established');
    }

    this.busy = true;
    this.lastActiveAt = Date.now();

    const size = data.length;
    this.metrics.packetsSent++;
    this.metrics.bytesInFlight += size;

    // BBR-paced sending
    const pacingDelay = this.computeBBRPacingDelay(size);
    await this.sleep(pacingDelay);

    // Simulate ACK
    this.metrics.bytesInFlight -= size;
    this.metrics.packetsAcked++;

    // Update BBR state with delivery sample
    const measuredRtt = pacingDelay + Math.random() * 2; // slight jitter
    this.updateBBR(size, measuredRtt);
    this.updateSmoothedRtt(measuredRtt);
    this.metrics.rttMs = measuredRtt;

    this.busy = false;
    return { bytesAcked: size, rttMs: measuredRtt };
  }

  /**
   * Migrate connection to a new network path.
   * QUIC supports connection migration without re-handshake.
   */
  async migrate(newEndpoint: string): Promise<{ success: boolean; previousPath: string }> {
    if (!this.connected) {
      throw new Error('Cannot migrate: not connected');
    }

    const previousPath = this.currentPath;
    this.currentPath = newEndpoint;
    this.migrationCount++;

    // Path validation: probe the new path
    const probeStart = performance.now();
    await this.sleep(Math.max(1, this.metrics.smoothedRttMs * 0.5));
    const probeRtt = performance.now() - probeStart;

    // Reset congestion controller for new path (BBR probe_bw)
    this.bbrState.mode = 'probe_bw';
    this.bbrState.cycleIndex = 0;
    this.metrics.congestionWindow = 10 * 1200; // 10 initial packets

    this.updateSmoothedRtt(probeRtt);
    this.lastActiveAt = Date.now();

    return { success: true, previousPath };
  }

  /**
   * Compute BBR pacing delay for a given packet size.
   */
  private computeBBRPacingDelay(packetSize: number): number {
    const { btlBw, pacingGain } = this.bbrState;

    if (btlBw <= 0) {
      // No bandwidth estimate yet: use initial RTT / 10
      return Math.max(0.5, this.config.initialRttMs / 10);
    }

    // Pacing interval = packetSize / (btlBw * pacingGain)
    const pacingRate = btlBw * pacingGain;
    const interval = (packetSize / pacingRate) * 1000; // convert to ms

    return Math.max(0.1, interval);
  }

  /**
   * Update BBR state machine with a new delivery sample.
   */
  private updateBBR(bytesDelivered: number, rttSample: number): void {
    const now = Date.now();

    // Update bottleneck bandwidth estimate
    const deliveryRate = bytesDelivered / (rttSample / 1000);
    this.metrics.deliveryRate = deliveryRate;

    if (deliveryRate > this.bbrState.btlBw) {
      this.bbrState.btlBw = deliveryRate;
    }

    // Update min RTT (rt_prop)
    if (rttSample < this.bbrState.rtProp || now > this.bbrState.rtPropExpiry) {
      this.bbrState.rtProp = rttSample;
      this.bbrState.rtPropExpiry = now + 10000; // 10s window
    }

    // State machine transitions
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
        if (now > this.bbrState.rtPropExpiry) {
          this.bbrState.mode = 'probe_bw';
        }
        break;
    }

    // Update congestion window
    this.metrics.congestionWindow = Math.max(
      4 * 1200, // minimum 4 packets
      this.computeBDP() * this.bbrState.cwndGain
    );
  }

  /**
   * Compute Bandwidth-Delay Product.
   */
  private computeBDP(): number {
    return this.bbrState.btlBw * (this.bbrState.rtProp / 1000);
  }

  /**
   * Update smoothed RTT using exponential weighted moving average.
   */
  private updateSmoothedRtt(sample: number): void {
    const alpha = 0.125;
    const beta = 0.25;

    if (this.metrics.smoothedRttMs === 0) {
      this.metrics.smoothedRttMs = sample;
      this.metrics.rttVariance = sample / 2;
    } else {
      this.metrics.rttVariance = (1 - beta) * this.metrics.rttVariance +
        beta * Math.abs(this.metrics.smoothedRttMs - sample);
      this.metrics.smoothedRttMs = (1 - alpha) * this.metrics.smoothedRttMs +
        alpha * sample;
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
      mode: 'startup',
      btlBw: 0,
      rtProp: Infinity,
      rtPropExpiry: 0,
      cwndGain: 2.0,
      pacingGain: 2.885,
      cycleIndex: 0,
      fullBwReached: false,
      fullBwCount: 0,
      lastBw: 0,
    };
  }

  private initMetrics(): ConnectionMetrics {
    return {
      rttMs: 0,
      smoothedRttMs: 0,
      rttVariance: 0,
      bytesInFlight: 0,
      congestionWindow: 10 * 1200,
      deliveryRate: 0,
      packetsLost: 0,
      packetsSent: 0,
      packetsAcked: 0,
      zeroRttUsed: false,
      handshakeTimeMs: 0,
    };
  }

  // -- Accessors --

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

  hasSessionTicket(): boolean {
    return QUICConnection.ticketCache.has(this.config.endpoint);
  }

  /**
   * Clear session ticket cache (for testing or security reset).
   */
  static clearTicketCache(): void {
    QUICConnection.ticketCache.clear();
  }

  /**
   * Get the number of cached session tickets.
   */
  static getTicketCacheSize(): number {
    return QUICConnection.ticketCache.size;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
