// charter: dispatch
// ADR-0181 Phase 5 — typed dispatch surface (F4-3 cli delegation prerequisite).
//
// `ToolPayloadMap` is a literal-keyed map from registered MCP tool name → the
// payload type the handler accepts. It exists so the public `Archivist.dispatch`
// / `Archivist.dispatchRead` entry points can carry a typed overload —
// `dispatch<K extends keyof ToolPayloadMap>(tool: K, payload: ToolPayloadMap[K])`
// — and a typo in the tool name OR a mismatched payload becomes a compile-time
// error at the cli call site, not a fail-loud at runtime.
//
// The map is the union of every `registerMutationHandler<T>(...)` and
// `registerReadHandler<T, R>(...)` call across `handlers/**`. For read handlers
// only the *input* type (the `T`, never the `R`) is the map value — the
// dispatch overload is for the *call site*, not the return type.
//
// Source of truth: the registration call itself. When a new handler is added
// (or removed), this file is updated alongside it; the unit test in
// `test/archivist/dispatch-types.test.ts` is the compile-time gate that catches
// drift between this map and the registry.
//
// Keep the existing untyped `dispatch(toolName: string, payload: unknown)`
// signature on `Archivist` as a *fallback* overload (marked `@deprecated`) so
// callers that have not yet flipped to the typed form still type-check. The
// transition is per-mcp-tools-file per the Phase 5 recon — once every cli file
// has flipped, the fallback overload can be retired in a future phase.

