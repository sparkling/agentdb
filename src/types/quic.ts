/**
 * QUIC Synchronization Types for AgentDB
 *
 * ADR-0217 (2026-05-22): The multi-writer QUIC stack was quarantined.
 * Upstream never built it; the ENABLE_QUIC_SYNC gate is off by default and
 * the phantom `sync_changelog` schema was never created. This file is retained
 * because `VectorClock`, `incrementVectorClock`, and `createVectorClock` are
 * consumed by agentic-flow's autopilot-learning.ts at runtime. All other types
 * and functions in this file are @internal — do NOT use them from outside
 * agentdb. The multi-writer ADR will revisit when a real ≥2-install driver
 * exists (single-writer / experimental only until then).
 */

// ============================================================================
// Core Sync Types
// ============================================================================

/**
 * Vector clock for causal ordering of events across distributed nodes.
 * Maps node IDs to their logical clock values.
 *
 * @public — retained: consumed by agentic-flow autopilot-learning.ts at runtime.
 */
export interface VectorClock {
  clocks: Map<string, number>;  // node_id -> logical_clock
}

/**
 * Compares two vector clocks to determine causal relationship.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export type VectorClockComparison =
  | 'before'      // local happened before remote
  | 'after'       // local happened after remote
  | 'concurrent'  // concurrent events (conflict)
  | 'equal';      // identical clocks

/**
 * Main sync message envelope wrapping all sync operations.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface SyncMessage {
  sequenceNumber: number;
  timestampMs: number;
  nodeId: string;
  vectorClock: VectorClock;
  payload: SyncPayload;
}

/**
 * Union type for different sync payload types.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export type SyncPayload =
  | { type: 'episode_sync'; data: EpisodeSync }
  | { type: 'skill_sync'; data: SkillSync }
  | { type: 'causal_edge_sync'; data: CausalEdgeSync }
  | { type: 'reconciliation_request'; data: FullReconciliationRequest }
  | { type: 'reconciliation_response'; data: FullReconciliationResponse };

// ============================================================================
// Episode Synchronization
// ============================================================================

/**
 * Supported operations for episode sync
 */
export enum EpisodeSyncOperation {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE'
}

/**
 * Episode synchronization message.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface EpisodeSync {
  operation: EpisodeSyncOperation;
  episodeId: number;
  episodeData: SyncableEpisode;
  causalClock: VectorClock;
  signature: Uint8Array;  // HMAC for integrity verification
}

/**
 * Serializable episode data for sync.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface SyncableEpisode {
  id?: number;
  agentId: string;
  sessionId: string;
  task: string;
  input: string;
  output: string;
  critique?: string;
  reward: number;
  success: boolean;
  latencyMs: number;
  timestamp: number;
  metadata?: Record<string, any>;
  vectorClock: VectorClock;
}

// ============================================================================
// Skill Synchronization (CRDT-based) — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * G-Counter (Grow-only Counter) for skill usage tracking.
 * @internal — CRDT stack quarantined (ADR-0217); no live consumer.
 */
export interface GCounter {
  nodeCounters: Map<string, number>;  // node_id -> local_count
}

/**
 * LWW-Register (Last-Write-Wins Register) for scalar values.
 * @internal — CRDT stack quarantined (ADR-0217); no live consumer.
 */
export interface LWWRegister<T> {
  value: T;
  timestamp: number;
  nodeId: string;
}

/**
 * OR-Set (Observed-Remove Set) for set-based values.
 * @internal — CRDT stack quarantined (ADR-0217); no live consumer.
 */
export interface ORSet<T> {
  adds: Map<T, Set<string>>;  // element -> set of unique tags
  removes: Set<string>;        // set of removed tags
}

/**
 * Skill synchronization message with CRDT fields.
 * @internal — CRDT stack quarantined (ADR-0217); no live consumer.
 */
export interface SkillSync {
  skillId: number;
  skillName: string;
  description?: string;

  // CRDT fields
  uses: GCounter;                      // Total uses across nodes
  successRate: LWWRegister<number>;    // Success rate with timestamp
  avgReward: LWWRegister<number>;      // Average reward with timestamp
  avgLatencyMs: LWWRegister<number>;   // Average latency with timestamp
  sourceEpisodes: ORSet<number>;       // Set of source episode IDs

