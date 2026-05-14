# ADR-0112 Cleanup Audit — Phase 6

**ADR:** ADR-0180 §Migration concerns Phase 6 + §Open Follow-up #5 (ADR-0112 dependent-code migration)
**Date:** 2026-05-14
**Auditor:** adr0112-cleanup-worker (Phase 6 team)
**Outcome:** No mechanical refactor required. Empty-set finding.

## Background

ADR-0180 §Migration concerns Phase 6 prescribed mechanical re-wiring of ADR-0112-era enforcement patterns when migrating the agentdb_* surface:

- "~14 sites in `controller-registry.ts` ('Phase 2: strict-mode discrimination' comments)"
- "6 sites in `agentdb-backend.ts` (`requireAgentDB()` guards)"
- "`rvf-backend-errors.ts:RvfNotInitializedError` pattern" (deferred to Phase 10)

## Audit findings

Three greps across `/Users/henrik/source/forks/agentdb/src/` (Phase 6 target tree):

1. `grep -rnE 'requireAgentDB\(' forks/agentdb/src/` → **0 production callsites**
2. `grep -rnE 'ADR-0112 Phase 2' forks/agentdb/src/` → **0 markers**
3. `grep -rnE 'RvfNotInitializedError' forks/agentdb/src/` → **0 class definitions, 0 imports**

Two informational hits remain:

- `forks/agentdb/src/archivist/MODULE.md:47` — narrates the *retired* pattern
- `forks/agentdb/src/archivist/index.ts:110` — same in a docblock

Both reference the pattern in past tense as documentation of the lazy-init contract that replaces it. **These should be retained** as architectural intent signals for readers.

Additional finding: brief referenced `forks/agentdb/src/backends/agentdb-backend.ts` as a 6-callsite host. **That file does not exist.** The backends/ dir holds `factory.ts`, `detector.ts`, `index.ts`, `GraphBackend.ts`, `LearningBackend.ts`, `VectorBackend.ts`, and per-substrate subdirs (`graph/`, `hnswlib/`, `postgres/`, `ruvector/`, `rvf/`). No file matches `agentdb-backend.*`.

## Conclusion

The Phase 6 mechanical cleanup described in ADR-0180 §Migration concerns Phase 6 + Follow-up #5 is **already complete** in the fork tree. No code edits required for Phase 6.

The "20 sites" figure (14 controller-registry + 6 requireAgentDB) in ADR §Migration concerns reflects a pre-extraction state of the codebase. Since ADR-0161's agentdb consolidation (2026-05-08) moved code into the dedicated `forks/agentdb` repo, the ADR-0112 enforcement layer was simplified during the move; only docblock narration of the retired pattern remains.

## Phase 10 implication

ADR-0180 §Migration concerns Phase 10 prescribed retiring `RvfNotInitializedError` from `rvf-backend-errors.ts`. **No such class exists in the fork today.** Phase 10's `rvf-error-retirement` worker should be re-scoped from "delete class" to "verify zero references" (which already pass today as well).

Per ADR §Migration concerns Phase 10 acceptance criteria, the drift-guard preflight that scans for `RvfNotInitializedError` / `MemoryNotInitializedError` is the load-bearing artifact. Phase 10 retains value as a permanent regression guard, not as a one-shot deletion task.

## ADR-0180 Open Follow-up #5 disposition

Item (a) — controller-registry ADR-0112 markers re-classified as guarded handlers: **VACUOUS** (no markers exist).
Item (b) — agentdb-backend.ts requireAgentDB() guards deletion: **VACUOUS** (no callsites; no file).

Follow-up #5 is closed against the Phase 6 surface. Phase 10 retains its `RvfNotInitializedError` verification scope.

## Phase 10 — RvfNotInitializedError retirement (2026-05-14)

**Auditor:** rvf-error-retirement (Phase 10 team)
**Outcome:** No code deletion. The pattern is retired in the agentdb surface but **remains load-bearing in the ruflo memory backend** — a separate substrate not under the archivist's init guarantee.

### Correction to the Phase 6 "0 class definitions, 0 imports" finding

Phase 6 (line 22) grepped `forks/agentdb/src/` only. Phase 10's mandated scope also covers `forks/ruflo/v3/@claude-flow/`, where the class **is** alive. Full grep across both trees — `grep -rnE 'RvfNotInitializedError|MemoryNotInitializedError'` — yields 11 hits:

**`forks/agentdb/src/` — 6 hits, all documentation narration (expected empty state, RETAINED):**

- `archivist/MODULE.md:47` — narrates the retired pattern in past tense
- `archivist/index.ts:110` — same, in a docblock
- `archivist/handlers/agentdb/ADR-0112-AUDIT.md:14,22,41,43,50` — Phase 6 audit-doc references

**`forks/ruflo/v3/@claude-flow/memory/` — 5 hits, ALL load-bearing code (NOT deleted):**

- `rvf-backend-errors.ts:63,71` — the `export class RvfNotInitializedError` definition + body
- `rvf-backend.ts:38` — live `import { RvfCorruptError, RvfNotInitializedError }`
- `rvf-backend.ts:45` — live `export { RvfCorruptError, RvfNotInitializedError }` re-export
- `rvf-backend.ts:341,348` — live discrimination logic in the autopersist-timer `.catch()` (per feedback-best-effort-must-rethrow-fatals)
- `rvf-backend.ts:418,426` — live throw-site: `requireInitialized()` throws it, called at the top of all 9 `RvfBackend` data-path methods (store / get / getByKey / update / delete / query / search / bulkInsert / bulkDelete)

`MemoryNotInitializedError` — **zero hits** across both trees (class definition, import, throw-site, and narration all absent).

### Why no deletion

Within the **agentdb / archivist** surface the "fail loud when a controller is called pre-init" intent is preserved by the archivist's init-completion guarantee (Phase 2 — handlers are invoked only after `Archivist.initialize()` resolves), so the per-store `RvfNotInitializedError` guard is genuinely retired there.

`RvfBackend` in `forks/ruflo/v3/@claude-flow/memory/` is a **different substrate** and is **not** routed through the archivist's init guarantee. Its `requireInitialized()` guard is the only thing standing between a caller that forgets `await initialize()` and silent in-memory degradation (writes land in the constructor-only Map, persist fails silently, native HNSW index never updates — the exact ADR-0082 / ADR-0112 antipattern). Deleting the class would break that guard and re-introduce silent data loss, violating feedback-no-fallbacks and ADR-0112's own "fail loud" mandate. It is retained as-is.

Net: Phase 10's "delete the class" framing applied only if the class were agentdb-local. It is not — it is ruflo-memory-local and live. The honest disposition is **verified + scoped**, not **deleted**.
