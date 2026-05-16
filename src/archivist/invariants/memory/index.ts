// charter: mutation-invariants
// Barrel re-export for the memory_* mutation invariants (ADR-0180 Phase 3,
// §Architecture · Mutation invariants). Migrators import their per-tool invariant
// array and pass it to `registerMutationHandler(..., { invariants: <array> })`.
//
// Wiring status (2026-05-14): memory_store / memory_delete / memory_migrate /
// memory_import_claude migrators have not landed in this archivist scaffold yet
// — only the `memory_search` read handler exists. These invariants ship now as
// the contract spec; wiring lands when each migrator's `handlers/memory/<tool>.ts`
// file does. The barrel makes the wiring a single import per migrator.

export type { MemoryStorePayload } from './store.js';
export { storeInvariants } from './store.js';

export type { MemoryDeletePayload } from './delete.js';
export { deleteInvariants } from './delete.js';

export type { MemoryMigratePayload } from './migrate.js';
export { migrateInvariants } from './migrate.js';

export type { MemoryImportClaudePayload } from './import-claude.js';
export { importClaudeInvariants } from './import-claude.js';

// Read-side invariants (TODO ADR-0181 #104 — read handlers don't accept `invariants:` today).
export type { MemoryListQuery } from './list.js';
export { listInvariants } from './list.js';

export type { MemoryRetrieveQuery } from './retrieve.js';
export { retrieveInvariants } from './retrieve.js';

export type { MemorySearchQuery } from './search.js';
export { searchInvariants } from './search.js';

export type { MemorySearchUnifiedQuery } from './search-unified.js';
export { searchUnifiedInvariants } from './search-unified.js';

export type { MemoryBridgeStatusQuery } from './bridge-status.js';
export { bridgeStatusInvariants } from './bridge-status.js';
