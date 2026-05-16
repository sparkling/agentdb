// charter: dispatch
// `hook_post_task` handler — replaces intelligence.cjs#feedback's rewrites of
// `.claude-flow/data/ranked-context.json` and `.claude-flow/data/graph-state.json`
// (boostConfidence in @claude-flow/cli/.claude/helpers/intelligence.cjs lines
// 685–711).
//
// Cold-path discipline (ADR-0180 §Performance and hot paths):
//   - MODERATE frequency — runs once per agent task boundary, not per edit.
//     Not registered with `{ hotPath: true }` because the caller-observable
//     budget (<10ms in intelligence.cjs's documented contract) is comfortable
//     against the MutationGuard cost; we want the invariant gate, not the
//     hot-path bypass.
//   - Two affected substrate slices (ranked-context entries + graph-state
//     nodes) are independent reads/writes; cold-path `child()` is available
//     if a future refinement splits the apply across two audit children. For
//     now this is a single leaf mutation against a logical 'post-task' slot.
//
// Wire-up to intelligence.cjs is deferred — cli's `feedback(success)` stays
// authoritative until the dispatch surface lands. Body throws so any caller
// that hits the registry pre-wire-up fails loudly rather than producing a
// silent no-op.

import { registerMutationHandler } from '../../registration.js';
import { postTaskInvariants } from '../../invariants/hooks/post-task.js';

export interface PostTaskPayload {
  readonly success: boolean;
  readonly matchedPatternIds: ReadonlyArray<string>;
  readonly timestamp: number;
  readonly sessionId: string | null;
}

export const postTaskHandler = registerMutationHandler<PostTaskPayload>(
  'hook_post_task',
  async (_ctx, _payload) => {
    // TODO: wire boostConfidence semantics — for each matched pattern id,
    // adjust ranked-context entry confidence (+0.05 on success, -0.02 on
    // failure, clamped to [0, 1]) and mirror the change onto the matching
    // graph-state node. cli remains authoritative until then.
    throw new Error(
      'archivist: hook_post_task handler not yet wired (cli intelligence.feedback remains authoritative)',
    );
  },
  {
    invariants: postTaskInvariants,
    cacheScope: 'global',
  },
);
