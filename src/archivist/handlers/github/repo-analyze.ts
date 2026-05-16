// charter: dispatch
// github_repo_analyze mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<GithubRepoAnalyzePayload>` so every analysis transitions
// through the archivist's audit chain (intent → applied | rejected) with guard
// verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/github-tools.ts` `github_repo_analyze`
// handler — invokes `git rev-list`, `gh issue list`, etc., then persists the
// computed `RepoInfo` to `.claude-flow/github/store.json` via `saveGitHubStore`.
// The FS-JSON store is backed by `makeFsJsonSubstrate` (lifted from hive-mind's
// `withHiveStoreLock` per ADR-0180 Phase 4); the cli's open-coded
// `readFileSync` + `writeFileSync` collapses to a single
// `ctx.substrate.withWrite` because the substrate primitive owns the lock
// semantics. The cli callsite stays in place until Phase 7+ removes the legacy
// path.
//
// Type-enforcement: returning `GuardedWrite<GithubRepoAnalyzePayload>` from
// `registerMutationHandler` produces a branded value that the store barrel's
// `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` typing accepts.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import { repoAnalyzeInvariants } from '../../invariants/github/repo-analyze.js';
import {
  GITHUB_STORE_ID,
  emptyGitHubStore,
  type GitHubStore,
  type GithubRepoInfo,
} from './shared.js';

/** Mutation payload — the computed analysis record to persist.
 *
 *  The cli `github_repo_analyze` handler runs `git rev-list` / `gh issue list`
 *  / etc. to COMPUTE a `RepoInfo` and the `repoKey` (`${owner}/${repo}`), then
 *  does `store.repos[repoKey] = repoInfo; saveGitHubStore(store)`. The git/gh
 *  shell-out + the `repoKey` derivation stay on the cli side; this handler owns
 *  the persistence step only (matching the progress_sync substrate-seam scope),
 *  so the already-computed `repoKey` + `repoInfo` arrive in the payload. */
export interface GithubRepoAnalyzePayload {
  readonly repoKey: string;
  readonly repoInfo: GithubRepoInfo;
}

const STORE_ID = GITHUB_STORE_ID;

// The cli's open-coded `loadGitHubStore() → store.repos[repoKey] = repoInfo →
// saveGitHubStore()` sequence collapses to a single `ctx.substrate.withWrite`
// because the FS-JSON substrate owns the lock + atomic-write semantics on
// `.claude-flow/github/store.json`. The cli callsite stays in place until the
// dispatch boundary is wired through cli (Phase 7+).
export const githubRepoAnalyzeHandler: GuardedWrite<GithubRepoAnalyzePayload> =
  registerMutationHandler<GithubRepoAnalyzePayload>(
    'github_repo_analyze',
    async (ctx: MutationContext<false>, payload: GithubRepoAnalyzePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<GitHubStore>({ storeId: STORE_ID, key: 'root' });
        const store: GitHubStore = current ?? emptyGitHubStore();

        store.repos[payload.repoKey] = payload.repoInfo;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: repoAnalyzeInvariants,
      cacheScope: 'store',
    },
  );
