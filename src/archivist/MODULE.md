# Archivist Module Charter — Scope Gate per ADR-0180

**Status:** Active — Phase 2 scaffolding (ADR-0180 §Migration concerns).
**Authoritative ADR:** [ADR-0180](../../../../../ruflo-patch/docs/adr/ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.md) §Governance, §Architecture.

This module is the type-enforced chokepoint between any in-process caller and substrate (RVF + the five permanent SQLite carve-out controllers per ADR-0166). All mutations and reads route through it. The substrate handle is path-restricted to `archivist/**` and is delivered to handlers exclusively via `MutationContext.substrate` / `ReadContext` — store-tree code cannot obtain it under any name.

## Charter purpose

This charter exists so the archivist's "thin" property is mechanically defensible, not aspirational. Earlier drafts of ADR-0180 gated scope on a 2500-LoC budget; itemized accounting showed the budget unrealistic for the six-feature surface (per ADR-0179). Scope is now policed by **what may land** (the enumerated responsibilities below), not **how much it weighs**.

A companion script — `scripts/check-archivist-charter.sh` in the ruflo-patch repo — parses the machine-readable responsibilities block below, walks every `*.ts` file under `src/archivist/**` (excluding `*.test.ts` and `*.spec.ts`), and asserts each file carries a `// charter: <responsibility-name>` header tag matching a name in this charter. Files without a tag, or with a tag not on this list, fail the check. The script is wired into `npm run test:unit` and into the release pipeline's preflight stage per ADR-0180 §Governance. Adding or retiring a responsibility requires an ADR amendment landing **before** the matching source file change.

## In-scope responsibilities

The list below is the machine-readable contract. The fenced block parses to responsibility names only (one per line, kebab-case, no comments, no leading whitespace). Per-name descriptions follow outside the fence.

```charter-responsibilities
dispatch
audit-chain
type-enforcement
substrate-seam
guard-policy
testing-surface
hot-path-fast-path
mutation-invariants
lazy-init
replay-verification
```

**dispatch** — Receive caller intents from MCP tools, CLI commands, hooks, daemons, and inter-controller writes; route each to the matching `GuardedWrite<T>` / `GuardedRead<T, R>` registered handler. Includes registration machinery (`registerMutationHandler`, `registerReadHandler`) and the runtime backstop that asserts `MutationContext` / `ReadContext` is present.

**audit-chain** — Single audit log above substrate. One entry per logical mutation, transitioning `intent → applied | partial | failed | rejected`. Records generated IDs, intent-time timestamp, embedding-model identity, resolved substrate, post-normalization payload, guard verdicts, invariant verdicts. Per-file rotation at 100 MiB; configurable retention budgets; rotated files carry `floor.marker` so replay knows where the chain begins.

**type-enforcement** — Branded `SubstrateAccess` capability handle reachable only inside the archivist runtime; branded `GuardedWrite<T>` / `GuardedRead<T, R>` return types from registration HOFs; path-restricted `substrate-internal.ts` (tsconfig `paths` + ESLint `no-restricted-imports` for `better-sqlite3` and the `@ruvector/rvf` module outside `archivist/**`); test-utility allowlist closure + `no-substrate-singleton` ESLint rule banning module-scope retention of substrate handles.

