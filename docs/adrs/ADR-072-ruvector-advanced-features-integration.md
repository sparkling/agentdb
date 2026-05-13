# ADR-072: RuVector Advanced Features Integration

**Status**: Proposed
**Date**: 2026-03-26
**Decision Makers**: RUV, Claude Flow Team
**Related**: ADR-071 (WASM Integration)

## Context

After adding ruvector as a git submodule (`packages/ruvector-upstream`), analysis reveals AgentDB is using only ~15% of available RuVector advanced features. The upstream repository contains 18 high-performance crates that could provide 10-100x speedups for graph operations.

### Current State
- **Using**: 3/18 crates (basic graph-node, graph-transformer, attention)
- **Missing**: Mincut (7 variants), Sparsifier (2), CNN (2), Delta-graph, etc.
- **Performance**: O(N²) attention complexity on large graphs
- **Memory**: No graph partitioning or sparsification

### Available Upstream Crates

**Critical Missing Features:**

1. **ruvector-mincut** - Dynamic graph partitioning
   - Stoer-Wagner mincut algorithm
   - Karger's randomized mincut
   - Flow-based cuts
   - **Impact**: 50-80% memory reduction, better cache locality

2. **ruvector-attn-mincut** - Attention with mincut optimization
   - Partitions attention computation across mincut clusters
   - Reduces cross-partition attention (sparse attention)
   - **Impact**: O(k log k) vs O(N²) for partitioned graphs

3. **ruvector-sparsifier** - Graph sparsification
   - Personalized PageRank (PPR) sparsification
   - Random walk sampling
   - Spectral sparsification
   - **Impact**: 10-100x speedup for large graphs (N > 10K)

4. **ruvector-mincut-gated-transformer** - Gated transformer with partitioning
   - Combines gating mechanisms with mincut partitions
   - Adaptive sparsity based on graph structure
   - **Impact**: 2-5x faster than standard transformers

5. **ruvector-cnn** - Convolutional neural networks
   - Graph convolutions (GCN, GAT, GIN)
   - Temporal convolutions
   - **Impact**: Better feature extraction, 30-50% accuracy improvement

6. **ruvector-delta-graph** - Incremental graph updates
   - Maintains mincut under edge additions/deletions
   - O(log N) update complexity
   - **Impact**: Real-time graph evolution support

## Decision

**Integrate RuVector advanced features in 3 phases:**

### Phase 1: Sparsification & Mincut (High Priority)
**Goal**: 10-100x speedup for large graphs
**Timeline**: 2 weeks
**Target**: v3.0.0-alpha.6

**Implementation:**
1. Add `@ruvector/sparsifier` package
2. Add `@ruvector/mincut` package
3. Implement PPR-based sparse attention in AttentionService
4. Add dynamic mincut partitioning for graph operations
5. Benchmark against baseline (target: 10x+ speedup for N > 10K)

**API Changes:**
```typescript
// New AttentionService configuration
const service = new AttentionService({
  embedDim: 768,
  numHeads: 12,
  sparsification: {
    enabled: true,
    method: 'ppr', // Personalized PageRank
    topK: 100,     // Attend to top-100 nodes only
  },
  partitioning: {
    enabled: true,
    method: 'mincut',
    maxPartitionSize: 1000,
  },
});

// Sparse attention (10-100x faster for large graphs)
const result = await service.sparseAttention(query, graphEdges, {
  useMincut: true,
  sparsificationRatio: 0.1, // 10% of edges retained
});
```

### Phase 2: Gated Transformers & CNN (Medium Priority)
**Goal**: 2-5x speedup, better accuracy
**Timeline**: 3 weeks
**Target**: v3.0.0-alpha.7

**Implementation:**
1. Add `@ruvector/mincut-gated-transformer` package
2. Add `@ruvector/cnn` package
3. Implement gated attention with mincut partitions
4. Add graph convolutional layers
5. Benchmark against phase 1 (target: 2-5x additional speedup)

### Phase 3: Delta-Graph & Advanced Features (Low Priority)
**Goal**: Real-time graph updates, complete feature parity
**Timeline**: 4 weeks
**Target**: v3.0.0-beta.1

