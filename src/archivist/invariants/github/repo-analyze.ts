// charter: mutation-invariants
// github_repo_analyze mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { GithubRepoAnalyzePayload } from '../../handlers/github/repo-analyze.js';

export type { GithubRepoAnalyzePayload };

const REPO_KEY_MAX = 500;

/** repoKey must be a non-empty string ≤500 chars (cli format: `${owner}/${repo}`). */
const repoKeyWellFormed: Invariant<GithubRepoAnalyzePayload> = ({ recordedPayload }) => {
  const k = recordedPayload.repoKey;
  if (typeof k !== 'string' || k.length === 0) {
    return { violated: true, detail: `repoKey must be a non-empty string, got ${typeof k} length=${(k as string)?.length ?? 0}` };
  }
  if (k.length > REPO_KEY_MAX) {
    return { violated: true, detail: `repoKey length ${k.length} exceeds max ${REPO_KEY_MAX}` };
  }
  return 'pass';
};

/** repoKey identity — TAUTOLOGY TODAY. */
const repoKeyEquality: Invariant<GithubRepoAnalyzePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.repoKey !== recordedPayload.repoKey) {
    return { violated: true, detail: `repoKey divergence: intent='${callerIntent.repoKey}' recorded='${recordedPayload.repoKey}'` };
  }
  return 'pass';
};

/** repoInfo must be an object with non-empty owner/name. */
const repoInfoWellFormed: Invariant<GithubRepoAnalyzePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.repoInfo;
  if (!r || typeof r !== 'object') {
    return { violated: true, detail: `repoInfo must be an object, got ${typeof r}` };
  }
  if (typeof r.owner !== 'string' || r.owner.length === 0) {
    return { violated: true, detail: `repoInfo.owner must be a non-empty string` };
  }
  if (typeof r.name !== 'string' || r.name.length === 0) {
    return { violated: true, detail: `repoInfo.name must be a non-empty string` };
  }
  return 'pass';
};

export const repoAnalyzeInvariants: ReadonlyArray<Invariant<GithubRepoAnalyzePayload>> = [
  repoKeyWellFormed,
  repoKeyEquality,
  repoInfoWellFormed,
];
