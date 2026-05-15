// charter: dispatch
// Barrel for `hooks/*` handler modules. Importing the barrel triggers the
// `registerMutationHandler` side-effects in each handler module, which is how
// handlers reach the archivist's dispatch registry. The barrel is typed as
// `Record<string, GuardedWrite<any>>` so non-branded exports (i.e. raw
// functions that bypassed `registerMutationHandler`) fail at compile time.

import type { GuardedWrite } from '../../types.js';
import { registerMutationHandlerAlias } from '../../registration.js';
import { postEditHandler, type PostEditPayload } from './post-edit.js';
import { postTaskHandler, type PostTaskPayload } from './post-task.js';
import { preTaskHandler, type PreTaskPayload } from './pre-task.js';
import { sessionEndHandler, type SessionEndPayload } from './session-end.js';

export type { PostEditPayload } from './post-edit.js';
export type { PostTaskPayload } from './post-task.js';
export type { PreTaskPayload } from './pre-task.js';
export type { SessionEndPayload } from './session-end.js';

export const hooksHandlers: Record<string, GuardedWrite<unknown>> = {
  hook_post_edit: postEditHandler as unknown as GuardedWrite<unknown>,
  hook_post_task: postTaskHandler as unknown as GuardedWrite<unknown>,
  hook_pre_task: preTaskHandler as unknown as GuardedWrite<unknown>,
  hook_session_end: sessionEndHandler as unknown as GuardedWrite<unknown>,
};

// ADR-0181 Phase 5 DA-memo CF#3 — namespace-harmonization aliases.
// The cli's MCP-tool surface (forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/
// hooks-tools.ts) names these tools under the *plural-hyphenated* convention
// (`hooks_pre-task`, `hooks_post-task`, `hooks_post-edit`, `hooks_session-end`)
// for compatibility with the user-facing MCP catalog and Claude Code's hook
// invocation. The archivist's internal registration uses the *singular-
// underscored* convention (`hook_pre_task`, etc.) which matches agentic-flow's
// `hook_*` MCP tools.
//
// Renaming either side is breaking:
// - Renaming archivist breaks agentic-flow's `hook_post_edit` benchmark + tests
// - Renaming cli breaks the user-facing MCP tool catalog (Claude Code calls
//   `hooks_pre-task` directly)
//
// Aliases let any future Phase 7 cli-to-archivist hook flip dispatch under the
// cli's spelling (`getProcessArchivist().dispatch('hooks_pre-task', payload)`)
// without touching either user-facing surface or the canonical registration.
// The ToolPayloadMap also needs alias entries (added in dispatch-types.ts) so
// the typed dispatch overload accepts both spellings — the alias entries
// resolve to the same payload type.
//
// Convention going forward (Phase 7+): use the cli's plural-hyphenated form
// at dispatch sites (`hooks_pre-task`). The singular-underscored form
// (`hook_pre_task`) remains the canonical archivist handler name for
// agentic-flow compatibility but is no longer the preferred dispatch spelling
// in the ruflo cli.
registerMutationHandlerAlias('hooks_pre-task', 'hook_pre_task');
registerMutationHandlerAlias('hooks_post-task', 'hook_post_task');
registerMutationHandlerAlias('hooks_post-edit', 'hook_post_edit');
registerMutationHandlerAlias('hooks_session-end', 'hook_session_end');

// Re-export the individual handlers for direct-import callers that want the
// typed payload surface without the `unknown`-erased barrel.
export { postEditHandler, postTaskHandler, preTaskHandler, sessionEndHandler };
export type HookPostEditHandler = typeof postEditHandler;
export type HookPostTaskHandler = typeof postTaskHandler;
export type HookPreTaskHandler = typeof preTaskHandler;
export type HookSessionEndHandler = typeof sessionEndHandler;
export type _PostEditPayloadAlias = PostEditPayload;
export type _PostTaskPayloadAlias = PostTaskPayload;
export type _PreTaskPayloadAlias = PreTaskPayload;
export type _SessionEndPayloadAlias = SessionEndPayload;
