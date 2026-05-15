// charter: dispatch
// Per-handler unit test for `agentdb_gnn_stats` (ADR-0181 Item 2 — 2026-05-15).
//
// Covers the GNNTelemetryReader capability surface:
//   1. The handler reaches `ctx.capabilities.requireGnnTelemetryReader()` and
//      returns the cli-envelope shape directly (no substrate touched).
//   2. The pattern + type fields are echoed back through the response (legacy
//      cli envelope contract).
//   3. Fail-loud when the capability is unwired.

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { gnnStatsHandler } from '../../../../src/archivist/handlers/agentdb/gnn-stats.js';
import type { GNNTelemetryReader } from '../../../../src/archivist/capabilities.js';

function makeStubReader(stats: {
  engine: string;
  initialized: boolean;
  count: number;
  config?: unknown;
}): GNNTelemetryReader & { readonly calls: number } {
  let calls = 0;
  return {
    async getStats() {
      calls++;
      return stats;
    },
    get calls() {
      return calls;
    },
  };
}

describe('agentdb_gnn_stats handler (ADR-0181 Item 2)', () => {
  it('returns the cli envelope shape with controller=gnnService and engine/count from the reader', async () => {
    const reader = makeStubReader({
      engine: 'native',
      initialized: true,
      count: 7,
      config: { hiddenDim: 128 },
    });

    const { result } = await withTestReadContext(
      gnnStatsHandler,
      { pattern: 'b5-marker-xyz', type: 'gnn' },
      { gnnTelemetryReader: reader },
    );

    expect(result).toEqual({
      success: true,
      controller: 'gnnService',
      engine: 'native',
      initialized: true,
      count: 7,
      config: { hiddenDim: 128 },
      marker: 'b5-marker-xyz',
      type: 'gnn',
    });
    expect(reader.calls).toBe(1);
  });

  it('defaults marker to null and type to "neural" when the payload omits them', async () => {
    const reader = makeStubReader({ engine: 'js', initialized: false, count: 0 });

    const { result } = await withTestReadContext(
      gnnStatsHandler,
      {},
      { gnnTelemetryReader: reader },
    );

    expect(result.marker).toBeNull();
    expect(result.type).toBe('neural');
    expect(result.engine).toBe('js');
    expect(result.count).toBe(0);
    expect(result.initialized).toBe(false);
  });

  it('throws fail-loud when the GNNTelemetryReader capability is unwired', async () => {
    await expect(
      withTestReadContext(gnnStatsHandler, { pattern: 'x' }, {}),
    ).rejects.toThrow(/GNNTelemetryReader capability/i);
  });

  it('passes through unknown engine values verbatim (no normalisation)', async () => {
    const reader = makeStubReader({ engine: 'unknown', initialized: false, count: 0 });

    const { result } = await withTestReadContext(
      gnnStatsHandler,
      {},
      { gnnTelemetryReader: reader },
    );

    expect(result.engine).toBe('unknown');
  });
});
