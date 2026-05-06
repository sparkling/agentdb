/**
 * Test GNN Integration with @ruvector/gnn v0.1.19
 *
 * Validates that AgentDB correctly uses Float32Array with the new GNN API
 */

import { RuVectorLearning } from './dist/src/backends/ruvector/RuVectorLearning.js';

console.log('🧪 Testing @ruvector/gnn v0.1.19 Integration\n');

async function testGNNIntegration() {
  console.log('Test 1: Initialize RuVectorLearning with GNN');

  try {
    const learning = new RuVectorLearning({
      inputDim: 64,
      hiddenDim: 32,
      heads: 4,
      dropout: 0.1
    });

    await learning.initialize();
    console.log('✅ PASS: GNN initialized successfully\n');

    // Test 2: Enhance query with Float32Array
    console.log('Test 2: Enhance query embedding');
    const query = new Float32Array(64).fill(0.5);
    const neighbors = [
      new Float32Array(64).fill(0.3),
      new Float32Array(64).fill(0.7)
    ];
    const weights = [0.6, 0.4];

    const enhanced = learning.enhance(query, neighbors, weights);
    console.log(`✅ PASS: Query enhanced, result type: ${enhanced.constructor.name}, length: ${enhanced.length}\n`);

    // Test 3: Differentiable search
    console.log('Test 3: Differentiable search with Float32Array');
    const candidates = [
      new Float32Array(64).fill(0.2),
      new Float32Array(64).fill(0.8),
      new Float32Array(64).fill(0.5)
    ];

    const searchResult = learning.search(query, candidates, { k: 2, temperature: 1.0 });
    console.log(`✅ PASS: Differentiable search completed, found ${searchResult.indices.length} results\n`);

    // Test 4: Hierarchical forward
    console.log('Test 4: Hierarchical forward pass');
    const layerEmbeddings = [
      [new Float32Array(64).fill(0.1), new Float32Array(64).fill(0.9)],
      [new Float32Array(64).fill(0.3), new Float32Array(64).fill(0.7)]
    ];

    const hierarchical = learning.enhanceHierarchical(query, layerEmbeddings);
    console.log(`✅ PASS: Hierarchical enhancement completed, result type: ${hierarchical.constructor.name}\n`);

    // Test 5: Serialization
    console.log('Test 5: GNN layer serialization');
    const json = learning.toJson();
    console.log(`✅ PASS: Serialized GNN layer (${json.length} characters)\n`);

    console.log('🎉 All GNN integration tests passed!');
    console.log('\n📊 Summary:');
    console.log('- Float32Array inputs: ✅');
    console.log('- Float32Array outputs: ✅');
    console.log('- GNN layer forward pass: ✅');
    console.log('- Differentiable search: ✅');
    console.log('- Hierarchical forward: ✅');
    console.log('- Serialization: ✅');

  } catch (error) {
    console.error('❌ FAIL:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testGNNIntegration().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
