// charter: dispatch
// task_cancel mutation handler (ADR-0180 Phase 5).
// Single-store mutation: sets `status='cancelled'`, stamps `completedAt`,
// records the cancel reason on `task.result.cancelReason`. Does NOT touch
// the hive-mind_agents store — the cli surface (task-tools.ts:428-453)
// leaves agent records untouched on cancel; agents are released by an
// explicit `task_assign` with `unassign: true` if the caller wants that.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/task-tools.ts` `task_cancel`
// handler (lines 428-453). Cli callsite stays in place until Phase 7+.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import type { TaskStore } from './shared.js';
import { cancelInvariants } from '../../invariants/tasks/cancel.js';

export interface TaskCancelPayload {
  readonly taskId: string;
  readonly reason?: string;
}

const STORE_ID = 'tasks' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the cli's cancelReason default
// ('Cancelled by user' when payload.reason is absent) and completedAt
// stamp here unchanged. The cli's unlocked save collapses to the
// substrate's withWrite under its O_EXCL lock.
export const taskCancelHandler: GuardedWrite<TaskCancelPayload> =
  registerMutationHandler<TaskCancelPayload>(
    'task_cancel',
    async (ctx: MutationContext<false>, payload: TaskCancelPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<TaskStore>({ storeId: STORE_ID, key: 'root' });
        const task = store?.tasks[payload.taskId];
        if (!store || !task) {
          return;
        }

        task.status = 'cancelled';
        task.completedAt = new Date().toISOString();
        task.result = { cancelReason: payload.reason ?? 'Cancelled by user' };

        store.tasks[payload.taskId] = task;
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: cancelInvariants,
      cacheScope: 'store',
    },
  );
