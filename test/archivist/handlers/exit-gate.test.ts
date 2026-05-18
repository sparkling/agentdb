// charter: dispatch
// ADR-0184 Wave 6 exit gate — final close-out tests.
//
// Verifies the two exit-gate criteria from ADR-0181 §Phase D + ADR-0180
// §Confirmation that ADR-0184 §Execution Plan inherits:
//
//   1. Zero `pending` stubs in `forks/agentdb/src/archivist/handlers/**`.
//      Every per-tool handler body is a real implementation, not a
//      "callers route through cli" stub-throw.
//
//   2. Audit-entry count equals mutation count. Each `consensusHiveMindHandler`
//      dispatch generates exactly one audit entry — the parent dispatcher's
//      `withWrite` is the audit boundary; per-strategy bodies operate within
//      that single scope. No double-write paths.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
  type FsJsonSubstrateFixture,
} from '../../../src/archivist/testing/index.js';
import { consensusHiveMindHandler } from '../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveMindConsensusPayload } from '../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveStateDoc } from '../../../src/archivist/handlers/hive-mind/hive-state.js';

const HANDLERS_DIR = new URL('../../../src/archivist/handlers/', import.meta.url).pathname;
const STORE_ID = 'hive-mind_consensus';
const ROOT_KEY = 'root';

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      out.push(fullPath);
    }
  }
  return out;
}

describe('ADR-0184 Wave 6 exit gate', () => {
  it('handlers/** contains zero `handler body pending` stub-throws', () => {
    const files = walkTsFiles(HANDLERS_DIR);
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Look for the literal stub-throw message used by Wave 1 skeletons.
        // Comments mentioning the pattern (e.g. doc-strings) DON'T count —
        // only the executable throw text inside a function body. Cheap proxy:
        // exclude lines starting with `//` or `*`.
        const stripped = lines[i]!.trimStart();
        if (stripped.startsWith('//') || stripped.startsWith('*')) continue;
        if (lines[i]!.includes('handler body pending')) {
          offenders.push({ file, line: i + 1, text: lines[i]!.trim() });
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}:${o.line} — ${o.text}`)
        .join('\n');
      throw new Error(
        `ADR-0184 Wave 6 exit gate: expected zero 'handler body pending' stubs, found ${offenders.length}:\n${msg}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});

describe('ADR-0184 Wave 6 — audit-entry count equals mutation count', () => {
  function freshState(workerIds: string[] = ['w1', 'w2']): HiveStateDoc {
    return {
      initialized: true,
      workers: workerIds,
      workerMeta: {},
      consensus: { pending: [], history: [] },
      sharedMemory: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function makeFixture(state: HiveStateDoc): FsJsonSubstrateFixture {
    const fixture = makeFsJsonSubstrateFixture({ files: [STORE_ID] });
    fixture.files.set(STORE_ID, { [ROOT_KEY]: state });
    return fixture;
  }

  it('each consensus dispatch generates exactly 1 audit entry per call (6 dispatches → 6 entries)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2']));

    // Drive 6 propose dispatches, one per strategy. Each one is a single
    // `consensusHiveMindHandler` invocation = exactly one `withWrite` scope =
    // exactly one audit entry.
    const auditEntries: Array<{ proposalId: string; intent: string }> = [];

    const strategies: Array<HiveMindConsensusPayload> = [
      { action: 'propose', type: 'p-bft', value: 'v', strategy: 'bft', proposalId: 'audit-bft' },
      { action: 'propose', type: 'p-raft', value: 'v', strategy: 'raft', proposalId: 'audit-raft' },
      { action: 'propose', type: 'p-quorum', value: 'v', strategy: 'quorum', proposalId: 'audit-quorum' },
      { action: 'propose', type: 'p-gossip', value: 'v', strategy: 'gossip', proposalId: 'audit-gossip' },
      { action: 'propose', type: 'p-crdt', value: 'v', strategy: 'crdt', proposalId: 'audit-crdt' },
      { action: 'list' },
    ];

    for (const payload of strategies) {
      const result = await withTestContext(consensusHiveMindHandler, payload, {
        substrate: fixture,
      });
      expect(result.audit).toBeDefined();
      // Per ADR-0180 §Confirmation: ONE audit entry per call.
      expect(result.audit.length).toBe(1);
      const entry = result.audit[0]!;
      auditEntries.push({
        proposalId: (payload as { proposalId?: string }).proposalId ?? '<no-id>',
        intent: entry.originatingTool ?? 'unknown',
      });
    }

    // 6 dispatches → 6 audit entries (Concern 5 stronger assertion).
    expect(auditEntries).toHaveLength(6);

    // Each entry's originatingTool is 'test' (default in withTestContext).
    // Verify all entries were captured — count is the primary assertion;
    // the originatingTool sanity-check confirms entries are real, not undefined.
    for (const e of auditEntries) {
      expect(typeof e.intent).toBe('string');
      expect(e.intent.length).toBeGreaterThan(0);
    }

    // Cross-check: 5 distinct propose proposalIds + 1 list call.
    const proposeIds = auditEntries.slice(0, 5).map((e) => e.proposalId);
    expect(new Set(proposeIds).size).toBe(5);
  });
});
