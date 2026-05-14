// charter: dispatch
// github_workflow mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<GithubWorkflowPayload>` because two of its four
// actions mutate state (`trigger`, `cancel` — both invoke side-effecting
// `gh workflow run` / `gh run cancel` against the GitHub Actions runner)
// and the remaining two (`list`, `status`) are dispatched through the
// mutation surface for audit-chain uniformity (per ADR-0180 §Audit chain:
// when a tool's actions are mixed read/write the canonical surface is the
// mutation handler).
//
// Pre-existing CLI surface: `cli/src/mcp-tools/github-tools.ts` `github_workflow`
// handler — internal switch on `action` invoking `gh run list`, `gh workflow list`,
// `gh run view`, `gh workflow run --ref`, `gh run cancel`. No FS-JSON store
// is persisted by this tool — the audit surface is the only fork-side
// state. Even so, the dispatch surface still routes through
// `makeFsJsonSubstrate` (lifted from hive-mind per ADR-0180 Phase 4) so the
// substrate-seam invariant holds (`ctx.substrate.withWrite` is the only
// path through which audit entries land — `gh`-side state mutations are
// recorded in the audit chain regardless of whether a local store is
// touched). The cli callsite stays in place until Phase 7+ removes the
// legacy path.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Mutation payload — discriminated by `action`. Mirrors the four action
 *  branches at cli `github_workflow`. `workflowId` carries the same
 *  `validateIdentifier` constraint as the cli (regex-bound), expressed
 *  here as an opaque string; the Phase 5 wire-up moves the regex into an
 *  invariant per ADR-0180 §Mutation invariants. */
export type GithubWorkflowPayload =
  | { readonly action: 'list'; readonly owner?: string; readonly repo?: string }
  | {
      readonly action: 'status';
      readonly workflowId?: string;
      readonly owner?: string;
      readonly repo?: string;
    }
  | {
      readonly action: 'trigger';
      readonly workflowId: string;
      readonly ref?: string;
      readonly owner?: string;
      readonly repo?: string;
    }
  | {
      readonly action: 'cancel';
      readonly workflowId: string;
      readonly owner?: string;
      readonly repo?: string;
    };

const STORE_ID = 'github' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of cli `github_workflow`
// handler once the dispatch boundary is wired through cli. The cli's
// open-coded `runArgv('gh', ['workflow', 'run', ...])` /
// `runArgv('gh', ['run', 'cancel', ...])` callsites are recorded in the
// audit chain — `ctx.substrate.withWrite` is the only path through which
// the gh-side mutation lands an audit entry, even though the fork-side
// FS-JSON store at `.claude-flow/github/store.json` is not persisted by
// this tool (only `github_repo_analyze` / `github_pr_manage` /
// `github_issue_track` touch the local store).
export const githubWorkflowHandler: GuardedWrite<GithubWorkflowPayload> =
  registerMutationHandler<GithubWorkflowPayload>(
    'github_workflow',
    async (ctx: MutationContext<false>, payload: GithubWorkflowPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          `archivist: github_workflow (action=${payload.action}) handler body pending Phase 5 wire-up; ` +
          `callers currently route through cli/src/mcp-tools/github-tools.ts github_workflow handler`,
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
