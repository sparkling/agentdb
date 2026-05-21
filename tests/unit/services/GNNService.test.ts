/**
 * Unit Tests for GNNService
 *
 * Tests semantic intent classification, skill recommendation, pattern
 * similarity, GCN skill matching, GAT context understanding, heterogeneous
 * graph processing, node classification, and link prediction.
 *
 * Engine note: @ruvector/gnn requires a native NAPI binary that is not
 * present for this platform in node_modules (the darwin-arm64 .node file is
 * missing), so initialize() resolves to the JS fallback (engineType='js').
 * The service is deliberately designed with a complete zero-dependency JS
 * fallback for exactly this case (ADR-062: "Zero-overhead JS fallback when
 * native is not present"), so every public method is fully exercisable
 * through its JS path. These tests assert the JS-fallback behavior, which is
 * deterministic except for classifyNode() (documented below).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GNNService, GNNConfig, IntentResult } from '../../../src/services/GNNService.js';

/** Build a unit-length-ish Float32Array biased toward one dimension. */
function oneHot(dim: number, idx: number): Float32Array {
  const v = new Float32Array(dim);
  v[idx % dim] = 1.0;
  return v;
}

describe('GNNService', () => {
  let gnn: GNNService;

  beforeEach(async () => {
    gnn = new GNNService();
    await gnn.initialize();
  });

  describe('constructor / config', () => {
    it('applies sensible defaults', () => {
      const stats = gnn.getStats();
      expect(stats.config.hiddenDim).toBe(128);
      expect(stats.config.outputDim).toBe(64);
      expect(stats.config.heads).toBe(8);
      expect(stats.config.inputDim).toBeGreaterThan(0);
    });

    it('honors explicit config overrides', () => {
      const g = new GNNService({ inputDim: 64, hiddenDim: 256, outputDim: 32, heads: 4 });
      const c = g.getStats().config;
      expect(c.inputDim).toBe(64);
      expect(c.hiddenDim).toBe(256);
      expect(c.outputDim).toBe(32);
      expect(c.heads).toBe(4);
    });

    it('falls back from the deprecated layers option to heads', () => {
      const g = new GNNService({ layers: 16 });
      expect(g.getStats().config.heads).toBe(16);
    });

    it('prefers heads over layers when both are supplied', () => {
      const g = new GNNService({ heads: 8, layers: 16 });
      expect(g.getStats().config.heads).toBe(8);
    });
  });

  describe('initialize / engine state', () => {
    it('marks the service initialized', () => {
      expect(gnn.isInitialized()).toBe(true);
    });

    it('reports a valid engine type', () => {
      expect(['native', 'js']).toContain(gnn.getEngineType());
    });

    it('is idempotent (second initialize does not change state)', async () => {
      const engineBefore = gnn.getEngineType();
      await gnn.initialize();
      expect(gnn.isInitialized()).toBe(true);
      expect(gnn.getEngineType()).toBe(engineBefore);
    });

    it('getStats reflects engine type, init flag, and config', () => {
      const stats = gnn.getStats();
      expect(stats.engineType).toBe(gnn.getEngineType());
      expect(stats.initialized).toBe(true);
      expect(stats.config).toBeDefined();
    });

    it('auto-initializes lazily on first method call without explicit initialize()', async () => {
      const lazy = new GNNService();
      expect(lazy.isInitialized()).toBe(false);
      await lazy.classifyIntent('find data', oneHot(lazy.getStats().config.inputDim, 0));
      expect(lazy.isInitialized()).toBe(true);
    });
  });

  describe('classifyIntent (JS keyword fallback)', () => {
    const dim = 768;

    it('classifies a search intent', async () => {
      const r: IntentResult = await gnn.classifyIntent('find the latest results', oneHot(dim, 0));
      expect(r.intent).toBe('search');
      expect(r.confidence).toBe(0.8);
    });

    it('classifies a create intent', async () => {
      const r = await gnn.classifyIntent('add a new record', oneHot(dim, 1));
      expect(r.intent).toBe('create');
      expect(r.confidence).toBe(0.8);
    });

    it('classifies an update intent', async () => {
      const r = await gnn.classifyIntent('modify the existing entry', oneHot(dim, 2));
      expect(r.intent).toBe('update');
      expect(r.confidence).toBe(0.8);
    });

    it('classifies a delete intent', async () => {
      const r = await gnn.classifyIntent('remove the old data', oneHot(dim, 3));
      expect(r.intent).toBe('delete');
      expect(r.confidence).toBe(0.8);
    });

    it('classifies an analyze intent', async () => {
      const r = await gnn.classifyIntent('generate a summary report', oneHot(dim, 4));
      expect(r.intent).toBe('analyze');
      expect(r.confidence).toBe(0.8);
    });

    it('defaults to search with lower confidence for an unrecognized query', async () => {
      const r = await gnn.classifyIntent('xyzzy plugh frobnicate', oneHot(dim, 0));
      expect(r.intent).toBe('search');
      expect(r.confidence).toBe(0.5);
    });

    it('is case-insensitive', async () => {
      const r = await gnn.classifyIntent('DELETE EVERYTHING', oneHot(dim, 0));
      expect(r.intent).toBe('delete');
    });

    it('returns one of the five known intent categories', async () => {
      const r = await gnn.classifyIntent('do something', oneHot(dim, 0));
      expect(['search', 'create', 'update', 'delete', 'analyze']).toContain(r.intent);
    });
  });

  describe('recommendSkills (JS graph-neighbor fallback)', () => {
    const skillGraph: Record<string, string[]> = {
      typescript: ['javascript', 'nodejs', 'testing'],
      javascript: ['typescript', 'react'],
      python: ['data-science', 'testing'],
      isolated: [],
    };

    it('returns the direct neighbors of a skill', async () => {
      const recs = await gnn.recommendSkills('typescript', skillGraph);
      expect(recs).toEqual(['javascript', 'nodejs', 'testing']);
    });

    it('caps recommendations at 5', async () => {
      const big: Record<string, string[]> = {
        hub: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      };
      const recs = await gnn.recommendSkills('hub', big);
      expect(recs.length).toBeLessThanOrEqual(5);
    });

    it('falls back to other graph skills when the current skill has no neighbors', async () => {
      const recs = await gnn.recommendSkills('isolated', skillGraph);
      expect(recs).not.toContain('isolated');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs.length).toBeLessThanOrEqual(5);
    });

    it('falls back to other skills for a skill absent from the graph', async () => {
      const recs = await gnn.recommendSkills('unknown-skill', skillGraph);
      expect(recs).not.toContain('unknown-skill');
      expect(recs.length).toBeGreaterThan(0);
    });

    it('returns an empty array for a single-node graph with no neighbors', async () => {
      const recs = await gnn.recommendSkills('only', { only: [] });
      expect(recs).toEqual([]);
    });
  });

  describe('findSimilarPatterns (JS cosine-similarity fallback)', () => {
    it('ranks identical patterns highest', async () => {
      const query = [1, 0, 0, 0];
      const patterns = [
        [0, 1, 0, 0], // orthogonal -> 0
        [1, 0, 0, 0], // identical -> 1
        [0.5, 0.5, 0, 0], // partial
      ];
      const results = await gnn.findSimilarPatterns(query, patterns);
      expect(results[0].index).toBe(1);
      expect(results[0].similarity).toBeCloseTo(1, 5);
    });

    it('returns results sorted by descending similarity', async () => {
      const query = [1, 1, 0];
      const patterns = [
        [1, 1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ];
      const results = await gnn.findSimilarPatterns(query, patterns);
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
      }
    });

    it('returns one result per candidate pattern with valid indices', async () => {
      const results = await gnn.findSimilarPatterns([1, 0], [[1, 0], [0, 1], [1, 1]]);
      expect(results).toHaveLength(3);
      const indices = results.map(r => r.index).sort();
      expect(indices).toEqual([0, 1, 2]);
    });

    it('yields zero similarity for orthogonal vectors', async () => {
      const results = await gnn.findSimilarPatterns([1, 0], [[0, 1]]);
      expect(results[0].similarity).toBeCloseTo(0, 5);
    });

    it('handles a zero vector without producing NaN (returns 0 similarity)', async () => {
      const results = await gnn.findSimilarPatterns([0, 0, 0], [[1, 2, 3]]);
      expect(results[0].similarity).toBe(0);
      expect(Number.isNaN(results[0].similarity)).toBe(false);
    });

    it('returns an empty array when there are no candidate patterns', async () => {
      const results = await gnn.findSimilarPatterns([1, 2, 3], []);
      expect(results).toEqual([]);
    });
  });

  describe('matchSkillsGCN (JS cosine fallback)', () => {
    const dim = 8;
    const skillGraph: Record<string, { embedding: Float32Array; neighbors: string[] }> = {
      coding: { embedding: oneHot(dim, 0), neighbors: ['testing'] },
      testing: { embedding: oneHot(dim, 1), neighbors: ['coding'] },
      design: { embedding: oneHot(dim, 2), neighbors: [] },
    };

    it('matches the most similar skill to the task embedding', async () => {
      const task = oneHot(dim, 0); // aligned with 'coding'
      const matches = await gnn.matchSkillsGCN(task, skillGraph);
      expect(matches[0].skill).toBe('coding');
      expect(matches[0].score).toBeCloseTo(1, 5);
    });

    it('returns results sorted by descending score', async () => {
      const matches = await gnn.matchSkillsGCN(oneHot(dim, 1), skillGraph);
      for (let i = 0; i < matches.length - 1; i++) {
        expect(matches[i].score).toBeGreaterThanOrEqual(matches[i + 1].score);
      }
    });

    it('respects the topK limit', async () => {
      const matches = await gnn.matchSkillsGCN(oneHot(dim, 0), skillGraph, 2);
      expect(matches.length).toBe(2);
    });

    it('attaches a confidence value to each match', async () => {
      const matches = await gnn.matchSkillsGCN(oneHot(dim, 0), skillGraph);
      matches.forEach(m => {
        expect(typeof m.confidence).toBe('number');
        expect(m.confidence).toBeGreaterThan(0);
      });
    });

    it('returns at most one entry per skill in the graph', async () => {
      const matches = await gnn.matchSkillsGCN(oneHot(dim, 0), skillGraph, 100);
      const skills = matches.map(m => m.skill);
      expect(new Set(skills).size).toBe(skills.length);
      expect(skills.length).toBeLessThanOrEqual(Object.keys(skillGraph).length);
    });
  });

  describe('understandContextGAT (JS uniform-attention fallback)', () => {
    const dim = 6;
    const contextNodes = [
      { id: 'n1', embedding: oneHot(dim, 0), type: 'code' },
      { id: 'n2', embedding: oneHot(dim, 1), type: 'code' },
      { id: 'n3', embedding: oneHot(dim, 2), type: 'doc' },
    ];

    it('returns a context vector matching the query dimensionality', async () => {
      const result = await gnn.understandContextGAT(oneHot(dim, 0), contextNodes);
      expect(result.contextVector).toBeInstanceOf(Float32Array);
      expect(result.contextVector.length).toBe(dim);
    });

    it('assigns an attention weight to every context node', async () => {
      const result = await gnn.understandContextGAT(oneHot(dim, 0), contextNodes);
      expect(Object.keys(result.attentionWeights).sort()).toEqual(['n1', 'n2', 'n3']);
    });

    it('uniform attention weights sum to ~1 in the JS fallback', async () => {
      const result = await gnn.understandContextGAT(oneHot(dim, 0), contextNodes);
      const sum = Object.values(result.attentionWeights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('ranks dominant node types by frequency (code before doc)', async () => {
      const result = await gnn.understandContextGAT(oneHot(dim, 0), contextNodes);
      // 2 'code' nodes vs 1 'doc' node -> 'code' dominates
      expect(result.dominantTypes[0]).toBe('code');
      expect(result.dominantTypes).toContain('doc');
    });

    it('averages context embeddings in the JS fallback', async () => {
      // 3 one-hot vectors at indices 0,1,2 -> average is 1/3 at each of those.
      const result = await gnn.understandContextGAT(oneHot(dim, 5), contextNodes);
      expect(result.contextVector[0]).toBeCloseTo(1 / 3, 5);
      expect(result.contextVector[1]).toBeCloseTo(1 / 3, 5);
      expect(result.contextVector[2]).toBeCloseTo(1 / 3, 5);
      expect(result.contextVector[3]).toBeCloseTo(0, 5);
    });
  });

  describe('processHeterogeneousGraph', () => {
    const dim = 6;
    const graph = {
      nodes: [
        { id: 'a', type: 'agent', embedding: oneHot(dim, 0) },
        { id: 't', type: 'task', embedding: oneHot(dim, 1) },
        { id: 's', type: 'skill', embedding: oneHot(dim, 2) },
        { id: 'x', type: 'task', embedding: oneHot(dim, 3) },
      ],
      edges: [
        { from: 'a', to: 't', type: 'depends_on', weight: 0.9 },
        { from: 't', to: 's', type: 'requires', weight: 0.8 },
        { from: 's', to: 'x', type: 'similar_to', weight: 0.7 },
      ],
    };

    it('throws when the query node is not in the graph', async () => {
      await expect(
        gnn.processHeterogeneousGraph(graph, 'nonexistent')
      ).rejects.toThrow(/not found in graph/);
    });

    it('returns an embedding, related nodes, and pathways for a valid query node', async () => {
      const result = await gnn.processHeterogeneousGraph(graph, 'a');
      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.embedding.length).toBe(dim);
      expect(Array.isArray(result.relatedNodes)).toBe(true);
      expect(Array.isArray(result.pathways)).toBe(true);
    });

    it('excludes the query node from the related-nodes list', async () => {
      const result = await gnn.processHeterogeneousGraph(graph, 'a');
      expect(result.relatedNodes.map(n => n.id)).not.toContain('a');
    });

    it('sorts related nodes by descending relevance', async () => {
      const result = await gnn.processHeterogeneousGraph(graph, 'a');
      for (let i = 0; i < result.relatedNodes.length - 1; i++) {
        expect(result.relatedNodes[i].relevance).toBeGreaterThanOrEqual(
          result.relatedNodes[i + 1].relevance
        );
      }
    });

    it('discovers a multi-hop pathway from the query node', async () => {
      const result = await gnn.processHeterogeneousGraph(graph, 'a');
      // There is a path a -> t -> s -> x; expect at least one pathway starting at 'a'.
      expect(result.pathways.length).toBeGreaterThan(0);
      result.pathways.forEach(p => {
        expect(p.path[0]).toBe('a');
        expect(typeof p.strength).toBe('number');
      });
    });

    it('preserves node type metadata in related nodes', async () => {
      const result = await gnn.processHeterogeneousGraph(graph, 'a');
      result.relatedNodes.forEach(n => {
        const original = graph.nodes.find(orig => orig.id === n.id);
        expect(n.type).toBe(original!.type);
      });
    });
  });

  describe('classifyNode (JS random fallback)', () => {
    const dim = 8;
    const categories = ['bug', 'feature', 'docs', 'refactor'];

    it('returns a category from the provided list', async () => {
      const result = await gnn.classifyNode(oneHot(dim, 0), [oneHot(dim, 1)], categories);
      expect(categories).toContain(result.category);
    });

    it('produces a normalized score for every category summing to ~1', async () => {
      const result = await gnn.classifyNode(oneHot(dim, 0), [], categories);
      expect(Object.keys(result.scores).sort()).toEqual([...categories].sort());
      const sum = Object.values(result.scores).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('reports the chosen category as the one with the highest score', async () => {
      const result = await gnn.classifyNode(oneHot(dim, 0), [oneHot(dim, 2)], categories);
      const maxScore = Math.max(...Object.values(result.scores));
      expect(result.scores[result.category]).toBeCloseTo(maxScore, 10);
      expect(result.confidence).toBeCloseTo(maxScore, 10);
    });

    it('all category scores are valid probabilities in [0, 1]', async () => {
      const result = await gnn.classifyNode(oneHot(dim, 0), [], categories);
      Object.values(result.scores).forEach(s => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });
    });

    it('handles a single-category classification', async () => {
      const result = await gnn.classifyNode(oneHot(dim, 0), [], ['only']);
      expect(result.category).toBe('only');
      expect(result.scores['only']).toBeCloseTo(1, 5);
      expect(result.confidence).toBeCloseTo(1, 5);
    });
  });

  describe('predictLinks (JS cosine-similarity fallback)', () => {
    const dim = 6;
    const source = { id: 'src', embedding: oneHot(dim, 0) };
    const candidates = [
      { id: 'c1', embedding: oneHot(dim, 0), type: 'task' }, // identical -> high
      { id: 'c2', embedding: oneHot(dim, 1), type: 'task' }, // orthogonal -> 0, filtered
      { id: 'c3', embedding: new Float32Array([0.7, 0.7, 0, 0, 0, 0]), type: 'skill' },
    ];

    it('predicts the most similar candidate as the strongest link', async () => {
      const links = await gnn.predictLinks(source, candidates, []);
      expect(links[0].targetId).toBe('c1');
      expect(links[0].probability).toBeCloseTo(1, 5);
    });

    it('excludes candidates that already have an edge from the source', async () => {
      const links = await gnn.predictLinks(source, candidates, [{ from: 'src', to: 'c1' }]);
      expect(links.map(l => l.targetId)).not.toContain('c1');
    });

    it('filters out zero-probability (orthogonal) candidates', async () => {
      const links = await gnn.predictLinks(source, candidates, []);
      // c2 is orthogonal -> probability 0 -> filtered out
      expect(links.map(l => l.targetId)).not.toContain('c2');
    });

    it('sorts predictions by descending probability', async () => {
      const links = await gnn.predictLinks(source, candidates, []);
      for (let i = 0; i < links.length - 1; i++) {
        expect(links[i].probability).toBeGreaterThanOrEqual(links[i + 1].probability);
      }
    });

    it('respects the topK limit', async () => {
      const many = Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`,
        embedding: new Float32Array([1, i / 10, 0, 0, 0, 0]),
        type: 'task',
      }));
      const links = await gnn.predictLinks(source, many, [], 3);
      expect(links.length).toBeLessThanOrEqual(3);
    });

    it('attaches a human-readable reasoning string to each prediction', async () => {
      const links = await gnn.predictLinks(source, candidates, []);
      links.forEach(l => {
        expect(typeof l.reasoning).toBe('string');
        expect(l.reasoning.length).toBeGreaterThan(0);
      });
    });

    it('returns an empty array when every candidate already has an edge', async () => {
      const links = await gnn.predictLinks(source, candidates, [
        { from: 'src', to: 'c1' },
        { from: 'src', to: 'c2' },
        { from: 'src', to: 'c3' },
      ]);
      expect(links).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('classifyIntent handles an empty query', async () => {
      const r = await gnn.classifyIntent('', oneHot(768, 0));
      expect(['search', 'create', 'update', 'delete', 'analyze']).toContain(r.intent);
    });

    it('recommendSkills handles an empty graph', async () => {
      const recs = await gnn.recommendSkills('anything', {});
      expect(recs).toEqual([]);
    });

    it('findSimilarPatterns handles mismatched vector lengths via min-length cosine', async () => {
      // cosineSim uses min(len) — should not throw and should yield a finite number.
      const results = await gnn.findSimilarPatterns([1, 0, 0], [[1, 0]]);
      expect(results).toHaveLength(1);
      expect(Number.isFinite(results[0].similarity)).toBe(true);
    });
  });
});
