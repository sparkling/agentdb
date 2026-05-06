# ADR-007: @ruvector Full Capability Integration

**Status:** Phase 1 Complete (Proposed for Phases 2-5)
**Date:** 2026-02-17
**Author:** System Architect (AgentDB v3)
**Supersedes:** None
**Related:** ADR-002 (WASM Integration), ADR-003 (RVF Format), ADR-004 (AGI), ADR-005 (Self-Learning), ADR-006 (Unified Self-Learning RVF)

## Context

AgentDB depends on 11 `@ruvector/*` npm packages but uses only a fraction of
their exported APIs. A deep audit of every package's type definitions against
AgentDB's `import` statements reveals significant untapped capability across
training, graph operations, quantization, persistence, kernel runtimes,
import/export, and model management.

### Package Inventory (11 packages)

| Package                | Version | AgentDB Usage                      | Capability Coverage |
| ---------------------- | ------- | ---------------------------------- | ------------------- |
| `@ruvector/core`       | 0.1.30  | VectorDb HNSW search               | ~40%                |
| `@ruvector/attention`  | 0.1.4   | 5 attention types (fallback JS)    | ~15%                |
| `@ruvector/gnn`        | 0.1.23  | RuvectorLayer forward pass         | ~20%                |
| `@ruvector/graph-node` | 0.1.26  | Basic CRUD (addNode/addEdge/query) | ~15%                |
| `@ruvector/router`     | 0.1.28  | SemanticRouter.addRoute/route      | ~30%                |
| `@ruvector/ruvllm`     | 0.2.4   | FederatedCoordinator, LoraManager  | ~10%                |
| `@ruvector/rvf`        | 0.1.9   | RvfDatabase open/insert/search     | ~45%                |
| `@ruvector/rvf-node`   | 0.1.7   | NodeBackend (auto-detected)        | ~60%                |
| `@ruvector/rvf-solver` | 0.1.3   | ThompsonSampling policy            | ~70%                |
| `@ruvector/rvf-wasm`   | 0.1.6   | Availability check only            | ~5%                 |
| `@ruvector/sona`       | 0.1.5   | SonaEngine basic API               | ~30%                |

**Problem:** AgentDB leaves ~70% of available @ruvector capability unused.
This includes production-critical features: kernel runtime embedding for
smart vectors, import/export for interoperability, WASM in-memory stores
for browser deployments, SIMD activation functions, retrieval-augmented
generation, training factory presets, hardware profiles for storage layout
optimization, and derivation chains for provenance tracking.

## Decision

Integrate unused @ruvector capabilities in five phases, prioritized by
impact on AgentDB's core value proposition (memory persistence, search
quality, learning speed, portability).

## Gap Analysis by Package

### 1. @ruvector/rvf (v0.1.9) — 55% unused

**Currently used:**

- `RvfDatabase`: `create`, `open`, `ingestBatch`, `query`, `delete`,
  `compact`, `status`, `derive`, `segments`, `close`
- `NodeBackend` auto-detection via `resolveBackend('auto')`

**Unused capabilities:**

| Category                  | APIs                                                                         | Priority | Phase |
| ------------------------- | ---------------------------------------------------------------------------- | -------- | ----- |
| **Kernel Embedding**      | `embedKernel(arch, type, flags, image, apiPort, cmdline)`, `extractKernel()` | HIGH     | 2     |
| **eBPF Embedding**        | `embedEbpf(progType, attachType, maxDim, bytecode, btf)`, `extractEbpf()`    | HIGH     | 2     |
| **Read-Only Access**      | `openReadonly(path)` — lock-free concurrent readers                          | HIGH     | 1     |
| **Derivation Types**      | `derive()` with `filter`, `merge`, `snapshot`, `transform` modes             | MEDIUM   | 3     |
| **Filter Deletion**       | `deleteByFilter(filter)` — metadata-predicate bulk delete                    | MEDIUM   | 2     |
| **Compression Profiles**  | `none`, `scalar` (int8), `product` (PQ) — at store creation                  | HIGH     | 1     |
| **Hardware Profiles**     | `0=Generic`, `1=Core`, `2=Hot`, `3=Full` — storage layout affinity           | MEDIUM   | 2     |
| **Segment Signing**       | `signing: true` option at creation — cryptographic segment signatures        | MEDIUM   | 3     |
| **Lineage Introspection** | `fileId()`, `parentId()`, `lineageDepth()` — provenance chain queries        | MEDIUM   | 2     |
| **WASM Backend**          | `WasmBackend` — full store operations in browser via WASM                    | HIGH     | 2     |
| **Filter Expressions**    | Full algebra: `eq/ne/lt/le/gt/ge/in/range/and/or/not` on metadata fields     | HIGH     | 1     |

**Impact:** Kernel embedding transforms RVF from a passive vector format into
an active compute container. A `.rvf` file carrying an embedded unikernel or
eBPF program becomes a "smart vector store" that bundles data with its
processing logic. This enables edge deployment where the vector store
ships with its own inference kernel. Hardware profiles optimize on-disk
layout for the target platform. Compression profiles provide 4-8x memory
reduction at creation time rather than as a post-hoc step. The WASM backend
enables full vector store operations in browsers without N-API.

### 2. @ruvector/rvf-wasm (v0.1.6) — 95% unused

**Currently used:**

- Availability check in `detector.ts` and `factory.ts`
- Witness verify/count loaded in `NativeAccelerator` (mostly unused)

**Unused capabilities:**

