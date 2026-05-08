/**
 * QUICStreamManager - Stream Multiplexing for QUIC Connections
 *
 * Manages multiple concurrent streams over a single QUIC connection:
 * - Stream multiplexing with independent flow control per stream
 * - Priority-based scheduling (urgent, high, normal, low, background)
 * - Bidirectional and unidirectional streams
 * - Flow control with configurable window sizes
 * - Stream-level metrics and backpressure
 */

import { QUICConnection } from './QUICConnection.js';

export type StreamPriority = 'urgent' | 'high' | 'normal' | 'low' | 'background';

export interface StreamConfig {
  priority?: StreamPriority;
  bidirectional?: boolean;
  maxSendWindow?: number;
  maxReceiveWindow?: number;
}

export interface StreamMetrics {
  streamId: number;
  priority: StreamPriority;
  bytesSent: number;
  bytesReceived: number;
  state: StreamState;
  createdAt: number;
  lastActiveAt: number;
  sendWindowRemaining: number;
  receiveWindowRemaining: number;
}

export interface ManagerStats {
  totalStreams: number;
  activeStreams: number;
  closedStreams: number;
  totalBytesSent: number;
  totalBytesReceived: number;
  streamsByPriority: Record<StreamPriority, number>;
  avgThroughputBytesPerSec: number;
}

export type StreamState = 'idle' | 'open' | 'half_closed_local' | 'half_closed_remote' | 'closed';

interface QUICStream {
  id: number;
  priority: StreamPriority;
  bidirectional: boolean;
  state: StreamState;
  createdAt: number;
  lastActiveAt: number;
  bytesSent: number;
  bytesReceived: number;
  sendWindow: number;
  maxSendWindow: number;
  receiveWindow: number;
  maxReceiveWindow: number;
  sendBuffer: Uint8Array[];
  receiveBuffer: Uint8Array[];
}

const PRIORITY_WEIGHTS: Record<StreamPriority, number> = {
  urgent: 256,
  high: 128,
  normal: 64,
  low: 32,
  background: 16,
};

export class QUICStreamManager {
  private connection: QUICConnection;
  private streams: Map<number, QUICStream> = new Map();
  private nextStreamId: number = 0;
  private maxConcurrentStreams: number;
  private defaultSendWindow: number;
  private defaultReceiveWindow: number;
  private totalBytesSent: number = 0;
  private totalBytesReceived: number = 0;
  private createdAt: number;

  constructor(
    connection: QUICConnection,
    options?: {
      maxConcurrentStreams?: number;
      defaultSendWindow?: number;
      defaultReceiveWindow?: number;
    },
  ) {
    this.connection = connection;
    this.maxConcurrentStreams = options?.maxConcurrentStreams ?? 100;
    this.defaultSendWindow = options?.defaultSendWindow ?? 65536;
    this.defaultReceiveWindow = options?.defaultReceiveWindow ?? 65536;
    this.createdAt = Date.now();
  }

  /**
   * Create a new stream with optional priority and flow control settings.
   */
  createStream(config?: StreamConfig): number {
    const activeCount = this.getActiveStreamCount();
    if (activeCount >= this.maxConcurrentStreams) {
      throw new Error(
        `Maximum concurrent streams reached (${this.maxConcurrentStreams})`
      );
    }

    const streamId = this.nextStreamId++;
    const stream: QUICStream = {
      id: streamId,
      priority: config?.priority ?? 'normal',
      bidirectional: config?.bidirectional ?? true,
      state: 'open',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      bytesSent: 0,
      bytesReceived: 0,
      sendWindow: config?.maxSendWindow ?? this.defaultSendWindow,
      maxSendWindow: config?.maxSendWindow ?? this.defaultSendWindow,
      receiveWindow: config?.maxReceiveWindow ?? this.defaultReceiveWindow,
      maxReceiveWindow: config?.maxReceiveWindow ?? this.defaultReceiveWindow,
      sendBuffer: [],
      receiveBuffer: [],
    };

    this.streams.set(streamId, stream);
    return streamId;
  }

  /**
   * Send data on a specific stream.
   * Respects flow control: blocks if send window is exhausted.
   */
  async sendOnStream(
    streamId: number,
    data: Uint8Array,
  ): Promise<{ bytesSent: number; rttMs: number }> {
    const stream = this.getStream(streamId);

    if (stream.state === 'closed' || stream.state === 'half_closed_local') {
      throw new Error(`Stream ${streamId} is not writable (state: ${stream.state})`);
    }

    // Flow control: check send window
    if (data.length > stream.sendWindow) {
      // Wait for window update (simulated)
      await this.waitForSendWindow(stream, data.length);
    }

    // Consume send window
    stream.sendWindow -= data.length;
    stream.bytesSent += data.length;
    stream.lastActiveAt = Date.now();
    this.totalBytesSent += data.length;

    // Send via underlying connection
    const result = await this.connection.send(data);

    // Replenish send window (ACK-based)
    stream.sendWindow = Math.min(
      stream.sendWindow + data.length,
      stream.maxSendWindow,
    );

    return { bytesSent: data.length, rttMs: result.rttMs };
  }

  /**
   * Send data on multiple streams concurrently using priority scheduling.
   * Higher-priority streams are sent first.
   */
  async sendMultiple(
    messages: Array<{ streamId: number; data: Uint8Array }>,
  ): Promise<Array<{ streamId: number; bytesSent: number; rttMs: number }>> {
    // Sort by priority (highest first)
    const sorted = messages
      .map(msg => ({
        ...msg,
        priority: this.getStream(msg.streamId).priority,
      }))
      .sort((a, b) => PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority]);

