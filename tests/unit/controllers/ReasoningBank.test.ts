/**
 * Unit Tests for ReasoningBank Controller — ADR-0219 F-04-001
 *
 * Tests the fail-loud behaviour added by ADR-0219:
 * - recordOutcome throws PatternNotFoundError when the target pattern has been
 *   deleted (updatePatternStats matches 0 rows → changes === 0).
 * - recordOutcome succeeds normally for an existing pattern.
 * - updatePatternStats returns { changes: number } with the correct count.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ReasoningBank, PatternNotFoundError } from '../../../src/controllers/ReasoningBank.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../../src/schemas/schema.sql'),
  'utf-8',
);

describe('ReasoningBank — ADR-0219 F-04-001 recordOutcome fail-loud', () => {
  let db: InstanceType<typeof Database>;
  let embedder: EmbeddingService;
  let bank: ReasoningBank;

  beforeEach(async () => {
    ReasoningBank._resetSingleton();

    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    bank = new ReasoningBank(db, embedder);
  });

  /** Store a minimal valid pattern and return its numeric ID. */
  async function addPattern(): Promise<number> {
    return bank.storePattern({
      taskType: 'test_task',
      approach: 'test approach description',
      successRate: 0.5,
    });
  }

  it('should throw PatternNotFoundError when recordOutcome targets a deleted pattern', async () => {
    const id = await addPattern();
    // Delete the pattern so the UPDATE matches 0 rows.
    db.prepare('DELETE FROM reasoning_patterns WHERE id = ?').run(id);

    await expect(bank.recordOutcome(id, true)).rejects.toBeInstanceOf(PatternNotFoundError);
  });

  it('PatternNotFoundError message should identify the missing pattern ID', async () => {
    const id = await addPattern();
    db.prepare('DELETE FROM reasoning_patterns WHERE id = ?').run(id);

    const err = await bank.recordOutcome(id, true).catch(e => e);
    expect(err).toBeInstanceOf(PatternNotFoundError);
    expect(err.message).toContain(String(id));
  });

  it('should succeed (not throw) when recordOutcome targets an existing pattern', async () => {
    const id = await addPattern();
    await expect(bank.recordOutcome(id, true)).resolves.toBeUndefined();
  });

  it('updatePatternStats returns { changes: 1 } for an existing row', async () => {
    const id = await addPattern();
    const result = bank.updatePatternStats(id, true, 1.0);
    expect(result).toEqual({ changes: 1 });
  });

  it('updatePatternStats returns { changes: 0 } when the row does not exist', async () => {
    const result = bank.updatePatternStats(99999, true, 1.0);
    expect(result).toEqual({ changes: 0 });
  });
});