**substrate-seam** — The single import boundary between the archivist and the underlying RVF / SQLite backends. Implements `makeFsJsonSubstrate` (lifted from hive-mind's `withHiveStoreLock` per ADR-0180 Phase 4) and the equivalent shape for RVF and the five SQLite carve-out controllers. Handlers receive `SubstrateAccess`; the seam is what makes that handle real.

**guard-policy** — Pluggable guard registration (`archivist.registerGuard`); five default guards (`size`, `quality`, `pii`, `schema`, `rate-limit`); verdict composition algebra (`veto > warn > pass`, all guards run, fail-closed on guard exceptions per `feedback-best-effort-must-rethrow-fatals`); discriminated `GuardVerdict` propagated via `MutationContext.guardVerdicts` so handlers can branch (skip-semantic-on-low-quality). Plugin guards namespaced `plugin-name/guard-name`; guards have no access to `SubstrateAccess`.

**testing-surface** — `@pkg/archivist/testing` entrypoint exporting `withTestContext`, `withTestReadContext`, `makeFsJsonSubstrateFixture`. Unresolvable under main `tsconfig.json`; resolvable under `tsconfig.test.json` allowlisted to `**/*.test.ts` and `**/*.spec.ts`. Four-view `TestResult` (flat `audit`, `auditTree` for re-entrancy, `bulkManifests` for bulk-mode, optional `hotPath`). Imports production branded types — not a parallel implementation.

**hot-path-fast-path** — Opt-in `registerMutationHandler(..., { hotPath: true })` registration for `post-edit` and `pre-task` hook writers. 256-entry single-producer in-flight queue + write-through journal + batched fsync ≤100ms; guards skipped; post-write triggers run via `setImmediate` and cannot block. Payloads >4KB divert to cold path. `ctx.child` and `withBulkWrite` typed `never` for hot-path contexts (compile-time enforced per §20 cross-mode constraints).

**mutation-invariants** — Per-handler declared predicates over `(callerIntent, recordedPayload, substrateStateBefore, substrateStateAfter)`. Evaluated at write-time BEFORE the audit entry transitions to `applied`; violation aborts the write and records `state: 'rejected', reason: 'invariant_violation'`. Closes the audit-replay tautology: replay re-evaluates invariants against the recorded pair, and live-vs-replayed verdict mismatches fail the §Confirmation gate. Invariants live in `archivist/invariants/<surface>/<handler>.ts`.

> **Footnote (ADR-0246 F-03-002 partial discharge, 2026-05-24)**: mutation-invariants are enforced today for FS-JSON-backed substrates only — the dispatch path stages FS-JSON writes (`staging-substrate.ts`) and only `commit()`s them after invariants pass. RVF-substrate enforcement is **pending** `freeze()` + rollback wiring into archivist dispatch (`RvfBackend.ts:freeze()` exists at `:594` but `grep "freeze" forks/agentdb/src/archivist/` returns zero hits today). The named follow-up will plumb real `substrateStateBefore` / `substrateStateAfter` for RVF substrates too; until then RVF-routed invariants run on `undefined` substrate args (well-formed-payload invariants still fire — the pre-fork zero-input guard, dimension checks, etc.). Per `[[feedback-best-effort-must-rethrow-fatals]]`, this is honest-gap, not silent-drift.

**lazy-init** — Per-tool initialization on first invocation; idle tools never load substrate. The archivist guarantees `initialize()` completes before any registered handler is invoked, replacing the per-store `requireAgentDB()` / `RvfNotInitializedError` "fail loud" pattern (ADR-0112 era; retired per ADR-0180 Follow-up #5 in Phase 10).

**replay-verification** — Replay the audit log against a freshly-initialized substrate and assert addressable-key set-equality + audit-tree depth ≤3 + no fanout amplification (per ADR-0180 §Confirmation). Tooling, not recovery: replay surfaces correctness regressions, it does not roll the live substrate back. Pairs with mutation-invariants to close the "handler recorded `foo` but wrote `bar`" gap.

## Explicitly out of scope

The archivist module deliberately does NOT own:

- **Substrate I/O implementations.** `better-sqlite3` calls, RVF N-API bindings, `fs.writeFileSync` for FS-JSON stores all live in `forks/agentdb/src/backends/**` (or `hive-mind-tools.ts` until Phase 4 lifts the primitive). The archivist consumes substrate via `SubstrateAccess` — it does not implement it.
- **Embedding-model selection.** Model identity is recorded in audit entries; choosing which model to invoke is a controller / store concern (see `Xenova/all-mpnet-base-v2` per memory `reference-embedding-model`).
- **Plugin store registration.** Third-party plugin-defined controllers register via the public extension API (ADR-0180 Follow-up #23, deferred); the archivist hosts the API but does not define plugin store semantics here.
- **Automatic compensating writes.** Per ADR-0180 §Transactions and partial failure: counter updates, autoincrement IDs, and downstream auto-promotion triggers cannot be cleanly inverted. Partial / failed entries surface via operator-visible alarm and remain in the audit chain as evidence; no automatic rollback.
- **Cross-process audit merging.** The archivist is per-process; CLI and daemon each carry their own instance (ADR-0180 Follow-up #15, currently option-c — per-process audit chains, replay is per-process).
- **Reference implementations for differential testing.** Deferred per ADR-0180 Follow-up #25 — the candidate set (`agentdb_filtered_search`, `SkillLibrary.consolidateEpisodesIntoSkills`, `NightlyLearner.run()`) ships only if a trigger fires (invariant-passing regression slips to production, Phase 9 load-test divergence, or ADR-0179 Phase 3 surfaces correctness bugs post-restoration).
- **Read-side TieredCache eviction policy.** ADR-0179 Follow-up #6 (TieredCache) integrates at the read-path boundary; the cache implementation itself sits in a separate module (per ADR-0180 Follow-up #24, deferred to TieredCache integration).
- **`@pkg/substrate-admin` migration / repair scripts.** Per ADR-0180 §Escape hatch: admin scripts import from a separate entrypoint allowlisted to `scripts/`, `migrations/`, `cli/admin/` via `tsconfig.admin.json`. They write synthetic audit entries but do not execute through the archivist runtime.
- **`@sparkleideas/cli-core` JsonMemoryBackend writes.** Path: `forks/ruflo/v3/@claude-flow/cli-core`. Non-archivist published surface per ADR-0180 Open Follow-up #9. Storage at `.swarm/memory.json` is storage-disjoint from RVF / SQLite carve-out substrates the archivist coordinates; cli-core writes never touch substrate the heavy stack reads. Three operational rules: (i) no claim of audit-chain completeness for `.swarm/memory.json` writes; (ii) plugin authors who need audit chain MUST use the heavy `@sparkleideas/cli` path (or `routeMemoryOp` directly), not cli-core; (iii) any future cli-core surface expansion that touches substrate beyond local JSON re-opens this disposition. See `@claude-flow/cli-core` README §"Non-archivist surface" for the plugin-author-facing operational doc.

## Adding or retiring a responsibility

The charter is the authoritative scope gate. The workflow:

1. **Propose an amendment** to ADR-0180 §Governance (or land a successor ADR that amends it) describing the new responsibility and its boundaries against existing ones.
2. **Land the ADR amendment** on `ruflo-patch/main` per ruflo-patch's normal PR flow. The implementation in `forks/agentdb` is trunk-only per `feedback-trunk-only-fork-development`; the amendment must be accepted before fork code lands.
3. **Update this `MODULE.md`** — add the responsibility name inside the `charter-responsibilities` fence (one new line, kebab-case) and add a matching description below the fence. Commit on `forks/agentdb` `main`.
4. **Source file headers** carrying the new `// charter: <name>` tag may then land. The mechanical check (`scripts/check-archivist-charter.sh`) will accept them because the name is now in the fence.

Retiring a responsibility runs the same loop in reverse: ADR amendment acceptance → remove the name from the fence (and its description) → migrate / remove source files carrying the retired tag. The mechanical check fails fast if a stale tag remains.

The committer can technically bypass `scripts/check-archivist-charter.sh` via `--no-verify`, but per CLAUDE.md this is forbidden absent explicit reason. Trunk-only solo-committer pattern means the script is the only structural enforcement; treat it as load-bearing.

## Cross-references

- **ADR-0180 §Architecture** (lines 83-224) — full architecture spec; this charter enforces a subset.
- **ADR-0180 §Governance** (line 134-136) — the charter-conformance contract this file fulfills.
- **ADR-0180 Open Follow-up #6** (lines 374-414) — guard verdict semantics; the `guard-policy` responsibility above.
- **ADR-0180 Open Follow-up #20** (lines 765-826) — testing surface; the `testing-surface` responsibility above.
- **ADR-0180 Open Follow-up #25** (lines 965-971) — reference-impl differential testing; deferred and explicitly out of scope.
- **ADR-0166** — permanent SQLite carve-out roster (5 controllers); informs substrate-seam scope.
- **ADR-0177** — RVF-primary decision; informs substrate-seam scope.
- **ADR-0179** — six lost features; informs the responsibilities `audit-chain`, `guard-policy`, plus the read-path features hosted at the boundary.
- **Memory `feedback-data-loss-zero-tolerance`** — no silent fall-through; informs the `audit-chain` and `mutation-invariants` rejection semantics.
- **Memory `feedback-trunk-only-fork-development`** — why the mechanical check is the only structural enforcement.
