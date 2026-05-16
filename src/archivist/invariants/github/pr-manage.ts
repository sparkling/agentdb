// charter: mutation-invariants
// github_pr_manage mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { GithubPrManagePayload } from '../../handlers/github/pr-manage.js';

export type { GithubPrManagePayload };

const VALID_ACTIONS = new Set(['list', 'create', 'review', 'merge', 'close']);
const TITLE_MAX = 500;
const BRANCH_MAX = 200;

/** action must be one of {list, create, review, merge, close}. */
const actionInEnum: Invariant<GithubPrManagePayload> = ({ recordedPayload }) => {
  if (!VALID_ACTIONS.has(recordedPayload.action as string)) {
    return { violated: true, detail: `action must be one of {list,create,review,merge,close}, got ${JSON.stringify(recordedPayload.action)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<GithubPrManagePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'` };
  }
  return 'pass';
};

/** prNumber, when present (review/merge/close), must be a positive integer. */
const prNumberPositive: Invariant<GithubPrManagePayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { prNumber?: unknown };
  if (p.prNumber === undefined) return 'pass';
  if (typeof p.prNumber !== 'number' || !Number.isFinite(p.prNumber) || !Number.isInteger(p.prNumber)) {
    return { violated: true, detail: `prNumber must be a finite integer, got ${String(p.prNumber)}` };
  }
  if (p.prNumber < 1) {
    return { violated: true, detail: `prNumber must be >= 1, got ${p.prNumber}` };
  }
  return 'pass';
};

/** title, when present (create), must be a non-empty string ≤500 chars. */
const titleBounded: Invariant<GithubPrManagePayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { title?: unknown };
  if (p.title === undefined) return 'pass';
  if (typeof p.title !== 'string' || p.title.length === 0) {
    return { violated: true, detail: `title must be a non-empty string when present, got ${typeof p.title}` };
  }
  if (p.title.length > TITLE_MAX) {
    return { violated: true, detail: `title length ${p.title.length} exceeds max ${TITLE_MAX}` };
  }
  return 'pass';
};

/** branch / baseBranch, when present, must be non-empty strings ≤200 chars. */
const branchBounded: Invariant<GithubPrManagePayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { branch?: unknown; baseBranch?: unknown };
  for (const k of ['branch', 'baseBranch'] as const) {
    const v = p[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length === 0) {
      return { violated: true, detail: `${k} must be a non-empty string when present, got ${typeof v}` };
    }
    if (v.length > BRANCH_MAX) {
      return { violated: true, detail: `${k} length ${v.length} exceeds max ${BRANCH_MAX}` };
    }
  }
  return 'pass';
};

export const prManageInvariants: ReadonlyArray<Invariant<GithubPrManagePayload>> = [
  actionInEnum,
  actionEquality,
  prNumberPositive,
  titleBounded,
  branchBounded,
];
