// charter: dispatch
// github_issue_track mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<GithubIssueTrackPayload>` because four of its five
// actions mutate state (`create`, `update`, `close`, `assign`) and the
// remaining one (`list`) is dispatched through the mutation surface for
// audit-chain uniformity (per ADR-0180 §Audit chain: when a tool's actions
// are mixed read/write the canonical surface is the mutation handler).
//
// Pre-existing CLI surface: `cli/src/mcp-tools/github-tools.ts` `github_issue_track`
// handler — internal switch on `action` invoking `gh issue {create|edit|close|list}`
// with a fallback that loads the `.claude-flow/github/store.json` FS-JSON store
// via `loadGitHubStore`, mutates `store.issues[issueId]`, and saves with
// `saveGitHubStore`. Labels pass through `sanitizeLabels` (regex-bound,
// 64-char cap per audit_1776853149979). The FS-JSON store is backed by
// `makeFsJsonSubstrate` (lifted from hive-mind per ADR-0180 Phase 4); the
// cli's open-coded `readFileSync` + `writeFileSync` collapses to
// `ctx.substrate.withWrite` because the substrate primitive owns the lock
// semantics. The cli callsite stays in place until Phase 7+ removes the
// legacy path.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Mutation payload — discriminated by `action`. Mirrors the five action
 *  branches at cli `github_issue_track`. Labels are typed as
 *  `ReadonlyArray<string>` here; the cli `sanitizeLabels` regex-binding
 *  (`[A-Za-z0-9 _\-./]`, 64-char cap) carries through as an invariant the
 *  Phase 5 wire-up will move into the handler body. */
export type GithubIssueTrackPayload =
  | { readonly action: 'list'; readonly owner?: string; readonly repo?: string }
  | {
      readonly action: 'create';
      readonly title?: string;
      readonly body?: string;
      readonly labels?: ReadonlyArray<string>;
      readonly assignees?: ReadonlyArray<string>;
      readonly owner?: string;
      readonly repo?: string;
    }
  | {
      readonly action: 'update';
      readonly issueNumber: number;
      readonly title?: string;
      readonly body?: string;
      readonly labels?: ReadonlyArray<string>;
      readonly owner?: string;
      readonly repo?: string;
    }
  | {
      readonly action: 'close';
      readonly issueNumber: number;
      readonly owner?: string;
      readonly repo?: string;
    }
  | {
      readonly action: 'assign';
      readonly issueNumber: number;
      readonly assignees: ReadonlyArray<string>;
      readonly owner?: string;
      readonly repo?: string;
    };

const STORE_ID = 'github' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of cli `github_issue_track`
// handler once the dispatch boundary is wired through cli. The cli's
// open-coded load → mutate `store.issues[issueId]` → save sequence collapses
// to `ctx.substrate.withWrite` per action because the substrate primitive
// owns the lock semantics on the FS-JSON store at
// `.claude-flow/github/store.json`. The `sanitizeLabels` regex-binding
// becomes an invariant per ADR-0180 §Mutation invariants.
export const githubIssueTrackHandler: GuardedWrite<GithubIssueTrackPayload> =
  registerMutationHandler<GithubIssueTrackPayload>(
    'github_issue_track',
    async (ctx: MutationContext<false>, payload: GithubIssueTrackPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          `archivist: github_issue_track (action=${payload.action}) handler body pending Phase 5 wire-up; ` +
          `callers currently route through cli/src/mcp-tools/github-tools.ts github_issue_track handler`,
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
