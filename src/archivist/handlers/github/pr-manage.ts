// charter: dispatch
// github_pr_manage mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<GithubPrManagePayload>` because three of its five
// actions mutate state (`create`, `merge`, `close`) and the remaining two
// (`list`, `review`) are dispatched through the mutation surface for audit-chain
// uniformity (per ADR-0180 §Audit chain: when a tool's actions are mixed
// read/write the canonical surface is the mutation handler).
//
// Pre-existing CLI surface: `cli/src/mcp-tools/github-tools.ts` `github_pr_manage`
// handler — internal switch on `action` invoking `gh pr {create|merge|close|view|list}`
// with a fallback that loads the `.claude-flow/github/store.json` FS-JSON store
// via `loadGitHubStore`, mutates `store.prs[prId]`, and saves with
// `saveGitHubStore`. The FS-JSON store is backed by `makeFsJsonSubstrate`
// (lifted from hive-mind per ADR-0180 Phase 4); the cli's open-coded
// `readFileSync` + `writeFileSync` collapses to `ctx.substrate.withWrite`
// because the substrate primitive owns the lock semantics. The cli callsite
// stays in place until Phase 7+ removes the legacy path.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Mutation payload — discriminated by `action`. Mirrors the five action
 *  branches at cli `github_pr_manage`. The `list` and `review` actions are
 *  read-shaped but dispatch through the mutation surface for audit-chain
 *  uniformity; `create`/`merge`/`close` mutate the FS-JSON store.
 *  Field-typing matches the cli handler's `validateIdentifier` /
 *  `validateText` / `toPositiveInt` callsites. */
export type GithubPrManagePayload =
  | { readonly action: 'list'; readonly owner?: string; readonly repo?: string }
  | {
      readonly action: 'create';
      readonly title?: string;
      readonly branch?: string;
      readonly baseBranch?: string;
      readonly body?: string;
      readonly owner?: string;
      readonly repo?: string;
    }
  | { readonly action: 'review'; readonly prNumber: number; readonly owner?: string; readonly repo?: string }
  | { readonly action: 'merge'; readonly prNumber: number; readonly owner?: string; readonly repo?: string }
  | { readonly action: 'close'; readonly prNumber: number; readonly owner?: string; readonly repo?: string };

const STORE_ID = 'github' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of cli `github_pr_manage` handler
// once the dispatch boundary is wired through cli. The cli's open-coded
// load → mutate `store.prs[prId]` → save sequence collapses to
// `ctx.substrate.withWrite` per action because the substrate primitive owns
// the lock semantics on the FS-JSON store at `.claude-flow/github/store.json`.
export const githubPrManageHandler: GuardedWrite<GithubPrManagePayload> =
  registerMutationHandler<GithubPrManagePayload>(
    'github_pr_manage',
    async (ctx: MutationContext<false>, payload: GithubPrManagePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          `archivist: github_pr_manage (action=${payload.action}) handler body pending Phase 5 wire-up; ` +
          `callers currently route through cli/src/mcp-tools/github-tools.ts github_pr_manage handler`,
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
