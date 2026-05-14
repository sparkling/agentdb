// charter: dispatch
// task_list mutation handler (ADR-0180 Phase 5).
//
// Same audit-chain rationale as `task_status` (this file's peer): all task_*
// actions register as mutations per the Phase 5 brief; the read runs under
// the substrate's withWrite so the snapshot is not torn against concurrent
// task_create / task_update / task_complete writers.
//
// Filtering + sorting + limit construction (cli/src/mcp-tools/task-tools.ts:172-218)
// happens at the dispatch wire-up callsite (Phase 7+) — this handler only
// surfaces the consistent snapshot under the audit chain.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { TaskRecord, TaskStore } from './shared';

export interface TaskListPayload {
  readonly status?: string;
  readonly type?: string;
  readonly assignedTo?: string;
  readonly priority?: TaskRecord['priority'];
  readonly limit?: number;
}

const STORE_ID = 'tasks' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): the cli's filter chain (status comma-split,
// type/assignedTo/priority predicates, createdAt-desc sort, slice(0, limit))
// moves to the wire-up callsite which consumes the recorded snapshot. The
// substrate read here owns ONLY the audit-chain + lock-ordered snapshot
// guarantee per ADR-0180 §Audit chain.
export const taskListHandler: GuardedWrite<TaskListPayload> =
  registerMutationHandler<TaskListPayload>(
    'task_list',
    async (ctx: MutationContext<false>, _payload: TaskListPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<TaskStore>({ storeId: STORE_ID, key: 'root' });
        // No mutation; ADR-0180 audit chain still emits intent → applied so
        // the read participates in the substrate's lock order. The cli's
        // filter/sort/limit construction reads back the recorded payload at
        // the wire-up callsite.
        void store;
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
