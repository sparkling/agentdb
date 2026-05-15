// charter: type-enforcement
// Runtime shape for MutationContext (ADR-0180 §Type enforcement, Follow-up #3).
// The constructor is INTERNAL — `createMutationContext` is not re-exported from
// the archivist's public surface (`index.ts`). Stores receive contexts only as
// arguments delivered by the archivist runtime; they cannot mint their own.

import type { BulkIntent, SubstrateAccess } from './types.js';
import type { GuardVerdict } from './guards-types.js';
import type { MutationCapabilities } from './capabilities.js';

/** Child-context relationship metadata recorded in the audit tree. */
export type ChildMode = 'sequential' | 'parallel';

/**
 * Public-facing MutationContext interface (Follow-up #3 disposition).
 * `HotPath` is a type-level toggle: when `true`, `child` and `bulk` become `never`
 * — compile-time enforcement of §Performance contract #4 ("hot-path writes are
 * leaf intents; no re-entrancy"). The runtime back-stop in §Performance still
 * applies for `as any` escapes.
 */
export interface MutationContext<HotPath extends boolean = false> {
  readonly auditId: string;
  readonly originatingTool: string;
  readonly guardVerdicts: ReadonlyArray<GuardVerdict>;
  readonly timestamp: number;
  readonly substrate: SubstrateAccess;

  /**
   * Resolved project root (`ArchivistInitConfig.projectRoot ?? process.cwd()`).
   * The archivist threads the *same* value it uses for FS-JSON substrate paths
   * onto every context, so handlers that need a project-relative path for
   * non-substrate reasons — `handlers/hooks/session-end.ts` resolving the daemon
   * Unix socket at `<projectRoot>/.claude-flow/daemon.sock` — agree with the
   * substrate layer instead of each calling `process.cwd()` independently
   * (ADR-0180 F4-2 Phase C, closing that handler's `TODO(F4-2-config)` fully).
   */
  readonly projectRoot: string;

  /**
   * Narrow capability handles wired by `initialize(config)` (ADR-0180 F4-2
   * Phase C). NOT raw controllers — each is the smallest surface the handler
   * needs (see `capabilities.ts`), preserving the type-enforcement boundary the
   * substrate brand also protects. Mutation-side: `taskRouter` (route trajectory
   * computation) + `embeddingScorer` (vectorize the task for the RVF write).
   * Unwired capabilities fail loud at the `require*` accessor.
   */
  readonly capabilities: MutationCapabilities;

  /** Re-entrancy — typed `never` on hot-path contexts. */
  readonly child: HotPath extends true ? never : (reason: string, mode?: ChildMode) => MutationContext<false>;

  /** Bulk-write entry — typed `never` on hot-path contexts (cross-mode constraint per §20). */
  readonly bulk: HotPath extends true ? never : (intent: BulkIntent, payload: unknown) => Promise<void>;
}

/** Hot-path narrowing — `MutationContext<true>` is the canonical alias. */
export type HotPathMutationContext = MutationContext<true>;

/**
 * Internal factory inputs. NOT exported from the archivist's public `index.ts`.
 * `__substrate__` is the path-restricted SubstrateAccess minted in
 * `substrate-internal.ts`. The archivist runtime is the only legitimate caller.
 */
export interface CreateMutationContextInput {
  readonly auditId: string;
  readonly originatingTool: string;
  readonly guardVerdicts: ReadonlyArray<GuardVerdict>;
  readonly timestamp: number;
  readonly substrate: SubstrateAccess;
  readonly projectRoot: string;
  readonly capabilities: MutationCapabilities;
  readonly parent?: { readonly auditId: string; readonly mode: ChildMode };
  readonly bulkDispatch: (intent: BulkIntent, payload: unknown) => Promise<void>;
  readonly mintChildAuditId: () => string;
}

/**
 * Internal constructor. Exported only for archivist-internal callers (registration,
 * dispatch, testing helpers under `archivist/testing/**`). Not re-exported from
 * `index.ts` — store code cannot import this directly under the production tsconfig.
 */
export function createMutationContext(input: CreateMutationContextInput): MutationContext<false> {
  const childFactory = (reason: string, mode: ChildMode = 'sequential'): MutationContext<false> =>
    createMutationContext({
      ...input,
      auditId: input.mintChildAuditId(),
      parent: { auditId: input.auditId, mode },
      // Reuse the same bulkDispatch + mint function in children. Reason is recorded
      // by the audit-writer when the child entry opens; not part of the context shape.
    });

  return {
    auditId: input.auditId,
    originatingTool: input.originatingTool,
    guardVerdicts: input.guardVerdicts,
    timestamp: input.timestamp,
    substrate: input.substrate,
    projectRoot: input.projectRoot,
    capabilities: input.capabilities,
    child: childFactory as MutationContext<false>['child'],
    bulk: input.bulkDispatch as MutationContext<false>['bulk'],
  };
}

/**
 * Internal hot-path constructor variant. Returns a context whose `child`/`bulk`
 * are runtime no-ops that throw — the TypeScript `never` typing makes any callsite
 * a compile error, but the runtime backstop ensures `as any` escapes fail loudly
 * rather than silently producing degenerate audit entries.
 */
export function createHotPathMutationContext(
  input: Omit<CreateMutationContextInput, 'bulkDispatch' | 'mintChildAuditId'>,
): MutationContext<true> {
  const violate = (op: string) => () => {
    throw new Error(
      `archivist: hot-path MutationContext does not support ${op} (ADR-0180 §Performance #4)`,
    );
  };
  return {
    auditId: input.auditId,
    originatingTool: input.originatingTool,
    guardVerdicts: input.guardVerdicts,
    timestamp: input.timestamp,
    substrate: input.substrate,
    projectRoot: input.projectRoot,
    capabilities: input.capabilities,
    child: violate('child()') as never,
    bulk: violate('bulk()') as never,
  };
}
