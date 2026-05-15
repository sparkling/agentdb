// charter: substrate-seam
// ADR-0181 Phase 5 DA-memo CF#6 — register-time path-alignment-check.
//
// `auditFsJsonPathOverrides()` is a structural validator over the two
// FS_JSON_PATH_OVERRIDES maps in substrate-registry.ts. It catches typos,
// absolute paths, leading/trailing slashes, backslash separators, and `..`
// path-traversal attempts. `assertFsJsonPathOverridesAligned()` is the
// fail-loud wrapper called by `Archivist.initialize()` on the real-config
// path.
//
// What this test does NOT cover (by design):
//   - Cross-package cli-vs-archivist path divergence: requires introspecting
//     the cli's `loadXxxStore()` paths from a different package, not
//     practical from this module. The four documented Phase-2/Phase-5
//     incidents would not have been caught by structural validation; this
//     guard catches the next class of bug, not the prior one.

import { describe, it, expect } from 'vitest';
import {
  auditFsJsonPathOverrides,
  assertFsJsonPathOverridesAligned,
  inspectOverrideEntry,
} from '../../src/archivist/substrate-registry.js';

describe('auditFsJsonPathOverrides', () => {
  it('passes for the current FS_JSON_PATH_OVERRIDES maps', () => {
    const report = auditFsJsonPathOverrides();
    expect(report.checked).toBeGreaterThan(0);
    if (report.violations.length > 0) {
      // Print every violation in the failure message so a regression is
      // diagnosable from the test output alone, not "rerun with debugger."
      const lines = report.violations.map(
        (v) => `  - storeId='${v.storeId}' (${v.map}) relPath='${v.relPath}': ${v.reason}`,
      );
      throw new Error(
        `expected zero structural violations in FS_JSON_PATH_OVERRIDES, got ${report.violations.length}:\n${lines.join(
          '\n',
        )}`,
      );
    }
    expect(report.violations).toEqual([]);
  });

  it('checks both override maps (claude-flow + project-root)', () => {
    const report = auditFsJsonPathOverrides();
    // The claude-flow map has ~25 entries, project-root has 2 (swarm_init,
    // swarm_shutdown). Lower-bound the count so a future map collapse
    // surfaces here rather than silently dropping coverage.
    expect(report.checked).toBeGreaterThanOrEqual(25);
  });
});

describe('assertFsJsonPathOverridesAligned', () => {
  it('does not throw on the current registered overrides', () => {
    expect(() => assertFsJsonPathOverridesAligned()).not.toThrow();
  });
});

describe('inspectOverrideEntry violation branches', () => {
  it('flags empty relative path', () => {
    expect(inspectOverrideEntry('foo', '', 'claude-flow')).toEqual({
      storeId: 'foo',
      relPath: '',
      map: 'claude-flow',
      reason: 'empty-relative-path',
    });
  });

  it('flags POSIX absolute path', () => {
    const v = inspectOverrideEntry('foo', '/etc/passwd', 'claude-flow');
    expect(v?.reason).toBe('absolute-path');
  });

  it('flags Windows-drive absolute path', () => {
    const v = inspectOverrideEntry('foo', 'C:\\data\\store.json', 'project-root');
    expect(v?.reason).toBe('absolute-path');
  });

  it('flags trailing slash', () => {
    const v = inspectOverrideEntry('foo', 'tasks/', 'claude-flow');
    expect(v?.reason).toBe('leading-or-trailing-slash');
  });

  it('flags backslash separator', () => {
    const v = inspectOverrideEntry('foo', 'tasks\\store.json', 'claude-flow');
    expect(v?.reason).toBe('backslash-separator');
  });

  it('flags `..` path-traversal', () => {
    const v = inspectOverrideEntry('foo', '../sibling/store.json', 'claude-flow');
    expect(v?.reason).toBe('path-traversal');
  });

  it('flags embedded `..` segment', () => {
    const v = inspectOverrideEntry('foo', 'a/../b/store.json', 'claude-flow');
    expect(v?.reason).toBe('path-traversal');
  });

  it('returns null for a well-formed entry', () => {
    expect(inspectOverrideEntry('tasks', 'tasks/store.json', 'claude-flow')).toBeNull();
    expect(inspectOverrideEntry('swarm_init', '.swarm/swarm-state.json', 'project-root')).toBeNull();
  });
});