  // Metadata
  signature: Record<string, any>;      // Skill signature (inputs/outputs)
  version: VectorClock;
  metadata?: Record<string, any>;
}

// ============================================================================
// Causal Edge Synchronization — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Metadata for conflict resolution in causal edges.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ConflictResolutionMetadata {
  experimentIds?: number[];
  evidenceCount: number;
  lastModifiedBy: string;
  lastModifiedAt: number;
}

/**
 * Causal edge synchronization message.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface CausalEdgeSync {
  edgeId: number;
  fromMemoryId: number;
  fromMemoryType: 'episode' | 'skill' | 'note' | 'fact';
  toMemoryId: number;
  toMemoryType: 'episode' | 'skill' | 'note' | 'fact';

  // Causal metrics
  similarity: number;
  uplift?: number;
  confidence: number;
  sampleSize?: number;

  // Evidence and explanation
  evidenceIds?: number[];
  experimentIds?: number[];
  confounderScore?: number;
  mechanism?: string;

  // Sync metadata
  version: VectorClock;
  conflictMetadata: ConflictResolutionMetadata;
  metadata?: Record<string, any>;
}

// ============================================================================
// Full Reconciliation — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Data types that can be reconciled.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export type ReconciliableDataType = 'episodes' | 'skills' | 'edges' | 'experiments';

/**
 * Request for full reconciliation.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface FullReconciliationRequest {
  lastSyncTimestamp: number;
  currentState: VectorClock;
  dataTypes: ReconciliableDataType[];
  requestId: string;
}

/**
 * Response with full state for reconciliation.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface FullReconciliationResponse {
  requestId: string;
  episodes: EpisodeSync[];
  skills: SkillSync[];
  edges: CausalEdgeSync[];
  authoritativeClock: VectorClock;
  merkleRoot: string;  // For verification
}

/**
 * State summary for efficient reconciliation.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface StateSummary {
  episodes: {
    count: number;
    merkleRoot: string;
    vectorClock: VectorClock;
  };
  skills: {
    count: number;
    merkleRoot: string;
    vectorClock: VectorClock;
  };
  edges: {
    count: number;
    merkleRoot: string;
    vectorClock: VectorClock;
  };
}

/**
 * Reconciliation report with results.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ReconciliationReport {
  success: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  recordsAdded: number;
  recordsUpdated: number;
  recordsDeleted: number;
  conflictsResolved: number;
  conflictsUnresolved: number;
  errors: string[];
}

// ============================================================================
// Authentication & Authorization — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * JWT claims for API authorization.
 * @internal — JWT auth stack quarantined (ADR-0217); no real issuer exists.
 */
export interface JWTClaims {
  iss: string;              // Issuer
  sub: string;              // Subject (node ID)
  exp: number;              // Expiration timestamp
  iat: number;              // Issued at timestamp
  roles: UserRole[];
  scopes: AuthScope[];
  networkId: string;
  metadata?: Record<string, any>;
}

/**
 * User roles.
 * @internal — JWT auth stack quarantined (ADR-0217).
 */
export enum UserRole {
  ADMIN = 'admin',
  AGENT = 'agent',
  OBSERVER = 'observer',
  LEARNER = 'learner'
}

/**
 * Authorization scopes.
 * @internal — JWT auth stack quarantined (ADR-0217).
 */
export type AuthScope =
  | 'episodes:read'
  | 'episodes:write'
  | 'episodes:delete'
  | 'skills:read'
  | 'skills:write'
  | 'skills:delete'
  | 'edges:read'
  | 'edges:write'
  | 'edges:delete'
  | 'experiments:read'
  | 'experiments:write'
  | 'reconciliation:request';

/**
 * Node registration data.
 * @internal — JWT auth stack quarantined (ADR-0217).
 */
export interface NodeRegistration {
  nodeId: string;
  certificate: string;      // PEM-encoded X.509 certificate
  publicKey: string;        // PEM-encoded public key
  networkId: string;
  registeredAt: number;
  expiresAt: number;
}

