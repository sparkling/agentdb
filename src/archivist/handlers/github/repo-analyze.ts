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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

export interface GithubRepoAnalyzePayload {
  readonly owner?: string;
  readonly repo?: string;
  readonly branch?: string;
  readonly deep?: boolean;
}

const STORE_ID = 'github' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the cli `github_repo_analyze` handler body
// here once the dispatch boundary is wired through cli. The cli's open-coded
// load → mutate `store.repos[repoKey]` → save sequence collapses to
// `ctx.substrate.withWrite` because the substrate primitive owns the lock
// semantics on the FS-JSON store at `.claude-flow/github/store.json`.
export const githubRepoAnalyzeHandler: GuardedWrite<GithubRepoAnalyzePayload> =
  registerMutationHandler<GithubRepoAnalyzePayload>(
    'github_repo_analyze',
    async (ctx: MutationContext<false>, _payload: GithubRepoAnalyzePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: github_repo_analyze handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/github-tools.ts github_repo_analyze handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
