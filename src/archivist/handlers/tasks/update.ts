// charter: dispatch
// task_update mutation handler (ADR-0180 Phase 5).
// Single-store mutation: status / progress / assignedTo on the named task
// record. The status='in_progress' transition stamps `startedAt` when absent
// — preserving the cli surface contract at task-tools.ts:301-307.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/task-tools.ts` `task_update`
// handler (lines 295-330). The cli callsite stays in place until Phase 7+
// flips the dispatch wire-up.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { TaskRecord, TaskStore } from './shared';

export interface TaskUpdatePayload {
  readonly taskId: string;
  readonly status?: TaskRecord['status'];
  readonly progress?: number;
  readonly assignTo?: ReadonlyArray<string>;
}

const STORE_ID = 'tasks' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): the cli's progress-clamp (Math.min(100,
// Math.max(0, ...))) and startedAt-on-first-in_progress stamp move here
// unchanged from task-tools.ts:308-313. The cli unlocked load/save pair
// collapses to a single `ctx.substrate.withWrite` covering both reads and
// the write under the substrate's O_EXCL lock.
export const taskUpdateHandler: GuardedWrite<TaskUpdatePayload> =
  registerMutationHandler<TaskUpdatePayload>(
    'task_update',
    async (ctx: MutationContext<false>, payload: TaskUpdatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<TaskStore>({ storeId: STORE_ID, key: 'root' });
        const task = store?.tasks[payload.taskId];
        if (!store || !task) {
          return;
        }

        if (payload.status) {
          task.status = payload.status;
          if (payload.status === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
        }
        if (typeof payload.progress === 'number') {
          task.progress = Math.min(100, Math.max(0, payload.progress));
        }
        if (payload.assignTo) {
          task.assignedTo = [...payload.assignTo];
        }

        store.tasks[payload.taskId] = task;
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