**Implementation:**
1. Add `@ruvector/delta-graph` package
2. Implement incremental mincut updates
3. Add streaming graph attention
4. Full upstream feature parity

## Consequences

### Positive
- **10-100x speedup** for large graphs (N > 10,000 nodes)
- **50-80% memory reduction** through partitioning
- **Better scalability** - handle graphs with 1M+ nodes
- **Real-time updates** with delta-graph
- **Better accuracy** with CNNs

### Negative
- **Complexity increase** - more configuration options
- **Build time** - need to compile additional Rust crates
- **Binary size** - additional 5-10MB for WASM/NAPI modules
- **Learning curve** - developers need to understand sparsification/mincut

### Neutral
- **Breaking changes** - new APIs, but backward compatible with feature flags
- **Documentation** - need comprehensive guides for advanced features
- **Testing** - require large-scale graph benchmarks

## Implementation Plan

### Phase 1 Tasks (v3.0.0-alpha.6)

1. **Add Upstream Packages** (Week 1, Days 1-2)
   - [ ] Add `@ruvector/sparsifier` to package.json
   - [ ] Add `@ruvector/mincut` to package.json
   - [ ] Build NAPI and WASM bindings
   - [ ] Verify package installation

2. **Implement Sparsification** (Week 1, Days 3-5)
   - [ ] Create SparsificationService wrapper
   - [ ] Implement PPR sparsification
   - [ ] Add random walk sampling
   - [ ] Add spectral sparsification
   - [ ] Unit tests (20+ tests)

3. **Implement Mincut Partitioning** (Week 2, Days 1-3)
   - [ ] Create MincutService wrapper
   - [ ] Implement Stoer-Wagner algorithm
   - [ ] Implement Karger's algorithm
   - [ ] Add partition caching
   - [ ] Unit tests (15+ tests)

4. **Integrate with AttentionService** (Week 2, Days 4-5)
   - [ ] Add sparse attention method
   - [ ] Add partitioned attention method
   - [ ] Fallback to dense attention for small graphs
   - [ ] Performance benchmarks
   - [ ] Documentation

5. **Benchmarking & Validation**
   - [ ] Benchmark on graphs: 1K, 10K, 100K, 1M nodes
   - [ ] Validate 10x+ speedup target
   - [ ] Memory profiling
   - [ ] Browser/edge deployment tests

### Success Metrics (Phase 1)

| Metric | Baseline | Target | Actual |
|--------|----------|--------|--------|
| Speedup (N=10K) | 1x | 10x+ | TBD |
| Speedup (N=100K) | 1x | 50x+ | TBD |
| Memory (N=10K) | 100% | <30% | TBD |
| Cold Start | <10ms | <10ms | TBD |

## Alternatives Considered

### 1. Stay with Current Implementation
**Pros**: No additional complexity
**Cons**: 10-100x slower for large graphs, doesn't scale

### 2. Implement Custom Sparsification
**Pros**: Full control
**Cons**: Reinventing the wheel, RuVector already optimized in Rust

### 3. Gradual Migration (Selected)
**Pros**: Phased rollout, backward compatible, validate each phase
**Cons**: Slower adoption

## References

- [RuVector Upstream](https://github.com/ruvnet/ruvector)
- [ADR-071: WASM Integration](./ADR-071-agentdb-ruvector-wasm-capabilities-review.md)
- [Personalized PageRank Paper](https://cs.stanford.edu/~jure/pubs/gps-www07.pdf)
- [Stoer-Wagner Mincut](https://dl.acm.org/doi/10.1145/263867.263872)
- [Graph Sparsification Survey](https://arxiv.org/abs/0808.2378)

## Notes

- **Submodule Location**: `packages/ruvector-upstream/`
- **Upstream Version**: 0.1.2 (older than published packages)
- **Build System**: Cargo + NAPI-RS for Node bindings
- **WASM Support**: wasm-pack for browser builds

## Decision Status

- [x] Analysis complete
- [ ] Phase 1 implementation (pending approval)
- [ ] Phase 2 implementation (pending)
- [ ] Phase 3 implementation (pending)

---

**Approved by**: Pending
**Implemented in**: Pending (target v3.0.0-alpha.6)
