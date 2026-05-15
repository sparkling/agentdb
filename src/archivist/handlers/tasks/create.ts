// charter: dispatch
// task_create mutation handler (ADR-0180 Phase 5).
// Registers as `GuardedWrite<TaskCreatePayload>` so every task creation
// transitions through the archivist's audit chain. The substrate's O_EXCL
// lock subsumes the legacy unlocked `loadTaskStore`/`saveTaskStore` pair at
// `cli/src/mcp-tools/task-tools.ts:51-67` — concurrent creators now serialize
// at the substrate boundary per `feedback-data-loss-zero-tolerance`.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/task-tools.ts` `task_create`
// handler (lines 85-117). The cli callsite stays in place until Phase 7+
// flips the dispatch wire-up; this file establishes the registration shape
// the dispatch path will resolve.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import type { TaskRecord, TaskStore } from './shared.js';

export interface TaskCreatePayload {
  readonly type: string;
  readonly description: string;
  readonly priority?: TaskRecord['priority'];
  readonly assignTo?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  // Caller-supplied taskId. When present, the handler honours it instead of
  // minting one. Lets the cli pre-compute the id so its envelope-shaper can
  // look up the record by id rather than diffing pre/post snapshots — the
  // diff is racy under parallel test execution (cap=12) where the FS-JSON
  // O_EXCL lock serializes writes but the pre-snapshot may already see a
  // sibling create's row. Non-cli callers can still omit and let the
  // handler mint, so the change is back-compat.
  readonly taskId?: string;
}

const STORE_ID = 'tasks' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): the cli's `loadTaskStore`/`saveTaskStore`
// pair (task-tools.ts:51-67) collapses to a single `ctx.substrate.withWrite`
// here because the substrate primitive owns durability + isolation. taskId
// minting (`task-${Date.now()}-${random}`) and default-population (priority,
// assignedTo, tags) move into this handler unchanged.
export const taskCreateHandler: GuardedWrite<TaskCreatePayload> =
  registerMutationHandler<TaskCreatePayload>(
    'task_create',
    async (ctx: MutationContext<false>, payload: TaskCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<TaskStore>({ storeId: STORE_ID, key: 'root' });
        const store: TaskStore = current ?? { tasks: {}, version: '3.0.0' };

        const taskId = payload.taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const task: TaskRecord = {
          taskId,
          type: payload.type,
          description: payload.description,
          priority: payload.priority ?? 'normal',
          status: 'pending',
          progress: 0,
          assignedTo: [...(payload.assignTo ?? [])],
          tags: [...(payload.tags ?? [])],
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        };

        store.tasks[taskId] = task;
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
