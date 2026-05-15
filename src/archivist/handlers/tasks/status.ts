// charter: dispatch
// task_status mutation handler (ADR-0180 Phase 5).
//
// The cli surface (task-tools.ts:119-157) returns the task record as a read
// response, but the dispatch boundary registers every `task_*` tool as a
// MUTATION per the brief's `registerMutationHandler('task_<action>', ...)`
// convention. The handler runs inside `ctx.substrate.withWrite` so the read
// participates in the audit chain (intent → applied) and the substrate's
// O_EXCL lock — guaranteeing the returned snapshot is not torn against an
// in-flight `task_update` / `task_complete`.
//
// No fields are written; the handler reads `store` and surfaces the record
// via `ctx` side-channel resolution at the dispatch wire-up callsite (Phase 7+).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import type { TaskStore } from './shared.js';

export interface TaskStatusPayload {
  readonly taskId: string;
}

const STORE_ID = 'tasks' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port cli `task_status` (task-tools.ts:129-156)
// return-shape construction here once the dispatch path resolves return values.
// The mutation-shaped registration is intentional: ADR-0180's per-action
// audit-chain ceremony covers reads-under-lock as a strict superset of
// dispatchRead's passthrough semantics, which the brief selects for every
// task_* tool.
export const taskStatusHandler: GuardedWrite<TaskStatusPayload> =
  registerMutationHandler<TaskStatusPayload>(
    'task_status',
    async (ctx: MutationContext<false>, payload: TaskStatusPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<TaskStore>({ storeId: STORE_ID, key: 'root' });
        const task = store?.tasks[payload.taskId];
        if (!task) {
          // Soft-miss: cli surface returns a `not_found` sentinel rather than
          // throwing. The dispatch boundary mirrors that contract — the cli's
          // status response shape (status: 'not_found') is constructed at the
          // wire-up callsite from the absent record, not from a thrown error.
          return;
        }
        // No store mutation; ADR-0180 audit-chain records the intent + applied
        // states as a no-op write so cross-process observers see the read
        // participate in the lock order. The cli return-shape construction
        // happens at the dispatch wire-up callsite (Phase 7+) reading the
        // recorded payload + this handler's `applied` audit entry.
        void task;
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
