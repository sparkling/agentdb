# ADR-008: `@agentdb/chat` — Self-Contained RVF Chat UI Package

**Status:** Proposed (Revision 4 — Grounded in Codebase Audit)
**Date:** 2026-02-17
**Author:** System Architect (AgentDB v3)
**Supersedes:** None
**Related:** ADR-003 (RVF Format), ADR-006 (Unified Self-Learning RVF), ADR-007 (Full Capability Integration)
**Package:** `@agentdb/chat`

## Context

AgentDB's RVF backend (`src/backends/rvf/`) is a production-ready stack of 12
files, 70+ active `@ruvector/*` API calls, 11 installed packages, and zerocan we
dead imports or stubs. ADR-007 Phase 1 is **complete** — `NativeAccelerator`
bridges 13 capability groups with graceful JS fallbacks across all packages.

Three upstream projects provide the building blocks for a self-contained chat
application embedded in a single `.rvf` file:

1. **[HuggingFace chat-ui](https://github.com/huggingface/chat-ui)** — SvelteKit
   LLM chat interface. Requires Node.js, MongoDB, and an external LLM API.

2. **[ruvbot](https://www.npmjs.com/package/ruvbot)** (v0.2.0) — Self-learning AI
   assistant on the `@ruvector/*` stack. 6-layer AIDefence, WASM embeddings (2.7ms),
   SONA learning with EWC++, 12+ LLM models with 3-tier routing, multi-platform
   (Slack/Discord/REST/CLI), 12 background workers. 2.3 MB, MIT.

3. **`@ruvector/*` package family** (11 packages, all installed) — The existing
   AgentDB backend already uses 50+ APIs across these packages.

### What Already Exists in AgentDB (Phase 1 Complete)

The audit of `src/backends/rvf/` reveals that most capabilities ADR-008
needs are **already implemented and tested**:

| Existing Component | File | Relevant APIs (LIVE, not proposed) |
|--------------------|------|------------------------------------|
| **RvfBackend** | `RvfBackend.ts` (815 lines) | `embedKernel`, `extractKernel`, `embedEbpf`, `extractEbpf`, `openReadonly`, `deleteByFilter`, `derive`, `verifyWitness`, `freeze`, `segments` — all 20 DB methods wired |
| **FilterBuilder** | `FilterBuilder.ts` (210 lines) | All 11 filter operators (`eq`/`ne`/`lt`/`le`/`gt`/`ge`/`in`/`range`/`and`/`or`/`not`), max 64 expressions |
| **WasmStoreBridge** | `WasmStoreBridge.ts` (84 lines) | `rvf_store_create`, `rvf_store_ingest`, `rvf_store_query`, `rvf_store_export`, `rvf_store_close` — complete browser vector DB |
| **NativeAccelerator** | `NativeAccelerator.ts` (490 lines) | 13 capability groups: SIMD (16 ops), WASM verify, quantization (SQ/PQ), InfoNCE, AdamW, EWC++, TensorCompress, router save/load, SONA extended, graph transactions+Cypher+batchInsert |
| **SimdFallbacks** | `SimdFallbacks.ts` (255 lines) | Pure JS: cosine, dot, L2, hamming, InfoNCE, AdamW, matvec, softmax, relu, gelu, sigmoid, layerNorm, add, mul, scale, normalize, crc32c |
| **ContrastiveTrainer** | `ContrastiveTrainer.ts` (560 lines) | InfoNCE loss, hard negative mining (NV-Retriever), 3-stage curriculum, analytical backpropagation |
| **SemanticQueryRouter** | `SemanticQueryRouter.ts` (457 lines) | Intent routing, persistence (save/load), debounced auto-save, threshold filtering |
| **SonaLearningBackend** | `SonaLearningBackend.ts` (358 lines) | Micro-LoRA (<1ms), trajectory recording, context enrichment, EWC++ |
| **FederatedSessionManager** | `FederatedSessionManager.ts` (527 lines) | `FederatedCoordinator` (15+ methods), `LoraManager`, `EphemeralAgent`, per-agent trajectories, warm-start patterns |
| **AdaptiveIndexTuner** | `AdaptiveIndexTuner.ts` (622 lines) | 5-tier compression (none/half/pq8/pq4/binary), native TensorCompress, Matryoshka truncation, health monitoring |
| **RvfSolver** | `RvfSolver.ts` (257 lines) | Thompson Sampling, 18 context-bucketed bandits, SHAKE-256 witness chains, A/B/C ablation |
| **SelfLearningRvfBackend** | `SelfLearningRvfBackend.ts` (433 lines) | Orchestrates ALL above: route → enhance → search → feedback → contrastive train → federated aggregate |

### What Does NOT Yet Exist (ADR-007 Phase 2-5)

These `@ruvector/ruvllm` APIs are **exported by the package but not yet
integrated** into AgentDB. ADR-008 depends on them for LLM inference:

| API | ADR-007 Phase | Status in AgentDB |
|-----|---------------|-------------------|
| `RuvLLM.generate/embed/route/similarity` | Phase 5 | **NOT INTEGRATED** |
| `NativeRuvLLM.RuvLLMEngine` | Phase 5 | **NOT INTEGRATED** |
| `RlmController.query/queryStream` | Phase 2 | **NOT INTEGRATED** |
| `StreamingGenerator.stream/createReadableStream` | Phase 4 | **NOT INTEGRATED** |
| `SessionManager.create/get/chat/getHistory` | Phase 3 | **NOT INTEGRATED** |
| `TrainingFactory.quickFinetune/deepTraining` | Phase 3 | **NOT INTEGRATED** |
| `ModelExporter/Importer` (SafeTensors) | Phase 2 | **NOT INTEGRATED** |

**ruvbot** bridges this gap — it already integrates these ruvllm APIs
independently of AgentDB, providing an immediately usable inference runtime.

## Decision

Publish **`@agentdb/chat`** as a standalone package in the monorepo
(`packages/agentdb-chat/`), peer to `packages/agentdb/`. It composes three layers:

1. **`agentdb`** (peer dependency) — `SelfLearningRvfBackend` for storage, search, learning
2. **`ruvbot`** (dependency) — inference, security, LLM routing, workers
3. **chat-ui fork** (vendored) — SvelteKit frontend, adapted for RVF + ruvbot

Embedded in `.rvf` files via the **already-wired** `RvfBackend.embedKernel()`.

### Package Structure

```
packages/agentdb-chat/
  package.json            # @agentdb/chat, peerDeps: agentdb
  tsconfig.json
  src/
    index.ts              # public API: createChatServer, embedChat, extractChat
    ChatPersistence.ts    # extends SelfLearningRvfBackend for chat
    ChatInference.ts      # ruvbot bridge for LLM inference
    ChatServer.ts         # SvelteKit SSR adapter + ruvbot middleware
    KernelBuilder.ts      # initramfs + embedKernel orchestration
  frontend/               # chat-ui fork (SvelteKit)
    src/
    svelte.config.js
    vite.config.ts
  bin/
    agentdb-chat.ts       # CLI: npx @agentdb/chat ./knowledge-base.rvf
  tests/
```

```jsonc
// package.json
{
  "name": "@agentdb/chat",
  "version": "0.1.0",
  "type": "module",
  "bin": { "agentdb-chat": "./bin/agentdb-chat.js" },
  "peerDependencies": {
    "agentdb": "^2.0.0"
  },
  "dependencies": {
    "ruvbot": "^0.2.0",
    "@ruvector/rvf": "^0.1.9",
    "@ruvector/rvf-node": "^0.1.7",
    "@ruvector/rvf-wasm": "^0.1.6",
    "@ruvector/ruvllm": "^0.2.4",
    "@ruvector/graph-node": "^0.1.15",
    "@ruvector/router": "^0.1.15",
    "@ruvector/sona": "^0.1.4"
  }
}
```

### Public API

```typescript
import { createChatServer, embedChat, extractChat } from '@agentdb/chat';

// 1. Serve chat UI against an existing .rvf file
const server = await createChatServer('./knowledge-base.rvf', { port: 3000 });

// 2. Embed chat runtime into a .rvf file (kernel segment)
await embedChat('./knowledge-base.rvf', { arch: 'x86_64' });

// 3. Extract and launch embedded chat from a .rvf file
const { url, stop } = await extractChat('./knowledge-base.rvf');
// url = 'http://localhost:3000'

// CLI equivalent:
// npx @agentdb/chat ./knowledge-base.rvf
// npx @agentdb/chat embed ./knowledge-base.rvf --arch x86_64
// npx @agentdb/chat extract ./knowledge-base.rvf
```

## MongoDB Replacement: Built on Existing AgentDB Components

Rather than creating a new `AgentDbStorageAdapter`, this ADR extends the
**existing** `SelfLearningRvfBackend` with a thin chat persistence layer.

### Mapping MongoDB Collections to Existing Components

| MongoDB Collection | AgentDB Replacement | Existing Component | Status |
|--------------------|--------------------|--------------------|--------|
| `embeddings` | `RvfBackend.ingestBatch` / `.query` | `RvfBackend.ts:815` | **LIVE** — core purpose of RVF |
| `settings` | `RvfBackend.query` with `FilterBuilder` predicates | `FilterBuilder.ts:210` | **LIVE** — 11 operators, metadata on sentinel vectors |
| `assistants` | `SemanticQueryRouter.addIntent` (one route per assistant) | `SemanticQueryRouter.ts:457` | **LIVE** — with persistence via `save`/`load` |
| `users` | `GraphDatabase.addNode` + Cypher queries + transactions | `NativeAccelerator.ts:490` | **LIVE** — `graphBeginTransaction`, `graphCypher`, `graphBatchInsert` |
| `conversations` | `FederatedSessionManager.beginSession` + trajectory recording | `FederatedSessionManager.ts:527` | **LIVE** — per-agent session lifecycle, export/import |
| `messages` | `SonaLearningBackend` trajectory steps + context enrichment | `SonaLearningBackend.ts:358` | **LIVE** — `addTrajectoryStep`, `addTrajectoryContext` |

### Chat Persistence Extension

The only new code is a ~150-line adapter in `@agentdb/chat` that maps
chat-ui's MongoDB client calls to existing agentdb components:

```typescript
// packages/agentdb-chat/src/ChatPersistence.ts (~150 lines)
// Depends on agentdb as peerDependency — does NOT duplicate it

import type { SelfLearningRvfBackend } from 'agentdb/backends/rvf';
import type { NativeAccelerator } from 'agentdb/backends/rvf';

export class ChatPersistence {
  constructor(
    private backend: SelfLearningRvfBackend,  // existing orchestrator
    private accel: NativeAccelerator,          // existing capability bridge
  ) {}

  // --- Conversations: delegates to FederatedSessionManager ---
  async createConversation(userId: string) {
    // beginSession returns a SessionHandle with trajectory recording
    return this.backend.federated.beginSession(userId);
  }

  async appendMessage(sessionId: string, embedding: number[], quality: number) {
    // Uses existing trajectory recording — stores embedding + quality
    return this.backend.federated.recordTrajectory(sessionId, embedding, quality);
  }

  async getHistory(sessionId: string) {
    // Export session state — JSON-serializable
    return this.backend.federated.endSession(sessionId);
  }

  // --- Users: delegates to NativeAccelerator graph ops ---
  async createUser(profile: Record<string, unknown>) {
    const txn = this.accel.graphBeginTransaction();
    try {
      const nodeId = this.accel.graphBatchInsert([{ type: 'user', ...profile }]);
      txn.commit();
      return nodeId;
    } catch (e) {
      txn.rollback();
      throw e;
    }
  }

  async findUser(email: string) {
    return this.accel.graphCypher(
      `MATCH (u:user) WHERE u.email = $email RETURN u`,
      { email }
    );
  }

  // --- Settings: delegates to RvfBackend + FilterBuilder ---
  async getSetting(key: string) {
    const results = await this.backend.search(ZERO_VEC, {
      k: 1,
      filter: FilterBuilder.buildFilter({
        op: 'and',
        children: [
          { op: 'eq', field: '_type', value: 'setting' },
          { op: 'eq', field: '_key', value: key },
        ],
      }),
    });
    return results[0]?.metadata?.value;
  }

  // --- Assistants: delegates to SemanticQueryRouter ---
  async createAssistant(name: string, systemPrompt: string, embedding: number[]) {
    return this.backend.router.addIntent({
      name,
      utterances: [embedding],
      metadata: { systemPrompt },
    });
  }

  async routeToAssistant(queryEmbedding: number[]) {
    return this.backend.router.route(queryEmbedding);
  }
}
```

### Why Extend, Not Replace

- **`SelfLearningRvfBackend`** already orchestrates search → enhance → feedback →
  contrastive train → federated aggregate. Adding chat persistence means wiring
  conversation events into this existing pipeline, not building a parallel one.
- **`NativeAccelerator`** already bridges graph transactions, Cypher queries, and
  batch insert with JS fallbacks. No new capability bridge needed.
- **`FederatedSessionManager`** already manages per-agent session lifecycle with
  trajectory recording, warm-start patterns, and state export/import. This IS
  the session manager — it just needs a chat-oriented API wrapper.
- **`FilterBuilder`** already implements the full 11-operator filter algebra.
  Settings queries are just filter expressions on sentinel vectors.

## Inference Layer: ruvbot Fills the Phase 2-5 Gap

AgentDB's `@ruvector/ruvllm` integration is currently at **Phase 1** — SIMD ops,
EWC++, InfoNCE, and AdamW are wired, but the LLM engine (`RuvLLM.generate`,
`NativeRuvLLM.RuvLLMEngine`, `RlmController`, `StreamingGenerator`) is **Phase 2-5
and not yet integrated**.

**ruvbot solves this** — it already integrates these ruvllm APIs independently:

### Capability Availability Matrix

| Capability | AgentDB Status | ruvbot Status | Combined |
|-----------|---------------|---------------|----------|
| SIMD vector math (16 ops) | **LIVE** (NativeAccelerator) | Uses same | NativeAccelerator |
| HNSW vector search | **LIVE** (RvfBackend) | Uses same | RvfBackend |
| WASM store (browser) | **LIVE** (WasmStoreBridge) | Uses same | WasmStoreBridge |
| Quantization (SQ/PQ) | **LIVE** (NativeAccelerator) | Uses same | NativeAccelerator |
| 5-tier compression | **LIVE** (AdaptiveIndexTuner) | N/A | AdaptiveIndexTuner |
| Contrastive training | **LIVE** (ContrastiveTrainer) | N/A | ContrastiveTrainer |
| SONA learning + LoRA | **LIVE** (SonaLearningBackend) | SONA via ruvbot | SonaLearningBackend |
| Federated learning | **LIVE** (FederatedSessionManager) | N/A | FederatedSessionManager |
| Thompson Sampling | **LIVE** (RvfSolver) | N/A | RvfSolver |
| Router persistence | **LIVE** (SemanticQueryRouter) | N/A | SemanticQueryRouter |
| EWC++ memory protection | **LIVE** (NativeAccelerator) | EWC via ruvbot | NativeAccelerator |
| Graph transactions+Cypher | **LIVE** (NativeAccelerator) | N/A | NativeAccelerator |
| **LLM text generation** | NOT INTEGRATED (Phase 5) | **LIVE** (12+ models) | **ruvbot** |
| **Streaming responses** | NOT INTEGRATED (Phase 4) | **LIVE** (SSE) | **ruvbot** |
| **RAG pipeline** | NOT INTEGRATED (Phase 2) | **LIVE** (recursive) | **ruvbot** |
| **Embedding generation** | NOT INTEGRATED (Phase 5) | **LIVE** (WASM 2.7ms) | **ruvbot** |
| **Model routing** | NOT INTEGRATED (Phase 5) | **LIVE** (3-tier) | **ruvbot** |
| **AIDefence security** | N/A | **LIVE** (6-layer, <5ms) | **ruvbot** |
| **Training factory** | NOT INTEGRATED (Phase 3) | partial | Phase 3 work |
| **Session manager** | NOT INTEGRATED (Phase 3) | N/A | ChatPersistence (above) |
| **SafeTensors export** | NOT INTEGRATED (Phase 2) | N/A | Phase 2 work |

**Key insight:** AgentDB owns storage/search/learning. ruvbot owns inference/security/routing.
There is no overlap — they are complementary.

### Integration Architecture

```
@agentdb/chat (standalone package)
    |
    +---> frontend/ (SvelteKit — chat-ui fork)
    |
    +---> ChatInference.ts -----> ruvbot (inference + security)
    |                               |
    |                               +---> AIDefence 6-layer (<5ms)
    |                               +---> 3-tier LLM routing (12+ models)
    |                               +---> Streaming SSE
    |                               +---> WASM embeddings (2.7ms)
    |                               +---> Background workers (12 types)
    |
    +---> ChatPersistence.ts ----> agentdb (peer dependency)
    |                               |
    |                               +---> SelfLearningRvfBackend (orchestrator)
    |                               |       +---> RvfBackend (20 DB methods)
    |                               |       +---> SonaLearningBackend
    |                               |       +---> ContrastiveTrainer
    |                               |       +---> FederatedSessionManager
    |                               |       +---> SemanticQueryRouter
    |                               |       +---> AdaptiveIndexTuner
    |                               |       +---> RvfSolver
    |                               +---> NativeAccelerator (13 groups)
    |                               +---> FilterBuilder (11 operators)
    |                               +---> WasmStoreBridge (browser)
    |
    +---> KernelBuilder.ts ------> embedKernel() / extractKernel()
```

### Request Flow

```
User Browser
    |
    v
@agentdb/chat :3000 (SvelteKit)
    |
    +--- user message -------> ChatInference → ruvbot
    |                            |
    |   [AIDefence: 6 checks, <5ms]
    |                            |
    |   ruvbot 3-tier router selects model
    |   ruvbot generates response (streaming SSE)
    |                            |
    |   meanwhile (parallel via ChatPersistence → agentdb):
    |     SonaLearningBackend.enhance(queryEmbedding)    <-- micro-LoRA, <1ms
    |     SemanticQueryRouter.route(queryEmbedding)      <-- assistant selection
    |     RvfBackend.query(enhanced, {k, filter})        <-- HNSW search, <1ms
    |     SonaLearningBackend.recordTrajectory(...)      <-- learning signal
    |     ContrastiveTrainer.createSample(...)            <-- training data
    |                            |
    +--- SSE stream ----------> browser
    |
    +--- ChatPersistence.appendMessage(...)              <-- via FederatedSessionManager
    +--- RvfBackend.ingestBatch([messageEmbedding])      <-- for future RAG
    |
    v
User sees response
    Self-learning loop: SONA tick → contrastive batch → solver policy update
```

## Architecture

### Layer Model

```
+---------------------------------------------------------------------+
|                           .rvf File                                 |
|---------------------------------------------------------------------|
|  Segment 0: manifest     | RVF header, dimensions, metric, config  |
|  Segment 1: vec          | Vector data (HNSW-indexed embeddings)    |
|  Segment 2: witness      | SHAKE-256 integrity chain                |
|  Segment 3: kernel       | embedKernel() — Linux unikernel image    |
|    +--------------------------------------------------------+       |
|    | vmlinuz (compressed Linux 6.8, ~5-12 MB)               |       |
|    | initramfs.cpio.gz                                       |       |
|    |   /usr/bin/node             (Node.js 22 LTS, ~40 MB)   |       |
|    |   /app/agentdb-chat/        (SvelteKit build, ~15 MB)  |       |
|    |   /app/node_modules/                                    |       |
|    |     ruvbot/                 (runtime, 2.3 MB)           |       |
|    |     @ruvector/rvf/          (RVF SDK)                   |       |
|    |     @ruvector/ruvllm/       (SIMD + learning, ~8 MB)    |       |
|    |     @ruvector/rvf-wasm/     (WASM microkernel, 42 KB)   |       |
|    |     @ruvector/graph-node/   (Cypher + transactions)     |       |
|    |     @ruvector/router/       (semantic routing)          |       |
|    |     @ruvector/sona/         (SONA learning)             |       |
|    |     @ruvector/gnn/          (tensor compression)        |       |
|    |     @ruvector/rvf-solver/   (Thompson Sampling)         |       |
|    |     @ruvector/attention/    (InfoNCE, AdamW)            |       |
|    |     @ruvector/rvf-node/     (N-API backend)             |       |
|    |   /app/graph-node.db        (user/session graph)        |       |
|    |   /init                     (boot script)               |       |
|    +--------------------------------------------------------+       |
|  Segment 4: ebpf (opt)   | eBPF vector filter programs              |
+---------------------------------------------------------------------+
```

**Total kernel segment: ~75 MB** (Node.js ~40 MB + SvelteKit ~15 MB +
ruvbot+ruvector ~12 MB + Linux kernel ~8 MB).

### Kernel Embedding (Using Existing RvfBackend API)

`RvfBackend.ts` already wires `embedKernel` and `extractKernel` — these
are **live API calls**, not proposed integrations:

```typescript
// RvfBackend.ts already exposes these (line ~700+):
// async embedKernel(arch, type, flags, image, apiPort, cmdline)
// async extractKernel()

import { RvfBackend } from './src/backends/rvf/RvfBackend.js';

const backend = new RvfBackend({ storagePath: './knowledge-base.rvf', dimension: 768 });
await backend.initialize();

// embedKernel is already wired — this is not new code
await backend.embedKernel(
  0,            // arch: x86_64
  1,            // kernelType: microvm
  0b0000_0011,  // flags: AUTOSTART | NET_BRIDGE
  kernelImage,  // Uint8Array: built kernel + initramfs
  3000,         // apiPort
  'console=ttyS0 quiet rvf.vectors=/dev/vdb',
);
```

### Extraction and Launch

```typescript
const backend = new RvfBackend({ storagePath: './knowledge-base.rvf', dimension: 768 });
await backend.initialize();

// extractKernel is already wired
const kernel = await backend.extractKernel();
// kernel.header: { arch: 0, type: 1, flags: 3, apiPort: 3000 }
// kernel.image: Uint8Array

await writeFile('/tmp/rvf-kernel.img', kernel.image);

spawn('firecracker', [
  '--kernel', '/tmp/rvf-kernel.img',
  '--drive', `path=./knowledge-base.rvf,is_read_only=true`,
  '--net', 'tap=rvf0,mac=AA:BB:CC:DD:EE:01',
]);
// `@agentdb/chat` at http://<vm-ip>:3000
```

### WASM Browser Alternative (Using Existing WasmStoreBridge)

`WasmStoreBridge.ts` already implements the full WASM store lifecycle:

```typescript
import { WasmStoreBridge } from './src/backends/rvf/WasmStoreBridge.js';

// Already implemented — 5 WASM ops with fallback-safe error handling
const store = new WasmStoreBridge();
const handle = store.create(768, 'cosine');
store.ingest(handle, vectors, ids);
const results = store.query(handle, queryVec, 10);
const rvfBytes = store.export(handle);  // serialize to .rvf format
store.close(handle);
```

### Architecture-Specific Variants

| `arch` | Value | Kernel Strategy | Image Size | Notes |
|---------|-------|-----------------|-----------|-------|
| x86_64 | 0 | bzImage + initramfs | ~75 MB | Primary target, full N-API |
| aarch64 | 1 | Image.gz + initramfs | ~70 MB | Graviton, Apple Silicon |
| riscv64 | 2 | Image + initramfs | ~65 MB | JS-only SIMD fallbacks |
| wasm32 | 3 | No kernel — WasmStoreBridge | ~20 MB | Browser SPA mode |

## Build Pipeline

### Development: `npm run dev` in Monorepo

```bash
# From monorepo root:
cd packages/agentdb-chat
npm install
npm run dev  # Starts SvelteKit dev server + ruvbot against a local .rvf file

# Or from any directory:
npx @agentdb/chat ./my-knowledge-base.rvf
```

### Production Build

```bash
cd packages/agentdb-chat
npm run build
# Output: dist/ (Node.js server) + dist/frontend/ (SvelteKit SSR build, ~15 MB)
```

### Kernel Image Build (`@agentdb/chat embed`)

```bash
# CLI command — builds initramfs and embeds into .rvf
npx @agentdb/chat embed ./knowledge-base.rvf --arch x86_64

# Equivalent programmatic API:
```

```typescript
import { embedChat } from '@agentdb/chat';

await embedChat('./knowledge-base.rvf', {
  arch: 'x86_64',    // 'x86_64' | 'aarch64' | 'riscv64'
  linuxKernel: './vmlinuz-6.8-minimal',  // optional, downloads if not provided
});
```

The `KernelBuilder` internally:

1. Creates initramfs with Node.js + `@agentdb/chat` build + `ruvbot` + `@ruvector/*`
2. Concatenates Linux kernel + initramfs into bootable image
3. Calls `RvfBackend.embedKernel()` (already wired)

```bash
# What KernelBuilder generates inside the initramfs:
rootfs/
  usr/bin/node                    # Node.js 22 LTS (~40 MB)
  app/agentdb-chat/build/         # SvelteKit SSR (~15 MB)
  app/agentdb-chat/node_modules/  # ruvbot + @ruvector/* (~12 MB)
  init                            # Boot script (below)
```

```bash
# /init — generated by KernelBuilder
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t devtmpfs dev /dev

mkdir -p /data/rvf
mount -o ro /dev/vdb /data/rvf 2>/dev/null

export AGENTDB_RVF_PATH=/data/rvf/store.rvf
export RUVBOT_STORAGE=rvf
export RUVBOT_ENGINE=native
export RUVBOT_SECURITY=aidefence

cd /app/agentdb-chat
PORT=3000 node build/index.js &

echo "@agentdb/chat ready on :3000"
exec sh
```

### Extract and Launch (`@agentdb/chat extract`)

```bash
npx @agentdb/chat extract ./knowledge-base.rvf
# Extracts kernel, launches Firecracker microVM, prints URL
```

```typescript
import { extractChat } from '@agentdb/chat';

const { url, stop } = await extractChat('./knowledge-base.rvf');
console.log(url);  // http://localhost:3000
// ... later:
await stop();  // Shuts down microVM
```

## Self-Learning Loop (Existing Pipeline)

The `SelfLearningRvfBackend` search pipeline already implements the full
learning cycle. Chat interactions feed directly into it:

```
User query
  → SemanticQueryRouter.route(embedding)        [assistant selection]
  → SonaLearningBackend.enhance(embedding)      [micro-LoRA, <1ms]
  → RvfBackend.query(enhanced, {k, filter})     [HNSW search, <1ms]
  → ruvbot.generate(prompt + context)            [LLM inference]
  → SonaLearningBackend.recordTrajectory(...)   [learning signal]
  → User feedback (upvote/downvote)
  → ContrastiveTrainer.createSample(...)         [hard negative mining]
  → FederatedSessionManager.aggregate(...)       [cross-session patterns]
  → RvfSolver.train(...)                         [policy optimization]
  → AdaptiveIndexTuner.assess(...)               [compression tiering]
```

Each conversation turn improves future search quality, response routing,
and compression decisions — automatically, with no manual intervention.

## Constraints and Limitations

### Hard Constraints

| Constraint | Detail |
|-----------|--------|
| **Image size** | ~75 MB kernel segment. Dominated by Node.js (~40 MB). |
| **Hypervisor required** | Firecracker, QEMU, or cloud-hypervisor needed. Not self-executing. |
| **No WASM kernel** | `arch=3` uses WasmStoreBridge directly — no Linux kernel, no ruvbot workers. |
| **Model weights** | ruvbot needs API keys OR local model weights. Small models (~100 MB) can embed in initramfs; large models mount at runtime. |
| **Phase 2-5 ruvllm APIs** | `RlmController`, `TrainingFactory`, `SessionManager`, `SafeTensors` export are not yet in AgentDB — ruvbot provides LLM inference independently, but deep integration requires completing ADR-007 Phase 2+. |

### Soft Constraints

| Constraint | Mitigation |
|-----------|-----------|
| **Boot latency** | ~1-2s on Firecracker. No MongoDB = no 2s startup penalty. |
| **Memory** | ~128 MB RAM (vs ~256 MB with MongoDB). |
| **Updates** | Rebuild kernel image + re-embed. ruvbot skills can hot-reload. |
| **Network** | Default offline. Network only for external LLM fallback. |

### Comparison

| Dimension | chat-ui (standalone) | `@agentdb/chat` |
|-----------|-------------------|-----------------|
| Storage | MongoDB (external, ~80 MB) | RVF in-file (existing, 0 MB overhead) |
| LLM | External API (network required) | ruvbot (local, 12+ models) |
| Security | Basic validation | AIDefence 6-layer (<5ms) |
| Search | External vector DB | HNSW in-RVF (<1ms) |
| Embeddings | External API (200ms) | WASM local (2.7ms) |
| Learning | Static | SONA + contrastive + federated + Thompson |
| Cold start | ~3s (with MongoDB) | ~1-2s (Firecracker) |
| Portability | 4 services to deploy | 1 file to copy |

## Security Considerations

1. **ruvbot AIDefence** — 6 checks on every request: prompt injection,
   jailbreak, PII masking, input sanitization, unicode filtering, rate
   limiting. All <5ms. This is ruvbot-native, not new code.
2. **RVF witness chains** — `RvfSolver` already generates SHAKE-256 witness
   entries. `RvfBackend.verifyWitness()` validates integrity. Kernel image
   segments are included in the chain.
3. **Segment signing** — `signing: true` at RVF creation provides
   cryptographic provenance. Verify before `extractKernel()`.
4. **Read-only mount** — `.rvf` file is read-only in the microVM. Guest
   cannot modify vector data.
5. **Path validation** — `RvfBackend` enforces `MAX_PATH_LENGTH=4096`,
   blocks `..`, `/etc/`, `/proc/`, `/sys/`, `/dev/`, null bytes.
6. **Metadata bounds** — `MAX_METADATA_BYTES=65536`, prototype pollution
   stripped, `MAX_BATCH_SIZE=10000`, `MAX_VECTOR_DIMENSION=4096`.
7. **No secrets in RVF** — API keys via environment variables or vsock.

## Alternatives Considered

### 1. New Storage Adapter in agentdb core (Rejected)

Add chat persistence directly to `packages/agentdb/`. Rejected — chat UI
is a distinct concern. `@agentdb/chat` depends on `agentdb` as a peer dep
and wraps `SelfLearningRvfBackend` via `ChatPersistence`, keeping agentdb
focused on vector operations and learning.

### 2. Wait for ADR-007 Phase 5 (Rejected)

Wait until `RuvLLM.generate()` and `NativeRuvLLM.RuvLLMEngine` are integrated
into AgentDB before building chat UI. Rejected — ruvbot provides immediate
inference capability. AgentDB handles storage/learning; ruvbot handles
inference/security. Clean separation.

### 3. MongoDB + External LLM (Rejected)

Keep chat-ui dependencies. Adds ~80 MB, requires network, no security layer,
defeats single-file portability.

### 4. ruvbot CLI Only (Rejected)

Use ruvbot's REST/CLI without chat-ui frontend. Rejected — chat-ui provides
streaming UI, markdown rendering, code highlighting, multimodal support.

## Implementation Phases

### Phase 1: Package Scaffolding + Chat Persistence

- Create `packages/agentdb-chat/` with package.json, tsconfig, bin entry
- Implement `ChatPersistence.ts` (~150 lines) wrapping `SelfLearningRvfBackend`
- Implement `ChatInference.ts` (~100 lines) wrapping ruvbot runtime
- Fork chat-ui into `frontend/`, replace MongoDB client with `ChatPersistence`
- Replace OpenAI client with `ChatInference` → ruvbot
- Implement `ChatServer.ts` — SvelteKit SSR + ruvbot middleware
- Export public API: `createChatServer`, `embedChat`, `extractChat`
- Implement CLI: `npx @agentdb/chat ./file.rvf`
- **New code: ~500 lines** across 4 source files + CLI entry
- **Verify:** `npm run dev` serves UI on :3000, vector search works, SSE streaming

### Phase 2: Kernel Embedding + Self-Learning

- Implement `KernelBuilder.ts` — initramfs generation + `embedKernel()` orchestration
- Wire `embedChat()` and `extractChat()` public APIs
- Wire chat feedback (upvote/downvote) into `ContrastiveTrainer`
- Enable `SonaLearningBackend` enhancement on every query
- Enable `FederatedSessionManager` cross-session pattern sharing
- Enable `SemanticQueryRouter` assistant routing with auto-save
- Integrate `RlmController` for recursive RAG (ADR-007 Phase 2 prerequisite)
- **Verify:** `npx @agentdb/chat embed ./kb.rvf` creates bootable kernel segment

### Phase 3: Production

- Firecracker integration in `extractChat()` for ~1s boot
- eBPF vector filtering via existing `RvfBackend.embedEbpf()`
- Multi-tenant isolation via ruvbot RLS
- Health checks, graceful shutdown, metrics export
- Publish `@agentdb/chat` to npm

### Phase 4: Multi-Architecture + Advanced

- aarch64/riscv64 kernel images in `KernelBuilder`
- `kernel.header.arch` auto-detection
- `ModelExporter.toSafeTensors()` for LoRA weight sharing (ADR-007 Phase 2)
- Federated learning across multiple `.rvf` files

## Success Criteria

| Metric | Target | Validated By |
|--------|--------|-------------|
| Single-file distribution | One `.rvf` file = vectors + UI + runtime | `RvfBackend.embedKernel` (LIVE) |
| Package size | `@agentdb/chat` ~500 lines new code | Builds on agentdb's 12 RVF files (~5000 lines) |
| External dependencies | Zero (no MongoDB, no LLM API) | ruvbot local inference, RVF storage |
| Boot to ready | < 2s on Firecracker | No MongoDB startup |
| Vector search | < 1ms for k=10 on 100K vectors | `RvfBackend.query` (LIVE) |
| Embedding generation | < 3ms (WASM) | `WasmStoreBridge` (LIVE) |
| Security | < 5ms per request (6 checks) | ruvbot AIDefence |
| Learning | SONA + contrastive + federated per query | `SelfLearningRvfBackend` (LIVE) |
| Kernel segment | < 80 MB | Node.js 40 + SvelteKit 15 + ruvector 12 + Linux 8 |
| JS fallback coverage | 100% graceful degradation | `SimdFallbacks` + `NativeAccelerator` (LIVE) |

## References

### External
- [HuggingFace chat-ui](https://github.com/huggingface/chat-ui) — SvelteKit LLM chat interface
- [ruvbot](https://www.npmjs.com/package/ruvbot) (v0.2.0) — Self-learning AI assistant, 2.3 MB, MIT
- [Firecracker](https://firecracker-microvm.github.io/) — Lightweight microVM

### ADRs
- ADR-007: @ruvector Full Capability Integration (Phase 1 Complete, Phases 2-5 Proposed)
- ADR-006: Unified Self-Learning RVF Integration
- ADR-003: RVF Format Integration

### Codebase (agentdb existing components `@agentdb/chat` builds on)
- `src/backends/rvf/RvfBackend.ts` (815 lines) — 20 live `@ruvector/rvf` API calls incl. `embedKernel`/`extractKernel`/`embedEbpf`/`extractEbpf`
- `src/backends/rvf/SelfLearningRvfBackend.ts` (433 lines) — full learning pipeline orchestrator
- `src/backends/rvf/NativeAccelerator.ts` (490 lines) — 13 capability groups, 70+ API calls, JS fallbacks
- `src/backends/rvf/FederatedSessionManager.ts` (527 lines) — session lifecycle, 15+ ruvllm API calls
- `src/backends/rvf/ContrastiveTrainer.ts` (560 lines) — InfoNCE, hard negative mining, curriculum learning
- `src/backends/rvf/SemanticQueryRouter.ts` (457 lines) — intent routing with persistence
- `src/backends/rvf/AdaptiveIndexTuner.ts` (622 lines) — 5-tier compression, health monitoring
- `src/backends/rvf/RvfSolver.ts` (257 lines) — Thompson Sampling, 18 bandits, witness chains
- `src/backends/rvf/FilterBuilder.ts` (210 lines) — 11-operator metadata filter algebra
- `src/backends/rvf/WasmStoreBridge.ts` (84 lines) — complete browser vector DB (5 WASM ops)
- `src/backends/rvf/SimdFallbacks.ts` (255 lines) — 17 pure JS fallback functions, 4-wide unrolled
