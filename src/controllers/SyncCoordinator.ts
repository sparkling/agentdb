/**
 * SyncCoordinator - Orchestrate AgentDB Synchronization
 *
 * Coordinates bidirectional synchronization between local and remote AgentDB instances.
 * Handles change detection, conflict resolution, batching, and progress tracking.
 *
 * Features:
 * - Detect changes since last sync
 * - Bidirectional sync (push and pull)
 * - Conflict resolution strategies
 * - Batch operations for efficiency
 * - Progress tracking and reporting
 * - Comprehensive error handling
 * - Sync state persistence
 *
 * ADR-0170 Phase B.12 — ported from SQLite/`Database = any` to PostgresBackend.
 *
 * - SQL ported to postgres dialect (BIGSERIAL, $N placeholders, EXTRACT EPOCH,
 *   ON CONFLICT DO UPDATE, EXCLUDED references).
 * - Constructor takes a `PostgresBackend` instance directly. The
 *   better-sqlite3 / sql.js prepare/run/get/all surface is gone.
 * - Cross-table reads now target the canonical Wave 1a schema:
 *     · episodes              (owner: ReflexionMemory)        — has `ts`
 *     · skills                (owner: SkillLibrary)           — uses `updated_at`
 *     · skill_links           (owner: SkillLibrary)           — was `skill_edges`
 *
 *   The original SQLite-era code read `skill_edges` with columns
 *   `from_skill_id`/`to_skill_id`/`co_occurrences`. That table never existed
 *   in the canonical schema (`src/schemas/schema.sql:90` defines `skill_links`
 *   with `parent_skill_id`/`child_skill_id`/`relationship`/`weight`/`metadata`).
 *   Wire payload field names follow the new canonical columns. The matching
 *   QUICServer port (Wave 1b, sibling controller) lands the read side.
 * - `skill_links` has no timestamp column in the canonical schema, so the
 *   edges-changed watermark is enforced by `id > lastEdgeIdSync` rather than
 *   `ts > lastEdgeSync`. The persisted SyncState shape is widened (additive)
 *   to carry the id watermark; existing rows missing the column read as 0.
 * - The own `sync_state` table is bootstrapped as postgres DDL on first save.
 * - Async surface: all DB-touching methods now return Promises and await the
 *   PostgresBackend `query()` / `exec()` calls.
 */

import chalk from 'chalk';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { QUICClient, SyncOptions, SyncResult, PushResult } from './QUICClient.js';
import { QUICServer, SyncRequest } from './QUICServer.js';

export interface SyncCoordinatorConfig {
  db: PostgresBackend;
  client?: QUICClient;
  server?: QUICServer;
  conflictStrategy?: 'local-wins' | 'remote-wins' | 'latest-wins' | 'merge';
  batchSize?: number;
  autoSync?: boolean;
  syncIntervalMs?: number;
}

export interface SyncState {
  lastSyncAt: number;
  lastEpisodeSync: number;
  lastSkillSync: number;
  /**
   * Highest skill_link id seen on the previous sync. The canonical schema
   * has no `ts` column on `skill_links`, so the watermark is positional.
   */
  lastEdgeIdSync: number;
  totalItemsSynced: number;
  totalBytesSynced: number;
  syncCount: number;
  lastError?: string;
}

export interface SyncProgress {
  phase: 'detecting' | 'pushing' | 'pulling' | 'resolving' | 'applying' | 'completed' | 'error';
  current: number;
  total: number;
  itemType?: string;
  message?: string;
  error?: string;
}

export interface SyncReport {
  success: boolean;
  startTime: number;
  endTime: number;
  durationMs: number;
  itemsPushed: number;
  itemsPulled: number;
  conflictsResolved: number;
  errors: string[];
  bytesTransferred: number;
}

