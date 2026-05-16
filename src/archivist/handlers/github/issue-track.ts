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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import {
  GITHUB_STORE_ID,
  emptyGitHubStore,
  type GitHubStore,
} from './shared.js';

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

const STORE_ID = GITHUB_STORE_ID;

// The cli's open-coded `loadGitHubStore() → mutate store.issues[…] → saveGitHubStore()`
// fallback path (github-tools.ts `github_issue_track` `create`/`update`/`close`
// branches) collapses to a single `ctx.substrate.withWrite` because the FS-JSON
// substrate owns the lock + atomic-write semantics on `.claude-flow/github/store.json`.
// The `gh issue {create|edit|close}` shell-out + `sanitizeLabels` regex-binding +
// `issueNumber` validation stay cli-side; this handler owns the local-store
// persistence step only. `labels` reach this handler already `sanitizeLabels`-cleaned
// (the regex-binding is the invariants-author's Phase 5 job per ADR-0180
// §Mutation invariants).
//
// `issueId` minting (`issue-${Date.now()}`) moves into this handler — matching the
// `tasks/create.ts` precedent. `list` is read-shaped (the cli returns store data
// without mutating) and is dispatched here only for audit-chain uniformity (per
// ADR-0180 §Audit chain). `assign` has NO cli `github_issue_track` implementation
// (the cli `switch` falls through to "Unknown action" — it never touches the
// store), so it is a no-write branch here too. The cli callsite stays in place
// until the dispatch boundary is wired through cli (Phase 7+).
export const githubIssueTrackHandler: GuardedWrite<GithubIssueTrackPayload> =
  registerMutationHandler<GithubIssueTrackPayload>(
    'github_issue_track',
    async (ctx: MutationContext<false>, payload: GithubIssueTrackPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<GitHubStore>({ storeId: STORE_ID, key: 'root' });
        const store: GitHubStore = current ?? emptyGitHubStore();

        switch (payload.action) {
          case 'list':
          case 'assign':
            // `list` is read-shaped; `assign` has no cli store-mutation
            // implementation. Dispatched for audit-chain uniformity only —
            // no store write.
            return;
          case 'create': {
            const issueId = `issue-${Date.now()}`;
            store.issues[issueId] = {
              id: issueId,
              title: payload.title ?? 'New Issue',
              status: 'open',
              labels: [...(payload.labels ?? [])],
              createdAt: new Date().toISOString(),
            };
            break;
          }
          case 'update': {
            // Mirrors the cli's issueNumber → issueKey lookup
            // (`Object.keys(store.issues).find(k => k.includes(String(issueNumber)))`).
            const issueKey = Object.keys(store.issues).find((k) =>
              k.includes(String(payload.issueNumber)),
            );
            if (issueKey === undefined) {
              // The cli silently no-ops here (the `gh`-side edit already ran;
              // there is no local record to transition). Audit-chain uniformity
              // still wants the dispatch — no-write branch, not a throw.
              return;
            }
            if (payload.title !== undefined) store.issues[issueKey].title = payload.title;
            if (payload.labels !== undefined) store.issues[issueKey].labels = [...payload.labels];
            break;
          }
          case 'close': {
            const issueKey = Object.keys(store.issues).find((k) =>
              k.includes(String(payload.issueNumber)),
            );
            if (issueKey === undefined) {
              return;
            }
            store.issues[issueKey].status = 'closed';
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
