// charter: mutation-invariants
// Barrel re-export for the task_* mutation invariants (ADR-0180 §Architecture
// · Mutation invariants). Wired today: task_create. The other task_* mutation
// handlers (update, complete, assign, cancel) operate on existing TaskRecord
// values minted by task_create; their range/well-formedness contract is
// enforced at the create-time invariant gate plus the substrate's atomic
// read-modify-write. They will gain per-handler invariants if a follow-up
// pass needs intent-vs-recorded discrimination on partial updates.

export type { TaskCreatePayload } from './create.js';
export { createInvariants } from './create.js';