| Category                 | APIs                                                                                               | Priority | Phase |
| ------------------------ | -------------------------------------------------------------------------------------------------- | -------- | ----- |
| **Quantization**         | `rvf_load_sq_params`, `rvf_dequant_i8`, `rvf_load_pq_codebook`, `rvf_pq_distances`                 | HIGH     | 1     |
| **HNSW Navigation**      | `rvf_load_neighbors`, `rvf_greedy_step`                                                            | MEDIUM   | 3     |
| **Segment Verification** | `rvf_verify_header`, `rvf_crc32c`, `rvf_verify_checksum`                                           | HIGH     | 1     |
| **Witness Chain**        | `rvf_witness_verify`, `rvf_witness_count`                                                          | HIGH     | 1     |
| **In-Memory Store**      | `rvf_store_create/open/ingest/query/delete/count/dimension/status/export/close`                    | HIGH     | 2     |
| **Core Query Path**      | `rvf_init`, `rvf_load_query`, `rvf_load_block`, `rvf_distances`, `rvf_topk_merge`, `rvf_topk_read` | MEDIUM   | 3     |
| **Segment Parsing**      | `rvf_parse_header`, `rvf_segment_count`, `rvf_segment_info`                                        | MEDIUM   | 3     |
| **Store Export**         | `rvf_store_export(handle, out_ptr, out_len)` — serialize in-memory store to RVF bytes              | HIGH     | 2     |
| **Memory Management**    | `rvf_alloc`, `rvf_free` — direct WASM linear memory management                                     | LOW      | 4     |

**Impact:** The WASM microkernel provides a **complete in-memory vector
database** for browser environments. `rvf_store_create` through
`rvf_store_close` mirror the full N-API store surface. `rvf_store_export`
enables serializing the in-memory store back to `.rvf` format for download
or IndexedDB persistence. The core query path (`rvf_load_query` through
`rvf_topk_read`) enables fine-grained control over distance computation
with pluggable distance metrics and top-k merging. Quantization functions
(`rvf_load_sq_params`, `rvf_pq_distances`) provide 4-8x memory reduction
entirely in the browser.

### 3. @ruvector/attention (v0.1.4) — 85% unused

**Currently used:**

- 5 attention mechanisms via JS fallbacks in `attention-fallbacks.ts`
- NAPI module loaded in `AttentionService.ts` (with fallback)

**Unused capabilities:**

| Category                | APIs                                                                                        | Priority | Phase |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------- | ----- |
| **Optimizers**          | `AdamOptimizer`, `AdamWOptimizer`, `SgdOptimizer`                                           | HIGH     | 1     |
| **Loss Functions**      | `InfoNceLoss`, `LocalContrastiveLoss`, `SpectralRegularization`                             | HIGH     | 1     |
| **Curriculum Learning** | `CurriculumScheduler`, `TemperatureAnnealing`, `LearningRateScheduler`                      | MEDIUM   | 2     |
| **Mining**              | `HardNegativeMiner`, `InBatchMiner` (Random/Hard/SemiHard/Distance strategies)              | MEDIUM   | 2     |
| **Graph Attention**     | `GraphRoPeAttention`, `EdgeFeaturedAttention`, `DualSpaceAttention`, `LocalGlobalAttention` | LOW      | 4     |
| **Hyperbolic Math**     | `expMap`, `logMap`, `mobiusAddition`, `poincareDistance`, `projectToPoincareBall`           | LOW      | 4     |
| **Batch/Parallel**      | `batchAttentionCompute`, `parallelAttentionCompute`, `crossAttention`                       | MEDIUM   | 3     |
| **Async Compute**       | `computeAttentionAsync`, `computeFlashAttentionAsync`, `computeHyperbolicAttentionAsync`    | MEDIUM   | 3     |
| **Stream Processing**   | `StreamProcessor` — chunked attention for long sequences                                    | MEDIUM   | 4     |
| **Benchmarking**        | `benchmarkAttention()` — built-in performance profiling                                     | LOW      | 4     |

**Impact:** AgentDB's `ContrastiveTrainer` currently implements InfoNCE loss
and AdamW in pure JavaScript. Switching to native NAPI versions provides
estimated 10-50x speedup for training loops. `StreamProcessor` enables
attention over sequences longer than memory allows. Async variants allow
non-blocking attention computation.

### 4. @ruvector/ruvllm (v0.2.4) — 90% unused

**Currently used:**

- `FederatedCoordinator` (in `FederatedSessionManager.ts`)
- `LoraManager` (basic create/merge)
- `SimdOps` (loaded in NativeAccelerator, cosine/dot/L2 only)

**Unused capabilities:**

