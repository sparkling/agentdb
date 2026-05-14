// charter: substrate-seam
// daemon_autoMemoryBridge mutation handler (ADR-0180 Phase 7 §Architecture · Audit chain).
// Registers the AutoMemoryBridge periodic-sync write as a
// `GuardedWrite<AutoMemoryBridgePayload>` so each `syncToAutoMemory` transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Pre-existing in-process callsite:
// `forks/ruflo/v3/@claude-flow/memory/src/auto-memory-bridge.ts`. The
// `AutoMemoryBridge` class (line 207) installs a 60s `setInterval` via
// `startPeriodicSync` (line 740) when `syncMode === 'periodic'`
// (constructor gate at line 238; default `syncIntervalMs: 60_000` at
// line 175). The interval handler invokes `syncToAutoMemory` (line 295) which
// produces three file outputs in one logical intent:
//   1. AgentDB backend entries (via the bridge's `IMemoryBackend`),
//   2. Topic markdown files at `<memoryDir>/<category>.md` (one append per
//      classified entry via `appendToTopicFile`, line 332),
//   3. The MEMORY.md index at `<memoryDir>/MEMORY.md` (rewritten end-to-end
//      by `curateIndex`, line 340, kept under `maxIndexLines`).
// The same `syncToAutoMemory` entrypoint is reached on session-end
// (default `syncMode: 'on-session-end'`, line 174). The `'on-write'` mode
// (line 279) is a different code path: `recordInsight` writes a single
// insight via `writeInsightToFiles` without invoking `syncToAutoMemory` and
// without touching the AgentDB query path or `curateIndex` — so the
// `'on-write'` trigger does NOT flow through this handler today. The
// payload's `trigger` field nonetheless includes `'on-write'` so a future
// wire-up that unifies all sync paths through this seam has a stable type.
//
// F4-3 deferral: per ADR-0180 §F4-3 the in-process `AutoMemoryBridge` class
// stays in place during Phase 7; only the registration shape lands here. The
// dispatch wire-up from `syncToAutoMemory` → `archivist.dispatchMutation(
// 'daemon_autoMemoryBridge', ...)` is deliberately deferred — this file
// establishes the registry-side contract the wire-up will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// the three-target sync output (backend + topic markdown + MEMORY.md) may
// mutate. The underlying primitive is `makeFsJsonSubstrate`
// (substrates/fs-json-store.ts) — this handler holds the substrate seam for
// the AutoMemoryBridge periodic-sync write. Wire-up emits one `withWrite`
// scope per tick; the three file outputs nest inside the same intent so the
// audit-chain records a single intent → applied transition per tick rather
// than three independent ones.

