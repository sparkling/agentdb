# WASM Integration Strategy - WASM Examples Browser

## Integration Overview

This document outlines the strategy for integrating the existing standalone HTML WASM examples into the React application while maintaining performance, isolation, and user experience.

## Current State Analysis

### Existing HTML Examples
- **Location**: `/agentdb/examples/browser/`
- **Structure**: Self-contained HTML files with inline JavaScript and CSS
- **WASM Usage**: Simulated AgentDB backend (ready for real WASM integration)
- **Features**: LocalStorage persistence, export/import, visual learning feedback

### Challenges
1. Examples are standalone HTML, not React components
2. Each has inline styles (gradient: #667eea to #764ba2)
3. JavaScript is embedded in `<script type="module">` tags
4. WASM backend currently simulated, not actual AgentDB WASM
5. No build process for examples

---

## Integration Approaches

### Approach A: iframe Embedding (Recommended MVP)

**Pros:**
- ✅ Fast implementation (1-2 days)
- ✅ Complete isolation (no style conflicts)
- ✅ Examples work exactly as designed
- ✅ No refactoring needed
- ✅ Sandboxed security

**Cons:**
- ❌ Less integrated UX
- ❌ Communication requires postMessage
- ❌ Harder to theme consistently
- ❌ Limited accessibility (screen readers)

**Implementation:**

```typescript
// /src/components/wasm/ExampleIframe.tsx

import { useState, useEffect, useRef } from 'react';
import { WasmExample } from '@/types/wasm-examples';

interface ExampleIframeProps {
  example: WasmExample;
  onMetricsUpdate?: (metrics: any) => void;
}

export const ExampleIframe = ({ example, onMetricsUpdate }: ExampleIframeProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin for security
      if (event.origin !== window.location.origin) return;

      // Handle different message types
      if (event.data.type === 'METRICS_UPDATE') {
        onMetricsUpdate?.(event.data.metrics);
      }

      if (event.data.type === 'EXAMPLE_LOADED') {
        setLoading(false);
      }

      if (event.data.type === 'EXAMPLE_ERROR') {
        setError(event.data.error);
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onMetricsUpdate]);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel rounded-lg z-10">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-cyan border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-muted-foreground">Loading {example.title}...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel rounded-lg z-10">
          <div className="text-center max-w-md p-6">
            <p className="text-red-500 mb-2">Failed to load example</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={example.htmlPath}
        className="w-full h-[600px] md:h-[700px] lg:h-[800px] rounded-lg border border-line bg-background"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        allow="clipboard-write"
        loading="lazy"
        title={example.title}
        onLoad={() => {
          // Send initialization message
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'INIT', theme: 'dark' },
            window.location.origin
          );
        }}
      />
    </div>
  );
};
```

**Enhance HTML Examples for Communication:**

Add to each example's HTML:

```html
<script type="module">
  // Communication with parent window
  function sendMessage(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, window.location.origin);
    }
  }

  // Notify parent when loaded
  window.addEventListener('load', () => {
    sendMessage('EXAMPLE_LOADED', { id: 'rag-self-learning' });
  });

  // Send metrics updates
  function updateMetrics(metrics) {
    sendMessage('METRICS_UPDATE', { metrics });
  }

  // Listen for messages from parent
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data.type === 'INIT') {
      // Apply theme from parent
      applyTheme(event.data.theme);
    }

    if (event.data.type === 'EXPORT_DATA') {
      // Send data to parent
      const data = exportData();
      sendMessage('DATA_EXPORT', { data });
    }
  });

  // Error handling
  window.addEventListener('error', (event) => {
    sendMessage('EXAMPLE_ERROR', {
      error: event.message,
      source: event.filename,
      line: event.lineno
    });
  });
</script>
```

---

### Approach B: React Component Conversion

**Pros:**
- ✅ Full React integration
- ✅ Consistent theming
- ✅ Better accessibility
- ✅ Type safety
- ✅ Code sharing/reuse

**Cons:**
- ❌ Significant refactoring (1-2 weeks)
- ❌ Need to port all JavaScript
- ❌ CSS conflicts to resolve
- ❌ Testing overhead

**Implementation** (Example for RAG):

```typescript
// /src/components/wasm/examples/RagExample.tsx

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWasmDB } from '@/hooks/use-wasm-db';

export const RagExample = () => {
  const db = useWasmDB();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [documents, setDocuments] = useState([]);

  // Initialize database
  useEffect(() => {
    async function init() {
      await db.initialize();
      loadDocuments();
    }
    init();
  }, []);

  const loadDocuments = async () => {
    // Load from localStorage
    const saved = localStorage.getItem('rag-documents');
    if (saved) {
      const docs = JSON.parse(saved);
      setDocuments(docs);
      // Insert into WASM DB
      for (const doc of docs) {
        await db.insert({
          embedding: generateEmbedding(doc.content),
          metadata: doc
        });
      }
    }
  };

  const handleSearch = async () => {
    const queryEmbedding = generateEmbedding(query);
    const results = await db.search(queryEmbedding, 5, 'cosine', 0.7);
    setResults(results);
  };

  // ... rest of component
};
```

**Not Recommended for MVP** - Too time-consuming

---

### Approach C: Hybrid (Recommended Long-Term)

**Strategy:**
1. **Phase 1 (MVP)**: Use iframe embedding for all examples
2. **Phase 2 (Post-launch)**: Convert 2-3 popular examples to React
3. **Phase 3 (Future)**: Gradual migration of remaining examples

**Benefits:**
- Fast MVP delivery
- Progressive enhancement
- Validate user demand before investing
- Parallel work possible

---

## Real AgentDB WASM Integration

### Current State: Simulated Backend

All examples currently use simulated AgentDB:

```javascript
// From rag/index.html
async function initDB() {
    // In a real implementation, import AgentDB WASM
    // For this demo, we'll simulate the behavior
    console.log('Initializing AgentDB WASM backend...');

    db = {
        documents: [],
        async addDocument(doc) { /* ... */ },
        async search(query, k) { /* ... */ }
    };
}
```

### Real WASM Integration

**Option 1: Update HTML Examples**

Add real AgentDB WASM to each example:

```html
<script type="module">
  // Import real AgentDB
  import { createVectorDB } from '/node_modules/agentdb/dist/index.mjs';

  let db;

  async function initDB() {
    console.log('Initializing AgentDB WASM backend...');

    try {
      // Create real WASM database
      db = await createVectorDB({
        memoryMode: true  // Browser in-memory mode
      });

      // Load persisted data
      const saved = localStorage.getItem('agentdb-export');
      if (saved) {
        const data = JSON.parse(saved);
        await db.importAsync(new Uint8Array(data));
      }

      console.log('AgentDB initialized successfully');
    } catch (error) {
      console.error('Failed to initialize AgentDB:', error);
      // Fallback to simulated backend
      db = createSimulatedDB();
    }
  }

  // Vector operations
  async function addDocument(doc) {
    const embedding = await generateEmbedding(doc.content);
    const id = db.insert({
      embedding,
      metadata: { title: doc.title, content: doc.content }
    });
    return id;
  }

  async function searchDocuments(query, topK = 5) {
    const queryEmbedding = await generateEmbedding(query);
    const results = db.search(
      queryEmbedding,
      topK,
      'cosine',    // similarity metric
      0.7          // minimum threshold
    );
    return results;
  }

  // Export for persistence
  function exportDB() {
    const data = db.export();
    localStorage.setItem('agentdb-export', JSON.stringify(Array.from(data)));
  }

  // Auto-export on page unload
  window.addEventListener('beforeunload', exportDB);
</script>
```

**Option 2: React Components with AgentDB**

For React-converted examples:

```typescript
// /src/hooks/use-wasm-db.ts

import { useState, useEffect } from 'react';
import { createVectorDB } from 'agentdb';

export function useWasmDB() {
  const [db, setDb] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function initDB() {
      try {
        const database = await createVectorDB({
          memoryMode: true
        });

        // Load persisted data
        const saved = localStorage.getItem('agentdb-export');
        if (saved) {
          const data = JSON.parse(saved);
          await database.importAsync(new Uint8Array(data));
        }

        setDb(database);
        setLoading(false);
      } catch (err) {
        console.error('Failed to initialize WASM DB:', err);
        setError(err as Error);
        setLoading(false);
      }
    }

    initDB();

    // Cleanup and export on unmount
    return () => {
      if (db) {
        const data = db.export();
        localStorage.setItem('agentdb-export', JSON.stringify(Array.from(data)));
      }
    };
  }, []);

  return { db, loading, error };
}
```

---

## Embedding Generation

### Current: Simulated Embeddings

```javascript
// Simple hash-based embeddings (demo only)
function generateEmbedding(text) {
    const embedding = new Array(384).fill(0);
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        embedding[i % 384] += charCode;
    }
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
}
```

### Production: Real Embeddings

**Option A: Client-Side with Transformers.js**

```javascript
import { pipeline } from '@xenova/transformers';

let embedder;

async function initEmbedder() {
  // Load model (cached after first load)
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
}

async function generateEmbedding(text) {
  if (!embedder) await initEmbedder();

  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
```

**Option B: API-Based (OpenAI, Cohere)**

```javascript
async function generateEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text
    })
  });

  const data = await response.json();
  return data.data[0].embedding;
}
```

**Recommendation for MVP**: Keep simulated embeddings
**Recommendation for Production**: Transformers.js (client-side, no API costs)

---

## Performance Optimization

### WASM Loading Strategy

```typescript
// Lazy load WASM only when example is viewed
const loadWasmExample = async (exampleId: string) => {
  // Code splitting for WASM modules
  const module = await import(
    /* webpackChunkName: "wasm-[request]" */
    /* webpackMode: "lazy" */
    `@/wasm-examples/${exampleId}/module.wasm`
  );

  return module;
};
```

### Service Worker Caching

```javascript
// /public/sw.js

const CACHE_NAME = 'agentdb-wasm-v1';
const WASM_RESOURCES = [
  '/agentdb/examples/browser/rag/index.html',
  '/agentdb/examples/browser/pattern-learning/index.html',
  // ... all examples
  '/node_modules/agentdb/dist/wasm-loader.js',
  '/node_modules/sql.js/dist/sql-wasm.wasm'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(WASM_RESOURCES);
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/agentdb/examples/')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});
```

### Memory Management

```typescript
// Monitor WASM memory usage
function trackMemoryUsage() {
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    console.log({
      usedJSHeapSize: `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      totalJSHeapSize: `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      jsHeapSizeLimit: `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB`
    });
  }
}

// Cleanup on unmount
useEffect(() => {
  return () => {
    // Free WASM memory
    if (db) {
      db.close?.();
    }
  };
}, []);
```

---

## Security Considerations

### iframe Sandbox Attributes

```html
<iframe
  src={example.htmlPath}
  sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
  allow="clipboard-write"
  loading="lazy"
/>
```

**Sandbox Flags:**
- `allow-scripts` - Required for JavaScript execution
- `allow-same-origin` - Allow LocalStorage access
- `allow-forms` - Allow form submission
- `allow-modals` - Allow alert/confirm dialogs

**NOT Included:**
- `allow-popups` - Prevent unwanted popups
- `allow-top-navigation` - Prevent navigation hijacking
- `allow-downloads` - Prevent auto-downloads

### Content Security Policy

```html
<!-- Add to index.html -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' 'unsafe-eval';
               style-src 'self' 'unsafe-inline';
               worker-src 'self' blob:;
               connect-src 'self' https://api.openai.com https://api.cohere.ai;
               img-src 'self' data: blob:;
               font-src 'self' data:;
               frame-src 'self';" />
```

### WASM Security

```typescript
// Validate WASM module signatures (future)
async function loadVerifiedWasm(url: string) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  // Verify signature
  const valid = await verifyWasmSignature(buffer);
  if (!valid) {
    throw new Error('Invalid WASM module signature');
  }

  return WebAssembly.compile(buffer);
}
```

---

## Browser Compatibility

### Feature Detection

```typescript
// /src/lib/wasm-helpers.ts

export function checkWasmSupport(): boolean {
  try {
    if (typeof WebAssembly === 'object' &&
        typeof WebAssembly.instantiate === 'function') {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
      );
      return module instanceof WebAssembly.Module;
    }
  } catch (e) {
    return false;
  }
  return false;
}

export function checkRequiredFeatures() {
  return {
    wasm: checkWasmSupport(),
    localStorage: typeof localStorage !== 'undefined',
    workers: typeof Worker !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined'
  };
}

// Usage
const features = checkRequiredFeatures();
if (!features.wasm) {
  console.warn('WebAssembly not supported - falling back to simulated backend');
}
```

### Polyfills

```typescript
// /src/lib/polyfills.ts

// LocalStorage polyfill for browsers without support
if (typeof localStorage === 'undefined') {
  (window as any).localStorage = {
    _data: {} as Record<string, string>,
    setItem(key: string, value: string) {
      this._data[key] = String(value);
    },
    getItem(key: string) {
      return this._data[key] || null;
    },
    removeItem(key: string) {
      delete this._data[key];
    },
    clear() {
      this._data = {};
    }
  };
}
```

---

## Testing Strategy

### WASM Integration Tests

```typescript
// /src/__tests__/wasm-integration.test.ts

import { createVectorDB } from 'agentdb';

describe('WASM Integration', () => {
  let db: any;

  beforeEach(async () => {
    db = await createVectorDB({ memoryMode: true });
  });

  afterEach(() => {
    db?.close();
  });

  test('initializes WASM database', async () => {
    expect(db).toBeDefined();
  });

  test('inserts and searches vectors', async () => {
    const embedding = new Array(384).fill(0).map(() => Math.random());

    const id = db.insert({
      embedding,
      metadata: { test: 'data' }
    });

    expect(id).toBeGreaterThan(0);

    const results = db.search(embedding, 1, 'cosine', 0.9);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.test).toBe('data');
  });

  test('exports and imports data', async () => {
    db.insert({
      embedding: new Array(384).fill(0.5),
      metadata: { id: 1 }
    });

    const exported = db.export();
    expect(exported).toBeInstanceOf(Uint8Array);

    const db2 = await createVectorDB({ memoryMode: true });
    await db2.importAsync(exported);

    const results = db2.search(new Array(384).fill(0.5), 1, 'cosine', 0.9);
    expect(results[0].metadata.id).toBe(1);
  });
});
```

---

## Migration Path

### Phase 1: MVP (Week 1-2)
- ✅ iframe embedding for all examples
- ✅ Keep simulated WASM backends
- ✅ Basic postMessage communication
- ✅ Loading/error states

### Phase 2: Real WASM (Week 3-4)
- ✅ Integrate real AgentDB WASM
- ✅ Add Transformers.js embeddings
- ✅ Service worker caching
- ✅ Performance monitoring

### Phase 3: React Conversion (Month 2-3)
- ✅ Convert 2-3 popular examples
- ✅ Shared component library
- ✅ Improved accessibility
- ✅ Enhanced theming

---

**Recommendation**: Start with Approach A (iframe) + simulated WASM for MVP, then progressively enhance.

**Next**: See `05-IMPLEMENTATION-STEPS.md` for step-by-step implementation guide
