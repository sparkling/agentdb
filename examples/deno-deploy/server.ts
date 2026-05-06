/**
 * Deno Deploy Example for AgentDB
 * ADR-071 Phase 4: Browser Deployment
 *
 * Demonstrates:
 * - AgentDB with WASM graph-transformer in Deno
 * - Flash Attention v2 for embeddings
 * - Deno KV for persistence
 * - Edge-optimized vector search
 *
 * Deploy: deployctl deploy --project=your-project server.ts
 */

/// <reference lib="deno.unstable" />

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { AgentDB } from '../../dist/deno/agentdb.deno.js';

/**
 * Initialize AgentDB with Deno KV backend
 */
async function initDB(): Promise<AgentDB> {
  const kv = await Deno.openKv();

  const db = new AgentDB({
    backend: 'wasm', // Use WASM for Deno Deploy
    storage: {
      type: 'deno-kv',
      kv, // Pass Deno KV instance
    },
    features: {
      graphTransformer: true,
      flashAttentionV2: true,
      hnswIndex: true,
    },
  });

  await db.initialize();
  return db;
}

// Global DB instance (cached across requests)
let dbInstance: AgentDB | null = null;

async function getDB(): Promise<AgentDB> {
  if (!dbInstance) {
    dbInstance = await initDB();
  }
  return dbInstance;
}

/**
 * HTTP request handler
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  if (url.pathname === '/health') {
    return new Response(
      JSON.stringify({
        status: 'ok',
        version: '3.0.0-alpha.4',
        runtime: 'deno',
        denoVersion: Deno.version.deno,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const db = await getDB();

  try {
    // POST /store - Store a memory
    if (url.pathname === '/store' && req.method === 'POST') {
      const body = await req.json();
      const { key, content, metadata } = body;

      const result = await db.store({
        key,
        content,
        metadata,
        timestamp: Date.now(),
      });

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /search?q=query&limit=10 - Vector search
    if (url.pathname === '/search' && req.method === 'GET') {
      const query = url.searchParams.get('q');
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const useFlashV2 = url.searchParams.get('flash') === 'true';

      if (!query) {
        return new Response('Missing query parameter', {
          status: 400,
          headers: corsHeaders,
        });
      }

      const startTime = performance.now();
      const results = await db.search({
        query,
        limit,
        useFlashAttention: useFlashV2,
      });
      const duration = performance.now() - startTime;

      return new Response(
        JSON.stringify({
          results,
          metadata: {
            durationMs: duration,
            usedFlashAttentionV2: useFlashV2,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // GET /retrieve/:key - Retrieve a memory
    if (url.pathname.startsWith('/retrieve/')) {
      const key = url.pathname.split('/')[2];
      const result = await db.retrieve(key);

      if (!result) {
        return new Response('Not found', {
          status: 404,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // DELETE /delete/:key - Delete a memory
    if (url.pathname.startsWith('/delete/') && req.method === 'DELETE') {
      const key = url.pathname.split('/')[2];
      await db.delete(key);

      return new Response(JSON.stringify({ deleted: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /stats - Database statistics
    if (url.pathname === '/stats' && req.method === 'GET') {
      const stats = await db.getStats();
      return new Response(JSON.stringify(stats), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /benchmark - Run Flash Attention v2 benchmark
    if (url.pathname === '/benchmark' && req.method === 'GET') {
      const seqLen = parseInt(url.searchParams.get('seqLen') || '256', 10);

      // Generate test data
      const testEmbeddings = Array.from({ length: seqLen }, () =>
        Array.from({ length: 768 }, () => Math.random())
      );

      // Benchmark Flash Attention v2
      const flashStart = performance.now();
      await db.embedWithAttention(testEmbeddings, { useFlashV2: true });
      const flashDuration = performance.now() - flashStart;

      // Benchmark baseline
      const baselineStart = performance.now();
      await db.embedWithAttention(testEmbeddings, { useFlashV2: false });
      const baselineDuration = performance.now() - baselineStart;

      const speedup = baselineDuration / flashDuration;

      return new Response(
        JSON.stringify({
          seqLen,
          flashV2TimeMs: flashDuration,
          baselineTimeMs: baselineDuration,
          speedup,
          targetRange: '2.49x-7.47x',
          passedTarget: speedup >= 2.49,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response('Not found', {
      status: 404,
      headers: corsHeaders,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error:', errorMessage);

    return new Response(
      JSON.stringify({
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

// Start server
console.log('🦕 AgentDB Deno Deploy Server');
console.log('📦 WASM Graph Transformer + Flash Attention v2');
console.log('🚀 Starting server...\n');

serve(handler, {
  onListen: ({ hostname, port }) => {
    console.log(`✅ Server running on http://${hostname}:${port}`);
  },
});
