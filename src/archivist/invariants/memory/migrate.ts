// charter: mutation-invariants
// memory_migrate mutation invariants (ADR-0180 §Architecture · Mutation invariants — second
// correctness gate). Migration is a bulk-shape mutation — invariants verify the
// source/destination identity AND the row count survives the move. A handler that
// drops rows silently (the failure shape `feedback-data-loss-zero-tolerance` exists
// to prevent) would replay identically without these invariants.

import type { Invariant } from '../../registration';

/**
 * memory_migrate intent. Captures the source/destination namespace pair and the
 * number of entries the cli surface believes it is moving. The handler records the
 * actual number of rows it migrated; equality is enforced post-write.
 */
export interface MemoryMigratePayload {
  readonly sourceNamespace: string;
  readonly destinationNamespace: string;
  readonly entryCount: number;
}

/** Source namespace identity — the caller's source must be the recorded source. */
const sourceNamespaceEquality: Invariant<MemoryMigratePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sourceNamespace !== recordedPayload.sourceNamespace) {
    return {
      violated: true,
      detail: `source_namespace divergence: intent='${callerIntent.sourceNamespace}' recorded='${recordedPayload.sourceNamespace}'`,
    };
  }
  return 'pass';
};

/** Destination namespace identity — recorded destination equals intended destination. */
const destinationNamespaceEquality: Invariant<MemoryMigratePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.destinationNamespace !== recordedPayload.destinationNamespace) {
    return {
      violated: true,
      detail: `destination_namespace divergence: intent='${callerIntent.destinationNamespace}' recorded='${recordedPayload.destinationNamespace}'`,
    };
  }
  return 'pass';
};

/**
 * Entry count equality — rows migrated MUST equal rows recorded. Zero-tolerance for
 * silent drop (per `feedback-data-loss-zero-tolerance`); a partial migration that
 * exits cleanly with N-k rows when the caller staged N is a data-loss bug.
 */
const entryCountEquality: Invariant<MemoryMigratePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.entryCount !== recordedPayload.entryCount) {
    return {
      violated: true,
      detail: `entry_count divergence: intent=${callerIntent.entryCount} recorded=${recordedPayload.entryCount}`,
    };
  }
  return 'pass';
};

export const migrateInvariants: ReadonlyArray<Invariant<MemoryMigratePayload>> = [
  sourceNamespaceEquality,
  destinationNamespaceEquality,
  entryCountEquality,
];
