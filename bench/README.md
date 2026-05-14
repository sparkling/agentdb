# archivist bench harness — Phase 2 baseline

Performance baseline for ADR-0180 (thin memory coordinator with type-enforced
mutation handlers). Five workloads with explicit regression bands gate the
phase-3+ archivist roll-out.

## Quick start

```bash
# Run all five benches (Node 24 strips types natively):
node --test bench/*.bench.ts

# Run one bench:
node --test bench/cold-single.bench.ts
```

## Workloads

| ID  | File                  | Iter   | Band                                                         | Stage in `npm run release` |
| --- | --------------------- | ------ | ------------------------------------------------------------ | -------------------------- |
| W1  | `cold-single.bench.ts`| 1,000  | p50 ≤ 1.3× baseline, p99 ≤ 1.5× (hard-fail at p99 > 2.0×)    | preflight                  |
| W2  | `cold-bulk.bench.ts`  |   200* | p50 ≤ 1.2× baseline, p99 ≤ 1.5×                              | preflight                  |
| W3  | `hot-path.bench.ts`   | 10,000 | absolute: p50 < 300 µs, p99 < 2 ms, p999 < 5 ms              | acceptance**               |
| W4  | `read-cache.bench.ts` |  2,000 | cache-hit p50 ≥ 10× miss p50 (same-run ratio)                | preflight                  |
| W5  | `cascade.bench.ts`    |    500 | p99 ≤ 1.5× baseline, audit-tree depth ≤ 3                    | preflight                  |

\* outer iterations × bulk size 50 = 10k row-writes total
\** W3 is too slow (≈30s) for preflight; runs in the acceptance stage instead.
W1 + W3 also run inside `npm run test:unit` as fast feedback during phase work.

W3_contended (multi-process p99 ≤ 5 ms ceiling per Follow-up #13) shares the
W3 harness — parent script spawns 4 writer processes against the same journal.
Phase 5 adds a top-level `phase_5_contention` block to `baseline.json`
recording `lockWaits_per_mutation_ratio` + `max_lock_wait_ms`.

## Baseline file

`baseline.json` is a single JSON object keyed by stable measurement ID, NOT
an append log. Phase 2 writes the `env` block + `workloads.W1-W5`. Subsequent
phases re-run all workloads pre-release and overwrite the file; `passed:
false` blocks release.

Bumping `schemaVersion` (currently 1) invalidates the file and requires a
re-baseline gated by ADR amendment.

`env` mismatch between baseline capture and current run produces a WARN log
but does not fail — dev machine + CI machine differ deliberately.

## Phase 2 status

The archivist module is NOT wired yet. Each bench includes a `TODO(Phase N)`
comment at the stub call site so the wiring is grep-able:

```bash
grep -n 'TODO(Phase' bench/*.bench.ts
```

Phase 2 numbers in `baseline.json` are placeholders (zeros + band metadata).
Phase 3 must overwrite W1 + W3 with real post-archivist measurements before
release.

## Notes

- No third-party perf dep — Node built-in test runner + `performance.now()`
  histograms (p50 / p99 / p999).
- Each bench owns its tempdir under `os.tmpdir()` and cleans up in `finally`.
- A 50-iter (W1) / 10-outer (W2) / 200-iter (W3) / pre-warm (W4) / 20-outer
  (W5) warmup is discarded to stabilize JIT and fs-cache state.
