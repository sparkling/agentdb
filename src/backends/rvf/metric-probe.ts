// ADR-0246 F-03-001: probe-and-reseat metric on every RVF open*().
// The constructor-supplied `metricType` (defaulting to `'cosine'`) is correct
// for `create()` paths but DROPS THE PERSISTED METRIC on every `open()` /
// `load()` / `openReadonly()`. `distanceToSimilarity()` then scores `1 - distance`
// for cosine when the underlying store is actually `l2`, returning `2cos − 1`
// instead of `cos` for unit-normalized vectors — invisible to rank-only checks
// but threshold-gated callers see corrupted scores.
//
// Strategy per ADR-0246 supermajority improvement #1:
//   - Probe the persisted metric via the substrate's read-back surface.
//   - Default behaviour is REVALUE — `metricType` is reseated from the persisted
//     value, regardless of what the caller passed (no fail-loud for default
//     callers).
//   - Fail-loud ONLY when the caller explicitly passed `config.metric` (i.e.,
//     non-default) AND the persisted store metric disagrees. The "explicit"
//     signal is supplied by the call site (RvfBackend stores it on
//     `constructor`; SqlJsRvfBackend likewise).
//
// The shape is repeated across three call sites (RvfBackend init/load/openReadonly
// plus SqlJsRvfBackend load), so it lives in this helper.

type RvfMetricLiteral = 'cosine' | 'l2' | 'ip';

/**
 * Read back the persisted metric from the substrate, reconcile against any
 * caller-supplied explicit metric, and return the metric to seat on the
 * backend.
 *
 * @param probedMetric        The value read back from the substrate.
 *                            `undefined` means the substrate has no
 *                            queryable metric surface (most likely the
 *                            `@ruvector/rvf` SDK 0.2.x with no `metric()`
 *                            method) — in that case the caller-supplied value
 *                            stays in force.
 * @param callerExplicit      The metric the caller passed via `config.metric`
 *                            in the constructor — only when non-undefined
 *                            (i.e., explicitly supplied, not defaulted to
 *                            `'cosine'`). Used for the fail-loud branch.
 * @param storeIdHint         Short label for the throw message (the storage
 *                            path or backend name).
 * @returns                   The metric to seat on the backend's `metricType`.
 *                            On fail-loud divergence, throws instead.
 */
export function probeAndSeatMetric(
  probedMetric: RvfMetricLiteral | string | undefined,
  callerExplicit: RvfMetricLiteral | undefined,
  storeIdHint: string,
): RvfMetricLiteral {
  // Normalize SDK-side `dotproduct` to the AgentDB-side `ip`.
  const probed =
    probedMetric === 'dotproduct'
      ? ('ip' as RvfMetricLiteral)
      : (probedMetric as RvfMetricLiteral | undefined);

  if (probed === undefined) {
    // Substrate exposes no metric surface — leave the caller-supplied (or
    // defaulted) value in force. Default `'cosine'` is the documented choice.
    return callerExplicit ?? 'cosine';
  }

  if (callerExplicit !== undefined && callerExplicit !== probed) {
    // Caller passed an explicit non-default metric AND it disagrees with the
    // persisted store — fail loud per `feedback-no-fallbacks`. Silently
    // seating either side would corrupt scoring (`distanceToSimilarity`
    // depends on the metric branch).
    throw new Error(
      `RvfBackend: caller-supplied metric='${callerExplicit}' disagrees with ` +
        `persisted store metric='${probed}' at '${storeIdHint}'. ` +
        `Persisted-store metric wins on reopen (ADR-0246 F-03-001); pass the ` +
        `correct metric or open with the default to reseat from the store.`,
    );
  }

  return probed;
}
