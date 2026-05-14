// charter: dispatch
// Shared types for task_* handlers (ADR-0180 Phase 5).
// Mirrors `cli/src/mcp-tools/task-tools.ts:16-34` `TaskRecord` / `TaskStore`
// shapes verbatim so the dispatch boundary can read/write the same on-disk
// `.claude-flow/tasks/store.json` without a schema migration. The cli's
// interface declarations stay in place until Phase 7+ removes the legacy
// callsites; until then both surfaces share the same JSON document.

export interface TaskRecord {
  taskId: string;
  type: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  assignedTo: string[];
  tags: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result?: Record<string, unknown>;
}

export interface TaskStore {
  tasks: Record<string, TaskRecord>;
  version: string;
}

/** agents.json record shape — task_complete and task_assign mutate
 *  `assignedTo` agent records under the SAME archivist surface (the
 *  hive-mind_agents store, ADR-0180 §Caller surfaces). This is the
 *  canonical-shape declaration used by the cross-store sync inside both
 *  handlers; it intentionally narrows to the fields task_* writes so
 *  unrelated agent state (health, config, etc.) round-trips through the
 *  loaded record without re-declaration. */
export interface TaskAgentRecord {
  status?: string;
  currentTask?: string | null;
  taskCount?: number;
  [key: string]: unknown;
}

export interface TaskAgentStore {
  agents: Record<string, TaskAgentRecord>;
}
