/**
 * Cloudflare Workers Example for AgentDB
 * ADR-071 Phase 4: Browser Deployment
 *
 * Demonstrates:
 * - AgentDB with WASM graph-transformer
 * - Flash Attention v2 for embeddings
 * - Edge-optimized vector search
 * - Durable Objects for persistence
 *
 * Deploy: wrangler deploy
 */

import { AgentDB } from '../../dist/workers/agentdb.workers.js';

export interface Env {
  // Durable Object binding
  AGENTDB: DurableObjectNamespace;
  // KV for caching
  CACHE: KVNamespace;
}

/**
 * Main Worker - handles HTTP requests
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '3.0.0-alpha.4' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get Durable Object instance
    const id = env.AGENTDB.idFromName('default');
    const stub = env.AGENTDB.get(id);

    // Route to Durable Object
    return stub.fetch(request);
  },
};

/**
 * AgentDB Durable Object - provides persistent vector storage
 */
export class AgentDBDurableObject {
  private db: AgentDB | null = null;
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  /**
   * Initialize AgentDB with WASM backend
   */
  private async initDB(): Promise<AgentDB> {
    if (this.db) {
      return this.db;
    }

    // Initialize AgentDB with WASM graph-transformer and attention
    this.db = new AgentDB({
      backend: 'wasm', // Use WASM for Cloudflare Workers
      storage: this.state.storage, // Use Durable Object storage
      features: {
        graphTransformer: true,
        flashAttentionV2: true,
        hnswIndex: true,
      },
    });

    await this.db.initialize();
    return this.db;
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const db = await this.initDB();

    try {
      // POST /store - Store a memory
      if (url.pathname === '/store' && request.method === 'POST') {
        const body = await request.json();
        const { key, content, metadata } = body;

        const result = await db.store({
          key,
          content,
          metadata,
          timestamp: Date.now(),
        });

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /search?q=query&limit=10 - Vector search
      if (url.pathname === '/search' && request.method === 'GET') {
        const query = url.searchParams.get('q');
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);

        if (!query) {
          return new Response('Missing query parameter', { status: 400 });
        }

        const results = await db.search({
          query,
          limit,
          useFlashAttention: true, // Use Flash Attention v2 for embeddings
        });

        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /retrieve/:key - Retrieve a memory
      if (url.pathname.startsWith('/retrieve/')) {
        const key = url.pathname.split('/')[2];
        const result = await db.retrieve(key);

        if (!result) {
          return new Response('Not found', { status: 404 });
        }

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /stats - Database statistics
      if (url.pathname === '/stats' && request.method === 'GET') {
        const stats = await db.getStats();
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
