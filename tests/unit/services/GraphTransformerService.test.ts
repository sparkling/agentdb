/**
 * Unit Tests for GraphTransformerService
 *
 * GraphTransformerService wraps the optional @ruvector/graph-transformer native
 * module and provides a deterministic pure-JS fallback for all 8 graph-attention
 * modules plus proof operations.
 *
 * Testing strategy:
 *  - The JS fallback path is fully deterministic. A *fresh* (uninitialized)
 *    instance has available=false / engineType='js', so every method exercises
 *    the documented JS fallback. These tests assert exact mathematical behavior.
 *  - A separately initialized instance is used to assert the public availability
 *    contract (initialize(), isAvailable(), getEngineType(), getStats()) and that
 *    the methods which normalize native output still return the documented shape.
 *
 * The native module may or may not load depending on the host platform; the
 * fallback-path tests are independent of that, keeping the suite deterministic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphTransformerService } from '../../../src/services/GraphTransformerService.js';
import { cosineSimilarity } from '../../../src/utils/similarity.js';

describe('GraphTransformerService', () => {
  // ==========================================================================
  // JS fallback path (fresh instance, initialize() NOT called)
  // ==========================================================================

  describe('JS fallback path (uninitialized)', () => {
    let svc: GraphTransformerService;

    beforeEach(() => {
      // No initialize() => available=false, engineType='js' => deterministic JS fallback.
      svc = new GraphTransformerService();
    });

    it('reports js engine and unavailable before initialization', () => {
      expect(svc.isAvailable()).toBe(false);
      expect(svc.getEngineType()).toBe('js');
    });

    it('reports empty modulesLoaded in stats when unavailable', () => {
      const stats = svc.getStats();
      expect(stats).toEqual({
        available: false,
        engineType: 'js',
        modulesLoaded: [],
      });
    });

    // ----- 1. sublinearAttention -----
    describe('sublinearAttention', () => {
      it('returns the top-K rows by cosine similarity to the query', () => {
        const query = [1, 0, 0];
        const adjacency = [
          [1, 0, 0], // identical -> sim 1
          [0, 1, 0], // orthogonal -> sim 0
          [0, 0, 1], // orthogonal -> sim 0
          [0.5, 0.5, 0], // partial
        ];

        const { scores, indices } = svc.sublinearAttention(query, adjacency, 3, 2);

        expect(indices).toHaveLength(2);
        expect(scores).toHaveLength(2);
        expect(indices[0]).toBe(0); // best match is the identical row
        expect(scores[0]).toBeCloseTo(1, 6);
        // Scores are returned in descending order.
        expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
      });

      it('caps the result count at topK even when more rows exist', () => {
        const adjacency = Array.from({ length: 10 }, (_, i) => [i + 1, 0, 0]);
        const { scores, indices } = svc.sublinearAttention([1, 0, 0], adjacency, 3, 3);

        expect(indices).toHaveLength(3);
        expect(scores).toHaveLength(3);
      });
    });

    // ----- 2. verifiedStep -----
    describe('verifiedStep', () => {
      it('applies a single SGD update: w - lr * grad', () => {
        const { updated, proofId } = svc.verifiedStep([1, 2, 3], [0.1, 0.2, 0.3], 0.5);

        expect(updated).toEqual([
          1 - 0.5 * 0.1,
          2 - 0.5 * 0.2,
          3 - 0.5 * 0.3,
        ]);
        expect(proofId).toBeUndefined(); // JS fallback returns no proof
      });

      it('treats missing gradients as zero', () => {
        const { updated } = svc.verifiedStep([1, 2, 3], [0.1], 1.0);

        expect(updated[0]).toBeCloseTo(0.9, 10);
        expect(updated[1]).toBe(2); // gradient undefined -> unchanged
        expect(updated[2]).toBe(3);
      });
    });

    // ----- 3. causalAttention -----
    describe('causalAttention', () => {
      it('weights similarity by temporal decay (older keys decay more)', () => {
        const query = [1, 0];
        const keys = [
          [1, 0], // identical, recent
          [1, 0], // identical, old
        ];
        const timestamps = [100, 50]; // key 0 newer than key 1

        const { scores, causalWeights } = svc.causalAttention(query, keys, timestamps);

        expect(scores).toHaveLength(2);
        // Both keys are identical to query, but the newer key decays less => higher score.
        expect(scores[0]).toBeGreaterThan(scores[1]);
        // causalWeights are the non-negative clamp of scores.
        expect(causalWeights[0]).toBeCloseTo(Math.max(0, scores[0]), 10);
      });

      it('clamps negative causal weights to zero', () => {
        const query = [1, 0];
        const keys = [[-1, 0]]; // opposite direction -> negative similarity
        const timestamps = [100];

        const { scores, causalWeights } = svc.causalAttention(query, keys, timestamps);

        expect(scores[0]).toBeLessThan(0);
        expect(causalWeights[0]).toBe(0);
      });
    });

    // ----- 4. grangerExtract -----
    describe('grangerExtract', () => {
      it('extracts edges between strongly correlated node series', () => {
        // Three node slices; nodes 0 and 1 identical, node 2 differs.
        const history = [
          1, 2, 3, 4, // node 0
          1, 2, 3, 4, // node 1 (identical to node 0)
          4, 3, 2, 1, // node 2 (reversed)
        ];

        const { edges } = svc.grangerExtract(history, 3, 4);

        // The identical pair (0,1) must produce a strong edge.
        const edge01 = edges.find(e => e.from === 0 && e.to === 1);
        expect(edge01).toBeDefined();
        expect(edge01!.strength).toBeCloseTo(1, 6);
        // All emitted edges exceed the 0.3 threshold.
        edges.forEach(e => expect(e.strength).toBeGreaterThan(0.3));
      });

      it('returns no edges when series are weakly correlated', () => {
        // Orthogonal-ish blocks produce near-zero similarity.
        const history = [
          1, 0, 0, 0, // node 0
          0, 1, 0, 0, // node 1
        ];

        const { edges } = svc.grangerExtract(history, 2, 4);
        expect(edges).toEqual([]);
      });
    });

    // ----- 5. hamiltonianStep -----
    describe('hamiltonianStep', () => {
      it('returns leapfrog-integrated positions, momenta, and conserved-ish energy', () => {
        const positions = [1, 0];
        const momenta = [0, 1];
        const dt = 0.1;

        const result = svc.hamiltonianStep(positions, momenta, dt);

        expect(result.newPositions).toHaveLength(2);
        expect(result.newMomenta).toHaveLength(2);
        // Harmonic oscillator energy starts at 0.5*(1^2) + 0.5*(1^2) = 1; leapfrog
        // conserves it to high precision over one small step.
        expect(result.energy).toBeCloseTo(1, 3);
        // Does not mutate the input arrays.
        expect(positions).toEqual([1, 0]);
        expect(momenta).toEqual([0, 1]);
      });

      it('produces zero energy for a system at rest at the origin', () => {
        const result = svc.hamiltonianStep([0, 0], [0, 0], 0.1);
        expect(result.energy).toBe(0);
        expect(result.newPositions).toEqual([0, 0]);
        expect(result.newMomenta).toEqual([0, 0]);
      });
    });

    // ----- 6. spikingAttention -----
    describe('spikingAttention', () => {
      it('fires neurons whose integrated activation meets the threshold', () => {
        const potentials = [0.4, 0.9, 0.1];
        // Each neuron receives one incoming edge weight; activations += w * 0.1.
        const edges = [[1], [1], [1]];
        const threshold = 0.5;

        const { spikes, activations } = svc.spikingAttention(potentials, edges, threshold);

        // activation[i] = potential[i] + 0.1
        expect(activations[0]).toBeCloseTo(0.5, 10);
        expect(activations[1]).toBeCloseTo(1.0, 10);
        expect(activations[2]).toBeCloseTo(0.2, 10);

        expect(spikes[0]).toBe(true);  // 0.5 >= 0.5
        expect(spikes[1]).toBe(true);  // 1.0 >= 0.5
        expect(spikes[2]).toBe(false); // 0.2 <  0.5
      });

      it('handles neurons with no incoming edges', () => {
        const { spikes, activations } = svc.spikingAttention([0.6, 0.3], [], 0.5);

        // No edges => activations equal raw potentials.
        expect(activations).toEqual([0.6, 0.3]);
        expect(spikes).toEqual([true, false]);
      });
    });

    // ----- 7. gameTheoreticAttention -----
    describe('gameTheoreticAttention', () => {
      it('returns a softmax equilibrium that is a valid probability distribution', () => {
        const { equilibrium, nashScore } = svc.gameTheoreticAttention([1, 2, 3], []);

        expect(equilibrium).toHaveLength(3);
        // Probabilities sum to ~1.
        const sum = equilibrium.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 6);
        // Higher utility => higher equilibrium weight.
        expect(equilibrium[2]).toBeGreaterThan(equilibrium[0]);
        // Nash score is clamped to [0,1].
        expect(nashScore).toBeGreaterThanOrEqual(0);
        expect(nashScore).toBeLessThanOrEqual(1);
      });

      it('reports a low nash score for a near-uniform equilibrium', () => {
        // Equal utilities => uniform equilibrium => maximal entropy => nashScore near 0.
        const { equilibrium, nashScore } = svc.gameTheoreticAttention([1, 1, 1], []);

        equilibrium.forEach(p => expect(p).toBeCloseTo(1 / 3, 6));
        expect(nashScore).toBeLessThan(0.1);
      });
    });

    // ----- 8. productManifoldDistance -----
    describe('productManifoldDistance', () => {
      it('returns zero distance for identical vectors', () => {
        const { distance, components } = svc.productManifoldDistance(
          [1, 2, 3, 4],
          [1, 2, 3, 4],
          [0.5, 1.0],
        );

        expect(distance).toBe(0);
        expect(components).toEqual([0, 0]);
      });

      it('scales each block distance by 1 + |curvature|', () => {
        // Two curvature blocks of size 2 over a length-4 vector.
        // Block 0 diff = [1,0] -> raw 1, scale 1+0=1 -> 1.
        // Block 1 diff = [0,1] -> raw 1, scale 1+1=2 -> 2.
        const { distance, components } = svc.productManifoldDistance(
          [1, 1, 1, 1],
          [0, 1, 1, 0],
          [0.0, 1.0],
        );

        expect(components[0]).toBeCloseTo(1, 10);
        expect(components[1]).toBeCloseTo(2, 10);
        // Total distance = sqrt(1^2 + 2^2) = sqrt(5).
        expect(distance).toBeCloseTo(Math.sqrt(5), 10);
      });

      it('treats missing vector entries as zero', () => {
        const { distance } = svc.productManifoldDistance([3], [], [0.0]);
        // diff = 3 - 0 = 3; raw sqrt(9)=3; scale 1 -> 3; total sqrt(9)=3.
        expect(distance).toBeCloseTo(3, 10);
      });
    });

    // ----- Proof operations -----
    describe('proof operations (fallback)', () => {
      it('proveDimension verifies when expected matches actual', () => {
        expect(svc.proveDimension(384, 384)).toEqual({ verified: true });
        expect(svc.proveDimension(384, 128)).toEqual({ verified: false });
      });

      it('createAttestation returns null in fallback mode', () => {
        expect(svc.createAttestation(1)).toBeNull();
      });

      it('verifyAttestation returns false in fallback mode', () => {
        expect(svc.verifyAttestation(new Uint8Array([1, 2, 3]))).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Initialized instance — availability contract
  // ==========================================================================

  describe('initialized instance', () => {
    let svc: GraphTransformerService;

    beforeEach(async () => {
      svc = new GraphTransformerService();
      await svc.initialize();
    });

    it('initialize() never throws and leaves the service in a usable state', () => {
      // Whether native/wasm/js loaded, the engine type is one of the known values.
      expect(['native', 'wasm', 'js']).toContain(svc.getEngineType());
      expect(typeof svc.isAvailable()).toBe('boolean');
    });

    it('reports loaded module names when available, and none otherwise', () => {
      const stats = svc.getStats();
      expect(stats.engineType).toBe(svc.getEngineType());
      expect(stats.available).toBe(svc.isAvailable());

      if (stats.available) {
        expect(stats.modulesLoaded).toContain('sublinearAttention');
        expect(stats.modulesLoaded).toContain('productManifoldDistance');
        expect(stats.modulesLoaded).toHaveLength(8);
      } else {
        expect(stats.modulesLoaded).toEqual([]);
      }
    });

    it('sublinearAttention returns a normalized {scores, indices} shape regardless of engine', () => {
      const adjacency = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];

      const result = svc.sublinearAttention([1, 0, 0], adjacency, 3, 2);

      expect(result).toHaveProperty('scores');
      expect(result).toHaveProperty('indices');
      expect(Array.isArray(result.scores)).toBe(true);
      expect(Array.isArray(result.indices)).toBe(true);
      expect(result.indices.length).toBeLessThanOrEqual(2);
    });

    it('verifiedStep returns an updated weight vector regardless of engine', () => {
      const result = svc.verifiedStep([1, 2, 3], [0.1, 0.1, 0.1], 0.5);

      expect(result).toHaveProperty('updated');
      expect(Array.isArray(result.updated)).toBe(true);
      expect(result.updated).toHaveLength(3);
    });

    it('causalAttention returns {scores, causalWeights} arrays regardless of engine', () => {
      const result = svc.causalAttention([1, 0], [[1, 0], [0, 1]], [100, 50]);

      expect(Array.isArray(result.scores)).toBe(true);
      expect(Array.isArray(result.causalWeights)).toBe(true);
    });

    it('proveDimension verifies a correct dimension match', () => {
      const result = svc.proveDimension(256, 256);
      expect(result.verified).toBe(true);
    });
  });

  // ==========================================================================
  // Sanity cross-check of the similarity primitive the fallback relies on
  // ==========================================================================

  describe('fallback similarity primitive', () => {
    it('cosineSimilarity returns 1 for identical vectors and 0 for orthogonal', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });
  });
});
