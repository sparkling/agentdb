// charter: dispatch
// Barrel for archivist browser_* mutation handlers (ADR-0180 Phase 5 wave 2).
//
// EMPTY ON PURPOSE. Body inspection of
// `cli/src/mcp-tools/browser-tools.ts` (704 LoC, 22 tools) shows that every
// browser_* handler in the cli delegates to the external `agent-browser`
// binary via `execBrowserCommand`. None of them persist substrate state:
//
//   - Navigation (open / back / forward / reload / close) drives Chrome.
//   - Snapshot / screenshot read from the live page.
//   - Interaction (click / fill / type / press / hover / select / check /
//     uncheck / scroll) sends events to the page.
//   - Info retrieval (get-text / get-value / get-title / get-url) reads from
//     the live page.
//   - Wait / eval drive the page.
//   - session-list is a pure read from the in-memory `browserSessions` Map.
//
// The only state the cli writes is the process-local `browserSessions` Map
// (created on `browser_open`, deleted on `browser_close`). That Map is NOT
// substrate state: it does not survive process restart, is not under the
// archivist's O_EXCL lock or audit chain, and has no JSON file under any
// store-tree. It is runtime-only bookkeeping, equivalent to a connection
// pool's in-memory client registry.
//
// Per the wave-1 claims-migrator precedent (no substrate mutators ⇒ no
// registrations), this barrel registers zero handlers. The directory exists
// so future tooling that genuinely persists browser state (e.g. an
// `agent-browser` session-recorder writing trace files to a store) has a
// natural home, but stub-registering pure-runtime browser ops as substrate
// mutators would mislead dispatch and pollute the registry.
export {};