| Category                 | APIs                                                                                                    | Priority | Phase |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | -------- | ----- |
| **SIMD Activations**     | `SimdOps.softmax`, `relu`, `gelu`, `sigmoid`, `layerNorm`, `matvec`, `add`, `mul`, `scale`, `normalize` | HIGH     | 1     |
| **EWC Memory**           | `EwcManager.registerTask`, `computePenalty`, `stats` — native EWC++ with Fisher information             | HIGH     | 1     |
| **SONA Coordination**    | `SonaCoordinator.recordSignal/recordTrajectory/runBackgroundLoop`                                       | HIGH     | 2     |
| **ReasoningBank**        | `ReasoningBank.store/findSimilar/recordUsage/get/getByType/prune/stats` (Float64Array optimized)        | HIGH     | 2     |
| **Trajectory Building**  | `TrajectoryBuilder.startStep/endStep/complete`                                                          | HIGH     | 2     |
| **Ephemeral Agents**     | `EphemeralAgent.processTask/processTaskWithRoute/applyMicroLora/exportState/forceLearn`                 | HIGH     | 3     |
| **LoRA Full API**        | `LoraAdapter.forward/forwardBatch/backward/startTraining/freeze/merge/clone/toJSON/fromJSON`            | HIGH     | 2     |
| **Training Pipeline**    | `TrainingPipeline.addBatch/addData/train/loadCheckpoint/getMetrics/reset`                               | MEDIUM   | 3     |
| **Training Factory**     | `TrainingFactory.quickFinetune/deepTraining/continualLearning/federatedAggregation`                     | MEDIUM   | 3     |
| **LR Scheduler**         | `LRScheduler(constant/linear/cosine/warmup).getLR/step/reset`                                           | MEDIUM   | 3     |
| **Metrics Tracker**      | `MetricsTracker.recordLoss/recordValLoss/recordGradNorm/avgLoss/bestValLoss/eta`                        | MEDIUM   | 3     |
| **RLM Controller**       | `RlmController.query/queryStream/addMemory/searchMemory/clearCache` — recursive RAG                     | HIGH     | 2     |
| **Session Management**   | `SessionManager.create/get/chat/addSystemMessage/addContext/getHistory/export/import`                   | MEDIUM   | 3     |
| **Streaming**            | `StreamingGenerator.stream/streamWithCallbacks/collect`, `createReadableStream()`                       | MEDIUM   | 4     |
| **LLM Engine**           | `RuvLLM.query/generate/route/searchMemory/addMemory/feedback/embed/similarity/batchQuery`               | LOW      | 5     |
| **Model Import/Export**  | `SafeTensorsWriter/Reader`, `ModelExporter(safetensors/json/binary/huggingface)`, `ModelImporter`       | HIGH     | 2     |
| **Dataset Export**       | `DatasetExporter.toJSONL/toCSV/toPretrain`                                                              | MEDIUM   | 3     |
| **Model Management**     | `ModelDownloader.download/downloadAll/delete/isDownloaded/getStatus`                                    | LOW      | 5     |
| **Contrastive Training** | `ContrastiveTrainer.addTriplet/train/exportTrainingData/generateLoRAConfig`                             | MEDIUM   | 3     |
| **Native Engine**        | `NativeRuvLLM.RuvLLMEngine` — Rust NAPI engine with `query/generate/route/embed/similarity`             | LOW      | 5     |

**Impact:** The full `SimdOps` surface provides 16 SIMD-accelerated operations
including activation functions (`relu`, `gelu`, `sigmoid`, `softmax`,
`layerNorm`) and linear algebra (`matvec`, `normalize`) — AgentDB currently
uses only 3 of 16. `ReasoningBank` with Float64Array optimization provides
native pattern distillation that `SonaLearningBackend` reimplements in TS.
`RlmController` enables multi-hop retrieval-augmented generation with
automatic sub-query decomposition, reflection loops, and caching —
a complete RAG pipeline. `TrainingFactory` provides pre-configured
training pipelines (`quickFinetune`, `deepTraining`, `continualLearning`,
`federatedAggregation`) that replace manual training setup. `EphemeralAgent`
provides temporary learning workers with automatic trajectory collection
and state export, enabling disposable compute for federated learning.

### 5. @ruvector/graph-node (v0.1.26) — 85% unused

**Currently used:**

- `GraphDatabase`: `addNode`, `addEdge`, `query` (basic CRUD)
- Constructor with persistence path

**Unused capabilities:**

| Category                 | APIs                                                 | Priority | Phase |
| ------------------------ | ---------------------------------------------------- | -------- | ----- |
| **Cypher Queries**       | `querySync(cypher)` — full Cypher query language     | HIGH     | 1     |
| **Transactions**         | `begin`, `commit`, `rollback`                        | HIGH     | 1     |
| **Hyperedges**           | `createHyperedge`, `searchHyperedges`                | MEDIUM   | 2     |
| **Temporal Hyperedges**  | `addTemporalHyperedge`, `queryTemporalRange`         | MEDIUM   | 3     |
| **Streaming**            | `QueryResultStream`, `HyperedgeStream`, `NodeStream` | MEDIUM   | 4     |
| **Batch Insert**         | `batchInsert(nodes[])`                               | HIGH     | 1     |
| **K-Hop Neighbors**      | `kHopNeighbors(nodeId, k)` — multi-hop traversal     | MEDIUM   | 2     |
| **Change Subscriptions** | `subscribe()` — reactive change notifications        | MEDIUM   | 4     |
| **Graph Statistics**     | `stats()` — node/edge counts, index info             | LOW      | 2     |

**Impact:** Without transactions, `GraphDatabaseAdapter` has no consistency
guarantees for multi-step graph mutations. Cypher support would replace
the current imperative query building with declarative graph queries.
Batch insert would accelerate bulk memory ingestion 10-100x. `subscribe()`
enables reactive patterns where downstream consumers (e.g., index tuners)
are notified of graph mutations in real-time.

### 6. @ruvector/router (v0.1.28) — 70% unused

**Currently used:**

- `SemanticRouter`: `addIntent`, `route`, `routeWithEmbedding`, `removeIntent`,
  `getIntents`, `clear`, `count`

**Unused capabilities:**

| Category             | APIs                                                      | Priority | Phase |
| -------------------- | --------------------------------------------------------- | -------- | ----- |
| **VectorDb Class**   | Direct HNSW-backed `VectorDb` for custom route storage    | MEDIUM   | 3     |
| **Persistence**      | `save(path)`, `load(path)` — serialize router state       | HIGH     | 1     |
| **Async Operations** | `addIntentAsync` — auto-embed intent text                 | MEDIUM   | 2     |
| **Embedder Config**  | `setEmbedder(fn)` — custom embedding function for intents | HIGH     | 2     |
| **Quantization**     | Built-in quantization support for route embeddings        | MEDIUM   | 3     |

**Impact:** `SemanticQueryRouter` rebuilds its route index from scratch on
every initialization because it doesn't use `save/load`. Persistence support
would give the router cross-session continuity. `setEmbedder` enables
pluggable embedding functions for intent matching.

### 7. @ruvector/sona (v0.1.5) — 70% unused

**Currently used:**

- `SonaEngine`: `withConfig`, `beginTrajectory`, `addTrajectoryStep`,
  `setTrajectoryRoute`, `endTrajectory`, `applyMicroLora`, `tick`,
  `forceLearn`, `findPatterns`, `getStats`, `setEnabled`

