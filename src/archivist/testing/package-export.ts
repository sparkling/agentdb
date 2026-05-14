// charter: testing-surface
// Public re-export barrel for the @pkg/archivist/testing entrypoint.
// Intended to be reachable from test files only; the path is excluded from
// the main tsconfig.json's compilation surface and from production code's
// module resolution.
//
// To complete the package wiring, /Users/henrik/source/forks/agentdb/package.json
// `exports` map MUST gain an entry:
//
//   "./archivist/testing": {
//     "import": "./dist/src/archivist/testing/index.js",
//     "types": "./dist/src/archivist/testing/index.d.ts"
//   }
//
// Queen-sparc handles the package.json update; the file existing at this path
// is the precondition for that wire-up.

export {
  withTestContext,
  withTestReadContext,
  makeFsJsonSubstrateFixture,
  treeDepth,
  flattenTree,
  unorderedEqualForParallel,
} from './index.js';

export type {
  WithTestContextOpts,
  WithTestReadContextOpts,
  TestResult,
  ReadTestResult,
  BulkManifest,
  HotPathTestView,
  HotPathPostWriteTrigger,
  GuardPolicy,
  AuditNode,
  FsJsonSubstrateFixture,
  LockWait,
} from './index.js';
