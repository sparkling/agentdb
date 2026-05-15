// charter: dispatch
// Top-level barrel for ALL archivist handler families (ADR-0180 / ADR-0181).
//
// Each per-domain handler module performs a side-effecting
// `registerReadHandler` / `registerMutationHandler` call at top level. The
// registry is populated by IMPORTING the module — NOT by calling anything
// from it. So consumers (the cli, the worker daemon) must import this
// barrel BEFORE the first `archivist.dispatch(...)` / `dispatchRead(...)`
// or the dispatch site throws
// `archivist: no handler registered for tool '<name>'` (registry.ts).
//
// `archivist/index.ts` does a side-effect import of this barrel so simply
// importing `Archivist` from `@sparkleideas/agentdb/archivist` is enough
// to trigger registration. The per-domain `*/index.ts` re-export pattern
// (`export * from './spawn.js';` etc.) ensures every concrete handler
// module is loaded — tree-shaking does NOT prune this since each module's
// top-level `registerMutationHandler(...)` is a side effect.
//
// Order of imports is irrelevant — handlers are keyed by tool name in a
// per-module-load Map (see `registration.ts`). The only invariant is that
// no two handlers register under the same tool name, enforced by the
// registry (it throws on duplicate registration).
//
// Per `feedback-no-fallbacks`: there is no try/catch around these imports.
// A handler module that fails to load is a fatal config error — the
// dispatch surface depending on it would throw anyway, and surfacing it
// at archivist-init time gives a clearer stack.

// Side-effect-only imports (no re-export) — sub-barrels may re-export
// type aliases with overlapping names (e.g. `AgentRecord`), which a
// top-level `export *` would surface as TS2308 ambiguity. The registry
// only needs each module to load; consumers that need a specific
// handler import the sub-barrel directly.
import './agentdb/index.js';
import './agents/index.js';
import './autopilot/index.js';
import './browser/index.js';
import './claims/index.js';
import './config/index.js';
import './coordination/index.js';
import './daa/index.js';
import './daemons/index.js';
import './github/index.js';
import './hive-mind/index.js';
import './hooks/index.js';
import './memory/index.js';
import './neural/index.js';
import './performance/index.js';
import './progress/index.js';
import './ruvllm/index.js';
import './swarm/index.js';
import './system/index.js';
import './tasks/index.js';
import './wasm/index.js';
import './workflow/index.js';