**Unused capabilities:**

| Category               | APIs                                                            | Priority | Phase |
| ---------------------- | --------------------------------------------------------------- | -------- | ----- |
| **Context Enrichment** | `addTrajectoryContext(id, json)` — rich metadata per trajectory | HIGH     | 1     |
| **Base LoRA**          | `applyBaseLora(weights)` — pre-trained adaptation baselines     | MEDIUM   | 2     |
| **Flush**              | `flush()` — force write instant-loop pending state              | MEDIUM   | 2     |
| **Background Config**  | `backgroundIntervalMs`, `qualityThreshold` — tuning knobs       | LOW      | 3     |
| **SIMD Toggle**        | `enableSimd` config — explicit SIMD control                     | LOW      | 3     |

**Impact:** `SonaLearningBackend` records trajectories but never uses
`addTrajectoryContext` (which attaches structured metadata like user intent,
session state, or environmental context to each trajectory). This limits
the self-learning pipeline's ability to condition adaptations on contextual
factors beyond the query vector itself.

### 8. @ruvector/gnn (v0.1.23) — 80% unused

**Currently used:**

- `RuvectorLayer`: `forward`, `hierarchicalForward`
- `TensorCompress`: `getCompressionLevel`

**Unused capabilities:**

| Category                  | APIs                                             | Priority | Phase |
| ------------------------- | ------------------------------------------------ | -------- | ----- |
| **Differentiable Search** | `differentiableSearch(query, keys, temperature)` | MEDIUM   | 3     |
| **Full TensorCompress**   | `compress`, `compressWithLevel`, `decompress`    | HIGH     | 1     |
| **Batch Compression**     | `TensorCompress.batchCompress`                   | HIGH     | 1     |
| **Layer Serialization**   | `RuvectorLayer.toJson`, `fromJson`               | MEDIUM   | 2     |
| **Batch Forward**         | `batchForward`                                   | MEDIUM   | 3     |

**Impact:** `AdaptiveIndexTuner` uses `getCompressionLevel` for tier
classification but never calls `compress`/`decompress` for actual data
reduction. It implements its own JS quantization instead. Native tensor
compression with 5 levels (`none/half/pq8/pq4/binary`) would reduce
memory footprint and eliminate the JS quantization code.

### 9. @ruvector/core (v0.1.30) — 60% unused

**Currently used:**

- `VectorDb`: CRUD, search, HNSW config

**Unused capabilities:**

| Category             | APIs                             | Priority | Phase |
| -------------------- | -------------------------------- | -------- | ----- |
| **Batch Operations** | `insertBatch`, `batchDelete`     | HIGH     | 1     |
| **Index Management** | `optimize`, `compact`, `rebuild` | MEDIUM   | 3     |
| **Persistence**      | `save`, `load`, `export`         | MEDIUM   | 3     |

## SOTA Capabilities: Kernel Runtimes

The RVF format's most distinctive SOTA capability is **kernel embedding** —
the ability to store executable compute programs directly inside vector
database files. This transforms `.rvf` from a passive data format into an
active compute container.

### Embedded Kernel Runtimes

```typescript
// Embed a unikernel image into the RVF store
const segId = await db.embedKernel(
  arch, // CPU architecture (x86_64=0, aarch64=1, riscv64=2, wasm32=3)
  kernelType, // Kernel type (unikernel=0, microvm=1, wasm-component=2)
  flags, // Runtime flags bitmask
  image, // Raw kernel/WASM image bytes (Uint8Array)
  apiPort, // API port for the kernel's HTTP/gRPC interface
  cmdline, // Optional kernel command line
);

// Extract to run the kernel alongside vector operations
const kernel = await db.extractKernel();
// kernel.header: KernelHeader (arch, type, flags, apiPort)
// kernel.image: raw bytes to load/execute
```

**Use Cases:**

- **Edge inference:** Ship a `.rvf` file with an embedded WASM inference
  kernel. The client loads vectors AND the inference model in one file.
- **Smart vector stores:** The kernel processes queries before/after vector
  search — e.g., a re-ranking model embedded alongside the index.
- **Portable compute:** A single `.rvf` file contains everything needed
  to run a complete retrieval+inference pipeline.

### Embedded eBPF Programs

```typescript
// Embed an eBPF program for in-kernel vector filtering
const segId = await db.embedEbpf(
  programType, // eBPF program type (socket=0, kprobe=1, tracepoint=2, xdp=3)
  attachType, // Attach point type
  maxDimension, // Max vector dimension the program handles
  bytecode, // Compiled eBPF bytecode (Uint8Array)
  btf, // Optional BTF (BPF Type Format) data
);

// Extract to load into the eBPF runtime
const ebpf = await db.extractEbpf();
// ebpf.header: EbpfHeader (programType, attachType, maxDimension)
// ebpf.payload: bytecode + BTF
```

**Use Cases:**

- **In-kernel filtering:** eBPF programs filter vectors at the OS level
  before they reach userspace, reducing memory bandwidth.
- **Observability:** Trace vector operations with eBPF probes for
  production monitoring without overhead.
- **Hardware offload:** XDP programs for network-attached vector stores
  that filter queries at the NIC level.

### Hardware Profiles

```typescript
// Create with hardware-optimized storage layout
const db = await RvfDatabase.create("./vectors.rvf", {
  dimensions: 768,
  profile: 2, // 0=Generic, 1=Core, 2=Hot, 3=Full
});
```

| Profile | ID  | Layout Optimization                               |
| ------- | --- | ------------------------------------------------- |
| Generic | 0   | Portable layout, no platform assumptions          |
| Core    | 1   | Aligned for common CPU cache lines (64B)          |
| Hot     | 2   | Optimized for frequently-accessed hot paths       |
| Full    | 3   | Maximum native optimization (SIMD alignment, etc) |

## SOTA Capabilities: Import/Export

