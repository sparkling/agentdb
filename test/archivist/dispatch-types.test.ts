// charter: dispatch
// ADR-0181 Phase 5 — typed dispatch overload conformance test.
//
// `Archivist.dispatch` / `Archivist.dispatchRead` carry a typed overload
// keyed on `ToolPayloadMap`. This test is the compile-time gate: it asserts
// that
//   (a) a valid `(toolName, payload)` pair type-checks,
//   (b) a wrong tool name fails compilation when callers use the typed form,
//   (c) a mismatched payload (for a real tool name) fails compilation.
//
// `// @ts-expect-error` is the load-bearing assertion — if a check below ever
// stops being an error (e.g. someone weakens the overload to `string` or
// loosens `ToolPayloadMap[K]`), `tsc` flips the directive into "unused
// @ts-expect-error" and the build fails. The runtime expectations below
// (`expect(typeof ...).toBe('function')`) are secondary — they prove the
// methods exist; the value-level compile-time errors are the real test.
//
// Note on the fallback overload: per ADR-0181 Phase 5 ruling, `Archivist`
// retains a deprecated `(toolName: string, payload: unknown)` signature so
// pre-flip callers still type-check. That means an unknown literal like
// `'unknown_xyz'` *does* satisfy the fallback — to verify the typed overload's
// strictness independent of the fallback, the unknown-tool-name assertions
// below go through a strictly-typed wrapper (`TypedDispatch`) that exposes
// only the typed signature.

import { describe, it, expect } from 'vitest';
import {
  Archivist,
  type ToolPayloadMap,
} from '../../src/archivist/index.js';
import type { MemoryStorePayload } from '../../src/archivist/handlers/memory/store.js';
import type { MemorySearchQuery } from '../../src/archivist/handlers/memory/search.js';

// Strict wrapper types that expose ONLY the typed overload — used to verify
// unknown-tool-name rejection, which the deprecated string fallback overload
// would otherwise mask. cli call sites that want maximum compile-time
// strictness can declare their own variable with this shape; future phases
// will retire the string fallback and these wrappers become unnecessary.
type TypedDispatch = <K extends keyof ToolPayloadMap>(
  tool: K,
  payload: ToolPayloadMap[K],
) => Promise<unknown>;
type TypedDispatchRead = TypedDispatch;

describe('Archivist typed dispatch overloads (ADR-0181 Phase 5)', () => {
  it('typed dispatch accepts a valid (tool, payload) pair', () => {
    const archivist = new Archivist();

    // Valid mutation call — type-checks. We don't await it (no backend wired
    // in this unit test); we just need the call expression to compile.
    const validPayload: MemoryStorePayload = {
      namespace: 'unit-test',
      key: 'k1',
      content: 'hello',
    };
    const p: Promise<unknown> = archivist.dispatch('memory_store', validPayload);
    void p;

    // Valid read call — type-checks.
    const validQuery: MemorySearchQuery = {
      text: 'hello',
      limit: 5,
    };
    const r: Promise<unknown> = archivist.dispatchRead('memory_search', validQuery);
    void r;

    expect(typeof archivist.dispatch).toBe('function');
    expect(typeof archivist.dispatchRead).toBe('function');
  });

  it('typed dispatch rejects an unknown tool name at compile time', () => {
    const archivist = new Archivist();
    const payload: MemoryStorePayload = {
      namespace: 'unit-test',
      key: 'k1',
      content: 'hello',
    };

    // Bind the dispatch methods through a strictly-typed local that exposes
    // only the typed overload — this is the surface cli call sites get once
    // the deprecated fallback is retired. With the fallback removed from the
    // call-site type, an unknown tool name is a hard compile error.
    const typedDispatch: TypedDispatch = archivist.dispatch.bind(archivist);
    const typedDispatchRead: TypedDispatchRead =
      archivist.dispatchRead.bind(archivist);

    // @ts-expect-error — 'unknown_tool_xyz' is not a registered tool name
    const p: Promise<unknown> = typedDispatch('unknown_tool_xyz', payload);
    void p;

    // @ts-expect-error — 'unknown_tool_xyz' is not a registered tool name
    const r: Promise<unknown> = typedDispatchRead('unknown_tool_xyz', payload);
    void r;

    expect(typeof archivist.dispatch).toBe('function');
  });

  it('typed dispatch rejects a mismatched payload at compile time', () => {
    const archivist = new Archivist();

    // Same rationale as the unknown-tool-name test: the deprecated string
    // fallback overload (`(toolName: string, payload: unknown)`) would
    // otherwise accept any `(string, anything)` pair and the @ts-expect-error
    // directives would be flagged as unused. Bind through the strict wrapper
    // so only the typed overload is in scope — this is the surface cli call
    // sites get once the fallback is retired.
    const typedDispatch: TypedDispatch = archivist.dispatch.bind(archivist);
    const typedDispatchRead: TypedDispatchRead =
      archivist.dispatchRead.bind(archivist);

    // 'memory_store' is registered with payload type `MemoryStorePayload`
    // (`namespace` / `key` / `content` required). An empty object lacks the
    // required fields — typed overload rejects.
    // @ts-expect-error — '{}' is missing required fields of MemoryStorePayload
    const p1: Promise<unknown> = typedDispatch('memory_store', {});
    void p1;

    // 'memory_search' is a read with payload `MemorySearchQuery` (requires
    // `text`). Passing a `MemoryStorePayload` shape is a mismatch.
    // @ts-expect-error — MemoryStorePayload is not assignable to MemorySearchQuery
    const p2: Promise<unknown> = typedDispatchRead('memory_search', {
      namespace: 'x',
      key: 'k',
      content: 'c',
    });
    void p2;

    // Passing a string where an object payload is required.
    // @ts-expect-error — 'not-a-payload' is not assignable to MemoryStorePayload
    const p3: Promise<unknown> = typedDispatch('memory_store', 'not-a-payload');
    void p3;

    expect(typeof archivist.dispatch).toBe('function');
  });

  it('ToolPayloadMap is non-empty and covers core surfaces', () => {
    // Sanity check: spot-check a handful of well-known tool names so a
    // regression that empties the map (e.g. a renamed file leaving the import
    // resolving to `never`) shows up here too. Compile-time assertion via
    // `satisfies` keeps these as static-only checks — if any of these keys is
    // ever removed from `ToolPayloadMap`, the `Pick<>` collapses and the
    // satisfies-check fails at tsc.
    type CoreTools =
      | 'memory_store'
      | 'memory_search'
      | 'agentdb_route'
      | 'swarm_init'
      | 'hive-mind_spawn'
      | 'claims_claim'
      | 'task_create'
      | 'hook_pre_task'
      | 'daemon_autoMemoryBridge';
    const coverage = {
      memory_store: true,
      memory_search: true,
      agentdb_route: true,
      swarm_init: true,
      'hive-mind_spawn': true,
      claims_claim: true,
      task_create: true,
      hook_pre_task: true,
      daemon_autoMemoryBridge: true,
    } satisfies Record<keyof Pick<ToolPayloadMap, CoreTools>, true>;
    expect(Object.keys(coverage).length).toBe(9);
  });
});
