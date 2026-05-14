// charter: dispatch
// task_assign mutation handler (ADR-0180 Phase 5).
// TWO-store mutation (same shape as task_complete): the task record's
// `assignedTo` list plus the `hive-mind_agents` records — agents removed
// from the assignment revert to status='idle', agents added move to
// status='active' with `currentTask` set. Task auto-transitions to
// `in_progress` when assigning to a previously-pending record (preserves
// cli surface contract at task-tools.ts:391-397).
//
// `unassign: true` clears all assignees on the task and reverts every
// previously-assigned agent to idle.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/task-tools.ts` `task_assign`
// handler (lines 345-414). Cli callsite stays in place until Phase 7+.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { TaskAgentStore, TaskStore } from './shared';

export interface TaskAssignPayload {
  readonly taskId: string;
  readonly agentIds?: ReadonlyArray<string>;
  readonly unassign?: boolean;
}

const TASKS_STORE_ID = 'tasks' as StoreId;
const AGENTS_STORE_ID = 'hive-mind_agents' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): the cli (task-tools.ts:354-413) loads
// both stores up-front with a single best-effort try/catch around the
// agent-store read. The archivist surface separates the two reads into
// their own withWrite scopes — the agents.json read participates in the
// hive-mind_agents lock instead of running unprotected. The task lock is
// acquired first (outer scope) so concurrent `task_complete` on the same
// taskId observes a consistent ordering.
export const taskAssignHandler: GuardedWrite<TaskAssignPayload> =
  registerMutationHandler<TaskAssignPayload>(
    'task_assign',
    async (ctx: MutationContext<false>, payload: TaskAssignPayload): Promise<void> => {
      let previouslyAssigned: ReadonlyArray<string> = [];
      let nextAssigned: ReadonlyArray<string> = [];

      await ctx.substrate.withWrite({ storeId: TASKS_STORE_ID }, async (handle) => {
        const store = await handle.read<TaskStore>({ storeId: TASKS_STORE_ID, key: 'root' });
        const task = store?.tasks[payload.taskId];
        if (!store || !task) {
          return;
        }

        previouslyAssigned = [...task.assignedTo];

        if (payload.unassign) {
          task.assignedTo = [];
        } else {
          const agentIds = payload.agentIds ?? [];
          task.assignedTo = [...agentIds];
          if (task.status === 'pending' && agentIds.length > 0) {
            task.status = 'in_progress';
            if (!task.startedAt) {
              task.startedAt = new Date().toISOString();
            }
          }
        }

        nextAssigned = task.assignedTo;
        store.tasks[payload.taskId] = task;
        await handle.write({ storeId: TASKS_STORE_ID, key: 'root', payload: store });
      });

      if (previouslyAssigned.length === 0 && nextAssigned.length === 0) return;

      await ctx.substrate.withWrite({ storeId: AGENTS_STORE_ID }, async (handle) => {
        const current = await handle.read<TaskAgentStore>({
          storeId: AGENTS_STORE_ID,
          key: 'root',
        });
        const agentStore: TaskAgentStore = current ?? { agents: {} };

        // Revert agents removed from the assignment to idle.
        for (const agentId of previouslyAssigned) {
          if (!nextAssigned.includes(agentId)) {
            const agent = agentStore.agents[agentId];
            if (agent) {
              agent.status = 'idle';
              agent.currentTask = null;
            }
          }
        }
        // Move newly-assigned agents to active.
        for (const agentId of nextAssigned) {
          const agent = agentStore.agents[agentId];
          if (agent) {
            agent.status = 'active';
            agent.currentTask = payload.taskId;
          }
        }

        await handle.write({ storeId: AGENTS_STORE_ID, key: 'root', payload: agentStore });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