// ============================================================================
// Configuration — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Network topology types.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export enum NetworkTopology {
  HUB_AND_SPOKE = 'hub_and_spoke',
  MESH = 'mesh',
  HIERARCHICAL = 'hierarchical'
}

/**
 * Conflict resolution strategies.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export enum ConflictResolutionStrategy {
  AUTO = 'auto',          // Automatic resolution using configured algorithms
  MANUAL = 'manual',      // Flag conflicts for manual resolution
  INTERACTIVE = 'interactive'  // Prompt user for resolution
}

/**
 * Sync mode.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export enum SyncMode {
  INCREMENTAL = 'incremental',
  FULL = 'full',
  HYBRID = 'hybrid'
}

/**
 * Server configuration.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ServerConfig {
  port: number;
  host: string;
  maxConnections: number;
  maxStreamsPerConnection: number;

  // TLS/Security
  tlsCertPath: string;
  tlsKeyPath: string;
  caCertPath: string;
  jwtSecret: string;
  jwtExpirationMs: number;

  // Sync settings
  changelogRetentionDays: number;
  changelogMaxRecords: number;
  reconciliationIntervalMs: number;

  // Performance
  batchSize: number;
  compressionThreshold: number;
  maxMemoryPerConnection: number;

  // Topology
  topology: NetworkTopology;
  networkId: string;
}

/**
 * Client configuration.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ClientConfig {
  nodeId: string;
  serverUrl: string;

  // TLS/Security
  clientCertPath: string;
  clientKeyPath: string;
  caCertPath: string;
  jwt: string;

  // Sync settings
  mode: SyncMode;
  incrementalIntervalMs: number;
  fullReconciliationIntervalMs: number;
  autoSync: boolean;

  // Conflict resolution
  conflictResolutionStrategy: ConflictResolutionStrategy;

  // Performance
  batchSize: number;
  compressionThreshold: number;
  retryMaxAttempts: number;
  retryBackoffMs: number;
}

// ============================================================================
// Status & Monitoring — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Server status.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ServerStatus {
  uptime: number;
  activeConnections: number;
  totalConnectionsHandled: number;
  activeStreams: number;
  changelogSize: number;
  lastReconciliation: number;

  // Performance metrics
  avgSyncLatencyMs: number;
  throughputBytesPerSec: number;
  conflictsPerMinute: number;

  // Resource usage
  cpuUsagePercent: number;
  memoryUsageBytes: number;
  diskUsageBytes: number;
}

/**
 * Client status.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ClientStatus {
  connected: boolean;
  nodeId: string;
  serverUrl: string;
  lastSyncTimestamp: number;
  nextSyncScheduled: number;

  // Sync stats
  episodesSynced: number;
  skillsSynced: number;
  edgesSynced: number;
  conflictsEncountered: number;
  conflictsAutoResolved: number;

  // Connection health
  connectionUptimeMs: number;
  reconnectAttempts: number;
  lastError?: string;
}

/**
 * Sync result for a single operation.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface SyncResult {
  success: boolean;
  duration: number;

  // Changes applied
  episodesAdded: number;
  episodesUpdated: number;
  episodesDeleted: number;
  skillsAdded: number;
  skillsUpdated: number;
  edgesAdded: number;
  edgesUpdated: number;

  // Conflicts
  conflictsTotal: number;
  conflictsAutoResolved: number;
  conflictsPending: number;

  // Errors
  errors: SyncError[];
}

/**
 * Sync error details.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface SyncError {
  code: string;
  message: string;
  dataType: ReconciliableDataType;
  recordId?: number;
  timestamp: number;
  retryable: boolean;
}

// ============================================================================
// Helper Functions (Type Guards & Utilities)
// ============================================================================

/**
 * Type guard for episode sync.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export function isEpisodeSync(payload: SyncPayload): payload is { type: 'episode_sync'; data: EpisodeSync } {
  return payload.type === 'episode_sync';
}

/**
 * Type guard for skill sync.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export function isSkillSync(payload: SyncPayload): payload is { type: 'skill_sync'; data: SkillSync } {
  return payload.type === 'skill_sync';
}

/**
 * Type guard for causal edge sync.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export function isCausalEdgeSync(payload: SyncPayload): payload is { type: 'causal_edge_sync'; data: CausalEdgeSync } {
  return payload.type === 'causal_edge_sync';
}

/**
 * Compare two vector clocks.
 * @internal — quarantined with the QUIC stack (ADR-0217). Use VectorClock/incrementVectorClock/createVectorClock for the public surface.
 */
