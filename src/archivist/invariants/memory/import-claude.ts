// charter: mutation-invariants
// memory_import_claude mutation invariants (ADR-0180 §Architecture · Mutation invariants —
// second correctness gate). Imports of Claude Code session memory cross a process boundary
// (read from `~/.claude/projects/<slug>/memory/`); these invariants verify the recorded
// source path AND record count match what the caller staged. Silent-drop on a malformed
// MEMORY.md line would replay identically without this gate.

import type { Invariant } from '../../registration.js';

/**
 * memory_import_claude intent. The import source path is the canonical pointer
 * to where the records originated; the record count is the caller's pre-write tally.
 * Handlers that filter records mid-import (e.g., dedup against existing rows) MUST
 * surface the filtered count back into the recorded payload so the invariant gate
 * agrees — a handler that silently drops without updating the count is the
 * regression this invariant catches.
 */
export interface MemoryImportClaudePayload {
  readonly sourcePath: string;
  readonly recordCount: number;
  readonly targetNamespace?: string;
}

/** Source path identity — the file or directory the caller staged is what was imported. */
const sourcePathEquality: Invariant<MemoryImportClaudePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sourcePath !== recordedPayload.sourcePath) {
    return {
      violated: true,
      detail: `source_path divergence: intent='${callerIntent.sourcePath}' recorded='${recordedPayload.sourcePath}'`,
    };
  }
  return 'pass';
};

/**
 * Record count equality — records read MUST equal records recorded. Per
 * `feedback-data-loss-zero-tolerance`, a 99.9% import pass that quietly drops 0.1%
 * is NOT shippable; the invariant aborts the write so the caller sees the failure.
 */
const recordCountEquality: Invariant<MemoryImportClaudePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.recordCount !== recordedPayload.recordCount) {
    return {
      violated: true,
      detail: `record_count divergence: intent=${callerIntent.recordCount} recorded=${recordedPayload.recordCount}`,
    };
  }
  return 'pass';
};

/** Target namespace identity when supplied — caller's intended landing namespace. */
const targetNamespaceEquality: Invariant<MemoryImportClaudePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.targetNamespace !== recordedPayload.targetNamespace) {
    return {
      violated: true,
      detail: `target_namespace divergence: intent='${String(callerIntent.targetNamespace)}' recorded='${String(recordedPayload.targetNamespace)}'`,
    };
  }
  return 'pass';
};

export const importClaudeInvariants: ReadonlyArray<Invariant<MemoryImportClaudePayload>> = [
  sourcePathEquality,
  recordCountEquality,
  targetNamespaceEquality,
];
