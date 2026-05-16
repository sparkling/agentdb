// charter: dispatch
// task_complete mutation handler (ADR-0180 Phase 5).
// TWO-store mutation: the task record's status/progress/completedAt/result
// fields, AND the `hive-mind_agents` records for each `assignedTo` agent
// (status → idle, currentTask → null, taskCount++). Composed under nested
// `ctx.substrate.withWrite` scopes — each substrate owns its own O_EXCL
// lock; nesting yields hold-A-then-acquire-B ordering keyed by the storeId
// brand. The two locks point at different files (`.claude-flow/tasks/store.json`
// vs `.claude-flow/agents/store.json`) so the order is safe.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/task-tools.ts` `task_complete`
// handler (lines 232-279) — best-effort agent sync inside a try/catch. The
// migrator preserves the side-effect but routes it through the archivist's
// audit chain (each store's write emits its own intent → applied entry).

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import type { TaskAgentStore, TaskStore } from './shared.js';
import { completeInvariants } from '../../invariants/tasks/complete.js';

export interface TaskCompletePayload {
  readonly taskId: string;
  readonly result?: Record<string, unknown>;
}

const TASKS_STORE_ID = 'tasks' as StoreId;
const AGENTS_STORE_ID = 'hive-mind_agents' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): the cli's best-effort try/catch around the
// agent-sync block (task-tools.ts:245-263) was an ADR-0085 workaround for the
// lack of a transactional surface. The archivist surface RE-THROWS fatals
// per `feedback-best-effort-must-rethrow-fatals` — the second withWrite
// runs OUTSIDE the first so a thrown agent-sync error leaves the task record
// marked completed (the cli's pre-archivist behavior on a swallowed throw).
// The audit chain records both store writes independently; observers see
// task_complete `applied` even when the agent-sync emits `failed`.
export const taskCompleteHandler: GuardedWrite<TaskCompletePayload> =
  registerMutationHandler<TaskCompletePayload>(
    'task_complete',
    async (ctx: MutationContext<false>, payload: TaskCompletePayload): Promise<void> => {
      let assignedTo: ReadonlyArray<string> = [];

      await ctx.substrate.withWrite({ storeId: TASKS_STORE_ID }, async (handle) => {
        const store = await handle.read<TaskStore>({ storeId: TASKS_STORE_ID, key: 'root' });
        const task = store?.tasks[payload.taskId];
        if (!store || !task) {
          // Soft-miss matches cli `task_complete` not_found return shape;
          // the wire-up callsite resolves the return value from the absent
          // record. No store mutation, audit still emits intent → applied.
          return;
        }

        task.status = 'completed';
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        task.result = payload.result ?? {};

        store.tasks[payload.taskId] = task;
        await handle.write({ storeId: TASKS_STORE_ID, key: 'root', payload: store });

        assignedTo = task.assignedTo;
      });

      if (assignedTo.length === 0) return;

      await ctx.substrate.withWrite({ storeId: AGENTS_STORE_ID }, async (handle) => {
        const current = await handle.read<TaskAgentStore>({
          storeId: AGENTS_STORE_ID,
          key: 'root',
        });
        const agentStore: TaskAgentStore = current ?? { agents: {} };

        for (const agentId of assignedTo) {
          const agent = agentStore.agents[agentId];
          if (agent) {
            agent.status = 'idle';
            agent.currentTask = null;
            agent.taskCount = (agent.taskCount ?? 0) + 1;
          }
        }

        await handle.write({ storeId: AGENTS_STORE_ID, key: 'root', payload: agentStore });
      });
    },
    {
      invariants: completeInvariants,
      cacheScope: 'store',
    },
  );