### RVF Format Import/Export

```typescript
// Create with built-in compression
const db = await RvfDatabase.create("./compressed.rvf", {
  dimensions: 768,
  compression: "scalar", // 'none' | 'scalar' (int8) | 'product' (PQ)
  signing: true, // cryptographic segment signatures
});

// Derivation chain: COW branching with provenance
const child = await db.derive("./child.rvf", { dimensions: 768 });
// DerivationType: 'filter' | 'merge' | 'snapshot' | 'transform'

// Lineage introspection
const fid = await child.fileId(); // unique hex identifier
const pid = await child.parentId(); // parent's hex identifier
const depth = await child.lineageDepth(); // 0 = root, 1 = first child, ...

// Read-only access (no lock required, concurrent readers)
const reader = await RvfDatabase.openReadonly("./vectors.rvf");

// WASM in-browser store export
// rvf_store_export(handle, out_ptr, out_len) → serialized .rvf bytes
// Enables: browser vector DB → download as .rvf → import in Node.js
```

### Model Import/Export (SafeTensors + HuggingFace)

```typescript
import {
  ModelExporter,
  ModelImporter,
  SafeTensorsWriter,
  SafeTensorsReader,
  DatasetExporter,
} from "@ruvector/ruvllm";

// Export learned model to SafeTensors (HuggingFace compatible)
const exporter = new ModelExporter();
const buffer = exporter.toSafeTensors({
  metadata: { name: "agentdb-lora", version: "1.0" },
  loraWeights,
  loraConfig,
  patterns,
  ewcStats,
  tensors: new Map([["embedding", embeddingData]]),
});

// Export to multiple formats
const json = exporter.toJSON(model); // human-readable
const binary = exporter.toBinary(model); // compact
const hf = exporter.toHuggingFace(model); // { safetensors, config, readme }

// Import from any format
const importer = new ModelImporter();
const loaded = importer.fromSafeTensors(buffer); // → Partial<ExportableModel>
const fromJson = importer.fromJSON(jsonString);
const fromBin = importer.fromBinary(binaryBuffer);

// SafeTensors low-level API
const writer = new SafeTensorsWriter();
writer.addTensor("lora_a", weightA, [768, 64]);
writer.add2D("lora_b", numberArray2D);
writer.addMetadata("format", "agentdb-v3");
const bytes = writer.build();

const reader = new SafeTensorsReader(bytes);
reader.getTensorNames(); // ['lora_a', 'lora_b']
reader.getTensor("lora_a"); // { data: Float32Array, shape: [768, 64] }
reader.getMetadata(); // { format: 'agentdb-v3' }

// Dataset export for external training
const ds = new DatasetExporter();
const jsonl = ds.toJSONL(trainingData); // one JSON per line
const csv = ds.toCSV(trainingData); // CSV with embeddings
const pretrain = ds.toPretrain(patterns); // pre-training format
```

### WASM In-Memory Store (Browser-Side Full Vector Database)

```typescript
// The rvf-wasm microkernel exposes a complete in-memory vector store:
//   rvf_store_create(dim, metric) → handle
//   rvf_store_ingest(handle, vecs_ptr, ids_ptr, count) → status
//   rvf_store_query(handle, query_ptr, k, metric, out_ptr) → count
//   rvf_store_delete(handle, ids_ptr, count) → status
//   rvf_store_export(handle, out_ptr, out_len) → bytes_written
//   rvf_store_close(handle)
//
// This enables AgentDB to run a full vector database in the browser
// with no server dependency. rvf_store_export serializes the in-memory
// store to standard .rvf format for download or IndexedDB persistence.
```

## SOTA Capabilities: SIMD Activation Functions

The `SimdOps` class from `@ruvector/ruvllm` provides 16 hardware-accelerated
operations. AgentDB currently uses only 3 (cosine, dot, L2):

| Operation          | Signature                     | AgentDB Status | Use Case                         |
| ------------------ | ----------------------------- | -------------- | -------------------------------- |
| `dotProduct`       | `(a, b) → number`             | Used           | Similarity computation           |
| `cosineSimilarity` | `(a, b) → number`             | Used           | Similarity computation           |
| `l2Distance`       | `(a, b) → number`             | Used           | Distance computation             |
| `matvec`           | `(matrix, vector) → number[]` | **UNUSED**     | LoRA forward pass, projections   |
| `softmax`          | `(input) → number[]`          | **UNUSED**     | Attention scores, routing        |
| `add`              | `(a, b) → number[]`           | **UNUSED**     | Residual connections             |
| `mul`              | `(a, b) → number[]`           | **UNUSED**     | Gating, element-wise scaling     |
| `scale`            | `(a, scalar) → number[]`      | **UNUSED**     | Temperature scaling              |
| `normalize`        | `(a) → number[]`              | **UNUSED**     | L2 normalization                 |
| `relu`             | `(input) → number[]`          | **UNUSED**     | GNN activation                   |
| `gelu`             | `(input) → number[]`          | **UNUSED**     | Transformer activation           |
| `sigmoid`          | `(input) → number[]`          | **UNUSED**     | Gating, binary classification    |
| `layerNorm`        | `(input, eps?) → number[]`    | **UNUSED**     | Pre/post attention normalization |
| `isNative`         | `() → boolean`                | **UNUSED**     | Capability detection             |
| `capabilities`     | `() → string[]`               | **UNUSED**     | AVX2/AVX512/SSE4.1/NEON report   |

**Impact:** `matvec` alone would replace ContrastiveTrainer's JS
`matVecMul` with SIMD-accelerated matrix-vector multiplication. `softmax`
replaces manual softmax in attention fallbacks. `layerNorm` enables
proper pre-normalization in GNN layers. `normalize` replaces hand-rolled
L2 normalization loops throughout the codebase.

## SOTA Capabilities: Training Factory & RAG

### Training Factory Presets

