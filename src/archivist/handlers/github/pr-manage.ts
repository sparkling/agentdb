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
} from '../../index.js';
import {
  GITHUB_STORE_ID,
  emptyGitHubStore,
  type GitHubStore,
} from './shared.js';

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

const STORE_ID = GITHUB_STORE_ID;

// The cli's open-coded `loadGitHubStore() → mutate store.prs[…] → saveGitHubStore()`
// fallback path (github-tools.ts `github_pr_manage` `create`/`merge`/`close`
// branches) collapses to a single `ctx.substrate.withWrite` because the FS-JSON
// substrate owns the lock + atomic-write semantics on `.claude-flow/github/store.json`.
// The `gh pr {create|merge|close}` shell-out + `prNumber` validation stay cli-side;
// this handler owns the local-store persistence step only.
//
// `prId` minting (`pr-${Date.now()}`) moves into this handler — matching the
// `tasks/create.ts` precedent where the substrate-seam handler owns id-minting
// for its store. `list` / `review` are read-shaped (the cli returns store data
// without mutating) and are dispatched here only for audit-chain uniformity
// (per ADR-0180 §Audit chain); their handler branch reads but does not write.
// The cli callsite stays in place until the dispatch boundary is wired through
// cli (Phase 7+).
export const githubPrManageHandler: GuardedWrite<GithubPrManagePayload> =
  registerMutationHandler<GithubPrManagePayload>(
    'github_pr_manage',
    async (ctx: MutationContext<false>, payload: GithubPrManagePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<GitHubStore>({ storeId: STORE_ID, key: 'root' });
        const store: GitHubStore = current ?? emptyGitHubStore();

        switch (payload.action) {
          case 'list':
          case 'review':
            // Read-shaped: the cli returns store/`gh` data without mutating.
            // Dispatched through the mutation surface only for audit-chain
            // uniformity (ADR-0180 §Audit chain) — no store write.
            return;
          case 'create': {
            const prId = `pr-${Date.now()}`;
            store.prs[prId] = {
              id: prId,
              title: payload.title ?? 'New PR',
              status: 'open',
              branch: payload.branch ?? 'feature',
              createdAt: new Date().toISOString(),
            };
            break;
          }
          case 'merge':
          case 'close': {
            // Mirrors the cli's prNumber → prKey lookup
            // (`Object.keys(store.prs).find(k => k.includes(String(prNumber)))`).
            const target = payload.action === 'merge' ? 'merged' : 'closed';
            const prKey = Object.keys(store.prs).find((k) =>
              k.includes(String(payload.prNumber)),
            );
            if (prKey === undefined) {
              // The cli silently no-ops here (the `gh`-side action already ran).
              // No local record to transition — audit-chain uniformity still
              // wants the dispatch, so this is a no-write branch, not a throw.
              return;
            }
            store.prs[prKey].status = target;
            break;
          }
        }

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
