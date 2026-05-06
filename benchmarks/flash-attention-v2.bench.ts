/**
 * Flash Attention v2 Performance Benchmark
 * ADR-071 Phase 3: Verify 2.49x-7.47x speedup target
 *
 * Benchmarks:
 * 1. Flash Attention v2 vs naive O(n²) attention
 * 2. WASM vs NAPI performance
 * 3. Scaling behavior with sequence length
 * 4. Memory efficiency
 */

import { AttentionService } from '../src/controllers/AttentionService.js';

interface BenchmarkResult {
  name: string;
  seqLen: number;
  embedDim: number;
  numHeads: number;
  executionTimeMs: number;
  runtime: 'napi' | 'wasm' | 'fallback';
  speedup?: number;
  memoryMB?: number;
}

/**
 * Generate random test data
 */
function generateTestData(seqLen: number, embedDim: number): {
  query: Float32Array;
  key: Float32Array;
  value: Float32Array;
} {
  const size = seqLen * embedDim;
  const query = new Float32Array(size);
  const key = new Float32Array(size);
  const value = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    query[i] = Math.random() * 2 - 1; // [-1, 1]
    key[i] = Math.random() * 2 - 1;
    value[i] = Math.random() * 2 - 1;
  }

  return { query, key, value };
}

/**
 * Run Flash Attention v2 benchmark
 */
async function benchmarkFlashV2(
  seqLen: number,
  embedDim: number = 768,
  numHeads: number = 12
): Promise<BenchmarkResult> {
  const headDim = Math.floor(embedDim / numHeads);
  const service = new AttentionService({
    numHeads,
    headDim,
    embedDim,
    useFlash: true,
  });

  await service.initialize();

  const { query, key, value } = generateTestData(seqLen, embedDim);

  // Warmup
  await service.flashAttentionV2(query, key, value);

  // Benchmark
  const iterations = seqLen > 512 ? 10 : 100;
  const startMem = process.memoryUsage().heapUsed / 1024 / 1024;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    await service.flashAttentionV2(query, key, value);
  }

  const duration = performance.now() - start;
  const avgTime = duration / iterations;
  const endMem = process.memoryUsage().heapUsed / 1024 / 1024;
  const memoryMB = endMem - startMem;

  const info = service.getInfo();

  return {
    name: 'Flash Attention v2',
    seqLen,
    embedDim,
    numHeads,
    executionTimeMs: avgTime,
    runtime: info.hasWASM ? 'wasm' : info.hasNAPI ? 'napi' : 'fallback',
    memoryMB,
  };
}

/**
 * Run baseline (naive) attention benchmark
 */
async function benchmarkBaseline(
  seqLen: number,
  embedDim: number = 768,
  numHeads: number = 12
): Promise<BenchmarkResult> {
  const headDim = Math.floor(embedDim / numHeads);
  const service = new AttentionService({
    numHeads,
    headDim,
    embedDim,
    useFlash: false, // Disable Flash to get baseline
  });

  await service.initialize();

  const { query, key, value } = generateTestData(seqLen, embedDim);

  // Warmup
  await service.multiHeadAttention(query, key, value);

  // Benchmark
  const iterations = seqLen > 512 ? 10 : 100;
  const startMem = process.memoryUsage().heapUsed / 1024 / 1024;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    await service.multiHeadAttention(query, key, value);
  }

  const duration = performance.now() - start;
  const avgTime = duration / iterations;
  const endMem = process.memoryUsage().heapUsed / 1024 / 1024;
  const memoryMB = endMem - startMem;

  return {
    name: 'Baseline (naive)',
    seqLen,
    embedDim,
    numHeads,
    executionTimeMs: avgTime,
    runtime: 'fallback',
    memoryMB,
  };
}

/**
 * Compare Flash Attention v2 vs baseline
 */
async function comparePerformance(seqLen: number): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Benchmark: Sequence Length = ${seqLen}`);
  console.log('='.repeat(80));

  const baseline = await benchmarkBaseline(seqLen);
  const flashV2 = await benchmarkFlashV2(seqLen);

  const speedup = baseline.executionTimeMs / flashV2.executionTimeMs;
  const memoryReduction = baseline.memoryMB && flashV2.memoryMB
    ? ((baseline.memoryMB - flashV2.memoryMB) / baseline.memoryMB) * 100
    : 0;

  // Results table
  console.log('\nResults:');
  console.log('─'.repeat(80));
  console.log('Method              | Time (ms) | Memory (MB) | Runtime');
  console.log('─'.repeat(80));
  console.log(
    `${baseline.name.padEnd(20)}| ${baseline.executionTimeMs.toFixed(2).padStart(9)} | ` +
    `${(baseline.memoryMB || 0).toFixed(2).padStart(11)} | ${baseline.runtime}`
  );
  console.log(
    `${flashV2.name.padEnd(20)}| ${flashV2.executionTimeMs.toFixed(2).padStart(9)} | ` +
    `${(flashV2.memoryMB || 0).toFixed(2).padStart(11)} | ${flashV2.runtime}`
  );
  console.log('─'.repeat(80));

  // Performance metrics
  console.log('\nPerformance Metrics:');
  console.log(`  Speedup:          ${speedup.toFixed(2)}x`);
  console.log(`  Memory Reduction: ${memoryReduction.toFixed(1)}%`);

  // ADR-071 target verification
  const targetMin = 2.49;
  const targetMax = 7.47;

  if (speedup >= targetMin && speedup <= targetMax * 1.5) {
    console.log(`  ✅ PASS: Speedup ${speedup.toFixed(2)}x within target range (${targetMin}x-${targetMax}x)`);
  } else if (speedup >= targetMin) {
    console.log(`  ✅ PASS: Speedup ${speedup.toFixed(2)}x exceeds target (${targetMin}x-${targetMax}x)`);
  } else {
    console.log(`  ❌ FAIL: Speedup ${speedup.toFixed(2)}x below target minimum (${targetMin}x)`);
  }
}

/**
 * Run full benchmark suite
 */
async function main() {
  console.log('Flash Attention v2 Performance Benchmark');
  console.log('ADR-071 Phase 3: Target 2.49x-7.47x speedup');
  console.log('═'.repeat(80));

  // Test various sequence lengths
  const sequenceLengths = [128, 256, 512, 1024, 2048];

  for (const seqLen of sequenceLengths) {
    try {
      await comparePerformance(seqLen);
    } catch (error) {
      console.error(`\n❌ Error benchmarking seqLen=${seqLen}:`, error);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('Benchmark Complete');
  console.log('═'.repeat(80));
  console.log('\nNotes:');
  console.log('- Flash Attention v2 provides O(n) memory vs O(n²) for naive attention');
  console.log('- Speedup increases with sequence length due to better memory locality');
  console.log('- WASM runtime may show lower speedup than NAPI due to JS-WASM overhead');
  console.log('- Target speedup: 2.49x-7.47x (from ADR-071)');
}

// Run benchmark
main().catch(console.error);