export function compareVectorClocks(a: VectorClock, b: VectorClock): VectorClockComparison {
  const allNodes = new Set([...a.clocks.keys(), ...b.clocks.keys()]);

  let aGreater = false;
  let bGreater = false;

  for (const node of allNodes) {
    const aClock = a.clocks.get(node) || 0;
    const bClock = b.clocks.get(node) || 0;

    if (aClock > bClock) aGreater = true;
    if (bClock > aClock) bGreater = true;
  }

  if (aGreater && !bGreater) return 'after';
  if (bGreater && !aGreater) return 'before';
  if (!aGreater && !bGreater) return 'equal';
  return 'concurrent';
}

/**
 * Merge two vector clocks (take max of each node).
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged = new Map(a.clocks);

  for (const [node, clock] of b.clocks) {
    const existingClock = merged.get(node) || 0;
    merged.set(node, Math.max(existingClock, clock));
  }

  return { clocks: merged };
}

/**
 * Increment vector clock for local node.
 * @public — retained: consumed by agentic-flow autopilot-learning.ts at runtime (ADR-0217 exception).
 */
export function incrementVectorClock(clock: VectorClock, nodeId: string): VectorClock {
  const newClocks = new Map(clock.clocks);
  const currentClock = newClocks.get(nodeId) || 0;
  newClocks.set(nodeId, currentClock + 1);
  return { clocks: newClocks };
}

/**
 * Create empty vector clock.
 * @public — retained: consumed by agentic-flow autopilot-learning.ts at runtime (ADR-0217 exception).
 */
export function createVectorClock(): VectorClock {
  return { clocks: new Map() };
}

// ============================================================================
// CRDT Operations — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Increment G-Counter for a node.
 * @internal — CRDT stack quarantined (ADR-0217); no live consumer.
 */
export function incrementGCounter(counter: GCounter, nodeId: string, delta: number = 1): GCounter {
  const newCounters = new Map(counter.nodeCounters);
  const current = newCounters.get(nodeId) || 0;
  newCounters.set(nodeId, current + delta);
  return { nodeCounters: newCounters };
}

