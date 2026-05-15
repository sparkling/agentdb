// charter: dispatch
// Shared types for workflow_* handlers (ADR-0180 Phase 5).
// Mirrors `cli/src/mcp-tools/workflow-tools.ts:16-45` `WorkflowStep` /
// `WorkflowRecord` / `WorkflowStore` shapes verbatim so the dispatch boundary
// can read/write the same on-disk `.claude-flow/workflows/store.json` without
// a schema migration. The cli's interface declarations stay in place until
// Phase 7+ removes the legacy callsites; until then both surfaces share the
// same JSON document.

export interface WorkflowStep {
  stepId: string;
  name: string;
  type: 'task' | 'condition' | 'parallel' | 'loop' | 'wait';
  config: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowRecord {
  workflowId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed';
  currentStep: number;
  variables: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowStore {
  workflows: Record<string, WorkflowRecord>;
  templates: Record<string, WorkflowRecord>;
  version: string;
}
