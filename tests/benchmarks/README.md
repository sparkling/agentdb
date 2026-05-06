# ADR-072 Phase 1 Benchmarks

Comprehensive performance benchmarks for sparse attention and graph partitioning optimizations.

## Quick Start

```bash
# Run all benchmarks
npm run benchmark:adr072

# Run validation test (fast smoke test)
npm test -- benchmarks/validate-adr072

# Run specific benchmark categories
npm test -- benchmarks/adr-072-phase1-benchmark -t "Sparse Attention"
npm test -- benchmarks/adr-072-phase1-benchmark -t "Fused Attention"
```

## Benchmark Categories

### 1. Sparse Attention Speedup
Tests PPR, random-walk, and spectral sparsification methods across different graph sizes.

**Target**: 10x speedup @ N=10K, 50x speedup @ N=100K

**Graphs tested**:
- Random graphs (uniform degree distribution)
- Scale-free graphs (power-law degree distribution)
- Small-world graphs (high clustering + short paths)

### 2. Partitioned Attention Speedup
Tests Stoer-Wagner, Karger, and flow-based graph partitioning algorithms.

**Target**: 5-10x speedup

**Algorithms**:
- Stoer-Wagner: Deterministic, optimal for small graphs
- Karger: Randomized, scalable for large graphs
- Flow-based: Max-flow min-cut theorem

### 3. Memory Reduction
Measures memory usage with graph partitioning vs baseline dense attention.

**Target**: <30% memory usage @ N=10K

### 4. Cold Start Performance
Measures initialization time for all services.

**Target**: <10ms per service

### 5. Fused Attention Validation
Validates 10-50x speedup from fused attention kernel optimization.

**Sequence lengths tested**: 8, 32, 64, 128

## Test Structure

```
benchmarks/
├── adr-072-phase1-benchmark.test.ts    # Main benchmark suite
├── validate-adr072.test.ts             # Quick validation test
├── helpers/
│   └── graph-generator.ts              # Graph generation utilities
└── README.md                           # This file
```

## Graph Generator

The `helpers/graph-generator.ts` module provides utilities for creating realistic test graphs:

### Graph Types

**Random Graph**: Uniform degree distribution
```typescript
const graph = generateRandomGraph({
  numNodes: 1000,
  avgDegree: 4,
  seed: 42
});
```

**Scale-Free Graph**: Power-law degree distribution (Barabási-Albert model)
```typescript
const graph = generateScaleFreeGraph({
  numNodes: 1000,
  m0: 5,        // Initial nodes
  m: 3,         // Edges per new node
  exponent: 2.5 // Power-law exponent
});
```

**Small-World Graph**: Watts-Strogatz model
```typescript
const graph = generateSmallWorldGraph({
  numNodes: 1000,
  avgDegree: 4,
  rewiringProb: 0.1
});
```

### Helper Functions

```typescript
// Calculate graph statistics
const stats = calculateGraphStats(graph);
// Returns: { numNodes, numEdges, avgDegree, density, maxDegree, minDegree }

// Convert to adjacency list
const adjList = toAdjacencyList(graph);

// Generate attention matrices
const { query, key, value } = generateAttentionMatrices(numNodes, embedDim);
```

## Performance Targets (from ADR-072)

| Metric | Baseline | Target | Priority |
|--------|----------|--------|----------|
| Speedup (N=10K) | 1x | 10x+ | High |
| Speedup (N=100K) | 1x | 50x+ | High |
| Partition speedup | 1x | 5-10x | Medium |
| Memory (N=10K) | 100% | <30% | High |
| Cold start | - | <10ms | Medium |
| Fused attention | 1x | 10-50x | High |

## Results Documentation

Results are automatically printed in a formatted table:

```
| Category | Metric | Baseline | Target | Actual | Status |
|----------|--------|----------|--------|--------|--------|
| Sparse Attention | Speedup (N=10K, PPR) | 1.00 | 10.00 | 12.34 | ✅ pass |
| Fused Attention | Speedup (seqLen=64) | 1.00 | 10.00 | 15.67 | ✅ pass |
```

Full results are saved to: `docs/ADR-072-BENCHMARK-RESULTS.md`

## Implementation Notes

### WASM/NAPI Detection

Benchmarks automatically detect available backends:
1. **NAPI** (Node.js native): Fastest
2. **WASM**: Fast, universal
3. **JavaScript fallback**: Always available

If WASM/NAPI are unavailable, benchmarks gracefully skip or use fallback.

### Timing Methodology

- Uses `performance.now()` for sub-millisecond precision
- Multiple iterations for stable averages
- JIT warm-up before measurement
- Excludes outliers (±2σ)

### Memory Measurement

- Uses `process.memoryUsage().heapUsed`
- Measures delta before/after operations
- Compares to baseline (full adjacency matrix)
- Includes JavaScript object overhead

## Troubleshooting

### Benchmarks timeout or hang

Large graphs (N>50K) may take several minutes. Increase timeout:

```bash
npm test -- benchmarks/adr-072-phase1-benchmark --testTimeout=300000
```

Or reduce graph sizes in the test file:

```typescript
const GRAPH_SIZES = [1000, 5000, 10000]; // Smaller sizes
```

### Out of memory errors

Reduce graph sizes or run specific categories:

```bash
npm test -- benchmarks/adr-072-phase1-benchmark -t "Sparse Attention" -t "N=10K"
```

### WASM/NAPI not available

Install optional dependencies:

```bash
npm install --include=optional
```

Or use JavaScript fallback (automatically enabled).

## Adding New Benchmarks

1. Create test in `adr-072-phase1-benchmark.test.ts`
2. Use `recordResult()` to track metrics
3. Add to results table in "Comprehensive Performance Summary"
4. Update `docs/ADR-072-BENCHMARK-RESULTS.md`

Example:

```typescript
it('should benchmark new feature', async () => {
  // Setup
  const start = performance.now();

  // Run operation
  const result = await myNewFeature();

  // Measure
  const time = performance.now() - start;

  // Record
  recordResult(
    'My Category',
    'My Metric',
    1.0,      // baseline
    10.0,     // target
    time,     // actual
    'pass'    // status
  );

  expect(time).toBeLessThan(target);
});
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run ADR-072 Benchmarks
  run: npm run benchmark:adr072
  timeout-minutes: 10
```

### Performance Regression Detection

Compare results to baseline:

```bash
npm run benchmark:adr072 > results-current.txt
diff results-baseline.txt results-current.txt
```

## References

- **ADR-072**: AgentDB & RuVector WASM Capabilities Review
- **Task #54**: ADR-072 Phase 1 Benchmarks
- **Implementation**: packages/agentdb/src/controllers/
  - SparsificationService.ts
  - MincutService.ts
  - AttentionService.ts

## Support

- Issues: https://github.com/ruvnet/agentic-flow/issues
- Documentation: docs/ADR-072-BENCHMARK-RESULTS.md
- Architecture: docs/architecture/ADR-072.md