import type { AgentdbCausalRecallQuery } from './handlers/agentdb/causal-recall.js';
import type { AgentdbEmbedQuery } from './handlers/agentdb/embed.js';
import type { AgentdbExperienceRecordPayload } from './handlers/agentdb/experience-record.js';
import type { AgentdbFeedbackPayload } from './handlers/agentdb/feedback.js';
import type { AgentdbFilteredSearchQuery } from './handlers/agentdb/filtered-search.js';
import type { AgentdbHierarchicalRecallQuery } from './handlers/agentdb/hierarchical-recall.js';
import type { AgentdbHierarchicalStorePayload } from './handlers/agentdb/hierarchical-store.js';
import type { AgentdbGnnStatsQuery } from './handlers/agentdb/gnn-stats.js';
import type { AgentdbNeuralPatternsQuery } from './handlers/agentdb/neural-patterns.js';
import type { AgentdbPatternSearchQuery } from './handlers/agentdb/pattern-search.js';
import type { AgentdbPatternStorePayload } from './handlers/agentdb/pattern-store.js';
import type { AgentdbReflexionRetrieveQuery } from './handlers/agentdb/reflexion-retrieve.js';
import type { AgentdbReflexionStorePayload } from './handlers/agentdb/reflexion-store.js';
import type { AgentdbRoutePayload } from './handlers/agentdb/route.js';
import type { AgentdbSemanticRouteQuery } from './handlers/agentdb/semantic-route.js';
import type { AgentdbSkillCreatePayload } from './handlers/agentdb/skill-create.js';
import type { AgentdbSkillSearchQuery } from './handlers/agentdb/skill-search.js';
import type { AgentdbSonaTrajectoryStorePayload } from './handlers/agentdb/sona-trajectory-store.js';
import type { AgentExecutePayload } from './handlers/agents/execute.js';
import type { AgentPoolPayload } from './handlers/agents/pool.js';
import type { AgentSpawnPayload } from './handlers/agents/spawn.js';
import type { AgentTerminatePayload } from './handlers/agents/terminate.js';
import type { AgentUpdatePayload } from './handlers/agents/update.js';
import type { AutopilotConfigPayload } from './handlers/autopilot/config.js';
import type { AutopilotDisablePayload } from './handlers/autopilot/disable.js';
import type { AutopilotEnablePayload } from './handlers/autopilot/enable.js';
import type { AutopilotLearnPayload } from './handlers/autopilot/learn.js';
import type { AutopilotResetPayload } from './handlers/autopilot/reset.js';
import type { ClaimsAcceptHandoffPayload } from './handlers/claims/accept-handoff.js';
import type { ClaimsClaimPayload } from './handlers/claims/claim.js';
import type { ClaimsHandoffPayload } from './handlers/claims/handoff.js';
import type { ClaimsMarkStealablePayload } from './handlers/claims/mark-stealable.js';
import type { ClaimsRebalancePayload } from './handlers/claims/rebalance.js';
import type { ClaimsReleasePayload } from './handlers/claims/release.js';
import type { ClaimsStatusPayload } from './handlers/claims/status.js';
import type { ClaimsStealPayload } from './handlers/claims/steal.js';
import type { ConfigImportPayload } from './handlers/config/import.js';
import type { ConfigResetPayload } from './handlers/config/reset.js';
import type { ConfigSetPayload } from './handlers/config/set.js';
import type { CoordinationConsensusPayload } from './handlers/coordination/consensus.js';
import type { CoordinationLoadBalancePayload } from './handlers/coordination/load-balance.js';
import type { CoordinationNodePayload } from './handlers/coordination/node.js';
import type { CoordinationOrchestratePayload } from './handlers/coordination/orchestrate.js';
import type { CoordinationSyncPayload } from './handlers/coordination/sync.js';
import type { CoordinationTopologyPayload } from './handlers/coordination/topology.js';
import type { DaaAgentAdaptPayload } from './handlers/daa/agent-adapt.js';
import type { DaaAgentCreatePayload } from './handlers/daa/agent-create.js';
import type { DaaCognitivePatternPayload } from './handlers/daa/cognitive-pattern.js';
import type { DaaKnowledgeSharePayload } from './handlers/daa/knowledge-share.js';
import type { DaaWorkflowCreatePayload } from './handlers/daa/workflow-create.js';
import type { DaaWorkflowExecutePayload } from './handlers/daa/workflow-execute.js';
import type { AuditWorkerPayload } from './handlers/daemons/audit.js';
import type { AutoMemoryBridgePayload } from './handlers/daemons/auto-memory-bridge.js';
import type { BenchmarkWorkerPayload } from './handlers/daemons/benchmark.js';
import type { ConsolidateWorkerPayload } from './handlers/daemons/consolidate.js';
import type { HooksLearningPayload } from './handlers/daemons/hooks-learning.js';
import type { MapWorkerPayload } from './handlers/daemons/map.js';
import type { OptimizeWorkerPayload } from './handlers/daemons/optimize.js';
import type { TestGapsWorkerPayload } from './handlers/daemons/testgaps.js';
import type { GithubIssueTrackPayload } from './handlers/github/issue-track.js';
import type { GithubPrManagePayload } from './handlers/github/pr-manage.js';
import type { GithubRepoAnalyzePayload } from './handlers/github/repo-analyze.js';
import type { GithubWorkflowPayload } from './handlers/github/workflow.js';
import type { PostEditPayload } from './handlers/hooks/post-edit.js';
import type { PostTaskPayload } from './handlers/hooks/post-task.js';
import type { PreTaskPayload } from './handlers/hooks/pre-task.js';
import type { SessionEndPayload } from './handlers/hooks/session-end.js';
import type { AgentsJsonPayload } from './handlers/hive-mind/agents-json.js';
import type { HiveMindBroadcastPayload } from './handlers/hive-mind/broadcast.js';
import type { HiveMindConsensusPayload } from './handlers/hive-mind/consensus.js';
import type { HiveMindInitPayload } from './handlers/hive-mind/init.js';
import type { HiveMindMemoryPayload } from './handlers/hive-mind/memory.js';
import type { HiveMindShutdownPayload } from './handlers/hive-mind/shutdown.js';
import type { HiveMindSpawnPayload } from './handlers/hive-mind/spawn.js';
import type { HiveMindStatusQuery } from './handlers/hive-mind/status.js';
import type { MemoryBridgeStatusQuery } from './handlers/memory/bridge-status.js';
import type { MemoryListQuery } from './handlers/memory/list.js';
import type { MemoryRetrieveQuery } from './handlers/memory/retrieve.js';
import type { MemorySearchQuery } from './handlers/memory/search.js';
import type { MemorySearchUnifiedQuery } from './handlers/memory/search-unified.js';
import type { MemoryStorePayload } from './handlers/memory/store.js';
import type { NeuralCompressPayload } from './handlers/neural/compress.js';
import type { NeuralOptimizePayload } from './handlers/neural/optimize.js';
import type { NeuralPatternsMutationPayload } from './handlers/neural/patterns.js';
import type { NeuralTrainPayload } from './handlers/neural/train.js';
import type { PerfBenchmarkPayload } from './handlers/performance/benchmark.js';
import type { PerfReportPayload } from './handlers/performance/report.js';
import type { ProgressSyncPayload } from './handlers/progress/sync.js';
import type { RuvllmHnswAddPayload } from './handlers/ruvllm/hnsw-add.js';
import type { RuvllmHnswCreatePayload } from './handlers/ruvllm/hnsw-create.js';
import type { RuvllmMicroLoraAdaptPayload } from './handlers/ruvllm/microlora-adapt.js';
import type { RuvllmMicroLoraCreatePayload } from './handlers/ruvllm/microlora-create.js';
import type { RuvllmSonaAdaptPayload } from './handlers/ruvllm/sona-adapt.js';
import type { RuvllmSonaCreatePayload } from './handlers/ruvllm/sona-create.js';
import type { SwarmInitPayload } from './handlers/swarm/init.js';
import type { SwarmShutdownPayload } from './handlers/swarm/shutdown.js';
import type { SystemHealthPayload } from './handlers/system/health.js';
import type { SystemMetricsPayload } from './handlers/system/metrics.js';
import type { SystemResetPayload } from './handlers/system/reset.js';
import type { TaskAssignPayload } from './handlers/tasks/assign.js';
import type { TaskCancelPayload } from './handlers/tasks/cancel.js';
import type { TaskCompletePayload } from './handlers/tasks/complete.js';
import type { TaskCreatePayload } from './handlers/tasks/create.js';
import type { TaskListPayload } from './handlers/tasks/list.js';
import type { TaskStatusPayload } from './handlers/tasks/status.js';
import type { TaskUpdatePayload } from './handlers/tasks/update.js';
import type { WasmAgentCreatePayload } from './handlers/wasm/create.js';
import type { WasmGalleryCreatePayload } from './handlers/wasm/gallery-create.js';
import type { WasmAgentPromptPayload } from './handlers/wasm/prompt.js';
import type { WasmAgentTerminatePayload } from './handlers/wasm/terminate.js';
import type { WasmAgentToolPayload } from './handlers/wasm/tool.js';
import type { WorkflowCancelPayload } from './handlers/workflow/cancel.js';
import type { WorkflowCreatePayload } from './handlers/workflow/create.js';
import type { WorkflowDeletePayload } from './handlers/workflow/delete.js';
import type { WorkflowExecutePayload } from './handlers/workflow/execute.js';
import type { WorkflowPausePayload } from './handlers/workflow/pause.js';
import type { WorkflowResumePayload } from './handlers/workflow/resume.js';
import type { WorkflowRunPayload } from './handlers/workflow/run.js';
import type { WorkflowTemplatePayload } from './handlers/workflow/template.js';

