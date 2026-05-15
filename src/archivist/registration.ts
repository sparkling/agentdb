// charter: dispatch
// Handler registration + dispatch (ADR-0180 §Type enforcement, §Performance #4).
// `registerMutationHandler<T>` and `registerReadHandler<T, R>` return branded
// `GuardedWrite<T>` / `GuardedRead<T, R>` so a store's barrel typed
// `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` rejects non-branded
// exports at the type boundary.
//
// Hot-path overload: `{ hotPath: true }` narrows the handler's MutationContext
// to `MutationContext<true>` whose `child`/`bulk` are typed `never`. Compile-time
// enforcement of §Performance contract #4 ("hot-path writes are leaf intents").

import type { MutationContext } from './mutation-context.js';
import type { ReadContext } from './read-context.js';
import type { GuardedRead, GuardedWrite } from './types.js';

/** Cache scope hint for read handlers (used by archivist's cache-routing). */
export type CacheScope = 'namespace' | 'store' | 'global';

/**
 * Per-handler invariant predicate (§Mutation invariants — second correctness gate).
 * Returns `'pass'` or a violation. Evaluated at write-time BEFORE the audit entry
 * transitions to `applied`. NOT a guard — guards are policy, invariants are correctness.
 */
export type Invariant<T> = (args: {
  readonly callerIntent: T;
  readonly recordedPayload: T;
  readonly substrateStateBefore: unknown;
  readonly substrateStateAfter: unknown;
}) => 'pass' | { readonly violated: true; readonly detail: string };

/** Cold-path mutation handler signature. */
export type MutationHandlerFn<T> = (ctx: MutationContext<false>, payload: T) => Promise<void>;

/** Hot-path mutation handler signature — `child`/`bulk` are `never`-typed. */
export type HotPathMutationHandlerFn<T> = (ctx: MutationContext<true>, payload: T) => Promise<void>;

/** Read handler signature. */
export type ReadHandlerFn<T, R> = (ctx: ReadContext, payload: T) => Promise<R>;

export interface RegisterMutationOpts<T> {
  readonly hotPath?: boolean;
  readonly invariants?: ReadonlyArray<Invariant<T>>;
  readonly cacheScope?: CacheScope;
}

export interface RegisterReadOpts {
  readonly cacheScope?: CacheScope;
}

export interface MutationRegistryEntry {
  readonly handler: MutationHandlerFn<unknown> | HotPathMutationHandlerFn<unknown>;
  readonly hotPath: boolean;
  readonly invariants: ReadonlyArray<Invariant<unknown>>;
  readonly cacheScope?: CacheScope;
}

export interface ReadRegistryEntry {
  readonly handler: ReadHandlerFn<unknown, unknown>;
  readonly cacheScope?: CacheScope;
}

export type RegistryLookup =
  | { readonly kind: 'mutation'; readonly entry: MutationRegistryEntry }
  | { readonly kind: 'read'; readonly entry: ReadRegistryEntry };

const mutationRegistry = new Map<string, MutationRegistryEntry>();
const readRegistry = new Map<string, ReadRegistryEntry>();

/**
 * Register a mutation handler. Overload #1 (cold path): default. Overload #2 (hot path):
 * `opts.hotPath === true` narrows the context type so `child()`/`bulk()` calls are
 * compile errors inside the handler body.
 */
export function registerMutationHandler<T>(
  name: string,
  handler: HotPathMutationHandlerFn<T>,
  opts: RegisterMutationOpts<T> & { hotPath: true },
): GuardedWrite<T>;
export function registerMutationHandler<T>(
  name: string,
  handler: MutationHandlerFn<T>,
  opts?: RegisterMutationOpts<T>,
): GuardedWrite<T>;
export function registerMutationHandler<T>(
  name: string,
  handler: MutationHandlerFn<T> | HotPathMutationHandlerFn<T>,
  opts: RegisterMutationOpts<T> = {},
): GuardedWrite<T> {
  if (mutationRegistry.has(name)) {
    throw new Error(`archivist: mutation handler '${name}' already registered`);
  }
  mutationRegistry.set(name, {
    handler: handler as MutationHandlerFn<unknown> | HotPathMutationHandlerFn<unknown>,
    hotPath: Boolean(opts.hotPath),
    invariants: (opts.invariants ?? []) as ReadonlyArray<Invariant<unknown>>,
    cacheScope: opts.cacheScope,
  });
  // The brand is type-level; runtime is the bare handler. The dispatch boundary
  // is what enforces context shape — branding prevents store-barrel exports of
  // unguarded handler-like functions at compile time.
  return handler as unknown as GuardedWrite<T>;
}

/** Register a read handler. Returns a branded `GuardedRead<T, R>`. */
export function registerReadHandler<T, R>(
  name: string,
  handler: ReadHandlerFn<T, R>,
  opts: RegisterReadOpts = {},
): GuardedRead<T, R> {
  if (readRegistry.has(name)) {
    throw new Error(`archivist: read handler '${name}' already registered`);
  }
  readRegistry.set(name, {
    handler: handler as ReadHandlerFn<unknown, unknown>,
    cacheScope: opts.cacheScope,
  });
  return handler as unknown as GuardedRead<T, R>;
}

/**
 * Internal dispatch. Looks up the handler by name and invokes it with the supplied
 * context. The archivist runtime is the only caller — the dispatch boundary mints
 * `MutationContext` / `ReadContext` instances and delivers them to handlers.
 */
export async function dispatchMutation(
  name: string,
  ctx: MutationContext<boolean>,
  payload: unknown,
): Promise<void> {
  const entry = mutationRegistry.get(name);
  if (!entry) {
    throw new Error(`archivist: mutation tool not registered '${name}'`);
  }
  await (entry.handler as MutationHandlerFn<unknown>)(ctx as MutationContext<false>, payload);
}

export async function dispatchRead(name: string, ctx: ReadContext, payload: unknown): Promise<unknown> {
  const entry = readRegistry.get(name);
  if (!entry) {
    throw new Error(`archivist: read tool not registered '${name}'`);
  }
  return entry.handler(ctx, payload);
}

/**
 * Internal — registry lookup for the `Archivist.dispatch` public surface. Returns
 * a discriminated lookup so the dispatcher can branch on mutation vs read without
 * exposing the raw `Map`s. `undefined` when no handler is registered under `name`.
 */
export function getRegistration(name: string): RegistryLookup | undefined {
  const mutation = mutationRegistry.get(name);
  if (mutation) return { kind: 'mutation', entry: mutation };
  const read = readRegistry.get(name);
  if (read) return { kind: 'read', entry: read };
  return undefined;
}

/** Internal — registry introspection for tests + the charter-conformance check. */
export function listMutationHandlers(): ReadonlyArray<{ readonly name: string; readonly hotPath: boolean }> {
  return Array.from(mutationRegistry.entries()).map(([name, entry]) => ({
    name,
    hotPath: entry.hotPath,
  }));
}

export function listReadHandlers(): ReadonlyArray<string> {
  return Array.from(readRegistry.keys());
}

/** Internal — clear registry. Used by test fixtures, never by production. */
export function __resetRegistry__(): void {
  mutationRegistry.clear();
  readRegistry.clear();
}
