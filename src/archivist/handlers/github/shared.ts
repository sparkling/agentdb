// charter: dispatch
// Shared store shape + storeId for the archivist github_* mutation handlers
// (ADR-0180 Phase 5).
//
// The cli surface (`cli/src/mcp-tools/github-tools.ts`) persists repo / PR /
// issue records into ONE FS-JSON file — `.claude-flow/github/store.json` — via
// `loadGitHubStore` / `saveGitHubStore`. `github_repo_analyze`, `github_pr_manage`
// and `github_issue_track` all read-modify-write that single document; they
// therefore share one `StoreId` ('github') so the substrate routes all three to
// the same file + lock. The path override that pins 'github' to the cli's
// `github/store.json` layout lives in `substrate-registry.ts`
// `FS_JSON_PATH_OVERRIDES`.
//
// `github_workflow` touches NO local store (only `gh`-side state) — it has no
// read-modify-write step and is NOT un-stubbed in Phase 2 (carry-forward).
//
// Document shape mirrors `github-tools.ts` `GitHubStore` exactly so consumers of
// `github/store.json` see no contract change once the dispatch path takes over.

import type { StoreId } from '../../index.js';

/** `.claude-flow/github/store.json` — shared by repo-analyze / pr-manage / issue-track. */
export const GITHUB_STORE_ID = 'github' as StoreId;

/** Repo analysis record — mirrors github-tools.ts `RepoInfo`. */
export interface GithubRepoInfo {
  owner: string;
  name: string;
  branch: string;
  lastAnalyzed?: string;
  metrics?: {
    commits: number;
    branches: number;
    contributors: number;
    openIssues: number;
    openPRs: number;
  };
}

/** PR record — mirrors github-tools.ts `GitHubStore['prs']` value shape. */
export interface GithubPrRecord {
  id: string;
  title: string;
  status: string;
  branch: string;
  createdAt: string;
}

/** Issue record — mirrors github-tools.ts `GitHubStore['issues']` value shape. */
export interface GithubIssueRecord {
  id: string;
  title: string;
  status: string;
  labels: string[];
  createdAt: string;
}

/** Whole-document shape — mirrors github-tools.ts `GitHubStore`. */
export interface GitHubStore {
  repos: Record<string, GithubRepoInfo>;
  prs: Record<string, GithubPrRecord>;
  issues: Record<string, GithubIssueRecord>;
  version: string;
}

/** Empty store — mirrors `loadGitHubStore`'s `{ repos:{}, prs:{}, issues:{}, version:'3.0.0' }`. */
export function emptyGitHubStore(): GitHubStore {
  return { repos: {}, prs: {}, issues: {}, version: '3.0.0' };
}
