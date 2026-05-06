# AgentDB on Deno Deploy

Deploy AgentDB with WASM backend to Deno Deploy for serverless vector search at the edge.

## Features

- **WASM Graph Transformer**: Uses `ruvector-graph-transformer-wasm` for graph operations
- **Flash Attention v2**: Optimized embeddings with 2.49x-7.47x speedup
- **Deno KV**: Built-in persistent key-value storage
- **Global Distribution**: Deploy to 35+ edge regions worldwide
- **Zero Config**: No build step required, deploys TypeScript directly
- **Sub-5ms Latency**: Fast vector search with HNSW indexing

## Setup

### 1. Install Deno

```bash
# macOS/Linux
curl -fsSL https://deno.land/install.sh | sh

# Windows
irm https://deno.land/install.ps1 | iex
```

### 2. Install Deno Deploy CLI

```bash
deno install --allow-all --no-check -r -f https://deno.land/x/deploy/deployctl.ts
```

### 3. Build AgentDB for Edge Deployment

```bash
cd ../..
npm run build:edge
# This creates: dist/deno/agentdb.deno.js (optimized ~362KB bundle)
```

### 4. Login to Deno Deploy

```bash
deployctl login
```

## Local Development

Run the server locally:

```bash
deno run --allow-net --allow-read --allow-write --unstable server.ts
```

The server will start on `http://localhost:8000`

## Deployment

### Deploy to Deno Deploy

```bash
# Create new project
deployctl deploy --project=agentdb-demo server.ts

# Update existing project
deployctl deploy --project=agentdb-demo --prod server.ts
```

Your API will be available at: `https://agentdb-demo.deno.dev`

## Usage

### Store a Memory

```bash
curl -X POST https://agentdb-demo.deno.dev/store \
  -H "Content-Type: application/json" \
  -d '{
    "key": "deno-pattern",
    "content": "Deno uses TypeScript natively without transpilation",
    "metadata": {
      "category": "runtime",
      "language": "typescript"
    }
  }'
```

### Search Memories (with Flash Attention v2)

```bash
curl "https://agentdb-demo.deno.dev/search?q=typescript&limit=5&flash=true"
```

Response:

```json
{
  "results": [
    {
      "key": "deno-pattern",
      "content": "Deno uses TypeScript natively...",
      "score": 0.95,
      "metadata": { "category": "runtime" }
    }
  ],
  "metadata": {
    "durationMs": 4.2,
    "usedFlashAttentionV2": true
  }
}
```

### Retrieve a Memory

```bash
curl https://agentdb-demo.deno.dev/retrieve/deno-pattern
```

### Delete a Memory

```bash
curl -X DELETE https://agentdb-demo.deno.dev/delete/deno-pattern
```

### Get Statistics

```bash
curl https://agentdb-demo.deno.dev/stats
```

### Run Flash Attention v2 Benchmark

```bash
curl "https://agentdb-demo.deno.dev/benchmark?seqLen=512"
```

Response:

```json
{
  "seqLen": 512,
  "flashV2TimeMs": 12.4,
  "baselineTimeMs": 45.8,
  "speedup": 3.69,
  "targetRange": "2.49x-7.47x",
  "passedTarget": true
}
```

## Performance

- **Cold Start**: ~30-50ms (includes WASM initialization)
- **Warm Requests**: <5ms for vector search
- **Flash Attention v2**: 2.49x-7.47x faster than naive attention
- **Deno KV Latency**: <1ms for local reads, <10ms for global reads

## Architecture

```
┌─────────────────────────────────────────┐
│ Deno Deploy (V8 Isolates)              │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ AgentDB Instance                  │  │
│  │                                   │  │
│  │  • WASM Graph Transformer         │  │
│  │  • Flash Attention v2             │  │
│  │  • HNSW Vector Index              │  │
│  │  • RVF Format Support             │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ Deno KV (FoundationDB)            │  │
│  │  • Strong consistency             │  │
│  │  • Global replication             │  │
│  │  • ACID transactions              │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Cost Estimation

**Free Tier:**

- 100,000 requests/day
- 100 GiB bandwidth/month
- 1 GB Deno KV storage

**Pro Tier ($20/month):**

- 5 million requests/month
- 100 GB KV storage
- Custom domains
- Advanced analytics

Example: 1M searches/month = Free (within limits)

## Limitations

- **CPU Time**: 50ms per request (soft limit)
- **Memory**: 512MB per isolate
- **WASM Size**: Bundle should be <50MB
- **Deno KV**: 64KB per value, 10 writes/second per key

## Optimization Tips

1. **Cache DB Instance**: Reuse AgentDB instance across requests
2. **Enable Flash Attention v2**: Add `?flash=true` to search queries
3. **Batch Operations**: Combine multiple searches in single request
4. **Use Deno KV Watch**: Subscribe to real-time updates
5. **Enable SIMD**: Deno Deploy supports WASM SIMD by default

## Deno vs Cloudflare Workers

| Feature          | Deno Deploy            | Cloudflare Workers     |
| ---------------- | ---------------------- | ---------------------- |
| **Cold Start**   | 30-50ms                | 50-100ms               |
| **Warm Latency** | <5ms                   | <10ms                  |
| **CPU Limit**    | 50ms soft              | 50ms hard (50s for DO) |
| **Storage**      | Deno KV (FoundationDB) | Durable Objects        |
| **TypeScript**   | Native, no build       | Requires build         |
| **WASM Support** | Full                   | Limited to 25MB        |
| **Free Tier**    | 100k req/day           | 100k req/day           |
| **Pricing**      | $20/month Pro          | Pay-as-you-go          |

## Troubleshooting

**Error: "Deno KV not available"**

- Use `--unstable` flag when running locally
- Deno Deploy has KV enabled by default

**Error: "WASM module failed to load"**

- Verify bundle size is <50MB
- Check import paths in server.ts

**Error: "Exceeded CPU time limit"**

- Enable Flash Attention v2 for faster inference
- Reduce sequence length or batch size

**Error: "Permission denied"**

- Add required permissions: `--allow-net --allow-read --unstable`

## Resources

- [Deno Deploy Docs](https://deno.com/deploy/docs)
- [Deno KV Guide](https://deno.com/kv)
- [AgentDB Documentation](../../README.md)
- [ADR-071: WASM Capabilities](../../../docs/adr/ADR-071-agentdb-ruvector-wasm-capabilities-review.md)

## Example Client

```typescript
// deno-client.ts
const API_URL = "https://agentdb-demo.deno.dev";

async function storeMemory(key: string, content: string) {
  const res = await fetch(`${API_URL}/store`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, content }),
  });
  return res.json();
}

async function searchMemories(query: string, useFlashV2 = true) {
  const res = await fetch(
    `${API_URL}/search?q=${encodeURIComponent(query)}&flash=${useFlashV2}`,
  );
  return res.json();
}

// Usage
await storeMemory("ai-tip", "Use Flash Attention v2 for 3x faster inference");
const results = await searchMemories("faster inference", true);
console.log(results);
```