```typescript
import { TrainingFactory } from "@ruvector/ruvllm";

// Pre-configured training pipelines:
const quick = TrainingFactory.quickFinetune(config); // fast LoRA fine-tuning
const deep = TrainingFactory.deepTraining(config); // full training with LR schedule
const continual = TrainingFactory.continualLearning(config); // EWC-protected updates
const federated = TrainingFactory.federatedAggregation(config); // multi-agent aggregation
```

### Retrieval-Augmented Generation (RLM Controller)

```typescript
import { RlmController } from "@ruvector/ruvllm";

const rlm = new RlmController(config);
await rlm.addMemory("content", { source: "docs", topic: "auth" });

// Recursive retrieval with automatic sub-query decomposition
const result = await rlm.query("How does authentication work?");
// → Decomposes into sub-queries, retrieves per sub-query, synthesizes

// Streaming with token events
const stream = await rlm.queryStream("Explain OAuth2 flow");

// Cache management (5-minute TTL by default)
rlm.clearCache();
rlm.getCacheStats(); // { hits, misses, size }
```

## Integration Phases

### Phase 1: Critical Path (Weeks 1-3)

**Goal:** Replace JS reimplementations with native @ruvector APIs.

1. **Native Optimizers in ContrastiveTrainer**
   - Replace JS AdamW with `@ruvector/attention.AdamWOptimizer`
   - Replace JS InfoNCE with `@ruvector/attention.InfoNceLoss`
   - Expected: 10-50x training speedup

2. **Native EWC++ in SelfLearningRvfBackend**
   - Replace JS EWC approximation with `@ruvector/ruvllm.EwcManager`
   - Use `SimdOps` for vector math in hot paths

3. **Full SIMD Surface in NativeAccelerator**
   - Add `matvec`, `softmax`, `normalize`, `relu`, `gelu`, `sigmoid`,
     `layerNorm`, `add`, `mul`, `scale` to NativeAccelerator
   - Replace JS loops in ContrastiveTrainer, attention fallbacks, GNN layers

4. **WASM Verification APIs**
   - Integrate `rvf_witness_verify` and `rvf_witness_count` into RvfSolver
   - Add `rvf_verify_header`, `rvf_crc32c`, `rvf_verify_checksum` to loading
   - Enables client-side audit of witness chains

5. **RVF Compression Profiles**
   - Use `compression: 'scalar'|'product'` at store creation
   - 4-8x memory reduction without post-hoc quantization

6. **Graph Transactions + Cypher**
   - Wrap `GraphDatabaseAdapter` mutations in `begin`/`commit`/`rollback`
   - Add Cypher query support via `querySync`

7. **Router Persistence**
   - Use `@ruvector/router` `save`/`load` in SemanticQueryRouter
   - Cross-session route continuity

8. **SONA Context Enrichment**
   - Integrate `addTrajectoryContext` for rich trajectory metadata
   - Enable route-specific trajectory adaptation

9. **Batch Operations**
   - Use `@ruvector/core.insertBatch` and `@ruvector/graph-node.batchInsert`
   - 10-100x bulk ingestion speedup

10. **Tensor Compression**
    - Use `@ruvector/gnn.TensorCompress.compress/decompress/batchCompress`
    - Replace JS quantization in AdaptiveIndexTuner with native 5-level compression

11. **Read-Only Access + Filter Expressions**
    - Expose `openReadonly` for concurrent reader patterns
    - Wire full filter algebra (`eq/ne/lt/le/gt/ge/in/range/and/or/not`)

### Phase 2: Kernel Runtimes + Import/Export (Weeks 4-6)

**Goal:** Enable kernel embedding, model interoperability, and browser stores.

1. **Kernel + eBPF Embedding APIs**
   - Expose `embedKernel`/`extractKernel` through AgentDB public API
   - Expose `embedEbpf`/`extractEbpf` through AgentDB public API
   - Enable smart vector store packaging (data + compute in one file)

2. **Model Import/Export Pipeline**
   - Integrate `SafeTensorsWriter/Reader` for LoRA checkpoint persistence
   - Use `ModelExporter` for multi-format export (SafeTensors/JSON/Binary/HF)
   - Use `ModelImporter` for loading external models

3. **WASM In-Memory Store**
   - Expose WASM in-memory store (`rvf_store_*`) via WasmBackend
   - Enable `rvf_store_export` for browser → file serialization
   - Full vector database in browsers without N-API

4. **ReasoningBank Integration**
   - Replace TS pattern storage with `@ruvector/ruvllm.ReasoningBank`
   - Use Float64Array-optimized `store`/`findSimilar`/`recordUsage`/`prune`
   - Native pattern distillation from trajectories

5. **RLM Controller for RAG**
   - Integrate `RlmController` for recursive retrieval-augmented generation
   - Enable multi-hop retrieval with sub-query decomposition
   - Wire `queryStream` for streaming RAG responses

6. **LoRA Full Lifecycle**
   - Use `LoraAdapter` full API (forward/forwardBatch/backward per-layer)
   - Use `freeze/unfreeze/clone/merge` for adapter management
   - Use `toJSON/fromJSON` for adapter serialization

7. **Hardware Profiles + Lineage**
   - Use hardware profiles for platform-optimized storage layout
   - Expose `fileId/parentId/lineageDepth` for provenance tracking
   - Implement `deleteByFilter` for metadata-predicate bulk delete

8. **Curriculum Learning**
   - Replace JS curriculum scheduling with `@ruvector/attention.CurriculumScheduler`
   - Integrate `TemperatureAnnealing` and `LearningRateScheduler`

9. **Hard Negative Mining**
   - Use `HardNegativeMiner` and `InBatchMiner` from `@ruvector/attention`
   - Support Random/Hard/SemiHard/Distance mining strategies

