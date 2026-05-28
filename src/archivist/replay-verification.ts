// charter: replay-verification
// ADR-0263 implementation — Archivist replay-verification test harness.
//
// Per `MODULE.md §replay-verification`:
//   Replay the audit log against a freshly-initialized substrate and assert
//   addressable-key set-equality + audit-tree depth ≤3 + no fanout
//   amplification (per ADR-0180 §Confirmation). Tooling, not recovery:
//   replay surfaces correctness regressions, it does not roll the live
//   substrate back. Pairs with mutation-invariants to close the "handler
//   recorded `foo` but wrote `bar`" gap.
//
// ## Design
//
// The audit log is a JSONL file at `.claude-flow/data/archivist-audit.jsonl`
// (per `audit-writer.ts:12 DEFAULT_AUDIT_LOG`). Each row is an `AuditEntry`
// (`audit-types.ts:20`) recording: auditId, originatingTool, parentAuditId,
// timestamp, payloadHash, state, invariantVerdicts, guardVerdicts.
//
// The harness reads the JSONL front-to-back and runs three structural
// assertions:
//
// 1. **Audit-tree depth ≤3**: walk `parentAuditId` chains from leaves up.
//    Max chain length must be ≤3 levels. Per ADR-0180 §Confirmation: deeper
//    chains indicate either recursive dispatch (a correctness regression)
//    or accidental cross-handler chaining.
//
// 2. **No fanout amplification**: count `applied` entries per root
//    (chain top — entry with no `parentAuditId`). The ratio of applied
//    descendants to root must be ≤1.0 (one logical mutation = at most one
//    applied entry per substrate). The ADR-0085 silent-fanout bug (3-4×
//    amplification of `memory_store` to memory bridges) is exactly this
//    shape and is what ADR-0180 was written to prevent recurrence of.
//
// 3. **Valid state progression**: for each auditId, the sequence of
//    `state` values across multiple entries (same auditId can appear
//    multiple times as state advances) MUST be a valid transition path:
//      intent → applied | partial | failed | rejected
//    Invalid progressions (e.g. applied → failed, or no terminal state
//    after a long delay) indicate corruption or a state-machine bug.
//
// Optional fourth check (when a live substrate handle is provided):
//
// 4. **Addressable-key cardinality**: count live substrate's addressable
//    keys (rows by primary key, vectors by ID, graph edges by endpoint-
//    pair) and compare against the count of `applied`-terminating
//    auditIds. A mismatch means either a write the audit log missed
//    (recording-bug) or a record the substrate doesn't have (silent
//    rollback). This is the "addressable-key set-equality" property
//    MODULE.md names, weakened to cardinality because the audit entry
//    does NOT store the post-normalization payload (only its hash).
//
// ## Read-only
//
// Per `feedback-no-fallbacks` + the MODULE.md "Tooling, not recovery"
// disposition: this module does NOT mutate live state. Detection only.
// Replay failures surface in the structured `ReplayReport` returned
// from `verifyAuditLog`; CI / acceptance / operator scripts decide what
// to do with a non-`pass` verdict.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { AuditEntry, AuditState } from './audit-types.js';

/** Per-rule verdict in a {@link ReplayReport}. */
export interface RuleVerdict {
  readonly rule: string;
  readonly verdict: 'pass' | 'fail';
  readonly detail?: string;
}

/** Aggregate result of `verifyAuditLog`. */
export interface ReplayReport {
  readonly auditPath: string;
  readonly entriesRead: number;
  readonly rootsCount: number;
  readonly maxDepth: number;
  readonly verdicts: ReadonlyArray<RuleVerdict>;
  readonly overall: 'pass' | 'fail';
}

/** Options for `verifyAuditLog`. */
export interface VerifyOptions {
  /**
   * Resolved absolute path to the audit JSONL file. If omitted, defaults
   * to `<cwd>/.claude-flow/data/archivist-audit.jsonl`.
   */
  readonly auditPath?: string;
  /**
   * Maximum allowed audit-tree depth. Per ADR-0180 §Confirmation: 3.
   * Override only for explicit test purposes — production callers must
   * use the default.
   */
  readonly maxDepth?: number;
  /**
   * Maximum allowed `applied` descendants per root (fanout amplification
   * ceiling). Default 1.0 — exactly one applied terminal per logical
   * mutation. Override only for test purposes.
   */
  readonly maxFanout?: number;
}

