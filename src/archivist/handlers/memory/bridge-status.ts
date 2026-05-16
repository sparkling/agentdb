// charter: dispatch
// memory_bridge_status read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Status-class, not search-style: surfaces the archivist's current state as one
// ranked entry per component. Each entry carries provenance so telemetry
// consumers can map back to the source store/namespace, matchType='status'
// (Pass-3 disposition, closed Provenance union in ./search).
//
// ADR-0181 Phase 3 Amendment (2026-05-15) + DA ruling (round 3, option 1):
// status assembly is INLINE (filesystem + future capability probes), NOT a
// substrate read. The cli's `memory_bridge_status` handler at memory-tools.ts
// :945-1048 assembles four entries from live system state every call:
//
//   1. claude-code         — scan of `~/.claude/projects/*/memory/*.md`
//                            (filesystem-only, no cross-package dependencies)
//   2. agentdb             — listEntries probe (cli-internal getMemoryFunctions)
//   3. intelligence        — getIntelligenceStats from cli's ../memory/intelligence
//   4. bridge              — derived from #2's claude-memories namespace count
//
// Package-boundary constraint (ADR-0161 — agentdb cannot import forks/ruflo):
// entry #1 ports cleanly (pure node:fs + node:os + node:path). Entries #2/#3/#4
// reach for cli-internal modules and CANNOT be ported into agentdb today —
// they re-enter through `ctx.capabilities` in Phase 4 when the capability
// factories are wired (ADR-0180 F4-2 Phase C, deferred by Phase 1 Amendment).
// Until then, this handler emits the ONE component it can honestly assemble
// from agentdb's side of the boundary — the FS-scanned `claude-code` entry —
// and three `degraded`-state stub entries for the deferred components so the
// telemetry shape stays parity with the cli's pre-shape (four entries, same
// component names + storeIds). The stubs carry `state: 'degraded'` and
// `metadata: { pendingPhase4: true, reason: '...' }` — explicit signal, not a
// silent vacant placeholder.
//
// Per-entry provenance carries the same per-component `storeId` strings the
// cli emits (memory-tools.ts:1009/1018/1029/1038) — 'claude-code-projects',
// 'agentdb', 'intelligence', 'memory-bridge'. matchType='status', rawScore=1,
// rank is 0-indexed per cli line 1042 (`.map((e, rank) => ...)`). No
// `matchedField` — cli omits it; strict cli-parity per Phase 3 DA ruling
// (round 2, item 4).
//
// Exit-gate (ADR-0181 line 159): `includeProvenance: true` round-trips
// end-to-end on this handler — the FS-scanned `claude-code` entry is a real
// ranked result with provenance constructed and returned to the cli edge, on
// every fresh `npm run release` machine, no prior writer required.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext } from '../../index.js';
import type { RankedResult, RankedResults } from './search.js';

export interface MemoryBridgeStatusQuery {
  readonly detail?: 'brief' | 'verbose';
}

export interface BridgeStatusEntry {
  readonly component: string;
  readonly state: 'up' | 'down' | 'degraded';
  readonly metadata: Record<string, unknown>;
}

/**
 * Scan `~/.claude/projects/*\/memory/*.md` exactly as the cli does at
 * memory-tools.ts:950-963. Returns counts of (projects-with-memories, total
 * markdown files). Filesystem-only — no cross-package dependencies. Quiet on
 * any FS error to mirror the cli's `try { ... } catch { /* ignore *\/ }`
 * disposition for this surface; the empty-counts return is the honest signal,
 * NOT a silent fallback masking a feature failure.
 */