/**
 * Literal-keyed map from registered MCP tool name → payload type.
 *
 * Every `registerMutationHandler<T>(name, ...)` and
 * `registerReadHandler<T, R>(name, ...)` call across `handlers/**` contributes
 * one entry: the key is the literal first argument (the tool name); the value
 * is `T` (the input payload type — for reads, never `R`).
 *
 * Used by `Archivist.dispatch` / `Archivist.dispatchRead` typed overloads to
 * give cli call sites compile-time tool-name and payload-shape verification
 * (ADR-0181 Phase 5 F4-3 cli delegation prerequisite).
 *
 * Adding a handler: register the tool, then add the matching entry here. The
 * unit test at `test/archivist/dispatch-types.test.ts` is the compile-time
 * drift gate.
 */
export interface ToolPayloadMap {
  // agentdb_* (read + mutation)
  readonly agentdb_causal_recall: AgentdbCausalRecallQuery;
  readonly agentdb_embed: AgentdbEmbedQuery;
  readonly agentdb_experience_record: AgentdbExperienceRecordPayload;
  readonly agentdb_feedback: AgentdbFeedbackPayload;
  readonly agentdb_filtered_search: AgentdbFilteredSearchQuery;
  readonly agentdb_hierarchical_recall: AgentdbHierarchicalRecallQuery;
  readonly agentdb_hierarchical_store: AgentdbHierarchicalStorePayload;
  readonly agentdb_gnn_stats: AgentdbGnnStatsQuery;
  readonly agentdb_neural_patterns: AgentdbNeuralPatternsQuery;
  readonly agentdb_pattern_search: AgentdbPatternSearchQuery;
  readonly agentdb_pattern_store: AgentdbPatternStorePayload;
  readonly agentdb_reflexion_retrieve: AgentdbReflexionRetrieveQuery;
  readonly agentdb_reflexion_store: AgentdbReflexionStorePayload;
  readonly agentdb_route: AgentdbRoutePayload;
  readonly agentdb_semantic_route: AgentdbSemanticRouteQuery;
  readonly agentdb_skill_create: AgentdbSkillCreatePayload;
  readonly agentdb_skill_search: AgentdbSkillSearchQuery;
  readonly agentdb_sona_trajectory_store: AgentdbSonaTrajectoryStorePayload;
  readonly agentdb_sona_trajectory_stats: AgentdbSonaTrajectoryStorePayload;

