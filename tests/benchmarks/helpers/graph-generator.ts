/**
 * Graph Generator Utilities for ADR-072 Benchmarks
 *
 * Generates realistic graph structures for testing sparse attention
 * and graph partitioning algorithms.
 */

import type { GraphEdges } from '../../../src/types/graph.js';

export interface GraphGenerationOptions {
  /** Number of nodes */
  numNodes: number;
  /** Average degree (edges per node) */
  avgDegree?: number;
  /** Graph density (0-1, overrides avgDegree) */
  density?: number;
  /** Seed for reproducible randomness */
  seed?: number;
}

export interface ScaleFreeOptions extends GraphGenerationOptions {
  /** Power-law exponent (default: 2.5) */
  exponent?: number;
  /** Number of initial nodes (default: 3) */
  m0?: number;
  /** Edges per new node (default: 2) */
  m?: number;
}

export interface SmallWorldOptions extends GraphGenerationOptions {
  /** Rewiring probability (default: 0.1) */
  rewiringProb?: number;
  /** Lattice dimension (default: 1) */
  dimension?: number;
}

/**
 * Simple pseudorandom number generator for reproducible graphs
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number = 42) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/**
 * Generate a random graph with configurable density
 */
export function generateRandomGraph(options: GraphGenerationOptions): GraphEdges {
  const { numNodes, avgDegree = 4, density, seed = 42 } = options;
  const rng = new SeededRandom(seed);

  const edges: GraphEdges = {
    sourceIds: [],
    targetIds: [],
    weights: []
  };

  // Calculate probability of edge creation
  const edgeProb = density !== undefined
    ? density
    : avgDegree / (numNodes - 1);

  // Generate edges
  for (let i = 0; i < numNodes; i++) {
    for (let j = i + 1; j < numNodes; j++) {
      if (rng.next() < edgeProb) {
        // Add edge i -> j
        edges.sourceIds.push(i);
        edges.targetIds.push(j);
        edges.weights.push(1.0);

        // Add edge j -> i (undirected graph)
        edges.sourceIds.push(j);
        edges.targetIds.push(i);
        edges.weights.push(1.0);
      }
    }
  }

  return edges;
}

/**
 * Generate a scale-free graph using preferential attachment (Barabási-Albert model)
 * Power-law degree distribution: P(k) ~ k^(-γ)
 */
export function generateScaleFreeGraph(options: ScaleFreeOptions): GraphEdges {
  const { numNodes, exponent = 2.5, m0 = 3, m = 2, seed = 42 } = options;
  const rng = new SeededRandom(seed);

  const edges: GraphEdges = {
    sourceIds: [],
    targetIds: [],
    weights: []
  };

  // Start with complete graph on m0 nodes
  for (let i = 0; i < m0; i++) {
    for (let j = i + 1; j < m0; j++) {
      edges.sourceIds.push(i);
      edges.targetIds.push(j);
      edges.weights.push(1.0);
      edges.sourceIds.push(j);
      edges.targetIds.push(i);
      edges.weights.push(1.0);
    }
  }

  // Track degree of each node for preferential attachment
  const degrees = new Array(numNodes).fill(0);
  for (let i = 0; i < m0; i++) {
    degrees[i] = (m0 - 1) * 2; // Each initial node connected to all others
  }

  // Add remaining nodes with preferential attachment
  for (let newNode = m0; newNode < numNodes; newNode++) {
    const targets = new Set<number>();

    // Calculate total degree for normalization
    let totalDegree = 0;
    for (let i = 0; i < newNode; i++) {
      totalDegree += Math.pow(degrees[i] + 1, 1.0 / exponent);
    }

    // Select m unique targets with probability proportional to degree
    while (targets.size < Math.min(m, newNode)) {
      const rand = rng.next() * totalDegree;
      let cumulative = 0;

      for (let i = 0; i < newNode; i++) {
        if (!targets.has(i)) {
          cumulative += Math.pow(degrees[i] + 1, 1.0 / exponent);
          if (rand <= cumulative) {
            targets.add(i);
            break;
          }
        }
      }
    }

    // Add edges to selected targets
    for (const target of targets) {
      edges.sourceIds.push(newNode);
      edges.targetIds.push(target);
      edges.weights.push(1.0);
      edges.sourceIds.push(target);
      edges.targetIds.push(newNode);
      edges.weights.push(1.0);

      degrees[newNode] += 2;
      degrees[target] += 2;
    }
  }

  return edges;
}