import {
  registerMutationHandler,
  type BulkIntent,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import { createHash } from 'node:crypto';

/**
 * Sync trigger — mirrors `SyncMode` from auto-memory-bridge.ts:46.
 * `'periodic'` and `'on-session-end'` both call `syncToAutoMemory` and
 * therefore flow through this handler. `'on-write'` is included for type
 * completeness so a future wire-up that unifies all sync paths through this
 * seam can extend coverage without a payload migration; today
 * `recordInsight`'s `'on-write'` branch (auto-memory-bridge.ts:279) bypasses
 * `syncToAutoMemory` and writes a single insight file directly.
 */
export type AutoMemoryBridgeTrigger = 'periodic' | 'on-session-end' | 'on-write';

/**
 * Mutation payload for the AutoMemoryBridge periodic-sync write. The
 * `syncToAutoMemory` entrypoint (auto-memory-bridge.ts:295) takes no
 * caller-supplied arguments — the timer (or session-end caller) fires with
 * the bridge's own buffered insights + `lastSyncTime` as the implicit input.
 * The payload captures the trigger metadata so the audit record reflects
 * *why* the sync ran (`trigger`), what window of insights it covered
 * (`sinceMs`, mirroring the bridge's `lastSyncTime` cursor), and when it
 * fired (`ts`), without coupling to the bridge's internal buffer state.
 */
export interface AutoMemoryBridgePayload {
  readonly trigger: AutoMemoryBridgeTrigger;
  readonly sinceMs: number;
  readonly ts: number;
  /**
   * The sync result, computed bridge-side. The in-process `AutoMemoryBridge`
   * (memory/src/auto-memory-bridge.ts) runs `syncToAutoMemory` ON ITS OWN STACK
   * — it owns the insight buffer, the `IMemoryBackend` reference, the
   * LearningBridge consolidation, and the `queryRecentInsights` AgentDB read.
   * Per the `performance/benchmark.ts` precedent the *sync execution* stays
   * bridge-side and the handler owns persistence only; the `SyncResult` (the
   * bridge's own return value, auto-memory-bridge.ts:352-357) therefore arrives
   * here fully-composed. Field set mirrors `SyncResult` 1:1.
   */
  readonly result: AutoMemoryBridgeSyncResult;
}

/**
 * Auto-memory sync result — mirrors `SyncResult` from
 * `memory/src/auto-memory-bridge.ts:109-121`. `synced` is
 * `buffered.length + entries.length`; `categories` is the set of `<category>.md`
 * topic files touched this tick; `durationMs` / `errors` are the bridge's own
 * timing + non-fatal-error accumulators.
 */
export interface AutoMemoryBridgeSyncResult {
  readonly synced: number;
  readonly categories: ReadonlyArray<string>;
  readonly durationMs: number;
  readonly errors: ReadonlyArray<string>;
}

const STORE_ID = 'auto_memory_bridge' as StoreId;

// Bulk-intent table name — fs-json substrate resolves this to
// `data/auto-memory-store.json` via `FS_JSON_PATH_OVERRIDES` (the routing
// substrate keys `withBulkWrite` off `intent.tableName`, see index.ts
// `routingSubstrate`).
const BULK_TABLE = 'auto_memory_bridge';

// F4-2 body: persists the bridge-side sync result to
// `.claude-flow/data/auto-memory-store.json` (the path `auto_memory_bridge`
// resolves to). The brief specifies `withBulkWrite` because `syncToAutoMemory`
// is a genuine multi-target intent (AgentDB backend + topic markdown +
// MEMORY.md) — the bulk envelope records the multi-file shape in one
// `bulk-manifest` audit entry even though the fs-json substrate collapses the
// commit to one atomic file rewrite (`makeFsJsonSubstrate.withBulkWrite`
// delegates to `withWrite` — substrates/fs-json-store.ts:285-294). The sync
// *execution* stays bridge-side per the `performance/benchmark.ts` precedent;
// the dispatch wire-up flips the bridge's `syncToAutoMemory` to
// `archivist.dispatch('daemon_autoMemoryBridge', { trigger, sinceMs, ts, result })`
// under F4-3.
//
// TODO(F4-2-config: substrate-registry routing + a markdown-capable substrate
// for the topic-markdown and MEMORY.md outputs): `syncToAutoMemory` writes
// THREE targets — (1) AgentDB-backend entries, (2) per-category `<memoryDir>/
// <category>.md` topic-markdown files, (3) the `<memoryDir>/MEMORY.md` index.
// Only target (1)'s persistence record lands here. Targets (2) and (3) CANNOT
// be written through this seam yet for two reasons: (a) `substrate-registry.ts`
// `FS_JSON_PATH_OVERRIDES` (lines 144-174) routes no `StoreId` to any
// `<memoryDir>/*.md` path — the memory dir is project-root-relative but
// caller-configurable (`AutoMemoryBridgeConfig.memoryDir`), so its paths are
// not registry-static the way `.claude-flow/<store>.json` paths are; and (b)
// the fs-json substrate is JSON-only — `saveJsonAtomic` `JSON.stringify`s the
// payload (substrates/fs-json-store.ts:198), so it cannot emit the raw-markdown
// body that `appendToTopicFile` / `curateIndex` produce. Wiring (2)+(3) is
// `initialize(config)`-adjacent work: either a markdown-family substrate
// primitive (atomic tmp+fsync+rename over a `.md` path, no JSON encode) plus
// per-category `StoreId` routing, OR the bridge keeps owning the markdown
// writes and only the backend-sync record flows through the archivist. Faking
// markdown writes through the JSON substrate here would be the
// `don't-fake-bodies` violation the F4-2 brief calls out — the gap is
// documented, not masked (`feedback-no-fallbacks`).
export const autoMemoryBridgeHandler: GuardedWrite<AutoMemoryBridgePayload> =
  registerMutationHandler<AutoMemoryBridgePayload>(
    'daemon_autoMemoryBridge',
    async (ctx: MutationContext<false>, payload: AutoMemoryBridgePayload): Promise<void> => {
      const record = payload.result;
      const checksum = createHash('sha256')
        .update(JSON.stringify(record))
        .digest('hex');
      const intent: BulkIntent = {
        tableName: BULK_TABLE,
        columnSet: ['synced', 'categories', 'durationMs', 'errors'],
        count: record.synced,
        checksum,
      };
      await ctx.substrate.withBulkWrite(intent, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload: record });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