  // agent_* (mutation)
  readonly agent_execute: AgentExecutePayload;
  readonly agent_pool: AgentPoolPayload;
  readonly agent_spawn: AgentSpawnPayload;
  readonly agent_terminate: AgentTerminatePayload;
  readonly agent_update: AgentUpdatePayload;

  // autopilot_* (mutation)
  readonly autopilot_config: AutopilotConfigPayload;
  readonly autopilot_disable: AutopilotDisablePayload;
  readonly autopilot_enable: AutopilotEnablePayload;
  readonly autopilot_learn: AutopilotLearnPayload;
  readonly autopilot_reset: AutopilotResetPayload;

  // claims_* (mutation) — note hyphenated keys for `accept-handoff` and
  // `mark-stealable` (they are registered with the hyphen, not an underscore;
  // matches the cli's mcp-tools naming).
  readonly 'claims_accept-handoff': ClaimsAcceptHandoffPayload;
  readonly claims_claim: ClaimsClaimPayload;
  readonly claims_handoff: ClaimsHandoffPayload;
  readonly 'claims_mark-stealable': ClaimsMarkStealablePayload;
  readonly claims_rebalance: ClaimsRebalancePayload;
  readonly claims_release: ClaimsReleasePayload;
  readonly claims_status: ClaimsStatusPayload;
  readonly claims_steal: ClaimsStealPayload;

  // config_* (mutation)
  readonly config_import: ConfigImportPayload;
  readonly config_reset: ConfigResetPayload;
  readonly config_set: ConfigSetPayload;

  // coordination_* (mutation)
  readonly coordination_consensus: CoordinationConsensusPayload;
  readonly coordination_load_balance: CoordinationLoadBalancePayload;
  readonly coordination_node: CoordinationNodePayload;
  readonly coordination_orchestrate: CoordinationOrchestratePayload;
  readonly coordination_sync: CoordinationSyncPayload;
  readonly coordination_topology: CoordinationTopologyPayload;

  // daa_* (mutation)
  readonly daa_agent_adapt: DaaAgentAdaptPayload;
  readonly daa_agent_create: DaaAgentCreatePayload;
  readonly daa_cognitive_pattern: DaaCognitivePatternPayload;
  readonly daa_knowledge_share: DaaKnowledgeSharePayload;
  readonly daa_workflow_create: DaaWorkflowCreatePayload;
  readonly daa_workflow_execute: DaaWorkflowExecutePayload;

  // daemon_* (mutation) — note camelCase for the auto-memory / hooks-learning
  // / runMap / runOptimize / runBenchmark / runConsolidate keys; these match
  // the tool names as actually registered (not their file names).
  readonly daemon_audit: AuditWorkerPayload;
  readonly daemon_autoMemoryBridge: AutoMemoryBridgePayload;
  readonly daemon_hooksLearning: HooksLearningPayload;
  readonly daemon_runBenchmark: BenchmarkWorkerPayload;
  readonly daemon_runConsolidate: ConsolidateWorkerPayload;
  readonly daemon_runMap: MapWorkerPayload;
  readonly daemon_runOptimize: OptimizeWorkerPayload;
  readonly daemon_testgaps: TestGapsWorkerPayload;

  // github_* (mutation)
  readonly github_issue_track: GithubIssueTrackPayload;
  readonly github_pr_manage: GithubPrManagePayload;
  readonly github_repo_analyze: GithubRepoAnalyzePayload;
  readonly github_workflow: GithubWorkflowPayload;

  // hook_* (mutation) — archivist-side hook handlers. NOTE: the cli's
  // `mcp-tools/hooks-tools.ts` registers a much larger surface under the
  // *plural-hyphenated* spelling (`hooks_pre-task`, `hooks_post-task`,
  // `hooks_post-edit`, `hooks_session-end`, plus ~20 more without archivist
  // counterparts). The archivist registers only these 4, under the
  // *singular-underscored* spelling — for agentic-flow `hook_*` MCP tool
  // compatibility (see agentic-flow/src/mcp/fastmcp/tools/hooks/*).
  //
  // ADR-0181 Phase 5 DA-memo CF#3 — namespace harmonization landed
  // dispatch-name aliases via `registerMutationHandlerAlias` in
  // `handlers/hooks/index.ts` so future Phase 7 cli-to-archivist flips can
  // dispatch under either spelling. Each `hook_*` key below is paired with a
  // `hooks_<verb>-<noun>` alias key resolving to the same payload type.
  readonly hook_post_edit: PostEditPayload;
  readonly hook_post_task: PostTaskPayload;
  readonly hook_pre_task: PreTaskPayload;
  readonly hook_session_end: SessionEndPayload;
  readonly 'hooks_post-edit': PostEditPayload;
  readonly 'hooks_post-task': PostTaskPayload;
  readonly 'hooks_pre-task': PreTaskPayload;
  readonly 'hooks_session-end': SessionEndPayload;