/**
 * Generate a small-world graph using Watts-Strogatz model
 * High clustering coefficient + short average path length
 */
export function generateSmallWorldGraph(options: SmallWorldOptions): GraphEdges {
  const { numNodes, avgDegree = 4, rewiringProb = 0.1, seed = 42 } = options;
  const rng = new SeededRandom(seed);
  const k = Math.floor(avgDegree / 2); // Each node connects to k nearest neighbors

  const edges: GraphEdges = {
    sourceIds: [],
    targetIds: [],
    weights: []
  };

  // Create ring lattice
  for (let i = 0; i < numNodes; i++) {
    for (let j = 1; j <= k; j++) {
      const target = (i + j) % numNodes;

      edges.sourceIds.push(i);
      edges.targetIds.push(target);
      edges.weights.push(1.0);
      edges.sourceIds.push(target);
      edges.targetIds.push(i);
      edges.weights.push(1.0);
    }
  }

  // Rewire edges with probability p
  const edgeSet = new Set<string>();
  for (let i = 0; i < edges.sourceIds.length; i += 2) {
    const source = edges.sourceIds[i];
    const target = edges.targetIds[i];

    if (source < target && rng.next() < rewiringProb) {
      // Find new random target
      let newTarget;
      do {
        newTarget = rng.nextInt(numNodes);
      } while (
        newTarget === source ||
        edgeSet.has(`${source}-${newTarget}`) ||
        edgeSet.has(`${newTarget}-${source}`)
      );

      // Replace edge
      edges.targetIds[i] = newTarget;
      edges.sourceIds[i + 1] = newTarget;

      edgeSet.add(`${source}-${newTarget}`);
    } else {
      edgeSet.add(`${source}-${target}`);
    }
  }

  return edges;
}

/**
 * Calculate graph statistics
 */
export function calculateGraphStats(edges: GraphEdges): {
  numNodes: number;
  numEdges: number;
  avgDegree: number;
  density: number;
  maxDegree: number;
  minDegree: number;
} {
  // Find number of nodes
  const nodeSet = new Set<number>();
  for (const id of edges.sourceIds) nodeSet.add(id);
  for (const id of edges.targetIds) nodeSet.add(id);
  const numNodes = nodeSet.size;

  // Count edges (undirected, so divide by 2)
  const numEdges = edges.sourceIds.length / 2;

  // Calculate degree distribution
  const degrees = new Map<number, number>();
  for (const id of edges.sourceIds) {
    degrees.set(id, (degrees.get(id) || 0) + 1);
  }

  const degreeValues = Array.from(degrees.values());
  const avgDegree = degreeValues.reduce((a, b) => a + b, 0) / degreeValues.length;
  const maxDegree = Math.max(...degreeValues);
  const minDegree = Math.min(...degreeValues);

  // Calculate density
  const maxPossibleEdges = (numNodes * (numNodes - 1)) / 2;
  const density = numEdges / maxPossibleEdges;

  return {
    numNodes,
    numEdges,
    avgDegree,
    density,
    maxDegree,
    minDegree
  };
}

/**
 * Convert GraphEdges to adjacency list for efficient traversal
 */
export function toAdjacencyList(edges: GraphEdges): Map<number, number[]> {
  const adjList = new Map<number, number[]>();

  for (let i = 0; i < edges.sourceIds.length; i++) {
    const source = edges.sourceIds[i];
    const target = edges.targetIds[i];

    if (!adjList.has(source)) {
      adjList.set(source, []);
    }
    adjList.get(source)!.push(target);
  }

  return adjList;
}

/**
 * Generate attention matrices for graph-based attention
 */
export function generateAttentionMatrices(
  numNodes: number,
  embedDim: number = 512,
  seed: number = 42
): {
  query: Float32Array;
  key: Float32Array;
  value: Float32Array;
} {
  const rng = new SeededRandom(seed);
  const size = numNodes * embedDim;

  const query = new Float32Array(size);
  const key = new Float32Array(size);
  const value = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    // Use normal distribution approximation (Box-Muller transform)
    const u1 = rng.next();
    const u2 = rng.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    query[i] = z * 0.02; // Small variance for stability
    key[i] = z * 0.02;
    value[i] = z * 0.02;
  }

  return { query, key, value };
}