function scanClaudeProjectsMemory(): { memoryFiles: number; projects: number } {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(claudeProjectsDir)) {
    return { memoryFiles: 0, projects: 0 };
  }
  let memoryFiles = 0;
  let projects = 0;
  try {
    for (const project of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const memDir = join(claudeProjectsDir, project.name, 'memory');
      if (!existsSync(memDir)) continue;
      const files = readdirSync(memDir).filter((f: string) => f.endsWith('.md'));
      if (files.length > 0) {
        projects += 1;
        memoryFiles += files.length;
      }
    }
  } catch {
    /* ignore — mirrors cli's catch at memory-tools.ts:962 */
  }
  return { memoryFiles, projects };
}

export const bridgeStatusHandler: GuardedRead<MemoryBridgeStatusQuery, RankedResults<BridgeStatusEntry>> =
  registerReadHandler<MemoryBridgeStatusQuery, RankedResults<BridgeStatusEntry>>(
    'memory_bridge_status',
    async (_ctx: ReadContext, _payload: MemoryBridgeStatusQuery): Promise<RankedResults<BridgeStatusEntry>> => {
      // Component 1: claude-code — live FS scan, port-fidelity with cli
      // (memory-tools.ts:950-963). `state` derived from file count — `up` iff
      // any project carries memory files; `degraded` otherwise (no failure,
      // just no data yet).
      const claudeCode = scanClaudeProjectsMemory();
      const claudeCodeEntry: BridgeStatusEntry = {
        component: 'claude-code',
        state: claudeCode.memoryFiles > 0 ? 'up' : 'degraded',
        metadata: { ...claudeCode, namespace: 'filesystem' },
      };

      // Components 2/3/4: agentdb / intelligence / bridge — cli-internal
      // dependencies (getMemoryFunctions().listEntries, ../memory/intelligence,
      // claude-memories-derived bridge state). Cannot be ported into agentdb
      // without violating the ADR-0161 package-boundary rule. Emit explicit
      // `degraded`-state stubs so the telemetry shape matches the cli's
      // four-entry pre-shape; Phase 4 wires the capability factories
      // (ctx.capabilities.*) and these branches re-enter the body.
      //
      // TODO(ADR-0181 Phase 4): re-introduce live assembly for agentdb /
      // intelligence / bridge once `ctx.capabilities.{listEntries, intelligence}`
      // narrow surfaces land. The cli body at memory-tools.ts:967-993 is the
      // source-of-truth port target.
      const agentdbEntry: BridgeStatusEntry = {
        component: 'agentdb',
        state: 'degraded',
        metadata: {
          pendingPhase4: true,
          reason: 'listEntries probe requires ctx.capabilities (Phase 4 wiring)',
          namespace: 'all',
        },
      };
      const intelligenceEntry: BridgeStatusEntry = {
        component: 'intelligence',
        state: 'degraded',
        metadata: {
          pendingPhase4: true,
          reason: 'getIntelligenceStats requires ctx.capabilities (Phase 4 wiring)',
          namespace: 'sona',
        },
      };
      const bridgeEntry: BridgeStatusEntry = {
        component: 'bridge',
        state: 'degraded',
        metadata: {
          pendingPhase4: true,
          reason: 'derived from claude-memories listEntries count (Phase 4 wiring)',
          namespace: 'claude-memories',
        },
      };

      // Per-entry source storeId mirrors the cli's pre-shape (memory-tools.ts
      // :1009/1018/1029/1038) verbatim. Rank 0-indexed per cli line 1042.
      // matchType='status', rawScore=1 (status, not similarity rank).
      const entries: ReadonlyArray<{ item: BridgeStatusEntry; storeId: string }> = [
        { item: claudeCodeEntry, storeId: 'claude-code-projects' },
        { item: agentdbEntry, storeId: 'agentdb' },
        { item: intelligenceEntry, storeId: 'intelligence' },
        { item: bridgeEntry, storeId: 'memory-bridge' },
      ];

      return entries.map(({ item, storeId }, rank): RankedResult<BridgeStatusEntry> => ({
        item,
        score: 1,
        provenance: {
          storeId,
          matchType: 'status',
          rawScore: 1,
          rank,
        },
      }));
    },
    { cacheScope: 'global' },
  );