10. **SONA Extended + Router Async**
    - Use `applyBaseLora` for pre-trained adaptation baselines
    - Use `flush` for guaranteed state persistence
    - Use `setEmbedder` + `addIntentAsync` for pluggable embeddings
    - Integrate `SonaCoordinator` and `TrajectoryBuilder`

11. **GNN Layer Serialization**
    - Use `RuvectorLayer.toJson/fromJson` for cross-session GNN persistence

12. **K-Hop + Hyperedge Graph Operations**
    - Use `kHopNeighbors` for multi-hop graph traversals
    - Use `createHyperedge/searchHyperedges` for multi-node relationships

### Phase 3: Advanced Features (Weeks 7-10)

**Goal:** Leverage advanced @ruvector capabilities for SOTA performance.

1. **Training Pipeline + Factory**
   - Use `TrainingPipeline.addBatch/train/loadCheckpoint` in ContrastiveTrainer
   - Use `TrainingFactory` presets for common training patterns
   - Integrate `LRScheduler` and `MetricsTracker`

2. **Ephemeral Agents for Federated Learning**
   - Use `EphemeralAgent.processTask/processTaskWithRoute` for worker trajectories
   - Use `exportState` → `FederatedCoordinator.aggregate` pipeline
   - Use `coordinator.createAgent` for warm-started workers

3. **SessionManager Integration**
   - Use `@ruvector/ruvllm.SessionManager` for multi-turn session lifecycle
   - Replace custom session tracking in `FederatedSessionManager`

4. **Derivation Chain**
   - Implement COW branching with `derive(path, { type: 'snapshot' })`
   - Support `filter/merge/snapshot/transform` derivation types

5. **Segment Signing**
   - Use `signing: true` at store creation for cryptographic provenance
   - Verify signed segments on load from untrusted sources

6. **Graph Attention Mechanisms**
   - Integrate `GraphRoPeAttention`, `EdgeFeaturedAttention`
   - Enable attention-weighted graph traversal

7. **Hyperbolic Embeddings**
   - Use `expMap`, `logMap`, `mobiusAddition`, `poincareDistance`,
     `projectToPoincareBall`
   - Better representation of hierarchical memory relationships

8. **WASM Quantization + HNSW Navigation**
   - Integrate scalar quantization (`rvf_load_sq_params`, `rvf_dequant_i8`)
   - Integrate product quantization (`rvf_load_pq_codebook`, `rvf_pq_distances`)
   - Use `rvf_load_neighbors`/`rvf_greedy_step` for browser-side graph walk

9. **WASM Segment Parsing**
   - Use `rvf_parse_header/rvf_segment_count/rvf_segment_info`
   - Client-side .rvf file introspection without N-API

10. **Differentiable Search**
    - Integrate `@ruvector/gnn.differentiableSearch` for gradient-informed retrieval

11. **Batch/Parallel + Async Attention**
    - Use `batchAttentionCompute`, `parallelAttentionCompute`, `crossAttention`
    - Use async attention variants for non-blocking computation

12. **Temporal Hyperedges**
    - Use temporal hyperedge APIs for time-decaying relationships
    - Use `queryTemporalRange` for time-windowed graph queries

13. **Dataset Export + Contrastive Training**
    - Use `DatasetExporter.toJSONL/toCSV/toPretrain`
    - Use `@ruvector/ruvllm.ContrastiveTrainer` for native triplet training
    - Use `generateLoRAConfig` for HuggingFace-compatible LoRA configs

14. **Index Management**
    - Use `@ruvector/core` `optimize`/`compact`/`rebuild`
    - Automated background index optimization

### Phase 4: Streaming + Graph Events (Weeks 11-13)

**Goal:** Enable streaming and reactive patterns.

1. **Streaming Token Generation**
   - Integrate `StreamingGenerator.stream/streamWithCallbacks/collect`
   - Use `createReadableStream()` for Node.js stream compatibility

2. **Streaming Graph Queries + Subscriptions**
   - Use `QueryResultStream`, `HyperedgeStream`, `NodeStream`
   - Use `subscribe()` for reactive graph change notifications

3. **Stream Processing for Long Sequences**
   - Use `@ruvector/attention.StreamProcessor` for chunked attention

4. **Attention Benchmarking**
   - Use `benchmarkAttention()` for built-in performance profiling

5. **Hyperbolic Attention**
   - Integrate `DualSpaceAttention`, `LocalGlobalAttention`
   - Combine Euclidean + Hyperbolic dual-space reasoning

### Phase 5: Full Ecosystem (Weeks 14-16)

**Goal:** Complete @ruvector integration for all use cases.

1. **LLM Engine Integration**
   - Explore `RuvLLM` and native `NativeRuvLLM.RuvLLMEngine`
   - Use `RuvLLM.route` for native model routing (FastGRNN-based)
   - Integrate `batchQuery` for multi-prompt processing

2. **Model Management**
   - Integrate `ModelDownloader` for HuggingFace model acquisition
   - Use model registry with `MODEL_ALIASES`

3. **WASM Memory Management**
   - Use `rvf_alloc`/`rvf_free` for direct WASM linear memory control
   - Optimize browser memory usage for large vector stores

## Architecture: Wrapper Strategy

All @ruvector package integrations MUST follow the established lazy-loading
pattern with graceful fallback:

```typescript
// REQUIRED pattern for all @ruvector imports
class FeatureWrapper {
  private native: NativeModule | null = null;

  async initialize(): Promise<void> {
    try {
      const mod = await import("@ruvector/package-name");
      this.native = mod.FeatureClass;
    } catch {
      console.warn("@ruvector/package-name not available — using JS fallback");
    }
  }

  isNativeAvailable(): boolean {
    return this.native !== null;
  }
}
```

**Rationale:** All @ruvector packages are optional peer dependencies.
AgentDB must function (with degraded performance) when any or all packages
are missing. The lazy-loading pattern is already used by every existing
wrapper (`RvfBackend`, `SonaLearningBackend`, `SemanticQueryRouter`, etc.).