  // hive-mind_* (read + mutation) — note hyphenated `hive-mind` prefix; this
  // is the tool-name spelling, not an identifier, so it lives behind the
  // string literal key form.
  readonly 'hive-mind_agents': AgentsJsonPayload;
  readonly 'hive-mind_broadcast': HiveMindBroadcastPayload;
  readonly 'hive-mind_consensus': HiveMindConsensusPayload;
  readonly 'hive-mind_init': HiveMindInitPayload;
  readonly 'hive-mind_memory': HiveMindMemoryPayload;
  readonly 'hive-mind_shutdown': HiveMindShutdownPayload;
  readonly 'hive-mind_spawn': HiveMindSpawnPayload;
  readonly 'hive-mind_status': HiveMindStatusQuery;

  // memory_* (read + mutation)
  readonly memory_bridge_status: MemoryBridgeStatusQuery;
  readonly memory_list: MemoryListQuery;
  readonly memory_retrieve: MemoryRetrieveQuery;
  readonly memory_search: MemorySearchQuery;
  readonly memory_search_unified: MemorySearchUnifiedQuery;
  readonly memory_store: MemoryStorePayload;

  // neural_* (mutation)
  readonly neural_compress: NeuralCompressPayload;
  readonly neural_optimize: NeuralOptimizePayload;
  readonly neural_patterns: NeuralPatternsMutationPayload;
  readonly neural_train: NeuralTrainPayload;

  // performance_* (mutation)
  readonly performance_benchmark: PerfBenchmarkPayload;
  readonly performance_report: PerfReportPayload;

  // progress_* (mutation)
  readonly progress_sync: ProgressSyncPayload;

  // ruvllm_* (mutation)
  readonly ruvllm_hnsw_add: RuvllmHnswAddPayload;
  readonly ruvllm_hnsw_create: RuvllmHnswCreatePayload;
  readonly ruvllm_microlora_adapt: RuvllmMicroLoraAdaptPayload;
  readonly ruvllm_microlora_create: RuvllmMicroLoraCreatePayload;
  readonly ruvllm_sona_adapt: RuvllmSonaAdaptPayload;
  readonly ruvllm_sona_create: RuvllmSonaCreatePayload;

  // swarm_* (mutation)
  readonly swarm_init: SwarmInitPayload;
  readonly swarm_shutdown: SwarmShutdownPayload;

  // system_* (mutation)
  readonly system_health: SystemHealthPayload;
  readonly system_metrics: SystemMetricsPayload;
  readonly system_reset: SystemResetPayload;

  // task_* (mutation)
  readonly task_assign: TaskAssignPayload;
  readonly task_cancel: TaskCancelPayload;
  readonly task_complete: TaskCompletePayload;
  readonly task_create: TaskCreatePayload;
  readonly task_list: TaskListPayload;
  readonly task_status: TaskStatusPayload;
  readonly task_update: TaskUpdatePayload;

  // wasm_* (mutation)
  readonly wasm_agent_create: WasmAgentCreatePayload;
  readonly wasm_agent_prompt: WasmAgentPromptPayload;
  readonly wasm_agent_terminate: WasmAgentTerminatePayload;
  readonly wasm_agent_tool: WasmAgentToolPayload;
  readonly wasm_gallery_create: WasmGalleryCreatePayload;

  // workflow_* (mutation)
  readonly workflow_cancel: WorkflowCancelPayload;
  readonly workflow_create: WorkflowCreatePayload;
  readonly workflow_delete: WorkflowDeletePayload;
  readonly workflow_execute: WorkflowExecutePayload;
  readonly workflow_pause: WorkflowPausePayload;
  readonly workflow_resume: WorkflowResumePayload;
  readonly workflow_run: WorkflowRunPayload;
  readonly workflow_template: WorkflowTemplatePayload;
}

/**
 * Convenience alias — the union of every registered tool name. Useful for
 * call-site narrowing (e.g. a router function that takes one tool name and
 * looks it up against this map).
 */
export type ToolName = keyof ToolPayloadMap;
