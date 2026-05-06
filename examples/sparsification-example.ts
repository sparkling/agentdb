/**
 * SparsificationService Usage Example
 *
 * Demonstrates graph sparsification for memory retrieval optimization
 */

import { SparsificationService, type GraphEdges } from '../src/controllers/SparsificationService.js';

async function main() {
  console.log('🔍 SparsificationService Example\n');

  // Example 1: Memory Retrieval Graph
  console.log('Example 1: Memory Retrieval Optimization');
  console.log('=========================================\n');

  const memoryGraph: GraphEdges = {
    0: [1, 2, 5],          // Current memory
    1: [0, 2, 3],          // Related memory 1
    2: [0, 1, 4],          // Related memory 2
    3: [1, 4, 6],          // Related memory 3
    4: [2, 3, 5],          // Related memory 4
    5: [0, 4, 6],          // Related memory 5
    6: [3, 5, 7, 8],       // Hub memory
    7: [6, 8],             // Peripheral memory 1
    8: [6, 7, 9],          // Peripheral memory 2
    9: [8],                // Peripheral memory 3
  };

  // Create PPR service
  const pprService = new SparsificationService({
    method: 'ppr',
    topK: 5,
    alpha: 0.15,
  });

  await pprService.initialize();

  // Find top-5 most relevant memories from memory 0
  const pprResult = await pprService.sparsify(0, memoryGraph);

  console.log('Top-5 relevant memories (PPR):');
  pprResult.topKIndices.forEach((idx, rank) => {
    console.log(`  ${rank + 1}. Memory ${idx} (score: ${pprResult.scores[idx].toFixed(4)})`);
  });
  console.log(`\nSparsity: ${(pprResult.sparsityRatio * 100).toFixed(1)}%`);
  console.log(`Method: ${pprResult.method}`);
  console.log(`Execution time: ${pprResult.executionTimeMs?.toFixed(2)}ms\n`);

  // Example 2: Random Walk Exploration
  console.log('Example 2: Random Walk Exploration');
  console.log('===================================\n');

  const rwService = new SparsificationService({
    method: 'random-walk',
    topK: 5,
    numWalks: 200,
    walkLength: 10,
  });

  await rwService.initialize();

  const rwResult = await rwService.sparsify(0, memoryGraph);

  console.log('Top-5 memories by random walk:');
  rwResult.topKIndices.forEach((idx, rank) => {
    console.log(`  ${rank + 1}. Memory ${idx} (score: ${rwResult.scores[idx].toFixed(4)})`);
  });
  console.log(`\nExecution time: ${rwResult.executionTimeMs?.toFixed(2)}ms\n`);

  // Example 3: Hub Identification
  console.log('Example 3: Hub Identification');
  console.log('==============================\n');

  const degreeService = new SparsificationService({
    method: 'degree-based',
    topK: 3,
  });

  await degreeService.initialize();

  const degreeResult = await degreeService.sparsify(0, memoryGraph);

  console.log('Top-3 hub memories:');
  degreeResult.topKIndices.forEach((idx, rank) => {
    console.log(`  ${rank + 1}. Memory ${idx} (degree: ${degreeResult.scores[idx]})`);
  });
  console.log(`\nExecution time: ${degreeResult.executionTimeMs?.toFixed(2)}ms\n`);

  // Example 4: Comparing Alpha Values
  console.log('Example 4: PPR with Different Alpha Values');
  console.log('==========================================\n');

  const alphaValues = [0.1, 0.3, 0.5, 0.8];

  for (const alpha of alphaValues) {
    const service = new SparsificationService({
      method: 'ppr',
      topK: 3,
      alpha,
    });

    await service.initialize();
    const result = await service.sparsify(0, memoryGraph);

    console.log(`Alpha = ${alpha}:`);
    console.log(`  Top-3: [${result.topKIndices.join(', ')}]`);
    console.log(`  Source score: ${result.scores[0].toFixed(4)}`);
  }

  console.log('\n');

  // Example 5: Large Graph Performance
  console.log('Example 5: Large Graph Performance');
  console.log('===================================\n');

  // Generate a larger graph (100 nodes)
  const largeGraph: GraphEdges = {};
  for (let i = 0; i < 100; i++) {
    const neighbors: number[] = [];
    // Random connections (3-5 neighbors)
    const numNeighbors = 3 + Math.floor(Math.random() * 3);
    for (let j = 0; j < numNeighbors; j++) {
      const neighbor = Math.floor(Math.random() * 100);
      if (neighbor !== i && !neighbors.includes(neighbor)) {
        neighbors.push(neighbor);
      }
    }
    largeGraph[i] = neighbors;
  }

  const largeService = new SparsificationService({
    method: 'ppr',
    topK: 10,
    alpha: 0.15,
  });

  await largeService.initialize();

  const largeStart = performance.now();
  const largeResult = await largeService.sparsify(0, largeGraph);
  const largeEnd = performance.now();

  console.log('Large graph (100 nodes):');
  console.log(`  Total edges: ${largeResult.metadata?.totalEdges}`);
  console.log(`  Top-10 sparsity: ${(largeResult.sparsityRatio * 100).toFixed(1)}%`);
  console.log(`  Execution time: ${(largeEnd - largeStart).toFixed(2)}ms`);
  console.log(`  Method: ${largeResult.method}\n`);

  // Example 6: Configuration Updates
  console.log('Example 6: Dynamic Configuration');
  console.log('=================================\n');

  const dynamicService = new SparsificationService({
    method: 'ppr',
    topK: 5,
  });

  await dynamicService.initialize();

  console.log('Initial config:', dynamicService.getConfig());

  // Update configuration
  dynamicService.updateConfig({ topK: 3, alpha: 0.3 });
  console.log('\nUpdated config:', dynamicService.getConfig());

  // Reset to defaults
  dynamicService.resetConfig();
  console.log('\nReset config:', dynamicService.getConfig());

  console.log('\n✅ All examples completed successfully!');
}

// Run examples
main().catch((error) => {
  console.error('❌ Error running examples:', error);
  process.exit(1);
});
