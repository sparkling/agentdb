// charter: dispatch
// Barrel for `hooks/*` handler modules. Importing the barrel triggers the
// `registerMutationHandler` side-effects in each handler module, which is how
// handlers reach the archivist's dispatch registry. The barrel is typed as
// `Record<string, GuardedWrite<any>>` so non-branded exports (i.e. raw
// functions that bypassed `registerMutationHandler`) fail at compile time.

import type { GuardedWrite } from '../../types.js';
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