/**
 * Get total value of G-Counter.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function getGCounterValue(counter: GCounter): number {
  return Array.from(counter.nodeCounters.values()).reduce((sum, count) => sum + count, 0);
}

/**
 * Merge two G-Counters (take max per node).
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function mergeGCounter(a: GCounter, b: GCounter): GCounter {
  const merged = new Map(a.nodeCounters);

  for (const [nodeId, count] of b.nodeCounters) {
    const existingCount = merged.get(nodeId) || 0;
    merged.set(nodeId, Math.max(existingCount, count));
  }

  return { nodeCounters: merged };
}

/**
 * Update LWW-Register with new value.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function updateLWWRegister<T>(
  register: LWWRegister<T>,
  newValue: T,
  nodeId: string,
  timestamp: number = Date.now()
): LWWRegister<T> {
  if (timestamp > register.timestamp ||
      (timestamp === register.timestamp && nodeId > register.nodeId)) {
    return { value: newValue, timestamp, nodeId };
  }
  return register;
}

/**
 * Merge two LWW-Registers (keep most recent).
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function mergeLWWRegister<T>(a: LWWRegister<T>, b: LWWRegister<T>): LWWRegister<T> {
  if (b.timestamp > a.timestamp) {
    return b;
  } else if (b.timestamp === a.timestamp) {
    return b.nodeId > a.nodeId ? b : a;
  }
  return a;
}

/**
 * Add element to OR-Set.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function addToORSet<T>(set: ORSet<T>, element: T, uniqueTag: string): ORSet<T> {
  const newAdds = new Map(set.adds);
  if (!newAdds.has(element)) {
    newAdds.set(element, new Set());
  }
  newAdds.get(element)!.add(uniqueTag);

  return { adds: newAdds, removes: set.removes };
}

/**
 * Remove element from OR-Set.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function removeFromORSet<T>(set: ORSet<T>, element: T): ORSet<T> {
  const tags = set.adds.get(element);
  if (!tags) return set;

  const newRemoves = new Set(set.removes);
  tags.forEach(tag => newRemoves.add(tag));

  return { adds: set.adds, removes: newRemoves };
}

/**
 * Get current elements in OR-Set.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function getORSetElements<T>(set: ORSet<T>): Set<T> {
  const elements = new Set<T>();

  for (const [element, tags] of set.adds) {
    // Check if any tag is not in removes
    for (const tag of tags) {
      if (!set.removes.has(tag)) {
        elements.add(element);
        break;
      }
    }
  }

  return elements;
}

/**
 * Merge two OR-Sets.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function mergeORSet<T>(a: ORSet<T>, b: ORSet<T>): ORSet<T> {
  const mergedAdds = new Map<T, Set<string>>();
  const mergedRemoves = new Set([...a.removes, ...b.removes]);

  // Merge adds from both sets
  const allElements = new Set([...a.adds.keys(), ...b.adds.keys()]);

  for (const element of allElements) {
    const aTags = a.adds.get(element) || new Set();
    const bTags = b.adds.get(element) || new Set();
    const mergedTags = new Set([...aTags, ...bTags]);

    // Remove tags that are in removes set
    for (const tag of mergedTags) {
      if (mergedRemoves.has(tag)) {
        mergedTags.delete(tag);
      }
    }

    if (mergedTags.size > 0) {
      mergedAdds.set(element, mergedTags);
    }
  }

  return { adds: mergedAdds, removes: mergedRemoves };
}

// ============================================================================
// Conflict Resolution Helpers — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Weighted average for numeric conflict resolution.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export function weightedAverage(v1: number, w1: number, v2: number, w2: number): number {
  if (w1 + w2 === 0) return 0;
  return (v1 * w1 + v2 * w2) / (w1 + w2);
}

/**
 * Determine authorization for operation.
 * @internal — JWT auth stack quarantined (ADR-0217).
 */
export function isAuthorized(jwt: JWTClaims, requiredScope: AuthScope): boolean {
  return jwt.scopes.includes(requiredScope);
}

/**
 * Check if JWT is expired.
 * @internal — JWT auth stack quarantined (ADR-0217).
 */
export function isJWTExpired(jwt: JWTClaims): boolean {
  return Date.now() >= jwt.exp * 1000;
}

/**
 * Generate unique tag for OR-Set operations.
 * @internal — CRDT stack quarantined (ADR-0217).
 */
export function generateUniqueTag(nodeId: string, timestamp: number = Date.now()): string {
  return `${nodeId}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Event Types for Client SDK — @internal (ADR-0217 quarantine)
// ============================================================================

/**
 * Events emitted by sync client.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export type SyncEvent =
  | { type: 'sync_started'; timestamp: number }
  | { type: 'sync_completed'; result: SyncResult }
  | { type: 'sync_failed'; error: SyncError }
  | { type: 'conflict_detected'; conflict: ConflictData }
  | { type: 'conflict_resolved'; conflict: ConflictData; resolution: any }
  | { type: 'connection_established'; nodeId: string; serverUrl: string }
  | { type: 'connection_lost'; reason: string }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'reconciliation_started'; requestId: string }
  | { type: 'reconciliation_completed'; report: ReconciliationReport };

/**
 * Conflict data for manual resolution.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export interface ConflictData {
  dataType: ReconciliableDataType;
  recordId: number;
  localVersion: any;
  remoteVersion: any;
  localVectorClock: VectorClock;
  remoteVectorClock: VectorClock;
  detectedAt: number;
}

/**
 * Event handler type.
 * @internal — quarantined with the QUIC stack (ADR-0217).
 */
export type SyncEventHandler = (event: SyncEvent) => void;
