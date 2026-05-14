# Reference-Implementation Differential Testing — Decision

**Status**: DEFER
**Date**: 2026-05-14
**ADR**: [ADR-0180](../../../../../ruflo-patch/docs/adr/ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.md) Open Follow-up #25
**Phase**: 9 (load testing complete; structural scenarios A/B/C passed)

## Candidate Surfaces

Three high-risk handlers were identified in ADR-0180 §Follow-up #25 as candidates for reference-impl differential testing on the §Confirmation gate:

1. **`agentdb_filtered_search`** — BM25 + semantic fusion. Most complex read-path logic per ADR-0179. Risk: scoring drift between live + replayed runs masked by identically-wrong outputs at registration time.
2. **`SkillLibrary.consolidateEpisodesIntoSkills`** — Running-average updates over skill weights. Risk: non-invertible reductions (per §Transactions); a wrong reduction shape passes invariants because invariants only check shape/range, not derivation.
3. **`NightlyLearner.run()`** — Re-entrant cascade per Phase 9 Scenario A. Risk: emergent ordering bugs in multi-step rollups invisible to per-step invariants.

Remaining ~110 handlers: explicitly out of scope. Invariants are sufficient for them.

## Decision: DEFER

The mutation-invariants gate (second correctness gate per ADR-0180 §Architecture) is the primary defense. Reference impls are escalation, not baseline. Doubling per-handler implementation cost for three surfaces is only justified once a concrete trigger fires.

## Triggers to Re-evaluate

Per ADR-0180 §Follow-up #25:

- **(a)** An invariant-passing handler regression slips to production and corrupts substrate state in a way replay didn't catch at one of the three surfaces.
- **(b)** Phase 9 (or later) load tests reveal divergence between expected and observed mutation patterns at one of the three surfaces.
- **(c)** ADR-0179 Phase 3 restoration surfaces correctness bugs in the six lost features post-restoration — reference impls become the validation surface for the restored handler.

## State as of 2026-05-14

- Phase 9 scenarios A (NightlyLearner re-entrant cascade), B, C: **passed structurally**. No observed divergence between expected and observed mutation patterns.
- Trigger (a): not fired — no invariant-passing production regression.
- Trigger (b): not fired — Phase 9 load tests show convergence.
- Trigger (c): not fired — ADR-0179 Phase 3 restoration not yet executed.

Default holds: **defer**.

## Re-evaluation Cadence

- **Every Phase 9-class load test pass**: re-check trigger (b) against fresh metrics on the three surfaces. If divergence emerges at any one, escalate that surface to reference-impl.
- **Every ADR-0179 restoration milestone**: re-check trigger (c) when each of the six lost features is restored. Correctness bugs surfacing at one of the three candidate surfaces during restoration escalates that surface.
- **Any production incident touching the three surfaces**: re-check trigger (a) immediately; do not wait for the next scheduled review.

Escalation is per-surface. Triggering on one surface does not commit the other two.

## What This Directory Contains

This directory currently holds only this DECISION.md. No reference implementations are shipped. If a trigger fires, the escalated surface gets `<surface>/<handler>.ts` here, path-restricted to `test/**` consumers per ADR-0180 §Follow-up #25 (not exported from the package).
