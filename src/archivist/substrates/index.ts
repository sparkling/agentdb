// charter: substrate-seam
//
// Public surface of the `substrates/` subdirectory. Production substrate
// factories live here — they consume the path-restricted
// `substrate-internal.ts` brand-mint to return branded `SubstrateAccess`.
//
// Phase 4 deliverable: `makeFsJsonSubstrate` (lifted from hive-mind-tools.ts
// per ADR-0180 §Caller surfaces Recommendation, lines 484-521).
// Phase 5/6 expand this barrel with `makeSqliteSubstrate` and
// `makeRvfSubstrate` per the same recommendation.

export { makeFsJsonSubstrate, writeMultiFileAtomic } from './fs-json-store';
export type {
  MakeFsJsonSubstrateOpts,
  MultiFileTarget,
  MultiFileWriteResult,
} from './fs-json-store';
export * from './rvf-store';
export * from './sqlite-store';
