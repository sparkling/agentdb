// charter: dispatch
// ADR-0184 Wave 1 structural test — verifies the parent dispatcher in
// `handlers/hive-mind/consensus.ts` routes each `payload.strategy` value to
// its named per-strategy handler module. Wave 1 has no behavioural ports yet:
// every strategy's body still throws a keyed `pending ADR-0184 Wave N` error,
// so the test asserts on the thrown message substring per strategy.
//
// Catches two specific regressions per Wave 1 DA review:
//   (a) `'byzantine' → 'bft'` normalisation falls through to the bft case
//        (cli line 2056 parity), NOT a separate byzantine case or default.
//   (b) Unknown strategy hits the `default:` throw (not silent fallback).
//
// Wave-N ports will replace the matched substring assertion for that strategy
// with real behavioural assertions; the other strategies' assertions remain
// until their respective wave.

import { describe, expect, it } from 'vitest';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
} from '../../../../../src/archivist/testing/index.js';
import { consensusHiveMindHandler } from '../../../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveMindConsensusPayload } from '../../../../../src/archivist/handlers/hive-mind/consensus.js';

describe('hive-mind_consensus parent dispatcher (ADR-0184 Wave 1)', () => {
  const proposePayload = (
    strategy: HiveMindConsensusPayload extends { action: 'propose'; strategy?: infer S }
      ? S
      : never,
  ): HiveMindConsensusPayload =>
    ({
      action: 'propose',
      type: 'test',
      value: 'wave-1',
      strategy,
    }) as HiveMindConsensusPayload;

  it('routes strategy:bft to the bft per-strategy stub', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('bft'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[bft\] handler body pending ADR-0184 Wave 2/);
  });

  it('normalises strategy:byzantine to the bft per-strategy stub (cli line 2056 parity)', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('byzantine'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[bft\] handler body pending ADR-0184 Wave 2/);
  });

  it('routes strategy:raft to the raft per-strategy stub', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('raft'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[raft\] handler body pending ADR-0184 Wave 2/);
  });

  it('routes strategy:quorum to the quorum per-strategy stub', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('quorum'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[quorum\] handler body pending ADR-0184 Wave 2/);
  });

  it('routes strategy:weighted to the weighted per-strategy stub', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('weighted'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[weighted\] handler body pending ADR-0184 Wave 3/);
  });

  it('routes strategy:gossip to the gossip per-strategy stub', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('gossip'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[gossip\] handler body pending ADR-0184 Wave 4/);
  });

  it('routes strategy:crdt to the crdt per-strategy stub', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        proposePayload('crdt'),
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[crdt\] handler body pending ADR-0184 Wave 5/);
  });

  it('defaults to raft when strategy is omitted (cli parity)', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        { action: 'propose', type: 'test', value: 'no-strategy' } as HiveMindConsensusPayload,
        { substrate: fixture },
      ),
    ).rejects.toThrow(/hive-mind_consensus\[raft\] handler body pending ADR-0184 Wave 2/);
  });

  it('throws on an unknown strategy value (no silent fallback)', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['hive-mind_consensus'] });
    // Cast through `unknown` because the wire type is a union of known
    // strategies; this test exercises the runtime default arm.
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        {
          action: 'propose',
          type: 'test',
          value: 'invalid',
          strategy: 'mystery-strategy',
        } as unknown as HiveMindConsensusPayload,
        { substrate: fixture },
      ),
    ).rejects.toThrow(/unknown strategy/);
  });
});