    // Send in priority order, but concurrently within same priority tier
    const results: Array<{ streamId: number; bytesSent: number; rttMs: number }> = [];
    let currentPriority = sorted[0]?.priority;
    let batch: typeof sorted = [];

    for (const msg of sorted) {
      if (msg.priority !== currentPriority) {
        // Send current batch concurrently
        const batchResults = await Promise.all(
          batch.map(m => this.sendOnStream(m.streamId, m.data)
            .then(r => ({ streamId: m.streamId, ...r })))
        );
        results.push(...batchResults);
        batch = [];
        currentPriority = msg.priority;
      }
      batch.push(msg);
    }

    // Send remaining batch
    if (batch.length > 0) {
      const batchResults = await Promise.all(
        batch.map(m => this.sendOnStream(m.streamId, m.data)
          .then(r => ({ streamId: m.streamId, ...r })))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Receive data on a stream (simulate receiving from remote).
   */
  receiveOnStream(streamId: number, data: Uint8Array): void {
    const stream = this.getStream(streamId);

    if (stream.state === 'closed' || stream.state === 'half_closed_remote') {
      throw new Error(`Stream ${streamId} is not readable (state: ${stream.state})`);
    }

    if (!stream.bidirectional) {
      throw new Error(`Stream ${streamId} is unidirectional`);
    }

    if (data.length > stream.receiveWindow) {
      throw new Error(
        `Flow control violation on stream ${streamId}: ` +
        `${data.length} bytes exceeds window ${stream.receiveWindow}`
      );
    }

    stream.receiveWindow -= data.length;
    stream.bytesReceived += data.length;
    stream.lastActiveAt = Date.now();
    stream.receiveBuffer.push(data);
    this.totalBytesReceived += data.length;

    // Auto window update when 50% consumed
    if (stream.receiveWindow < stream.maxReceiveWindow / 2) {
      stream.receiveWindow = stream.maxReceiveWindow;
    }
  }

  /**
   * Close a stream (half-close local side).
   */
  closeStream(streamId: number): void {
    const stream = this.getStream(streamId);

    if (stream.state === 'open') {
      stream.state = 'half_closed_local';
    } else if (stream.state === 'half_closed_remote') {
      stream.state = 'closed';
    }
  }

  /**
   * Reset a stream (abrupt close with error).
   */
  resetStream(streamId: number): void {
    const stream = this.getStream(streamId);
    stream.state = 'closed';
    stream.sendBuffer = [];
    stream.receiveBuffer = [];
  }

  /**
   * Get metrics for a specific stream.
   */
  getStreamMetrics(streamId: number): StreamMetrics {
    const stream = this.getStream(streamId);
    return {
      streamId: stream.id,
      priority: stream.priority,
      bytesSent: stream.bytesSent,
      bytesReceived: stream.bytesReceived,
      state: stream.state,
      createdAt: stream.createdAt,
      lastActiveAt: stream.lastActiveAt,
      sendWindowRemaining: stream.sendWindow,
      receiveWindowRemaining: stream.receiveWindow,
    };
  }

  /**
   * Get overall manager statistics.
   */
  getStats(): ManagerStats {
    const activeStreams = this.getActiveStreamCount();
    const closedStreams = Array.from(this.streams.values())
      .filter(s => s.state === 'closed').length;

    const byPriority: Record<StreamPriority, number> = {
      urgent: 0, high: 0, normal: 0, low: 0, background: 0,
    };
    for (const stream of this.streams.values()) {
      if (stream.state !== 'closed') {
        byPriority[stream.priority]++;
      }
    }

    const elapsedSec = Math.max(1, (Date.now() - this.createdAt) / 1000);
    const avgThroughput = this.totalBytesSent / elapsedSec;

    return {
      totalStreams: this.streams.size,
      activeStreams,
      closedStreams,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
      streamsByPriority: byPriority,
      avgThroughputBytesPerSec: Number(avgThroughput.toFixed(2)),
    };
  }

  /**
   * Update the priority of an existing stream.
   */
  updatePriority(streamId: number, priority: StreamPriority): void {
    const stream = this.getStream(streamId);
    stream.priority = priority;
  }

  /**
   * Close all streams and reset state.
   */
  closeAll(): number {
    let closed = 0;
    for (const stream of this.streams.values()) {
      if (stream.state !== 'closed') {
        stream.state = 'closed';
        closed++;
      }
    }
    return closed;
  }

  /**
   * Get the number of active (non-closed) streams.
   */
  getActiveStreamCount(): number {
    let count = 0;
    for (const stream of this.streams.values()) {
      if (stream.state !== 'closed') {
        count++;
      }
    }
    return count;
  }

  // -- Private helpers --

  private getStream(streamId: number): QUICStream {
    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    return stream;
  }

  private async waitForSendWindow(stream: QUICStream, needed: number): Promise<void> {
    const maxWait = 5000;
    const start = Date.now();

    while (stream.sendWindow < needed && (Date.now() - start) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1));
      // Simulate window update from ACKs
      stream.sendWindow = Math.min(
        stream.sendWindow + Math.floor(stream.maxSendWindow / 4),
        stream.maxSendWindow,
      );
    }

    if (stream.sendWindow < needed) {
      throw new Error(
        `Send window timeout on stream ${stream.id}: ` +
        `needed ${needed}, available ${stream.sendWindow}`
      );
    }
  }
}