## NativeAccelerator Expansion

The existing `NativeAccelerator` (ADR-007 Phase 1 bridge) must be expanded
to cover the full capability surface. Current state:

| Capability           | NativeAccelerator | Actually Called | Gap                 |
| -------------------- | ----------------- | --------------- | ------------------- |
| SIMD cosine/dot/L2   | Loaded            | Yes             | None                |
| SIMD hamming         | Loaded            | No              | Wire to binary PQ   |
| SIMD matvec          | **Missing**       | No              | Add to bridge       |
| SIMD softmax         | **Missing**       | No              | Add to bridge       |
| SIMD activations (6) | **Missing**       | No              | Add 6 functions     |
| WASM witness verify  | Loaded            | Partially       | Full integration    |
| WASM segment verify  | Loaded            | No              | Wire to RvfBackend  |
| WASM in-memory store | **Missing**       | No              | Add store bridge    |
| WASM quantization    | **Missing**       | No              | Add SQ/PQ bridge    |
| WASM HNSW nav        | **Missing**       | No              | Add nav bridge      |
| WASM store export    | **Missing**       | No              | Add export bridge   |
| Native InfoNCE       | Loaded            | Via fallback    | Wire to trainer     |
| Native AdamW         | Loaded            | Via fallback    | Wire to trainer     |
| Tensor compress      | Loaded            | No              | Wire to tuner       |
| Router persist       | Loaded            | Partially       | Full integration    |
| SONA extended        | Loaded            | No              | Wire to backend     |
| Model export         | **Missing**       | No              | Add export bridge   |
| ReasoningBank        | **Missing**       | No              | Add pattern bridge  |
| Training Pipeline    | **Missing**       | No              | Add training bridge |
| RLM Controller       | **Missing**       | No              | Add RAG bridge      |

## Risks

| Risk                                                           | Likelihood | Mitigation                                                                        |
| -------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| @ruvector API breaking changes (alpha packages)                | HIGH       | Pin exact versions in package.json; wrap all imports in version-checking adapters |
| Native module build failures on some platforms                 | MEDIUM     | WASM fallback for all N-API features; JS fallback for all WASM features           |
| Performance regression from abstraction layers                 | LOW        | Benchmark each integration against JS baseline; keep fast path native             |
| @ruvector/attention "completely broken" (per existing comment) | HIGH       | Keep JS fallbacks in `attention-fallbacks.ts`; test native on every CI run        |
| Increased bundle size from unused package imports              | LOW        | All imports are dynamic (`await import()`); tree-shaking at module level          |
| Kernel/eBPF embedding security (arbitrary code in .rvf files)  | HIGH       | Validate embedded images; sandbox extraction; require signing for untrusted files |
| WASM memory limits for large in-browser stores                 | MEDIUM     | Monitor `rvf_store_status` memory usage; implement eviction for browser stores    |

## Success Metrics

| Metric                            | Current           | Phase 1 Target             | Phase 5 Target               |
| --------------------------------- | ----------------- | -------------------------- | ---------------------------- |
| @ruvector capability coverage     | ~30%              | ~55%                       | ~95%                         |
| ContrastiveTrainer training speed | JS baseline       | 10-50x (native optimizers) | 50-100x (full pipeline)      |
| Bulk ingestion throughput         | Sequential insert | 10x (batch)                | 100x (batch + compressed)    |
| Memory footprint (per 1M vectors) | ~4GB (f32)        | ~1GB (scalar quant)        | ~500MB (PQ)                  |
| Witness chain verification        | Server-only       | WASM-verified              | Full audit + signed segments |
| Graph mutation consistency        | No guarantees     | Transactional              | ACID + Cypher                |
| Router cold-start time            | Full rebuild      | Persisted                  | <100ms                       |
| Self-learning adaptation          | Static HNSW       | Route + context aware      | ReasoningBank + RAG          |
| SIMD operations used              | 3 of 16           | 10 of 16                   | 16 of 16                     |
| Import/export formats             | None              | SafeTensors + JSON         | All formats + WASM export    |
| Kernel runtime support            | None              | API exposed                | Full kernel + eBPF lifecycle |
| Browser vector DB                 | None              | WASM in-memory store       | Full WASM store + export     |
| Training pipeline automation      | Manual setup      | Factory presets            | Full pipeline + metrics      |
| RAG capability                    | None              | RLM basic query            | Streaming RAG + sub-queries  |

## Consequences

### Positive

- Eliminates JS reimplementations of native functionality (InfoNCE, AdamW, EWC++)
- Unlocks 10-100x performance improvements in training and bulk operations
- Provides transaction safety for graph mutations
- Enables browser-compatible vector operations via WASM quantization and in-memory store
- Gives witness chain auditability to all clients (not just N-API)
- **Kernel embedding** transforms RVF into an active compute container
- **eBPF embedding** enables in-kernel vector filtering for production workloads
- **SafeTensors import/export** enables HuggingFace ecosystem interoperability
- **WASM store export** enables browser → file → server round-trip for vector data
- **Full SIMD surface** replaces 13 additional JS math operations with native code
- **Training Factory** eliminates manual training configuration
- **RLM Controller** adds production-ready RAG without external dependencies
- Achieves near-complete utilization of @ruvector investment

### Negative

- Increased dependency surface on alpha-versioned packages
- More complex initialization logic (11 packages with individual availability checks)
- Testing matrix expands (with/without each @ruvector package)
- Migration risk for existing deployments using JS fallback paths
- Kernel/eBPF embedding introduces code-execution trust considerations
- WASM in-memory store has browser memory constraints (~2GB typical limit)

### Neutral

- Wrapper pattern remains the same (lazy-load + fallback) — no architectural change
- All integrations are additive — no existing API changes required
- Each phase is independently deployable and testable