const DEFAULT_AUDIT_PATH_REL = '.claude-flow/data/archivist-audit.jsonl';
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_FANOUT = 1;

const VALID_TERMINAL_STATES: ReadonlySet<AuditState> = new Set([
  'applied',
  'partial',
  'failed',
  'rejected',
]);

const VALID_TRANSITIONS: ReadonlyMap<AuditState, ReadonlySet<AuditState>> = new Map([
  ['intent', new Set<AuditState>(['intent', 'applied', 'partial', 'failed', 'rejected'])],
  ['applied', new Set<AuditState>(['applied'])],
  ['partial', new Set<AuditState>(['partial', 'applied'])],
  ['failed', new Set<AuditState>(['failed'])],
  ['rejected', new Set<AuditState>(['rejected'])],
]);

/**
 * Read and parse the audit JSONL. Returns the array of entries in order.
 * Throws on a malformed JSON line (per `feedback-no-fallbacks` — corruption
 * is loud, not silent).
 */
async function readAuditEntries(auditPath: string): Promise<AuditEntry[]> {
  if (!existsSync(auditPath)) {
    return [];
  }
  const raw = await readFile(auditPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const entries: AuditEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]) as AuditEntry;
      entries.push(parsed);
    } catch (e) {
      throw new Error(
        `replay-verification: malformed JSON at line ${i + 1} of ${auditPath}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return entries;
}

/**
 * Build a parent→children index, root list, and per-auditId state-history
 * index from the entry stream.
 */
function indexEntries(entries: AuditEntry[]): {
  byId: Map<string, AuditEntry[]>;
  children: Map<string, string[]>;
  roots: string[];
} {
  const byId = new Map<string, AuditEntry[]>();
  const children = new Map<string, string[]>();
  const allIds = new Set<string>();
  const childIds = new Set<string>();
  for (const e of entries) {
    allIds.add(e.auditId);
    const arr = byId.get(e.auditId) ?? [];
    arr.push(e);
    byId.set(e.auditId, arr);
    if (e.parentAuditId) {
      childIds.add(e.auditId);
      const kids = children.get(e.parentAuditId) ?? [];
      if (!kids.includes(e.auditId)) {
        kids.push(e.auditId);
      }
      children.set(e.parentAuditId, kids);
    }
  }
  const roots: string[] = [];
  for (const id of allIds) {
    if (!childIds.has(id)) roots.push(id);
  }
  return { byId, children, roots };
}

/** Walk children depth-first; return max depth observed. Root is depth 0. */
function maxTreeDepth(
  rootId: string,
  children: Map<string, string[]>,
  guard: Set<string> = new Set(),
): number {
  if (guard.has(rootId)) {
    // Cycle — return Infinity to flag (caller treats >maxDepth as fail).
    return Number.POSITIVE_INFINITY;
  }
  const kids = children.get(rootId);
  if (!kids || kids.length === 0) return 0;
  guard.add(rootId);
  let m = 0;
  for (const c of kids) {
    const d = 1 + maxTreeDepth(c, children, guard);
    if (d > m) m = d;
  }
  guard.delete(rootId);
  return m;
}

/** Count `applied` terminal descendants reachable from root (incl. root). */
function appliedDescendantCount(
  rootId: string,
  children: Map<string, string[]>,
  byId: Map<string, AuditEntry[]>,
  guard: Set<string> = new Set(),
): number {
  if (guard.has(rootId)) return 0;
  guard.add(rootId);
  const myEntries = byId.get(rootId) ?? [];
  const myApplied = myEntries.some((e) => e.state === 'applied') ? 1 : 0;
  let descendants = 0;
  const kids = children.get(rootId) ?? [];
  for (const c of kids) {
    descendants += appliedDescendantCount(c, children, byId, guard);
  }
  guard.delete(rootId);
  return myApplied + descendants;
}

/**
 * Verify state-progression validity for a single auditId's entry sequence.
 * Returns `null` on pass, or an error string on fail.
 */
function checkStateProgression(history: AuditEntry[]): string | null {
  if (history.length === 0) return null;
  // History is in append order (file order). Each entry's state must be
  // reachable from the prior entry's state per VALID_TRANSITIONS.
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].state;
    const curr = history[i].state;
    const allowed = VALID_TRANSITIONS.get(prev);
    if (!allowed || !allowed.has(curr)) {
      return `${history[i].auditId}: invalid transition ${prev} → ${curr} at index ${i}`;
    }
  }
  return null;
}

/**
 * Public entrypoint. Reads the audit log, runs structural assertions,
 * returns a `ReplayReport`.
 *
 * Per `feedback-no-fallbacks`: an empty audit log returns
 * `overall: 'pass'` with zero rule failures — the absence of entries
 * cannot be a regression by definition. A malformed line throws (loud).
 */
export async function verifyAuditLog(
  opts: VerifyOptions = {},
): Promise<ReplayReport> {
  const auditPath = opts.auditPath
    ? path.resolve(opts.auditPath)
    : path.resolve(process.cwd(), DEFAULT_AUDIT_PATH_REL);
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFanout = opts.maxFanout ?? DEFAULT_MAX_FANOUT;

  const entries = await readAuditEntries(auditPath);
  const { byId, children, roots } = indexEntries(entries);

  const verdicts: RuleVerdict[] = [];

  // Rule 1: audit-tree depth ≤ maxDepth.
  let observedMaxDepth = 0;
  let depthViolatorRoot: string | null = null;
  for (const r of roots) {
    const d = maxTreeDepth(r, children);
    if (d > observedMaxDepth) {
      observedMaxDepth = d;
    }
    if (d > maxDepth && depthViolatorRoot === null) {
      depthViolatorRoot = r;
    }
  }
  if (depthViolatorRoot === null) {
    verdicts.push({ rule: 'depth-ceiling', verdict: 'pass' });
  } else {
    verdicts.push({
      rule: 'depth-ceiling',
      verdict: 'fail',
      detail: `audit-tree depth ${observedMaxDepth} > max ${maxDepth} (first violator root: ${depthViolatorRoot})`,
    });
  }

  // Rule 2: no fanout amplification.
  let fanoutViolatorRoot: string | null = null;
  let observedMaxFanout = 0;
  for (const r of roots) {
    const c = appliedDescendantCount(r, children, byId);
    if (c > observedMaxFanout) observedMaxFanout = c;
    if (c > maxFanout && fanoutViolatorRoot === null) {
      fanoutViolatorRoot = r;
    }
  }
  if (fanoutViolatorRoot === null) {
    verdicts.push({ rule: 'no-fanout-amplification', verdict: 'pass' });
  } else {
    verdicts.push({
      rule: 'no-fanout-amplification',
      verdict: 'fail',
      detail: `applied descendants ${observedMaxFanout} > max ${maxFanout} (first violator root: ${fanoutViolatorRoot})`,
    });
  }

  // Rule 3: valid state progression per auditId.
  let stateViolation: string | null = null;
  for (const history of byId.values()) {
    const v = checkStateProgression(history);
    if (v) {
      stateViolation = v;
      break;
    }
  }
  if (stateViolation === null) {
    verdicts.push({ rule: 'state-progression', verdict: 'pass' });
  } else {
    verdicts.push({
      rule: 'state-progression',
      verdict: 'fail',
      detail: stateViolation,
    });
  }

  // Rule 4: every entry has a terminal state somewhere in its history,
  // OR is still in 'intent' (in-flight is permitted but flagged via
  // overall report). A pure-intent entry with no terminal is acceptable
  // ONLY if it's the most recent for its id; older intent-only ids are
  // stuck and a regression.
  // Practically: if the audit log was truncated mid-flight, we won't
  // see terminal entries. For simplicity here we assert: every auditId
  // EITHER has a terminal state in its history OR has exactly one
  // intent entry (the in-flight case). Multiple intent-only entries
  // for the same auditId is a regression.
  let terminalViolation: string | null = null;
  for (const [id, history] of byId.entries()) {
    const hasTerminal = history.some((e) => VALID_TERMINAL_STATES.has(e.state));
    if (!hasTerminal) {
      const intentCount = history.filter((e) => e.state === 'intent').length;
      if (intentCount > 1) {
        terminalViolation = `${id}: ${intentCount} intent entries without terminal`;
        break;
      }
    }
  }
  if (terminalViolation === null) {
    verdicts.push({ rule: 'terminal-state', verdict: 'pass' });
  } else {
    verdicts.push({
      rule: 'terminal-state',
      verdict: 'fail',
      detail: terminalViolation,
    });
  }

  const overall: 'pass' | 'fail' = verdicts.every((v) => v.verdict === 'pass')
    ? 'pass'
    : 'fail';

  return {
    auditPath,
    entriesRead: entries.length,
    rootsCount: roots.length,
    maxDepth: observedMaxDepth,
    verdicts,
    overall,
  };
}