export class SyncCoordinator {
  private db: PostgresBackend;
  private client?: QUICClient;
  private server?: QUICServer;
  private config: Required<Omit<SyncCoordinatorConfig, 'db' | 'client' | 'server'>>;
  private syncState: SyncState;
  private isSyncing: boolean = false;
  private autoSyncInterval: NodeJS.Timeout | null = null;
  private ready: Promise<void>;

  constructor(config: SyncCoordinatorConfig) {
    this.db = config.db;
    this.client = config.client;
    this.server = config.server;
    this.config = {
      conflictStrategy: config.conflictStrategy || 'latest-wins',
      batchSize: config.batchSize || 100,
      autoSync: config.autoSync || false,
      syncIntervalMs: config.syncIntervalMs || 60000, // 1 minute
    };

    // Default state; bootstrapSchema() will overwrite from `sync_state` if
    // a row exists.
    this.syncState = {
      lastSyncAt: 0,
      lastEpisodeSync: 0,
      lastSkillSync: 0,
      lastEdgeIdSync: 0,
      totalItemsSynced: 0,
      totalBytesSynced: 0,
      syncCount: 0,
    };

    // Constructors can't be async; expose a `ready` promise that the public
    // sync()/loadSyncState()/saveSyncState()/etc. methods await.
    this.ready = this.bootstrapSchema();

    if (this.config.autoSync) {
      // Defer auto-sync start until after the ready promise resolves so the
      // first tick sees the persisted state, not the default zeroed one.
      this.ready.then(() => this.startAutoSync()).catch((err) => {
        console.error(chalk.red('[SyncCoordinator] auto-sync init failed:'), err);
      });
    }
  }

