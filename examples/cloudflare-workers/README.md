# AgentDB on Cloudflare Workers

Deploy AgentDB with WASM backend to Cloudflare Workers for edge-native vector search.

## Features

- **WASM Graph Transformer**: Uses `ruvector-graph-transformer-wasm` for graph operations
- **Flash Attention v2**: Optimized embeddings with 2.49x-7.47x speedup
- **Durable Objects**: Persistent vector storage at the edge
- **Global Distribution**: Deploy to 300+ Cloudflare edge locations
- **Sub-10ms Latency**: Fast vector search with HNSW indexing

## Setup

### 1. Install Dependencies

```bash
npm install wrangler -g
npm install
```

### 2. Configure Wrangler

```bash
# Login to Cloudflare
wrangler login

# Create KV namespace (optional, for caching)
wrangler kv:namespace create CACHE
# Update wrangler.toml with the KV namespace ID
```

### 3. Build AgentDB for Edge Deployment

```bash
cd ../..
npm run build:edge
# This creates: dist/workers/agentdb.workers.js, dist/browser/, dist/deno/
```

### 4. Deploy

```bash
wrangler deploy
```

## Usage

### Store a Memory

```bash
curl -X POST https://agentdb-worker.your-subdomain.workers.dev/store \
  -H "Content-Type: application/json" \
  -d '{
    "key": "auth-pattern",
    "content": "Use JWT with refresh tokens for authentication",
    "metadata": {
      "category": "security",
      "language": "typescript"
    }
  }'
```

### Search Memories

```bash
curl "https://agentdb-worker.your-subdomain.workers.dev/search?q=authentication&limit=5"
```

### Retrieve a Memory

```bash
curl https://agentdb-worker.your-subdomain.workers.dev/retrieve/auth-pattern
```

### Get Statistics

```bash
curl https://agentdb-worker.your-subdomain.workers.dev/stats
```

## Performance

- **Cold Start**: ~50-100ms (includes WASM initialization)
- **Warm Requests**: <10ms for vector search
- **Flash Attention v2**: 2.49x-7.47x faster than naive attention
- **WASM Overhead**: ~15-20% vs NAPI, but still faster than JS fallback

## Architecture

```
┌─────────────────────────────────────────┐
│ Cloudflare Workers (V8 Runtime)         │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ AgentDB Durable Object            │  │
│  │                                   │  │
│  │  • WASM Graph Transformer         │  │
│  │  • Flash Attention v2             │  │
│  │  • HNSW Vector Index              │  │
│  │  • RVF Storage                    │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ Durable Object Storage            │  │
│  │  • Persistent state               │  │
│  │  • Transactional writes           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Cost Estimation

**Free Tier:**

- 100,000 requests/day
- 10ms CPU time per request
- 128MB memory per Durable Object

**Paid Tier:**

- $0.50 per million requests
- $12.50 per million CPU ms
- Durable Objects: $0.15 per million reads/writes

Example: 1M searches/month ≈ $2-5/month

## Limitations

- **CPU Time**: 50ms limit per request (Durable Objects get 50s)
- **Memory**: 128MB per isolate
- **WASM Size**: Bundle should be <25MB
- **No File System**: Use Durable Object storage instead of SQLite

## Optimization Tips

1. **Enable WASM SIMD**: Set `wasm-simd` flag in wrangler.toml
2. **Cache Embeddings**: Use KV namespace for frequently accessed vectors
3. **Batch Operations**: Combine multiple searches in single request
4. **Use Flash Attention v2**: 2.49x-7.47x faster than standard attention

## Troubleshooting

**Error: "Exceeded CPU time limit"**

- Reduce batch size or sequence length
- Enable Flash Attention v2 for faster inference

**Error: "WASM module failed to load"**

- Verify bundle size is <25MB
- Check wrangler.toml build configuration

**Error: "Durable Object not found"**

- Run migration: `wrangler publish --new-class AgentDBDurableObject`

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [AgentDB Documentation](../../README.md)
- [ADR-071: WASM Capabilities](../../../docs/adr/ADR-071-agentdb-ruvector-wasm-capabilities-review.md)
