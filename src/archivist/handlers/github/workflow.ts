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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { workflowInvariants } from '../../invariants/github/workflow.js';

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

// F4-2 body: the gh-process subprocess invocations stay cli-side (the
// `runArgv('gh', ...)` calls in `cli/src/mcp-tools/github-tools.ts`
// `github_workflow` at lines 481-535 — `gh run list`, `gh workflow list`,
// `gh run view`, `gh workflow run --ref`, `gh run cancel`). Per the registry
// note (substrate-registry.ts:203) `github_workflow` touches no local store —
// only `github_repo_analyze` / `github_pr_manage` / `github_issue_track` do.
// So this handler opens the `withWrite` scope ONLY to anchor the audit-chain
// entry (intent → applied) for the gh-side mutation; no `handle.write` is
// invoked because there is no fork-side document to update. This matches the
// audit-uniformity discipline of ADR-0180 §Audit chain (mixed read/write
// tools surface as one mutation handler so trigger/cancel land an audit entry
// alongside list/status which also flow through the surface).
//
// `feedback-no-fallbacks`: the cli wrapper validates `owner` / `repo` /
// `workflowId` / `ref` via `validateIdentifier` and surfaces validation errors
// in its own envelope (`{ success: false, error }`) before any dispatch lands;
// the handler does NOT re-validate because the cli boundary is the only
// caller and a re-check here would duplicate the cli's invariants-author
// surface (Phase 5 brief: invariants land in the registration metadata, not
// in handler bodies).
export const githubWorkflowHandler: GuardedWrite<GithubWorkflowPayload> =
  registerMutationHandler<GithubWorkflowPayload>(
    'github_workflow',
    async (ctx: MutationContext<false>, _payload: GithubWorkflowPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        // Audit-only: gh-process backend has no fork-side document to update.
        // The withWrite scope is the audit-chain anchor; cli owns the
        // subprocess invocation and result composition.
      });
    },
    {
      invariants: workflowInvariants,
      cacheScope: 'store',
    },
  );
