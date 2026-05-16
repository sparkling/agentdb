// charter: mutation-invariants
// github_issue_track mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Bad action / negative issueNumber / oversized labels would corrupt the local
// github store record.

import type { Invariant } from '../../registration.js';
import type { GithubIssueTrackPayload } from '../../handlers/github/issue-track.js';

export type { GithubIssueTrackPayload };

const VALID_ACTIONS = new Set(['list', 'create', 'update', 'close', 'assign']);
const TITLE_MAX = 500;
const BODY_MAX = 100_000;
const LABEL_MAX = 64;

/** action must be one of {list, create, update, close, assign}. */
const actionInEnum: Invariant<GithubIssueTrackPayload> = ({ recordedPayload }) => {
  if (!VALID_ACTIONS.has(recordedPayload.action as string)) {
    return { violated: true, detail: `action must be one of {list,create,update,close,assign}, got ${JSON.stringify(recordedPayload.action)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<GithubIssueTrackPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'` };
  }
  return 'pass';
};

/** issueNumber, when present (update/close/assign), must be a positive integer. */
const issueNumberPositive: Invariant<GithubIssueTrackPayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { issueNumber?: unknown };
  if (p.issueNumber === undefined) return 'pass';
  if (typeof p.issueNumber !== 'number' || !Number.isFinite(p.issueNumber) || !Number.isInteger(p.issueNumber)) {
    return { violated: true, detail: `issueNumber must be a finite integer, got ${String(p.issueNumber)}` };
  }
  if (p.issueNumber < 1) {
    return { violated: true, detail: `issueNumber must be >= 1, got ${p.issueNumber}` };
  }
  return 'pass';
};

/** title, when present (create/update), must be a non-empty string ≤500 chars. */
const titleBounded: Invariant<GithubIssueTrackPayload> = ({ recordedPayload }) => {
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

/** body, when present, must be a string ≤100KB. */
const bodyBounded: Invariant<GithubIssueTrackPayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { body?: unknown };
  if (p.body === undefined) return 'pass';
  if (typeof p.body !== 'string') {
    return { violated: true, detail: `body must be a string when present, got ${typeof p.body}` };
  }
  if (p.body.length > BODY_MAX) {
    return { violated: true, detail: `body length ${p.body.length} exceeds max ${BODY_MAX}` };
  }
  return 'pass';
};

/** labels, when present, must be an array of non-empty strings ≤64 chars each
 *  (cli `sanitizeLabels` cap). */
const labelsWellFormed: Invariant<GithubIssueTrackPayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { labels?: unknown };
  if (p.labels === undefined) return 'pass';
  if (!Array.isArray(p.labels)) {
    return { violated: true, detail: `labels must be an array, got ${typeof p.labels}` };
  }
  for (let i = 0; i < p.labels.length; i++) {
    const l = p.labels[i];
    if (typeof l !== 'string' || l.length === 0) {
      return { violated: true, detail: `labels[${i}] must be a non-empty string, got ${typeof l}` };
    }
    if (l.length > LABEL_MAX) {
      return { violated: true, detail: `labels[${i}] length ${l.length} exceeds max ${LABEL_MAX}` };
    }
  }
  return 'pass';
};

export const issueTrackInvariants: ReadonlyArray<Invariant<GithubIssueTrackPayload>> = [
  actionInEnum,
  actionEquality,
  issueNumberPositive,
  titleBounded,
  bodyBounded,
  labelsWellFormed,
];