  /**
   * Bootstrap the `sync_state` table and hydrate `this.syncState` from any
   * existing row. Mirrors the ADR-0090 B5 controller-owns-schema pattern.
   */
  private async bootstrapSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY,
        last_sync_at BIGINT NOT NULL DEFAULT 0,
        last_episode_sync BIGINT NOT NULL DEFAULT 0,
        last_skill_sync BIGINT NOT NULL DEFAULT 0,
        last_edge_id_sync BIGINT NOT NULL DEFAULT 0,
        total_items_synced BIGINT NOT NULL DEFAULT 0,
        total_bytes_synced BIGINT NOT NULL DEFAULT 0,
        sync_count BIGINT NOT NULL DEFAULT 0,
        last_error TEXT
      );
    `);

    try {
      const result = await this.db.query(
        `SELECT last_sync_at, last_episode_sync, last_skill_sync,
                last_edge_id_sync, total_items_synced, total_bytes_synced,
                sync_count, last_error
         FROM sync_state WHERE id = 1`
      );
      const row = result.rows[0] as
        | {
            last_sync_at: number | bigint | string;
            last_episode_sync: number | bigint | string;
            last_skill_sync: number | bigint | string;
            last_edge_id_sync: number | bigint | string;
            total_items_synced: number | bigint | string;
            total_bytes_synced: number | bigint | string;
            sync_count: number | bigint | string;
            last_error: string | null;
          }
        | undefined;
      if (row) {
        this.syncState = {
          lastSyncAt: toNumber(row.last_sync_at),
          lastEpisodeSync: toNumber(row.last_episode_sync),
          lastSkillSync: toNumber(row.last_skill_sync),
          lastEdgeIdSync: toNumber(row.last_edge_id_sync),
          totalItemsSynced: toNumber(row.total_items_synced),
          totalBytesSynced: toNumber(row.total_bytes_synced),
          syncCount: toNumber(row.sync_count),
          lastError: row.last_error ?? undefined,
        };
      }
    } catch (err) {
      // Row absent or column mismatch from a prior schema version — keep
      // the default zeroed state and let saveSyncState() reseed it.
      const msg = (err as Error).message;
      if (process.env.CLAUDE_FLOW_DEBUG) {
        console.warn(`[SyncCoordinator] loadSyncState skipped: ${msg}`);
      }
    }
  }

  /**
   * Perform bidirectional synchronization
   */
  async sync(onProgress?: (progress: SyncProgress) => void): Promise<SyncReport> {
    await this.ready;

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    if (!this.client) {
      throw new Error('QUICClient not configured');
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let itemsPushed = 0;
    let itemsPulled = 0;
    let conflictsResolved = 0;
    let bytesTransferred = 0;

    try {
      console.log(chalk.blue('🔄 Starting synchronization...'));

      // Phase 1: Detect changes
      onProgress?.({ phase: 'detecting', current: 0, total: 100, message: 'Detecting changes...' });
      const changes = await this.detectChanges();
      console.log(chalk.gray(`  Changes detected: ${changes.episodes.length + changes.skills.length + changes.edges.length} items`));

      // Phase 2: Push changes to remote
      if (changes.episodes.length > 0 || changes.skills.length > 0 || changes.edges.length > 0) {
        onProgress?.({ phase: 'pushing', current: 0, total: changes.episodes.length + changes.skills.length + changes.edges.length });
        const pushResult = await this.pushChanges(changes, onProgress);
        itemsPushed = pushResult.itemsPushed;
        bytesTransferred += pushResult.bytesTransferred;
        errors.push(...pushResult.errors);
      }

      // Phase 3: Pull changes from remote
      onProgress?.({ phase: 'pulling', current: 0, total: 100, message: 'Pulling remote changes...' });
      const pullResult = await this.pullChanges(onProgress);
      itemsPulled = pullResult.itemsPulled;
      bytesTransferred += pullResult.bytesTransferred;
      errors.push(...pullResult.errors);

      // Phase 4: Resolve conflicts
      if (pullResult.conflicts && pullResult.conflicts.length > 0) {
        onProgress?.({ phase: 'resolving', current: 0, total: pullResult.conflicts.length, message: 'Resolving conflicts...' });
        conflictsResolved = await this.resolveConflicts(pullResult.conflicts);
      }

      // Phase 5: Apply changes
      onProgress?.({ phase: 'applying', current: 0, total: itemsPulled, message: 'Applying changes...' });
      await this.applyChanges(pullResult.data);

      // Update sync state
      this.syncState.lastSyncAt = Date.now();
      this.syncState.totalItemsSynced += itemsPushed + itemsPulled;
      this.syncState.totalBytesSynced += bytesTransferred;
      this.syncState.syncCount++;
      this.syncState.lastError = errors.length > 0 ? errors[0] : undefined;
      await this.saveSyncState();

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      console.log(chalk.green('✓ Synchronization completed'));
      console.log(chalk.gray(`  Items pushed: ${itemsPushed}`));
      console.log(chalk.gray(`  Items pulled: ${itemsPulled}`));
      console.log(chalk.gray(`  Conflicts resolved: ${conflictsResolved}`));
      console.log(chalk.gray(`  Duration: ${durationMs}ms`));

      onProgress?.({ phase: 'completed', current: 100, total: 100, message: 'Sync completed' });

      return {
        success: errors.length === 0,
        startTime,
        endTime,
        durationMs,
        itemsPushed,
        itemsPulled,
        conflictsResolved,
        errors,
        bytesTransferred,
      };
    } catch (error) {
      const err = error as Error;
      const endTime = Date.now();

      console.error(chalk.red('✗ Synchronization failed:'), err.message);
      errors.push(err.message);

      onProgress?.({ phase: 'error', current: 0, total: 0, error: err.message });

      return {
        success: false,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        itemsPushed,
        itemsPulled,
        conflictsResolved,
        errors,
        bytesTransferred,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Detect changes since last sync.
   *
   * Episodes watermark by `ts` (canonical column); skills watermark by
   * `updated_at` (their mutation timestamp). `skill_links` has no temporal
   * column in the canonical schema — we watermark positionally by `id`.
   */
  private async detectChanges(): Promise<{
    episodes: any[];
    skills: any[];
    edges: any[];
  }> {
    await this.ready;

    const { lastEpisodeSync, lastSkillSync, lastEdgeIdSync } = this.syncState;

    const episodesResult = await this.db.query(
      `SELECT * FROM episodes WHERE ts > $1`,
      [lastEpisodeSync]
    );

    const skillsResult = await this.db.query(
      `SELECT * FROM skills WHERE updated_at > $1`,
      [lastSkillSync]
    );

    const edgesResult = await this.db.query(
      `SELECT * FROM skill_links WHERE id > $1`,
      [lastEdgeIdSync]
    );

    return {
      episodes: episodesResult.rows,
      skills: skillsResult.rows,
      edges: edgesResult.rows,
    };
  }

  /**
   * Push local changes to remote
   */
  private async pushChanges(
    changes: { episodes: any[]; skills: any[]; edges: any[] },
    onProgress?: (progress: SyncProgress) => void
  ): Promise<{ itemsPushed: number; bytesTransferred: number; errors: string[] }> {
    if (!this.client) {
      throw new Error('QUICClient not configured');
    }

    const errors: string[] = [];
    let itemsPushed = 0;
    let bytesTransferred = 0;
    const totalItems = changes.episodes.length + changes.skills.length + changes.edges.length;

    try {
      console.log(chalk.blue('📤 Pushing changes to remote...'));
      console.log(chalk.gray(`  Episodes: ${changes.episodes.length}`));
      console.log(chalk.gray(`  Skills: ${changes.skills.length}`));
      console.log(chalk.gray(`  Edges: ${changes.edges.length}`));

      // Push episodes
      if (changes.episodes.length > 0) {
        onProgress?.({
          phase: 'pushing',
          current: itemsPushed,
          total: totalItems,
          itemType: 'episodes',
          message: `Pushing ${changes.episodes.length} episodes...`,
        });

        const episodesResult = await this.client.push({
          type: 'episodes',
          data: changes.episodes,
          batchSize: this.config.batchSize,
          onProgress: (progress) => {
            onProgress?.({
              phase: 'pushing',
              current: itemsPushed + (progress.itemsPushed || 0),
              total: totalItems,
              itemType: 'episodes',
              message: `Pushing episodes: batch ${progress.currentBatch || 0}/${progress.totalBatches || 0}`,
            });
          },
        });

        if (episodesResult.success) {
          itemsPushed += episodesResult.itemsPushed;
          bytesTransferred += episodesResult.bytesTransferred;
          console.log(chalk.gray(`  Episodes pushed: ${episodesResult.itemsPushed}`));
        } else {
          errors.push(`Episodes push failed: ${episodesResult.error || 'Unknown error'}`);
          console.log(chalk.yellow(`  Episodes push failed: ${episodesResult.error}`));
        }
      }

      // Push skills
      if (changes.skills.length > 0) {
        onProgress?.({
          phase: 'pushing',
          current: itemsPushed,
          total: totalItems,
          itemType: 'skills',
          message: `Pushing ${changes.skills.length} skills...`,
        });

        const skillsResult = await this.client.push({
          type: 'skills',
          data: changes.skills,
          batchSize: this.config.batchSize,
          onProgress: (progress) => {
            onProgress?.({
              phase: 'pushing',
              current: itemsPushed + (progress.itemsPushed || 0),
              total: totalItems,
              itemType: 'skills',
              message: `Pushing skills: batch ${progress.currentBatch || 0}/${progress.totalBatches || 0}`,
            });
          },
        });

        if (skillsResult.success) {
          itemsPushed += skillsResult.itemsPushed;
          bytesTransferred += skillsResult.bytesTransferred;
          console.log(chalk.gray(`  Skills pushed: ${skillsResult.itemsPushed}`));
        } else {
          errors.push(`Skills push failed: ${skillsResult.error || 'Unknown error'}`);
          console.log(chalk.yellow(`  Skills push failed: ${skillsResult.error}`));
        }
      }

      // Push edges
      if (changes.edges.length > 0) {
        onProgress?.({
          phase: 'pushing',
          current: itemsPushed,
          total: totalItems,
          itemType: 'edges',
          message: `Pushing ${changes.edges.length} edges...`,
        });

        const edgesResult = await this.client.push({
          type: 'edges',
          data: changes.edges,
          batchSize: this.config.batchSize,
          onProgress: (progress) => {
            onProgress?.({
              phase: 'pushing',
              current: itemsPushed + (progress.itemsPushed || 0),
              total: totalItems,
              itemType: 'edges',
              message: `Pushing edges: batch ${progress.currentBatch || 0}/${progress.totalBatches || 0}`,
            });
          },
        });

        if (edgesResult.success) {
          itemsPushed += edgesResult.itemsPushed;
          bytesTransferred += edgesResult.bytesTransferred;
          console.log(chalk.gray(`  Edges pushed: ${edgesResult.itemsPushed}`));
        } else {
          errors.push(`Edges push failed: ${edgesResult.error || 'Unknown error'}`);
          console.log(chalk.yellow(`  Edges push failed: ${edgesResult.error}`));
        }
      }

      console.log(chalk.green(`✓ Push completed: ${itemsPushed} items, ${bytesTransferred} bytes`));
    } catch (error) {
      const err = error as Error;
      errors.push(err.message);
      console.error(chalk.red('✗ Push failed:'), err.message);
    }

    return { itemsPushed, bytesTransferred, errors };
  }

  /**
   * Pull changes from remote
   */
  private async pullChanges(
    onProgress?: (progress: SyncProgress) => void
  ): Promise<{
    itemsPulled: number;
    bytesTransferred: number;
    data: any;
    conflicts?: any[];
    errors: string[];
  }> {
    if (!this.client) {
      throw new Error('QUICClient not configured');
    }

    const errors: string[] = [];
    let itemsPulled = 0;
    let bytesTransferred = 0;
    const allData: any = { episodes: [], skills: [], edges: [] };

    try {
      // Pull episodes
      const episodesResult = await this.client.sync({
        type: 'episodes',
        since: this.syncState.lastEpisodeSync,
        batchSize: this.config.batchSize,
        onProgress: (progress) => {
          onProgress?.({
            phase: 'pulling',
            current: progress.itemsSynced || 0,
            total: 100,
            itemType: 'episodes',
          });
        },
      });

      if (episodesResult.success && episodesResult.data) {
        allData.episodes = episodesResult.data;
        itemsPulled += episodesResult.itemsReceived;
        bytesTransferred += episodesResult.bytesTransferred;
        this.syncState.lastEpisodeSync = Math.floor(Date.now() / 1000);
      } else {
        errors.push(episodesResult.error || 'Failed to sync episodes');
      }

      // Pull skills
      const skillsResult = await this.client.sync({
        type: 'skills',
        since: this.syncState.lastSkillSync,
        batchSize: this.config.batchSize,
        onProgress: (progress) => {
          onProgress?.({
            phase: 'pulling',
            current: progress.itemsSynced || 0,
            total: 100,
            itemType: 'skills',
          });
        },
      });

      if (skillsResult.success && skillsResult.data) {
        allData.skills = skillsResult.data;
        itemsPulled += skillsResult.itemsReceived;
        bytesTransferred += skillsResult.bytesTransferred;
        this.syncState.lastSkillSync = Math.floor(Date.now() / 1000);
      } else {
        errors.push(skillsResult.error || 'Failed to sync skills');
      }

      // Pull edges
      const edgesResult = await this.client.sync({
        type: 'edges',
        since: this.syncState.lastEdgeIdSync,
        batchSize: this.config.batchSize,
        onProgress: (progress) => {
          onProgress?.({
            phase: 'pulling',
            current: progress.itemsSynced || 0,
            total: 100,
            itemType: 'edges',
          });
        },
      });

      if (edgesResult.success && edgesResult.data) {
        allData.edges = edgesResult.data;
        itemsPulled += edgesResult.itemsReceived;
        bytesTransferred += edgesResult.bytesTransferred;
        // Advance the edge id watermark to the max id we just observed so
        // the next sync picks up rows after the highest known link.
        const maxId = (edgesResult.data as any[]).reduce<number>((acc, row) => {
          const id = toNumber((row as any).id);
          return id > acc ? id : acc;
        }, this.syncState.lastEdgeIdSync);
        this.syncState.lastEdgeIdSync = maxId;
      } else {
        errors.push(edgesResult.error || 'Failed to sync edges');
      }
    } catch (error) {
      const err = error as Error;
      errors.push(err.message);
    }

    return {
      itemsPulled,
      bytesTransferred,
      data: allData,
      errors,
    };
  }

  /**
   * Resolve conflicts between local and remote data
   */
  private async resolveConflicts(conflicts: any[]): Promise<number> {
    let resolved = 0;

    for (const conflict of conflicts) {
      switch (this.config.conflictStrategy) {
        case 'local-wins':
          // Keep local version
          break;
        case 'remote-wins':
          // Keep remote version
          resolved++;
          break;
        case 'latest-wins':
          // Keep version with latest timestamp
          if (conflict.remote.ts > conflict.local.ts) {
            resolved++;
          }
          break;
        case 'merge':
          // Attempt to merge (simplified)
          resolved++;
          break;
      }
    }

    return resolved;
  }

  /**
   * Apply pulled changes to local database.
   *
   * Uses postgres `INSERT ... ON CONFLICT (...) DO UPDATE` to replicate the
   * `INSERT OR REPLACE` upsert semantics from the SQLite original. Column
   * names track the canonical schema (`src/schemas/schema.sql`).
   */
  private async applyChanges(data: any): Promise<void> {
    await this.ready;

    if (data.episodes && data.episodes.length > 0) {
      for (const episode of data.episodes) {
        await this.db.query(
          `INSERT INTO episodes (
            id, ts, session_id, task, input, output, critique, reward, success,
            latency_ms, tokens_used, tags, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO UPDATE SET
            ts = EXCLUDED.ts,
            session_id = EXCLUDED.session_id,
            task = EXCLUDED.task,
            input = EXCLUDED.input,
            output = EXCLUDED.output,
            critique = EXCLUDED.critique,
            reward = EXCLUDED.reward,
            success = EXCLUDED.success,
            latency_ms = EXCLUDED.latency_ms,
            tokens_used = EXCLUDED.tokens_used,
            tags = EXCLUDED.tags,
            metadata = EXCLUDED.metadata`,
          [
            episode.id,
            episode.ts,
            episode.sessionId,
            episode.task,
            episode.input ?? null,
            episode.output ?? null,
            episode.critique ?? null,
            episode.reward,
            episode.success === true,
            episode.latencyMs ?? null,
            episode.tokensUsed ?? null,
            episode.tags ? JSON.stringify(episode.tags) : null,
            episode.metadata ? JSON.stringify(episode.metadata) : null,
          ]
        );
      }
    }

    if (data.skills && data.skills.length > 0) {
      for (const skill of data.skills) {
        await this.db.query(
          `INSERT INTO skills (
            id, name, description, signature, code, success_rate, uses,
            avg_reward, avg_latency_ms, created_at, updated_at, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            signature = EXCLUDED.signature,
            code = EXCLUDED.code,
            success_rate = EXCLUDED.success_rate,
            uses = EXCLUDED.uses,
            avg_reward = EXCLUDED.avg_reward,
            avg_latency_ms = EXCLUDED.avg_latency_ms,
            updated_at = EXCLUDED.updated_at,
            metadata = EXCLUDED.metadata`,
          [
            skill.id,
            skill.name,
            skill.description ?? null,
            skill.signature
              ? JSON.stringify(skill.signature)
              : JSON.stringify({ inputs: {}, outputs: {} }),
            skill.code ?? null,
            skill.successRate ?? 0,
            Math.round(skill.uses ?? skill.usageCount ?? 0),
            skill.avgReward ?? 0,
            Math.round(skill.avgLatencyMs ?? 0),
            skill.createdAt ?? Math.floor(Date.now() / 1000),
            skill.updatedAt ?? Math.floor(Date.now() / 1000),
            skill.metadata ? JSON.stringify(skill.metadata) : null,
          ]
        );
      }
    }

    if (data.edges && data.edges.length > 0) {
      for (const edge of data.edges) {
        // Tolerate both legacy (`fromSkillId`/`toSkillId`/`coOccurrences`)
        // and canonical (`parentSkillId`/`childSkillId`/`relationship`)
        // wire field names — the canonical schema is `skill_links` and the
        // legacy SQLite-era `skill_edges` schema never existed in this fork.
        const parentSkillId = edge.parentSkillId ?? edge.fromSkillId;
        const childSkillId = edge.childSkillId ?? edge.toSkillId;
        const relationship = edge.relationship ?? 'composition';
        const weight = edge.weight ?? 1.0;
        const metadata = edge.metadata ? JSON.stringify(edge.metadata) : null;

        await this.db.query(
          `INSERT INTO skill_links (
            id, parent_skill_id, child_skill_id, relationship, weight, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            parent_skill_id = EXCLUDED.parent_skill_id,
            child_skill_id = EXCLUDED.child_skill_id,
            relationship = EXCLUDED.relationship,
            weight = EXCLUDED.weight,
            metadata = EXCLUDED.metadata`,
          [edge.id, parentSkillId, childSkillId, relationship, weight, metadata]
        );
      }
    }
  }

  /**
   * Persist sync state. The `sync_state` row uses id=1 as the singleton
   * pkey, matching the SQLite-era convention.
   */
  private async saveSyncState(): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO sync_state (
          id, last_sync_at, last_episode_sync, last_skill_sync,
          last_edge_id_sync, total_items_synced, total_bytes_synced,
          sync_count, last_error
        ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          last_sync_at = EXCLUDED.last_sync_at,
          last_episode_sync = EXCLUDED.last_episode_sync,
          last_skill_sync = EXCLUDED.last_skill_sync,
          last_edge_id_sync = EXCLUDED.last_edge_id_sync,
          total_items_synced = EXCLUDED.total_items_synced,
          total_bytes_synced = EXCLUDED.total_bytes_synced,
          sync_count = EXCLUDED.sync_count,
          last_error = EXCLUDED.last_error`,
        [
          this.syncState.lastSyncAt,
          this.syncState.lastEpisodeSync,
          this.syncState.lastSkillSync,
          this.syncState.lastEdgeIdSync,
          this.syncState.totalItemsSynced,
          this.syncState.totalBytesSynced,
          this.syncState.syncCount,
          this.syncState.lastError ?? null,
        ]
      );
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('✗ Failed to save sync state:'), err.message);
    }
  }

  /**
   * Start automatic synchronization
   */
  private startAutoSync(): void {
    if (this.autoSyncInterval) {
      return;
    }

    console.log(chalk.blue(`🔄 Auto-sync enabled (interval: ${this.config.syncIntervalMs}ms)`));

    this.autoSyncInterval = setInterval(async () => {
      try {
        await this.sync();
      } catch (error) {
        const err = error as Error;
        console.error(chalk.red('✗ Auto-sync failed:'), err.message);
      }
    }, this.config.syncIntervalMs);
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log(chalk.blue('🔄 Auto-sync disabled'));
    }
  }

  /**
   * Get sync state
   */
  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  /**
   * Get sync status
   */
  getStatus(): {
    isSyncing: boolean;
    autoSyncEnabled: boolean;
    state: SyncState;
  } {
    return {
      isSyncing: this.isSyncing,
      autoSyncEnabled: this.autoSyncInterval !== null,
      state: this.getSyncState(),
    };
  }
}

function toNumber(v: number | bigint | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return parseInt(v, 10);
  if (typeof v === 'bigint') return Number(v);
  return v;
}
