// charter: dispatch
// Per-handler unit test for `task_create` — covers the caller-supplied taskId
// override added to fix the cli's parallel-create race (handover § Bug 1).
//
// Background: the cli wrapper (forks/ruflo/.../task-tools.ts) used to recover
// the handler-minted taskId via a pre/post store-snapshot diff. Under
// `run_check_bg cap=12` parallel acceptance execution the diff was racy:
// concurrent task_create calls landed in the post-snapshot, surfacing as
// "expected exactly 1 new task, found 2". The fix lets the cli pre-mint the
// id and pass it through `payload.taskId`. Non-cli callers can still omit
// `taskId` and the handler mints one (back-compat).

import { describe, it, expect } from 'vitest';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
} from '../../../../src/archivist/testing/index.js';
import { taskCreateHandler } from '../../../../src/archivist/handlers/tasks/create.js';
import type { TaskStore } from '../../../../src/archivist/handlers/tasks/shared.js';

describe('task_create handler — caller-supplied taskId (handover § Bug 1)', () => {
  it('honours payload.taskId verbatim when supplied', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['tasks'] });

    await withTestContext(
      taskCreateHandler,
      {
        taskId: 'task-cli-pre-minted-abc123',
        type: 'feature',
        description: 'cli pre-minted id passes through',
      },
      { substrate: fixture },
    );

    const stored = fixture.files.get('tasks') as { root: TaskStore } | undefined;
    expect(stored?.root.tasks['task-cli-pre-minted-abc123']).toBeDefined();
    expect(stored?.root.tasks['task-cli-pre-minted-abc123'].type).toBe('feature');
    // Exactly one task — the supplied id is the only key.
    expect(Object.keys(stored?.root.tasks ?? {})).toEqual(['task-cli-pre-minted-abc123']);
  });

  it('mints a task-* id when payload.taskId is absent (back-compat for non-cli callers)', async () => {
    const fixture = makeFsJsonSubstrateFixture({ files: ['tasks'] });

    await withTestContext(
      taskCreateHandler,
      {
        type: 'bugfix',
        description: 'no taskId supplied — handler mints',
      },
      { substrate: fixture },
    );

    const stored = fixture.files.get('tasks') as { root: TaskStore } | undefined;
    const ids = Object.keys(stored?.root.tasks ?? {});
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^task-\d+-[a-z0-9]+$/);
  });

  it('serializes concurrent caller-supplied creates without id collisions', async () => {
    // Mirrors the parallel test execution shape (cap=12 in acceptance harness).
    // Each concurrent call supplies a distinct pre-minted id; all 12 records
    // must land in the store under their supplied keys with no diff drift.
    const fixture = makeFsJsonSubstrateFixture({
      files: ['tasks'],
      lockHoldMs: 5,
    });

    const ids = Array.from({ length: 12 }, (_, i) => `task-parallel-${i}`);
    await Promise.all(
      ids.map((taskId, i) =>
        withTestContext(
          taskCreateHandler,
          {
            taskId,
            type: 'feature',
            description: `parallel create #${i}`,
          },
          { substrate: fixture },
        ),
      ),
    );

    const stored = fixture.files.get('tasks') as { root: TaskStore } | undefined;
    const storedIds = Object.keys(stored?.root.tasks ?? {}).sort();
    expect(storedIds).toEqual([...ids].sort());
  });
});
