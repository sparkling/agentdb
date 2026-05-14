// charter: substrate-seam
//
// PATH-RESTRICTED MODULE — only files under `src/archivist/**` may import this module.
// Other paths fail at type-check via the tsconfig path-restriction rule
// (`tsconfig.archivist.json` is a TypeScript project reference; the main `tsconfig.json`
// excludes the consumer-facing import). ESLint `no-restricted-imports` on
// `archivist/substrate-internal` is a defense-in-depth backstop (per ADR-0180
// §Type enforcement, lines ~98-100).
//
// What this module owns:
//   - The branded `SubstrateAccess` constructor (`makeSubstrateAccess`).
//   - The branded `ReadOnlySubstrateAccess` constructor (`makeReadOnlySubstrateAccess`).
//
// What this module does NOT own:
//   - Specific substrate implementations (better-sqlite3, RVF, fs-json fixtures).
//     Those live in `forks/agentdb/src/backends/**` and `archivist/testing/**`.
//     The factories below take a generic `SubstrateHandle` and return the branded
//     opaque type that handlers can call but cannot deconstruct.
//
// Stores cannot import this file under any name; their barrels are typed
// `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` which has no shape
// admitting `SubstrateAccess` as an export.

import type {
  ReadOnlySubstrateAccess,
  ReadOnlySubstrateHandle,
  SubstrateAccess,
  SubstrateHandle,
} from './types';

/**
 * Internal factory. Mints a branded `SubstrateAccess` from a raw handle.
 * The brand attachment is invisible to consumers — the returned value IS the
 * handle, just typed as `SubstrateAccess` rather than `SubstrateHandle`. This
 * is the seam ADR-0180 §Type enforcement protects via path restriction.
 */
export function makeSubstrateAccess(handle: SubstrateHandle): SubstrateAccess {
  // Brand attachment is type-level only; runtime is the raw handle. This is
  // intentional — branded types in TypeScript are zero-cost at runtime.
  return handle as SubstrateAccess;
}

/**
 * Read-only counterpart. Returns the branded `ReadOnlySubstrateAccess` whose
 * write methods are absent from the type — `withWrite`/`withBulkWrite` are
 * unreachable even with `as any` because the structural type carries no such
 * members (handlers wanting writes need to register via `registerMutationHandler`).
 */
export function makeReadOnlySubstrateAccess(handle: ReadOnlySubstrateHandle): ReadOnlySubstrateAccess {
  return handle as ReadOnlySubstrateAccess;
}
