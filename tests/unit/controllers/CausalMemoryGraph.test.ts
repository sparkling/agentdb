/**
 * Unit Tests for CausalMemoryGraph Controller
 *
 * ADR-0170 Phase B.7: ported from better-sqlite3 (sync) to PostgresBackend
 * (pglite embedded, async). Each test gets a fresh ephemeral pglite cluster
 * under `os.tmpdir()` so test isolation is preserved without WAL/-shm/-db
 * cleanup hooks.
 *
 * The WITH RECURSIVE 5-hop chain exercise lives in the
 * `getCausalChain (WITH RECURSIVE)` describe block — it verifies the
 * postgres-dialect port of the SQLite recursive CTE: LEAST() instead of
 * row-wise MIN(), explicit `::TEXT` casts on BIGINT path elements,
 * COALESCE on uplift to avoid NULL propagation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresBackend } from '../../../src/backends/postgres/PostgresBackend.js';
import {
  CausalMemoryGraph,
  CausalEdge,
  CausalExperiment,
  CausalObservation,
} from '../../../src/controllers/CausalMemoryGraph.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CausalMemoryGraph', () => {
  let backend: PostgresBackend;
  let dataDir: string;
  let causalGraph: CausalMemoryGraph;

  beforeEach(async () => {
    // Reset the dual-instance singleton so each test gets a fresh controller
    // tied to this test's pglite cluster.
    CausalMemoryGraph._resetSingleton();

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-cmg-test-'));
    backend = new PostgresBackend({ metric: 'cosine', dataDir });
    await backend.initialize();

    // Load canonical postgres-dialect schemas (Phase A.5).
    const schemaPath = path.join(__dirname, '../../../src/schemas/schema.sql');
    if (fs.existsSync(schemaPath)) {
      await backend.exec(fs.readFileSync(schemaPath, 'utf-8'));
    }
    const frontierSchemaPath = path.join(__dirname, '../../../src/schemas/frontier-schema.sql');
    if (fs.existsSync(frontierSchemaPath)) {
      await backend.exec(fs.readFileSync(frontierSchemaPath, 'utf-8'));
    }

    causalGraph = new CausalMemoryGraph(backend);
  });

  afterEach(async () => {
    CausalMemoryGraph._resetSingleton();
    try {
      backend.close();
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  describe('addCausalEdge', () => {
    it('should add causal edge with all required fields', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.85,
        uplift: 0.25,
        confidence: 0.95,
        sampleSize: 100,
        evidenceIds: ['e1', 'e2', 'e3'],
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
      expect(typeof edgeId).toBe('number');
    });

    it('should add causal edge with minimal fields', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'skill',
        toMemoryId: 2,
        toMemoryType: 'skill',
        similarity: 0.7,
        confidence: 0.8,
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });

    it('should handle negative uplift (harmful effects)', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.9,
        uplift: -0.3,
        confidence: 0.9,
        sampleSize: 50,
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });

    it('should store edge with mechanism explanation', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.88,
        uplift: 0.2,
        confidence: 0.87,
        mechanism: 'Adding tests reduces bugs by catching errors early',
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });
  });

  describe('createExperiment', () => {
    it('should create A/B test experiment', async () => {
      const experiment: CausalExperiment = {
        name: 'Test Impact of Code Reviews',
        hypothesis: 'Code reviews reduce bug rate',
        treatmentId: 100,
        treatmentType: 'code_review',
        controlId: 101,
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
      };

      const expId = await causalGraph.createExperiment(experiment);

      expect(expId).toBeGreaterThan(0);
    });

    it('should create experiment without control group', async () => {
      const experiment: CausalExperiment = {
        name: 'Test New Feature',
        hypothesis: 'Feature improves UX',
        treatmentId: 200,
        treatmentType: 'feature_flag',
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
      };

      const expId = await causalGraph.createExperiment(experiment);

      expect(expId).toBeGreaterThan(0);
    });
  });

  describe('recordObservation', () => {
    it('should record treatment observation', async () => {
      // Create episode first (FK on causal_observations.episode_id).
      await backend.query(
        `INSERT INTO episodes (id, ts, session_id, task, reward, success)
           VALUES ($1, $2, 'test-session', 'test task', 0.85, TRUE)`,
        [1, Date.now()],
      );

      const expId = await causalGraph.createExperiment({
        name: 'Test',
        hypothesis: 'Tests help',
        treatmentId: 1,
        treatmentType: 'test',
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
      });

      const observation: CausalObservation = {
        experimentId: expId,
        episodeId: 1,
        isTreatment: true,
        outcomeValue: 0.85,
        outcomeType: 'reward',
      };

      await expect(causalGraph.recordObservation(observation)).resolves.toBeUndefined();
    });

    it('should record control observation', async () => {
      await backend.query(
        `INSERT INTO episodes (id, ts, session_id, task, reward, success)
           VALUES ($1, $2, 'test-session', 'test task', 0.65, TRUE)`,
        [2, Date.now()],
      );

      const expId = await causalGraph.createExperiment({
        name: 'Test',
        hypothesis: 'Tests help',
        treatmentId: 1,
        treatmentType: 'test',
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
      });

      const observation: CausalObservation = {
        experimentId: expId,
        episodeId: 2,
        isTreatment: false,
        outcomeValue: 0.65,
        outcomeType: 'reward',
      };

      await expect(causalGraph.recordObservation(observation)).resolves.toBeUndefined();
    });
  });

  describe('calculateUplift', () => {
    it('should calculate positive uplift', async () => {
      for (let i = 0; i < 20; i++) {
        await backend.query(
          `INSERT INTO episodes (id, ts, session_id, task, reward, success)
             VALUES ($1, $2, 'test-session', 'test task', $3, TRUE)`,
          [i, Date.now(), i < 10 ? 0.85 : 0.65],
        );
      }

      const expId = await causalGraph.createExperiment({
        name: 'Test',
        hypothesis: 'Tests help',
        treatmentId: 1,
        treatmentType: 'test',
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
      });

      for (let i = 0; i < 10; i++) {
        await causalGraph.recordObservation({
          experimentId: expId,
          episodeId: i,
          isTreatment: true,
          outcomeValue: 0.8 + Math.random() * 0.1,
          outcomeType: 'reward',
        });
      }

      for (let i = 10; i < 20; i++) {
        await causalGraph.recordObservation({
          experimentId: expId,
          episodeId: i,
          isTreatment: false,
          outcomeValue: 0.6 + Math.random() * 0.1,
          outcomeType: 'reward',
        });
      }

      const result = await causalGraph.calculateUplift(expId);

      expect(result.uplift).toBeGreaterThan(0);
      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
      expect(result.confidenceInterval).toHaveLength(2);
      expect(result.confidenceInterval[0]).toBeLessThan(result.confidenceInterval[1]);
    });

    it('should handle experiment with no observations', async () => {
      const expId = await causalGraph.createExperiment({
        name: 'Test',
        hypothesis: 'Tests help',
        treatmentId: 1,
        treatmentType: 'test',
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
      });

      const result = await causalGraph.calculateUplift(expId);

      expect(result.uplift).toBe(0);
      expect(result.pValue).toBe(1.0);
    });
  });

  describe('queryCausalEffects', () => {
    beforeEach(async () => {
      await causalGraph.addCausalEdge({
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.9,
        uplift: 0.3,
        confidence: 0.95,
        sampleSize: 100,
      });

      await causalGraph.addCausalEdge({
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 3,
        toMemoryType: 'episode',
        similarity: 0.85,
        uplift: 0.15,
        confidence: 0.88,
        sampleSize: 80,
      });

      await causalGraph.addCausalEdge({
        fromMemoryId: 2,
        fromMemoryType: 'episode',
        toMemoryId: 4,
        toMemoryType: 'episode',
        similarity: 0.7,
        uplift: 0.05,
        confidence: 0.6,
        sampleSize: 30,
      });
    });

    it('should query causal effects by intervention', async () => {
      const effects = await causalGraph.queryCausalEffects({
        interventionMemoryId: 1,
        interventionMemoryType: 'episode',
      });

      expect(effects.length).toBeGreaterThan(0);
      effects.forEach(edge => {
        expect(edge.fromMemoryId).toBe(1);
        expect(edge.fromMemoryType).toBe('episode');
      });
    });

    it('should filter by minimum confidence', async () => {
      const effects = await causalGraph.queryCausalEffects({
        interventionMemoryId: 1,
        interventionMemoryType: 'episode',
        minConfidence: 0.9,
      });

      effects.forEach(edge => {
        expect(edge.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should filter by minimum uplift', async () => {
      const effects = await causalGraph.queryCausalEffects({
        interventionMemoryId: 1,
        interventionMemoryType: 'episode',
        minUplift: 0.2,
      });

      effects.forEach(edge => {
        expect(Math.abs(edge.uplift || 0)).toBeGreaterThanOrEqual(0.2);
      });
    });

    it('should sort by impact (uplift * confidence)', async () => {
      const effects = await causalGraph.queryCausalEffects({
        interventionMemoryId: 1,
        interventionMemoryType: 'episode',
        minConfidence: 0.5,
      });

      for (let i = 0; i < effects.length - 1; i++) {
        const impact1 = Math.abs(effects[i].uplift || 0) * effects[i].confidence;
        const impact2 = Math.abs(effects[i + 1].uplift || 0) * effects[i + 1].confidence;
        expect(impact1).toBeGreaterThanOrEqual(impact2);
      }
    });
  });

  describe('getCausalChain (WITH RECURSIVE)', () => {
    it('should traverse multi-hop chain on postgres dialect', async () => {
      // Build chain: 1 -> 2 -> 3 -> 4 (exercises the recursive arm with
      // LEAST() aggregating confidence and column-type-consistent path
      // concatenation under BIGSERIAL ids).
      await causalGraph.addCausalEdge({
        fromMemoryId: 1, fromMemoryType: 'episode',
        toMemoryId: 2, toMemoryType: 'episode',
        similarity: 0.9, uplift: 0.2, confidence: 0.9,
      });
      await causalGraph.addCausalEdge({
        fromMemoryId: 2, fromMemoryType: 'episode',
        toMemoryId: 3, toMemoryType: 'episode',
        similarity: 0.85, uplift: 0.15, confidence: 0.85,
      });
      await causalGraph.addCausalEdge({
        fromMemoryId: 3, fromMemoryType: 'episode',
        toMemoryId: 4, toMemoryType: 'episode',
        similarity: 0.8, uplift: 0.1, confidence: 0.8,
      });

      // 1-hop reachability (anchor row only).
      const directChains = await causalGraph.getCausalChain(1, 2);
      expect(directChains.length).toBeGreaterThan(0);
      expect(directChains[0].path[0]).toBe(1);
      expect(directChains[0].path[directChains[0].path.length - 1]).toBe(2);

      // 3-hop chain — exercises the recursive arm.
      const deepChains = await causalGraph.getCausalChain(1, 4, 5);
      expect(deepChains.length).toBeGreaterThan(0);
      const deepPath = deepChains[0].path;
      expect(deepPath[0]).toBe(1);
      expect(deepPath[deepPath.length - 1]).toBe(4);
      // LEAST() over the chain — confidence must not exceed the weakest
      // edge (0.8) and must clear the 0.5 floor the WHERE filter imposes.
      expect(deepChains[0].confidence).toBeLessThanOrEqual(0.8);
      expect(deepChains[0].confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should return empty chain when no path exists', async () => {
      await causalGraph.addCausalEdge({
        fromMemoryId: 1, fromMemoryType: 'episode',
        toMemoryId: 2, toMemoryType: 'episode',
        similarity: 0.9, uplift: 0.2, confidence: 0.9,
      });

      const chains = await causalGraph.getCausalChain(1, 99);
      expect(chains).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero uplift', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.9,
        uplift: 0.0,
        confidence: 0.95,
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });

    it('should handle very high confidence', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.99,
        uplift: 0.5,
        confidence: 0.99,
        sampleSize: 1000,
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });

    it('should handle low confidence edges', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.5,
        uplift: 0.1,
        confidence: 0.5,
        sampleSize: 10,
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });

    it('should handle empty evidence IDs', async () => {
      const edge: CausalEdge = {
        fromMemoryId: 1,
        fromMemoryType: 'episode',
        toMemoryId: 2,
        toMemoryType: 'episode',
        similarity: 0.8,
        confidence: 0.85,
        evidenceIds: [],
      };

      const edgeId = await causalGraph.addCausalEdge(edge);

      expect(edgeId).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should add 100 causal edges efficiently', async () => {
      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        await causalGraph.addCausalEdge({
          fromMemoryId: i,
          fromMemoryType: 'episode',
          toMemoryId: i + 1,
          toMemoryType: 'episode',
          similarity: Math.random(),
          uplift: Math.random() * 0.4 - 0.2,
          confidence: 0.5 + Math.random() * 0.5,
          sampleSize: Math.floor(Math.random() * 100) + 10,
        });
      }

      const duration = Date.now() - startTime;

      // Postgres-substrate budget — round-trip cost is higher than
      // SQLite's in-process .prepare().run(). 5 s is a generous ceiling
      // for 100 sequential INSERTs on pglite.
      expect(duration).toBeLessThan(5000);
    });

    it('should query causal effects efficiently', async () => {
      for (let i = 0; i < 50; i++) {
        await causalGraph.addCausalEdge({
          fromMemoryId: 1,
          fromMemoryType: 'episode',
          toMemoryId: i + 2,
          toMemoryType: 'episode',
          similarity: Math.random(),
          uplift: Math.random() * 0.4 - 0.2,
          confidence: 0.5 + Math.random() * 0.5,
        });
      }

      const startTime = Date.now();

      const effects = await causalGraph.queryCausalEffects({
        interventionMemoryId: 1,
        interventionMemoryType: 'episode',
        minConfidence: 0.7,
      });

      const duration = Date.now() - startTime;

      expect(effects.length).toBeGreaterThan(0);
      // Single index-backed SELECT — pglite typically completes in
      // single-digit ms; budget is conservative.
      expect(duration).toBeLessThan(500);
    });
  });
});
