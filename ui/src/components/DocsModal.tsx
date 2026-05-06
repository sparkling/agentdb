import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  BookOpen, 
  Terminal, 
  Database, 
  Zap, 
  Code, 
  Settings, 
  Lightbulb, 
  AlertCircle,
  ChevronRight,
  Copy,
  ExternalLink,
  Menu,
  X
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FrontierMemoryDocs } from '@/components/FrontierMemoryDocs';

interface DocsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DocSection =
  | 'introduction'
  | 'installation'
  | 'quick-start'
  | 'api-reference'
  | 'learning-plugins'
  | 'quantization'
  | 'mcp-tools'
  | 'reasoning-bank'
  | 'frontier-memory'
  | 'hnsw-index'
  | 'advanced-features'
  | 'examples'
  | 'configuration'
  | 'best-practices'
  | 'troubleshooting';

const customStyles = `
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .docs-content h3 {
    color: hsl(var(--foreground));
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }
  .docs-content h4 {
    color: hsl(var(--foreground));
    font-size: 1.1rem;
    font-weight: 600;
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
  }
  .docs-content p {
    margin-bottom: 1rem;
    line-height: 1.6;
  }
  .docs-content ul {
    list-style: disc;
    margin-left: 1.5rem;
    margin-bottom: 1rem;
  }
  .docs-content li {
    margin-bottom: 0.5rem;
  }
`;

export const DocsModal = ({ open, onOpenChange }: DocsModalProps) => {
  const [activeSection, setActiveSection] = useState<DocSection>('introduction');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeSection]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Code copied successfully",
    });
  };

  const sections = [
    { id: 'introduction' as DocSection, label: 'Introduction', icon: BookOpen },
    { id: 'installation' as DocSection, label: 'Installation', icon: Terminal },
    { id: 'quick-start' as DocSection, label: 'Quick Start', icon: Zap },
    { id: 'api-reference' as DocSection, label: 'API Reference', icon: Code },
    { id: 'learning-plugins' as DocSection, label: 'Learning Plugins', icon: Zap },
    { id: 'quantization' as DocSection, label: 'Quantization', icon: Zap },
    { id: 'mcp-tools' as DocSection, label: 'MCP Tools', icon: Settings },
    { id: 'reasoning-bank' as DocSection, label: 'ReasoningBank', icon: Database },
    { id: 'frontier-memory' as DocSection, label: 'Frontier Memory', icon: Zap },
    { id: 'hnsw-index' as DocSection, label: 'HNSW Index', icon: Zap },
    { id: 'advanced-features' as DocSection, label: 'Advanced Features', icon: Settings },
    { id: 'examples' as DocSection, label: 'Examples', icon: Lightbulb },
    { id: 'configuration' as DocSection, label: 'Configuration', icon: Settings },
    { id: 'best-practices' as DocSection, label: 'Best Practices', icon: Lightbulb },
    { id: 'troubleshooting' as DocSection, label: 'Troubleshooting', icon: AlertCircle },
  ];

  const CodeBlock = ({ code, language = 'typescript' }: { code: string; language?: string }) => (
    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm my-4 relative group">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => copyToClipboard(code)}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Copy className="h-4 w-4" />
      </Button>
      <pre className="text-cyan overflow-x-auto">{code}</pre>
    </div>
  );

  return (
    <>
      <style>{customStyles}</style>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl h-[85vh] p-0 overflow-hidden bg-background border-border">
          <div className="flex h-full overflow-hidden">
            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden absolute top-4 left-4 z-50"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>

            {/* Sidebar */}
            <aside 
              className={`
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                md:translate-x-0 transition-transform duration-200 ease-in-out
                fixed md:static inset-y-0 left-0 z-40
                w-64 border-r border-border bg-panel p-6 flex-shrink-0 overflow-y-auto
              `}
            >
              <DialogHeader className="mb-6">
                <DialogTitle className="text-2xl font-bold text-cyan">
                  Documentation
                </DialogTitle>
              </DialogHeader>

              <nav className="space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  
                  return (
                    <button
                      key={section.id}
                      onClick={() => {
                        setActiveSection(section.id);
                        setSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${
                        isActive
                          ? 'bg-cyan/10 border border-cyan/30 text-cyan'
                          : 'hover:bg-background/50 text-foreground border border-transparent'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isActive ? 'text-cyan' : 'text-muted-foreground'}`} />
                      <span className="font-medium">{section.label}</span>
                      {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                    </button>
                  );
                })}
              </nav>

              <div className="mt-8 pt-6 border-t border-border">
                <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                  Quick Links
                </h4>
                <div className="space-y-2">
                  <a
                    href="https://github.com/ruvnet/agentic-flow"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-foreground hover:text-cyan transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    GitHub Repository
                  </a>
                  <a
                    href="https://www.npmjs.com/package/agentdb"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-foreground hover:text-cyan transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    NPM Package
                  </a>
                </div>
              </div>
            </aside>

            {/* Overlay for mobile */}
            {sidebarOpen && (
              <div 
                className="md:hidden fixed inset-0 bg-background/80 z-30"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Content */}
            <main ref={contentRef} className="flex-1 overflow-y-auto p-6 md:p-12 pt-16 md:pt-8">
              <div className="max-w-4xl docs-content">
                {activeSection === 'introduction' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Introduction to AgentDB
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      A sub-millisecond memory engine built for autonomous agents with instant memory, local learning, and global coordination.
                    </p>

                    <Card className="bg-cyan/10 border-cyan/30 mb-6">
                      <CardContent className="p-6">
                        <h3 className="text-xl font-semibold text-foreground mb-3">
                          What is AgentDB?
                        </h3>
                        <p className="text-foreground leading-relaxed">
                          AgentDB is an ultra-fast agent memory and vector database designed specifically for AI agents.
                          It provides blazing-fast vector search, persistent reasoning patterns, and works seamlessly in both
                          Node.js and browser environments with WASM support.
                        </p>
                      </CardContent>
                    </Card>

                    <h3>Key Features</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Zap className="h-5 w-5 text-cyan" />
                            Lightning Fast
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            Sub-millisecond query times with HNSW indexing. 12x faster search with 97% recall accuracy.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Database className="h-5 w-5 text-cyan" />
                            ReasoningBank
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            Built-in memory and learning system with pattern matching, experience curation, and memory optimization.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Code className="h-5 w-5 text-cyan" />
                            Universal Support
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            Works in Node.js and browsers with WASM. Same API, same performance everywhere.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Settings className="h-5 w-5 text-cyan" />
                            MCP Integration
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            29 Model Context Protocol tools (5 core vector + 5 core agentdb + 9 frontier memory + 10 learning) for seamless AI agent integration, memory management, and adaptive learning with Claude Code.
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <h3>Use Cases</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>🤖 Autonomous AI agents with long-term memory</li>
                      <li>💬 Conversational AI with context retention</li>
                      <li>🔍 Semantic search and recommendation systems</li>
                      <li>📊 Knowledge base management</li>
                      <li>🧠 Pattern recognition and learning systems</li>
                    </ul>
                  </div>
                )}

                {activeSection === 'installation' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Installation
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Get started with AgentDB in your project using npm, yarn, or npx.
                    </p>

                    <h3>Installation & Setup</h3>
                     <p className="text-muted-foreground">
                       AgentDB v1.3.9 supports both Node.js and browser environments with the same powerful API.
                     </p>

                     <h3>NPM Installation (Node.js)</h3>
                     <p className="text-muted-foreground">
                       Install AgentDB as a dependency in your Node.js project:
                     </p>
                     <CodeBlock code="npm install agentdb" />

                     <h3>Browser Installation (CDN)</h3>
                     <p className="text-muted-foreground mb-2">
                       Use AgentDB directly in the browser via CDN (no build step required):
                     </p>
                     <CodeBlock code={`<!-- AgentDB v1.3.9 - Browser Bundle -->
<script src="https://unpkg.com/agentdb@1.3.9/dist/agentdb.min.js"></script>
<script>
  // AgentDB is now available globally
  AgentDB.onReady(() => {
    console.log('AgentDB v' + AgentDB.version + ' ready!');
    // Start using the database
  });
</script>`} />

                     <Card className="bg-cyan/10 border-cyan/30 mb-6">
                       <CardContent className="p-6">
                         <h4 className="text-lg font-semibold text-foreground mb-2">
                           ⚡ Browser Bundle Features
                         </h4>
                         <ul className="space-y-1 text-sm text-foreground">
                           <li>• <strong>WASM-powered</strong> SQLite database (89KB bundle)</li>
                           <li>• <strong>Zero dependencies</strong> - just one script tag</li>
                           <li>• <strong>Backward compatible</strong> with v1.0.7 API</li>
                           <li>• <strong>5 pre-built tables</strong> (vectors, patterns, episodes, causal_edges, skills)</li>
                           <li>• <strong>Full SQL support</strong> with async initialization</li>
                         </ul>
                       </CardContent>
                     </Card>

                     <h3>Browser Usage Example</h3>
                     <p className="text-muted-foreground mb-2">
                       Complete HTML example using AgentDB in the browser:
                     </p>
                     <CodeBlock code={`<!DOCTYPE html>
<html>
<head>
  <title>AgentDB Browser Demo</title>
  <script src="https://unpkg.com/agentdb@1.3.9/dist/agentdb.min.js"></script>
</head>
<body>
  <h1>AgentDB Browser Example</h1>
  <div id="output"></div>
  
  <script>
    AgentDB.onReady(async () => {
      // Create and initialize database
      const db = new AgentDB.Database();
      await db.initializeAsync();
      
      // Insert some patterns
      db.insert('patterns', {
        pattern: 'causal-reasoning',
        metadata: JSON.stringify({ domain: 'logic', quality: 'high' })
      });
      
      db.insert('patterns', {
        pattern: 'optimization',
        metadata: JSON.stringify({ domain: 'ml', quality: 'medium' })
      });
      
      // Query data
      const results = db.exec('SELECT * FROM patterns');
      
      // Display results
      const output = document.getElementById('output');
      if (results.length > 0) {
        const { columns, values } = results[0];
        output.innerHTML = '<h2>Stored Patterns:</h2>';
        values.forEach(row => {
          const obj = {};
          columns.forEach((col, i) => obj[col] = row[i]);
          output.innerHTML += \`<pre>\${JSON.stringify(obj, null, 2)}</pre>\`;
        });
      }
      
      // Export database
      const data = db.export();
      console.log('Database size:', data.length, 'bytes');
      
      // Save to localStorage
      localStorage.setItem('agentdb', 
        btoa(String.fromCharCode(...data))
      );
    });
  </script>
</body>
</html>`} />

                     <h3>Yarn Installation</h3>
                     <p className="text-muted-foreground">
                       Or use Yarn if you prefer:
                     </p>
                     <CodeBlock code="yarn add agentdb" />

                     <h3>Quick Start with NPX</h3>
                     <p className="text-muted-foreground">
                       Try AgentDB instantly without installation:
                     </p>
                     <CodeBlock code="npx agentdb" />

                    <Card className="bg-panel border-border mt-6">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <AlertCircle className="h-5 w-5 text-cyan" />
                          Requirements
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li>• Node.js 16.0.0 or higher</li>
                          <li>• npm 7.0.0 or higher (or equivalent yarn/pnpm version)</li>
                          <li>• For WASM support: Modern browser with WebAssembly enabled</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Browser Usage</h3>
                    <p className="text-muted-foreground">
                      AgentDB can be used directly in the browser via WASM (optimized 89KB bundle):
                    </p>
                    <CodeBlock code={`<script type="module">
  import { SQLiteVectorDB } from 'https://unpkg.com/agentdb@latest/dist/agentdb.min.js';

  const db = new SQLiteVectorDB({ memoryMode: true, backend: 'wasm' });
  await db.initializeAsync();
  // Database ready to use
</script>`} />

                    <Card className="bg-gradient-to-r from-purple-500/10 to-cyan/10 border-purple-500/30 mt-6">
                      <CardContent className="p-6">
                        <h4 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                          <Zap className="h-5 w-5 text-purple-400" />
                          Try the Code Wizard
                        </h4>
                        <p className="text-foreground leading-relaxed mb-3">
                          New to AgentDB? Use our interactive Code Wizard on the <a href="/demo" className="text-cyan hover:underline">Demo page</a> to generate
                          a complete, customized WASM example in 5 easy steps. Configure database settings, quantization,
                          HNSW indexing, and choose from multiple example types with live preview.
                        </p>
                        <ul className="text-sm text-foreground space-y-1">
                          <li>• Interactive 5-step configuration wizard</li>
                          <li>• Live code preview in browser</li>
                          <li>• Copy complete HTML example to clipboard</li>
                          <li>• Multiple example types (RAG, semantic search, learning, clustering)</li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeSection === 'quick-start' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Quick Start Guide
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Get up and running with AgentDB in minutes.
                    </p>

                    <h3>1. Initialize the Database</h3>
                    <CodeBlock code={`import AgentDB from 'agentdb';

// Create an in-memory database
const db = new AgentDB({
  memory: true
});

// Or persist to disk
const persistentDb = new AgentDB({
  path: './data/agent.db'
});`} />

                    <h3>2. Store Vectors</h3>
                    <CodeBlock code={`// Store a vector with metadata
await db.store({
  id: 'user-query-1',
  vector: [0.1, 0.2, 0.3, 0.4, 0.5],
  metadata: {
    type: 'query',
    timestamp: Date.now(),
    content: 'What is AgentDB?'
  }
});`} />

                    <h3>3. Query Similar Vectors</h3>
                    <CodeBlock code={`// Find similar vectors
const results = await db.query({
  vector: [0.1, 0.2, 0.3, 0.4, 0.5],
  k: 5, // Return top 5 results
  threshold: 0.8 // Minimum similarity score
});

results.forEach(result => {
  console.log('ID:', result.id);
  console.log('Score:', result.score);
  console.log('Metadata:', result.metadata);
});`} />

                    <h3>4. Use ReasoningBank</h3>
                    <CodeBlock code={`// Store reasoning patterns
await db.reasoningBank.store({
  pattern: 'problem-solving',
  context: 'User needs help with installation',
  reasoning: 'Check dependencies, verify versions, provide step-by-step guide',
  outcome: 'success',
  confidence: 0.95
});

// Query similar patterns
const patterns = await db.reasoningBank.query({
  context: 'User installation issue',
  k: 3
});`} />

                    <Card className="bg-cyan/10 border-cyan/30 mt-6">
                      <CardContent className="p-6">
                        <h4 className="text-lg font-semibold text-foreground mb-2">
                          🎉 That's it!
                        </h4>
                        <p className="text-foreground">
                          You're now ready to build intelligent agents with AgentDB. Explore the API Reference
                          for more advanced features and configuration options.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeSection === 'api-reference' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      API Reference
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Complete API documentation for AgentDB.
                    </p>

                    <h3>Constructor</h3>
                    <CodeBlock code={`new AgentDB(options: AgentDBOptions)`} />
                    
                    <h4>Options</h4>
                    <div className="bg-panel border border-line rounded-lg p-4 mb-6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line">
                            <th className="text-left py-2 text-foreground">Property</th>
                            <th className="text-left py-2 text-foreground">Type</th>
                            <th className="text-left py-2 text-foreground">Description</th>
                          </tr>
                        </thead>
                        <tbody className="text-muted-foreground">
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">path</code></td>
                            <td className="py-2">string</td>
                            <td className="py-2">Database file path (optional)</td>
                          </tr>
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">memory</code></td>
                            <td className="py-2">boolean</td>
                            <td className="py-2">Use in-memory database</td>
                          </tr>
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">dimensions</code></td>
                            <td className="py-2">number</td>
                            <td className="py-2">Vector dimensions (default: 384)</td>
                          </tr>
                          <tr>
                            <td className="py-2"><code className="text-cyan">maxElements</code></td>
                            <td className="py-2">number</td>
                            <td className="py-2">Maximum vectors (default: 10000)</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <h3>Core Methods</h3>
                    
                    <h4>store()</h4>
                    <p className="text-muted-foreground">Store a vector with metadata.</p>
                    <CodeBlock code={`await db.store({
  id: string,
  vector: number[],
  metadata?: Record<string, any>
})`} />

                    <h4>query()</h4>
                    <p className="text-muted-foreground">Query for similar vectors.</p>
                    <CodeBlock code={`await db.query({
  vector: number[],
  k?: number,
  threshold?: number,
  filter?: Record<string, any>
})`} />

                    <h4>delete()</h4>
                    <p className="text-muted-foreground">Delete a vector by ID.</p>
                    <CodeBlock code={`await db.delete(id: string)`} />

                    <h4>update()</h4>
                    <p className="text-muted-foreground">Update vector metadata.</p>
                    <CodeBlock code={`await db.update(id: string, {
  metadata: Record<string, any>
})`} />

                    <h3>ReasoningBank Methods</h3>
                    
                    <h4>reasoningBank.store()</h4>
                    <CodeBlock code={`await db.reasoningBank.store({
  pattern: string,
  context: string,
  reasoning: string,
  outcome: string,
  confidence?: number
})`} />

                    <h4>reasoningBank.query()</h4>
                    <CodeBlock code={`await db.reasoningBank.query({
  context: string,
  k?: number,
  minConfidence?: number
})`} />
                  </div>
                )}

                {activeSection === 'learning-plugins' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Learning Plugins
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      AgentDB provides 10 advanced learning algorithms as pluggable modules for specialized agent training.
                    </p>

                    <Card className="bg-cyan/10 border-cyan/30 mb-6">
                      <CardContent className="p-6">
                        <h3 className="text-xl font-semibold text-foreground mb-3">
                          Plugin System
                        </h3>
                        <p className="text-foreground leading-relaxed mb-3">
                          Learning plugins extend AgentDB's capabilities with specialized machine learning algorithms.
                          Each plugin implements a specific learning paradigm and can be used independently or combined
                          for hybrid learning approaches.
                        </p>
                        <p className="text-foreground leading-relaxed">
                          All plugins are available in the <code className="text-cyan">agentdb/dist/plugins/implementations/</code> directory
                          and can be imported directly.
                        </p>
                      </CardContent>
                    </Card>

                    <h3>CLI Plugin Creator</h3>
                    <p className="text-muted-foreground mb-2">
                      Create custom learning plugins with an interactive wizard:
                    </p>
                    <CodeBlock code={`npx agentdb create-plugin

# Or using the CLI directly
agentdb create-plugin --name my-plugin --type reinforcement`} />

                    <h3>Available Learning Plugins</h3>

                    <div className="space-y-4 mt-6">
                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Q-Learning (Recommended)</CardTitle>
                          <Badge variant="secondary" className="mt-2">Reinforcement Learning</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Model-free reinforcement learning for action-value estimation.</p>
                          <CodeBlock code={`import { QLearning } from 'agentdb/dist/plugins/implementations/q-learning';

const qlearning = new QLearning({
  learningRate: 0.1,
  discountFactor: 0.95,
  epsilon: 0.1 // Exploration rate
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Discrete action spaces, game AI, navigation</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">SARSA</CardTitle>
                          <Badge variant="secondary" className="mt-2">Reinforcement Learning</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">On-policy temporal difference learning algorithm.</p>
                          <CodeBlock code={`import { SARSA } from 'agentdb/dist/plugins/implementations/sarsa';

const sarsa = new SARSA({
  learningRate: 0.1,
  discountFactor: 0.99
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Real-time decision making, risk-sensitive tasks</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Actor-Critic</CardTitle>
                          <Badge variant="secondary" className="mt-2">Reinforcement Learning</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Policy gradient method combining value and policy optimization.</p>
                          <CodeBlock code={`import { ActorCritic } from 'agentdb/dist/plugins/implementations/actor-critic';

const ac = new ActorCritic({
  actorLearningRate: 0.001,
  criticLearningRate: 0.01
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Continuous control, robotics, complex environments</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Active Learning</CardTitle>
                          <Badge variant="secondary" className="mt-2">Semi-Supervised</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Query strategy for selecting most informative training examples.</p>
                          <CodeBlock code={`import { ActiveLearning } from 'agentdb/dist/plugins/implementations/active-learning';

const al = new ActiveLearning({
  strategy: 'uncertainty', // or 'diversity', 'margin'
  batchSize: 10
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Limited labeled data, human-in-the-loop systems</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Curriculum Learning</CardTitle>
                          <Badge variant="secondary" className="mt-2">Training Strategy</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Progressive training from simple to complex examples.</p>
                          <CodeBlock code={`import { CurriculumLearning } from 'agentdb/dist/plugins/implementations/curriculum-learning';

const cl = new CurriculumLearning({
  stages: ['easy', 'medium', 'hard'],
  transitionCriteria: 0.9 // Success threshold
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Complex task learning, transfer learning</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Multi-Task Learning</CardTitle>
                          <Badge variant="secondary" className="mt-2">Transfer Learning</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Learn multiple related tasks simultaneously to improve generalization.</p>
                          <CodeBlock code={`import { MultiTaskLearning } from 'agentdb/dist/plugins/implementations/multi-task-learning';

const mtl = new MultiTaskLearning({
  tasks: ['classification', 'regression'],
  sharedLayers: 3
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Related tasks, data efficiency, shared representations</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Federated Learning</CardTitle>
                          <Badge variant="secondary" className="mt-2">Distributed Learning</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Train models across decentralized devices without sharing raw data.</p>
                          <CodeBlock code={`import { FederatedLearning } from 'agentdb/dist/plugins/implementations/federated-learning';

const fl = new FederatedLearning({
  aggregationStrategy: 'fedavg',
  clientSampleRate: 0.1
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Privacy-preserving ML, edge devices, distributed agents</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Neural Architecture Search</CardTitle>
                          <Badge variant="secondary" className="mt-2">AutoML</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Automatically discover optimal neural network architectures.</p>
                          <CodeBlock code={`import { NAS } from 'agentdb/dist/plugins/implementations/neural-architecture-search';

const nas = new NAS({
  searchSpace: 'efficient',
  maxTrials: 100,
  objective: 'accuracy'
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Model optimization, custom architectures, performance tuning</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Adversarial Training</CardTitle>
                          <Badge variant="secondary" className="mt-2">Robustness</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Train robust models using adversarial examples.</p>
                          <CodeBlock code={`import { AdversarialTraining } from 'agentdb/dist/plugins/implementations/adversarial-training';

const at = new AdversarialTraining({
  epsilon: 0.3, // Perturbation budget
  method: 'FGSM' // or 'PGD', 'C&W'
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Security-critical applications, robust AI</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Decision Transformer</CardTitle>
                          <Badge variant="secondary" className="mt-2">Offline RL</Badge>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Sequence modeling approach to offline reinforcement learning.</p>
                          <CodeBlock code={`import { DecisionTransformer } from 'agentdb/dist/plugins/implementations/decision-transformer';

const dt = new DecisionTransformer({
  contextLength: 20,
  returnConditioned: true
});`} />
                          <p className="text-xs mt-2"><strong>Best for:</strong> Learning from logged data, behavioral cloning</p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}

                {activeSection === 'quantization' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Vector Quantization
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Reduce memory usage and accelerate search with advanced compression techniques.
                    </p>

                    <Card className="bg-cyan/10 border-cyan/30 mb-6">
                      <CardContent className="p-6">
                        <h3 className="text-xl font-semibold text-foreground mb-3">
                          Why Quantization?
                        </h3>
                        <p className="text-foreground leading-relaxed">
                          Vector quantization compresses high-dimensional embeddings while preserving similarity relationships.
                          This enables storing millions of vectors in limited memory and achieving 10-100x faster searches
                          with minimal accuracy loss.
                        </p>
                      </CardContent>
                    </Card>

                    <h3>Available Quantization Methods</h3>

                    <div className="space-y-4 mt-6">
                      <Card className="bg-panel border-border border-cyan/50">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            Scalar Quantization
                            <Badge variant="outline" className="bg-cyan/20 text-cyan border-cyan">RECOMMENDED</Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Maps float32 vectors to int8/int16 with learned min/max bounds.</p>
                          <CodeBlock code={`import { SQLiteVectorDB } from 'agentdb';

const db = new SQLiteVectorDB({
  enableQuantization: true,
  quantizationType: 'scalar',
  quantizationBits: 8 // 4-8x compression
});

await db.initializeAsync();`} />
                          <div className="mt-3 p-3 bg-background rounded border border-line">
                            <p className="text-xs mb-2"><strong>Performance:</strong></p>
                            <ul className="text-xs space-y-1">
                              <li>• <strong>Compression:</strong> 4-16x (depending on bits)</li>
                              <li>• <strong>Speed:</strong> 2-4x faster search</li>
                              <li>• <strong>Accuracy:</strong> 85-95% (int8) to 95-99% (int16)</li>
                            </ul>
                          </div>
                          <p className="text-xs mt-3"><strong>Best for:</strong> General-purpose use, balanced speed/accuracy</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Product Quantization (PQ)</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Splits vectors into subvectors and quantizes each independently.</p>
                          <CodeBlock code={`const db = new SQLiteVectorDB({
  enableQuantization: true,
  quantizationType: 'product',
  subvectors: 8, // Split into 8 parts
  codebookSize: 256 // 8-bit codes
});`} />
                          <div className="mt-3 p-3 bg-background rounded border border-line">
                            <p className="text-xs mb-2"><strong>Performance:</strong></p>
                            <ul className="text-xs space-y-1">
                              <li>• <strong>Compression:</strong> 16-64x</li>
                              <li>• <strong>Speed:</strong> 10-20x faster search</li>
                              <li>• <strong>Accuracy:</strong> 70-85%</li>
                            </ul>
                          </div>
                          <p className="text-xs mt-3"><strong>Best for:</strong> Large-scale systems (1M+ vectors), high compression needs</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Binary Quantization</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Ultra-fast 1-bit quantization for maximum speed.</p>
                          <CodeBlock code={`const db = new SQLiteVectorDB({
  enableQuantization: true,
  quantizationType: 'binary',
  threshold: 0.0 // Sign threshold
});`} />
                          <div className="mt-3 p-3 bg-background rounded border border-line">
                            <p className="text-xs mb-2"><strong>Performance:</strong></p>
                            <ul className="text-xs space-y-1">
                              <li>• <strong>Compression:</strong> 256x (32-bit to 1-bit)</li>
                              <li>• <strong>Speed:</strong> 32x faster with Hamming distance</li>
                              <li>• <strong>Accuracy:</strong> 60-75%</li>
                            </ul>
                          </div>
                          <p className="text-xs mt-3"><strong>Best for:</strong> Initial filtering, retrieval cascades, real-time systems</p>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">Optimized Product Quantization (OPQ)</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Learns optimal rotation before PQ for better accuracy.</p>
                          <CodeBlock code={`const db = new SQLiteVectorDB({
  enableQuantization: true,
  quantizationType: 'optimized-pq',
  subvectors: 8,
  codebookSize: 256,
  rotationIterations: 20
});`} />
                          <div className="mt-3 p-3 bg-background rounded border border-line">
                            <p className="text-xs mb-2"><strong>Performance:</strong></p>
                            <ul className="text-xs space-y-1">
                              <li>• <strong>Compression:</strong> 16-64x (same as PQ)</li>
                              <li>• <strong>Speed:</strong> 10-20x faster search</li>
                              <li>• <strong>Accuracy:</strong> 75-90% (+5-10% vs PQ)</li>
                            </ul>
                          </div>
                          <p className="text-xs mt-3"><strong>Best for:</strong> Maximum accuracy with high compression</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="bg-panel border-border mt-6">
                      <CardHeader>
                        <CardTitle>Choosing the Right Method</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-line">
                              <th className="text-left py-2 text-foreground">Use Case</th>
                              <th className="text-left py-2 text-foreground">Recommended</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-line">
                              <td className="py-2">General purpose</td>
                              <td className="py-2 text-cyan">Scalar (int8)</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2">Large scale (1M+ vectors)</td>
                              <td className="py-2 text-cyan">Product Quantization</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2">Real-time/low latency</td>
                              <td className="py-2 text-cyan">Binary</td>
                            </tr>
                            <tr>
                              <td className="py-2">Best accuracy + compression</td>
                              <td className="py-2 text-cyan">Optimized PQ</td>
                            </tr>
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeSection === 'mcp-tools' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      MCP Tools
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Model Context Protocol tools for seamless AI agent integration with Claude Code and other AI assistants.
                    </p>

                    <Card className="bg-cyan/10 border-cyan/30 mb-6">
                      <CardContent className="p-6">
                        <h3 className="text-xl font-semibold text-foreground mb-3">
                          What are MCP Tools?
                        </h3>
                        <p className="text-foreground leading-relaxed">
                          AgentDB provides 29 MCP (Model Context Protocol) tools that enable AI assistants like
                          Claude Code to directly interact with your vector database, manage learning sessions,
                          and coordinate agent behaviors. All tools are available immediately when the MCP server starts.
                        </p>
                      </CardContent>
                    </Card>

                    <h3>MCP Server Setup</h3>
                    <p className="text-muted-foreground">
                      Add AgentDB as an MCP server to Claude Code:
                    </p>
                    <CodeBlock code={`# Add MCP server
claude mcp add agentdb npx agentdb mcp

# Start the server
npx agentdb mcp start`} />

                    <h3>Core Vector Database Tools (5)</h3>
                    <p className="text-muted-foreground mb-4">
                      Essential vector database operations for storing, searching, and managing embeddings.
                    </p>

                    <div className="space-y-4 mb-6">
                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">1. agentdb_init</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Initialize a new AgentDB vector database with configuration.</p>
                          <CodeBlock code={`// Initialize database
{
  "backend": "native",
  "memoryMode": true,
  "enableQuantization": false,
  "enableQueryCache": true
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">2. agentdb_insert</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Insert a single vector with metadata.</p>
                          <CodeBlock code={`// Insert vector
{
  "vector": {
    "embedding": [0.1, 0.2, 0.3, ...],
    "metadata": {
      "type": "document",
      "content": "Example text"
    }
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">3. agentdb_insert_batch</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Insert multiple vectors in batch for better performance.</p>
                          <CodeBlock code={`// Batch insert
{
  "vectors": [
    { "embedding": [...], "metadata": {...} },
    { "embedding": [...], "metadata": {...} }
  ]
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">4. agentdb_search</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Perform k-nearest neighbor search with cosine similarity.</p>
                          <CodeBlock code={`// Search for similar vectors
{
  "queryEmbedding": [0.1, 0.2, 0.3, ...],
  "k": 5,
  "threshold": 0.7,
  "metric": "cosine"
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">5. agentdb_delete</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Delete a vector by ID from the database.</p>
                          <CodeBlock code={`// Delete vector
{
  "id": "vector-123"
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">6. agentdb_stats</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Get comprehensive database statistics including cache and compression metrics.</p>
                          <CodeBlock code={`// Get stats (no parameters needed)`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">7. agentdb_pattern_store</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Store reasoning patterns in ReasoningBank for future learning.</p>
                          <CodeBlock code={`// Store pattern
{
  "pattern": {
    "embedding": [...],
    "taskType": "code-review",
    "approach": "Check types first",
    "successRate": 0.9,
    "metadata": {
      "domain": "typescript",
      "complexity": "medium"
    }
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">8. agentdb_pattern_search</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Search for similar reasoning patterns based on task embedding.</p>
                          <CodeBlock code={`// Search patterns
{
  "taskEmbedding": [...],
  "k": 5,
  "threshold": 0.7,
  "filters": {
    "domain": "typescript",
    "minSuccessRate": 0.8
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">9. agentdb_pattern_stats</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Get statistics about stored reasoning patterns.</p>
                          <CodeBlock code={`// Get pattern stats (no parameters needed)`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">10. agentdb_clear_cache</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Clear the query cache to free memory or force fresh queries.</p>
                          <CodeBlock code={`// Clear cache (no parameters needed)`} />
                        </CardContent>
                      </Card>
                    </div>

                    <h3>Frontier Memory Tools (9)</h3>
                    <p className="text-muted-foreground mb-4">
                      Advanced memory capabilities including Reflexion learning, skill management, and causal reasoning.
                    </p>

                    <div className="space-y-4 mb-6">
                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">11. reflexion_store</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Store episodes with self-critique for reflexive learning.</p>
                          <CodeBlock code={`// Store reflexion episode
{
  "task": "implement auth",
  "action": "created middleware",
  "outcome": "success",
  "reflection": "Should validate tokens first",
  "metadata": {
    "duration": 300,
    "complexity": "medium"
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">12. reflexion_retrieve</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Retrieve past episodes for learning from experience.</p>
                          <CodeBlock code={`// Retrieve episodes
{
  "task": "implement auth",
  "k": 5,
  "only_successes": true
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">13. skill_create</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Create reusable skills from successful patterns.</p>
                          <CodeBlock code={`// Create skill
{
  "name": "validate-jwt",
  "description": "JWT token validation",
  "implementation": "function validateToken(token) {...}",
  "metadata": {
    "language": "typescript",
    "domain": "security"
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">14. skill_search</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Search for skills by semantic similarity.</p>
                          <CodeBlock code={`// Search skills
{
  "query": "authentication helper",
  "k": 3,
  "threshold": 0.7
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">15. causal_add_edge</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Add causal relationships to track cause-effect patterns.</p>
                          <CodeBlock code={`// Add causal edge
{
  "cause": "added caching",
  "effect": "reduced latency",
  "uplift": 0.45,
  "confidence": 0.85
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">16. causal_query</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Query causal relationships and effects.</p>
                          <CodeBlock code={`// Query causality
{
  "cause": "added caching",
  "min_confidence": 0.7
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">17. recall_with_certificate</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Explainable recall with provenance certificates.</p>
                          <CodeBlock code={`// Recall with proof
{
  "query": "error handling pattern",
  "k": 3,
  "include_provenance": true
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">18. learner_discover</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Auto-discover causal patterns from data.</p>
                          <CodeBlock code={`// Discover patterns
{
  "min_support": 0.3,
  "min_confidence": 0.7,
  "max_patterns": 10
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">19. db_stats</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Get comprehensive database statistics.</p>
                          <CodeBlock code={`// Get stats (no parameters needed)`} />
                        </CardContent>
                      </Card>
                    </div>

                    <h3>Learning System Tools (10)</h3>
                    <p className="text-muted-foreground mb-4">
                      Adaptive learning and reinforcement capabilities for intelligent agent behavior.
                    </p>

                    <div className="space-y-4">
                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">20. learning_start_session</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Start a new learning session for adaptive action selection.</p>
                          <CodeBlock code={`// Start session
{
  "userId": "agent-001",
  "sessionType": "coding",
  "config": {
    "learningRate": 0.1,
    "discountFactor": 0.95
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">21. learning_end_session</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">End a learning session and save the learned policy.</p>
                          <CodeBlock code={`// End session
{
  "sessionId": "session-123"
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">22. learning_predict</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Get AI-recommended action for current state with confidence scores.</p>
                          <CodeBlock code={`// Get prediction
{
  "sessionId": "session-123",
  "currentState": {
    "taskDescription": "Fix bug",
    "availableTools": ["read", "edit", "bash"]
  },
  "availableTools": ["read", "edit", "bash"]
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">23. learning_feedback</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Provide feedback on action quality to improve learning.</p>
                          <CodeBlock code={`// Submit feedback
{
  "sessionId": "session-123",
  "actionId": "action-456",
  "feedback": {
    "success": true,
    "rating": 4.5,
    "dimensions": {
      "accuracy": 0.9,
      "speed": 0.8
    }
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">24. learning_train</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Train policy on collected experiences.</p>
                          <CodeBlock code={`// Train model
{
  "sessionId": "session-123",
  "options": {
    "epochs": 10,
    "batchSize": 32,
    "learningRate": 0.1
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">25. learning_metrics</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Get learning performance metrics and statistics.</p>
                          <CodeBlock code={`// Get metrics
{
  "sessionId": "session-123",
  "period": "session"
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">26. learning_transfer</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Transfer learning from one task to another.</p>
                          <CodeBlock code={`// Transfer learning
{
  "sourceSessionId": "session-123",
  "targetSessionId": "session-456",
  "similarity": 0.7
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">27. learning_explain</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Explain why an action was recommended.</p>
                          <CodeBlock code={`// Get explanation
{
  "sessionId": "session-123",
  "state": {
    "taskDescription": "Debug error",
    "availableTools": ["grep", "read"]
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">28. experience_record</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Record a tool execution as learning experience.</p>
                          <CodeBlock code={`// Record experience
{
  "sessionId": "session-123",
  "toolName": "edit",
  "args": {...},
  "result": "success",
  "outcome": {
    "success": true,
    "executionTime": 150
  }
}`} />
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardHeader>
                          <CardTitle className="text-base">29. reward_signal</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <p className="mb-2">Calculate reward signal for an outcome.</p>
                          <CodeBlock code={`// Calculate reward
{
  "outcome": {
    "success": true,
    "executionTime": 150
  },
  "context": {
    "userId": "agent-001",
    "sessionId": "session-123",
    "taskType": "coding"
  }
}`} />
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="bg-cyan/10 border-cyan/30 mt-6">
                      <CardContent className="p-6">
                        <h4 className="text-lg font-semibold text-foreground mb-2">
                          ✨ All Tools Available Immediately
                        </h4>
                        <p className="text-foreground">
                          All 29 MCP tools are initialized and available as soon as the MCP server starts.
                          Learning tools use a temporary in-memory database until you explicitly initialize
                          a persistent database with agentdb_init.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeSection === 'reasoning-bank' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      ReasoningBank
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Built-in memory and learning system for AI agents.
                    </p>

                    <Card className="bg-panel border-border mb-6">
                      <CardHeader>
                        <CardTitle>What is ReasoningBank?</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground">
                          ReasoningBank is a comprehensive memory and learning system that allows AI agents to:
                        </p>
                        <ul className="mt-4 space-y-2 text-muted-foreground">
                          <li>• Store and retrieve reasoning patterns</li>
                          <li>• Learn from past experiences</li>
                          <li>• Track performance metrics</li>
                          <li>• Optimize memory usage</li>
                          <li>• Adapt strategies over time</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Components</h3>

                    <h4>1. PatternMatcher</h4>
                    <p className="text-muted-foreground">
                      Stores and retrieves reasoning patterns based on context similarity.
                    </p>
                    <CodeBlock code={`// Store a reasoning pattern
await db.reasoningBank.patternMatcher.store({
  pattern: 'debugging',
  context: 'Error in async function',
  solution: 'Check promise handling and error catching',
  effectiveness: 0.9
});

// Find similar patterns
const matches = await db.reasoningBank.patternMatcher.match({
  context: 'Promise rejection in async code',
  k: 5
});`} />

                    <h4>2. ExperienceCurator</h4>
                    <p className="text-muted-foreground">
                      Manages task experiences and tracks performance over time.
                    </p>
                    <CodeBlock code={`// Record an experience
await db.reasoningBank.experienceCurator.record({
  task: 'code-review',
  context: 'React component optimization',
  actions: ['Identify re-renders', 'Add memoization'],
  outcome: 'success',
  quality: 0.92
});

// Query similar experiences
const experiences = await db.reasoningBank.experienceCurator.query({
  task: 'code-review',
  minQuality: 0.8
});`} />

                    <h4>3. MemoryOptimizer</h4>
                    <p className="text-muted-foreground">
                      Optimizes long-term storage by consolidating and pruning memories.
                    </p>
                    <CodeBlock code={`// Optimize memory
await db.reasoningBank.memoryOptimizer.optimize({
  pruneThreshold: 0.5, // Remove low-quality memories
  consolidateThreshold: 0.95, // Merge similar memories
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
});

// Get optimization stats
const stats = await db.reasoningBank.memoryOptimizer.getStats();`} />

                    <h3>Usage Example</h3>
                    <CodeBlock code={`// Complete ReasoningBank workflow
const agent = new AgentDB({ memory: true });

// 1. Agent encounters a problem
const problem = "How to handle rate limiting in API calls?";

// 2. Query for similar past experiences
const pastExperiences = await agent.reasoningBank.query({
  context: problem,
  k: 3,
  minConfidence: 0.7
});

// 3. Apply learned pattern or create new reasoning
let solution;
if (pastExperiences.length > 0) {
  solution = pastExperiences[0].reasoning;
} else {
  solution = "Implement exponential backoff with retry logic";
}

// 4. Store the new experience
await agent.reasoningBank.store({
  pattern: 'rate-limiting',
  context: problem,
  reasoning: solution,
  outcome: 'success',
  confidence: 0.85
});`} />
                  </div>
                )}

                {activeSection === 'frontier-memory' && (
                  <FrontierMemoryDocs />
                )}

                {activeSection === 'hnsw-index' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      HNSW Index
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Hierarchical Navigable Small World index for ultra-fast vector search.
                    </p>

                    <Card className="bg-cyan/10 border-cyan/30 mb-6">
                      <CardContent className="p-6">
                        <h3 className="text-xl font-semibold text-foreground mb-3">
                          Performance Benefits
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <div className="text-3xl font-bold text-cyan mb-1">12x</div>
                            <div className="text-sm text-muted-foreground">Faster than linear search</div>
                          </div>
                          <div>
                            <div className="text-3xl font-bold text-cyan mb-1">97%</div>
                            <div className="text-sm text-muted-foreground">Recall accuracy</div>
                          </div>
                          <div>
                            <div className="text-3xl font-bold text-cyan mb-1">&lt;1ms</div>
                            <div className="text-sm text-muted-foreground">Query time</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <h3>What is HNSW?</h3>
                    <p className="text-muted-foreground mb-4">
                      HNSW (Hierarchical Navigable Small World) is a graph-based algorithm for approximate 
                      nearest neighbor search. It creates a multi-layer graph structure that allows for 
                      logarithmic search complexity while maintaining high recall accuracy.
                    </p>

                    <h3>Configuration</h3>
                    <CodeBlock code={`const db = new AgentDB({
  memory: true,
  hnsw: {
    M: 16,              // Number of connections per node
    efConstruction: 200, // Search quality during build
    efSearch: 50,       // Search quality during query
    metric: 'cosine'    // Distance metric
  }
});`} />

                    <h4>Parameters</h4>
                    <div className="bg-panel border border-line rounded-lg p-4 mb-6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line">
                            <th className="text-left py-2 text-foreground">Parameter</th>
                            <th className="text-left py-2 text-foreground">Default</th>
                            <th className="text-left py-2 text-foreground">Description</th>
                          </tr>
                        </thead>
                        <tbody className="text-muted-foreground">
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">M</code></td>
                            <td className="py-2">16</td>
                            <td className="py-2">Connections per node (higher = better accuracy, more memory)</td>
                          </tr>
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">efConstruction</code></td>
                            <td className="py-2">200</td>
                            <td className="py-2">Build quality (higher = better index, slower build)</td>
                          </tr>
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">efSearch</code></td>
                            <td className="py-2">50</td>
                            <td className="py-2">Query quality (higher = better recall, slower search)</td>
                          </tr>
                          <tr>
                            <td className="py-2"><code className="text-cyan">metric</code></td>
                            <td className="py-2">cosine</td>
                            <td className="py-2">Distance metric (cosine, euclidean, dot)</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <h3>Tuning for Performance</h3>
                    <Card className="bg-panel border-border">
                      <CardHeader>
                        <CardTitle className="text-lg">Optimization Guidelines</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-3 text-sm text-muted-foreground">
                          <li>
                            <strong className="text-foreground">For speed:</strong> Lower M (8-12), lower efSearch (10-30)
                          </li>
                          <li>
                            <strong className="text-foreground">For accuracy:</strong> Higher M (16-32), higher efSearch (50-100)
                          </li>
                          <li>
                            <strong className="text-foreground">For large datasets:</strong> Increase efConstruction (200-400)
                          </li>
                          <li>
                            <strong className="text-foreground">For real-time apps:</strong> Use cosine metric, M=16, efSearch=20-30
                          </li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeSection === 'advanced-features' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Advanced Features
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Powerful capabilities for distributed agents, synchronization, and advanced query building.
                    </p>

                    <h3>VectorQueryBuilder</h3>
                    <p className="text-muted-foreground mb-2">
                      Fluent API for building complex vector queries with filters and options:
                    </p>
                    <CodeBlock code={`import { VectorQueryBuilder } from 'agentdb';

const results = await db
  .queryBuilder()
  .vector([0.1, 0.2, 0.3, ...])
  .k(10)
  .threshold(0.8)
  .filter({ category: 'technical', language: 'typescript' })
  .metric('cosine')
  .includeMetadata()
  .execute();

// Complex filtering
const results = await db
  .queryBuilder()
  .vector(embedding)
  .k(20)
  .filter({
    timestamp: { $gte: Date.now() - 86400000 }, // Last 24 hours
    confidence: { $gt: 0.9 },
    tags: { $contains: 'production' }
  })
  .sort('confidence', 'desc')
  .execute();`} />

                    <Card className="bg-panel border-border mt-6 mb-6">
                      <CardHeader>
                        <CardTitle className="text-lg">Query Builder Methods</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-line">
                              <th className="text-left py-2 text-foreground">Method</th>
                              <th className="text-left py-2 text-foreground">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-line">
                              <td className="py-2"><code className="text-cyan">.vector(arr)</code></td>
                              <td className="py-2">Set query vector</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2"><code className="text-cyan">.k(n)</code></td>
                              <td className="py-2">Number of results</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2"><code className="text-cyan">.threshold(n)</code></td>
                              <td className="py-2">Minimum similarity score (0-1)</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2"><code className="text-cyan">.filter(obj)</code></td>
                              <td className="py-2">Metadata filtering</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2"><code className="text-cyan">.metric(str)</code></td>
                              <td className="py-2">Distance metric (cosine, euclidean, dot)</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2"><code className="text-cyan">.sort(field, order)</code></td>
                              <td className="py-2">Sort results by metadata field</td>
                            </tr>
                            <tr>
                              <td className="py-2"><code className="text-cyan">.includeMetadata()</code></td>
                              <td className="py-2">Include full metadata in results</td>
                            </tr>
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>

                    <h3>QUIC Sync Protocol</h3>
                    <p className="text-muted-foreground mb-2">
                      Low-latency synchronization for distributed agent networks using QUIC protocol:
                    </p>
                    <CodeBlock code={`import { SQLiteVectorDB, QuicSync } from 'agentdb';

// Initialize database with QUIC sync
const db = new SQLiteVectorDB({
  path: './agent.db',
  sync: {
    enabled: true,
    protocol: 'quic',
    peers: [
      'quic://agent-1.local:4433',
      'quic://agent-2.local:4433'
    ],
    syncInterval: 5000 // 5 seconds
  }
});

await db.initializeAsync();

// Manual sync trigger
await db.sync.push(); // Push local changes
await db.sync.pull(); // Pull remote changes
await db.sync.bidirectional(); // Full sync

// Listen for sync events
db.on('sync:start', () => console.log('Sync started'));
db.on('sync:complete', (stats) => console.log('Synced:', stats));
db.on('sync:conflict', (conflict) => db.resolveConflict(conflict));`} />

                    <Card className="bg-cyan/10 border-cyan/30 mt-6 mb-6">
                      <CardContent className="p-6">
                        <h4 className="text-lg font-semibold text-foreground mb-2">
                          Why QUIC for Agent Sync?
                        </h4>
                        <p className="text-foreground leading-relaxed mb-3">
                          QUIC provides ultra-low latency (10-50ms), multiplexed streams, and built-in encryption
                          for secure agent-to-agent communication. Perfect for real-time distributed AI systems.
                        </p>
                        <ul className="text-foreground space-y-2">
                          <li>• <strong>0-RTT resumption:</strong> Instant reconnection for mobile agents</li>
                          <li>• <strong>Stream multiplexing:</strong> No head-of-line blocking</li>
                          <li>• <strong>Built-in TLS 1.3:</strong> Encrypted by default</li>
                          <li>• <strong>Connection migration:</strong> Seamless network switching</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Distributed Coordination</h3>
                    <CodeBlock code={`// Consensus-based updates
import { DistributedDB } from 'agentdb';

const db = new DistributedDB({
  nodeId: 'agent-worker-1',
  consensus: {
    algorithm: 'raft', // or 'paxos', 'pbft'
    quorum: 3,
    timeout: 1000
  },
  peers: ['agent-1', 'agent-2', 'agent-3']
});

// Propose update (requires quorum approval)
const result = await db.propose({
  operation: 'insert',
  vector: [...],
  metadata: {...}
});

// Listen for consensus events
db.on('consensus:achieved', (proposal) => {
  console.log('Cluster agreed on:', proposal);
});

db.on('consensus:failed', (proposal) => {
  console.log('No consensus, rolling back:', proposal);
});`} />

                    <h3>Cross-Session Memory Persistence</h3>
                    <CodeBlock code={`// Export session state
const snapshot = await db.exportSession({
  includeVectors: true,
  includeReasoningBank: true,
  includeMetrics: true
});

// Save to file or cloud storage
await fs.writeFile('./session-backup.json', JSON.stringify(snapshot));

// Restore in new session
const db2 = new SQLiteVectorDB({ memoryMode: true });
await db2.initializeAsync();
await db2.importSession(snapshot);

// Now db2 has all vectors, patterns, and metrics from db`} />

                    <h3>Plugin Registry</h3>
                    <CodeBlock code={`// Register custom learning plugin
import { PluginRegistry } from 'agentdb';

const registry = new PluginRegistry();

// Register plugin
registry.register({
  name: 'custom-rl',
  version: '1.0.0',
  type: 'learning',
  implementation: CustomRLPlugin,
  metadata: {
    author: 'your-name',
    description: 'Custom reinforcement learning algorithm'
  }
});

// Load plugin
const plugin = await registry.load('custom-rl');
const learner = new plugin({
  learningRate: 0.01
});

// List available plugins
const plugins = registry.list({ type: 'learning' });
console.log(plugins); // All learning plugins`} />

                    <h3>Advanced Index Options</h3>
                    <CodeBlock code={`import { OptimizedHNSWIndex } from 'agentdb';

// Create optimized index with custom configuration
const index = new OptimizedHNSWIndex({
  dimensions: 1536,
  M: 32, // Higher connectivity for better recall
  efConstruction: 400,
  efSearch: 100,

  // Advanced options
  levelMultiplier: 1 / Math.log(2),
  maxLevel: 6,
  pruneConnections: true,

  // Performance tuning
  cacheSize: 10000,
  prefetchDepth: 2,
  parallelism: 4 // Multi-threaded search
});

// Build index
await index.buildFromVectors(vectors);

// Batch insert with optimizations
await index.insertBatch(newVectors, {
  batchSize: 1000,
  parallel: true,
  skipDuplicates: true
});`} />

                    <Card className="bg-panel border-border mt-6">
                      <CardHeader>
                        <CardTitle>Performance Comparison</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-line">
                              <th className="text-left py-2 text-foreground">Feature</th>
                              <th className="text-left py-2 text-foreground">Standard</th>
                              <th className="text-left py-2 text-foreground">Advanced</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-line">
                              <td className="py-2">Query Latency</td>
                              <td className="py-2">~1-2ms</td>
                              <td className="py-2 text-cyan">~0.3-0.8ms</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2">Batch Insert</td>
                              <td className="py-2">1000/sec</td>
                              <td className="py-2 text-cyan">10,000/sec</td>
                            </tr>
                            <tr className="border-b border-line">
                              <td className="py-2">Sync Latency</td>
                              <td className="py-2">N/A</td>
                              <td className="py-2 text-cyan">10-50ms (QUIC)</td>
                            </tr>
                            <tr>
                              <td className="py-2">Memory Efficiency</td>
                              <td className="py-2">Baseline</td>
                              <td className="py-2 text-cyan">4-32x (with quantization)</td>
                            </tr>
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeSection === 'examples' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Examples
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Real-world examples and use cases for AgentDB.
                    </p>

                    <h3>Conversational AI Agent</h3>
                    <CodeBlock code={`class ConversationalAgent {
  constructor() {
    this.db = new AgentDB({ memory: true });
    this.embeddings = new EmbeddingModel();
  }

  async remember(message, response) {
    const embedding = await this.embeddings.encode(message);
    
    await this.db.store({
      id: Date.now().toString(),
      vector: embedding,
      metadata: {
        message,
        response,
        timestamp: Date.now()
      }
    });
  }

  async recall(query) {
    const embedding = await this.embeddings.encode(query);
    
    const results = await this.db.query({
      vector: embedding,
      k: 5,
      threshold: 0.7
    });

    return results.map(r => r.metadata);
  }

  async chat(userMessage) {
    // Recall relevant context
    const context = await this.recall(userMessage);
    
    // Generate response using context
    const response = await this.generateResponse(userMessage, context);
    
    // Remember this interaction
    await this.remember(userMessage, response);
    
    return response;
  }
}`} />

                    <h3>Semantic Search Engine</h3>
                    <CodeBlock code={`class SemanticSearch {
  constructor() {
    this.db = new AgentDB({ 
      path: './search.db',
      dimensions: 768
    });
  }

  async indexDocuments(documents) {
    for (const doc of documents) {
      const embedding = await this.embeddings.encode(doc.content);
      
      await this.db.store({
        id: doc.id,
        vector: embedding,
        metadata: {
          title: doc.title,
          content: doc.content,
          tags: doc.tags,
          url: doc.url
        }
      });
    }
  }

  async search(query, filters = {}) {
    const queryEmbedding = await this.embeddings.encode(query);
    
    const results = await this.db.query({
      vector: queryEmbedding,
      k: 20,
      filter: filters
    });

    return results.map(r => ({
      ...r.metadata,
      score: r.score
    }));
  }
}`} />

                    <h3>Recommendation System</h3>
                    <CodeBlock code={`class RecommendationEngine {
  constructor() {
    this.db = new AgentDB({ memory: true });
  }

  async trackInteraction(userId, itemId, interaction) {
    // Create interaction embedding
    const embedding = this.createInteractionVector(interaction);
    
    await this.db.store({
      id: \`\${userId}-\${itemId}-\${Date.now()}\`,
      vector: embedding,
      metadata: {
        userId,
        itemId,
        type: interaction.type,
        rating: interaction.rating,
        timestamp: Date.now()
      }
    });
  }

  async getRecommendations(userId, k = 10) {
    // Get user's interaction profile
    const userProfile = await this.getUserProfile(userId);
    
    // Find similar interaction patterns
    const similar = await this.db.query({
      vector: userProfile,
      k: k * 2,
      filter: { userId: { $ne: userId } }
    });

    // Extract unique item recommendations
    const recommendations = this.deduplicateItems(similar);
    
    return recommendations.slice(0, k);
  }
}`} />

                    <div className="mt-6">
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => {
                          onOpenChange(false);
                          window.location.href = '/demo';
                        }}
                      >
                        <Lightbulb className="h-4 w-4 mr-2" />
                        View Interactive Demos
                      </Button>
                    </div>
                  </div>
                )}

                {activeSection === 'configuration' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Configuration
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Advanced configuration options for AgentDB.
                    </p>

                    <h3>Database Configuration</h3>
                    <CodeBlock code={`const db = new AgentDB({
  // Storage
  path: './data/agent.db',
  memory: false,
  
  // Vector settings
  dimensions: 384,
  maxElements: 100000,
  
  // HNSW index
  hnsw: {
    M: 16,
    efConstruction: 200,
    efSearch: 50,
    metric: 'cosine'
  },
  
  // Performance
  cacheSize: 1000,
  batchSize: 100,
  
  // Logging
  logLevel: 'info'
});`} />

                    <h3>Environment Variables</h3>
                    <div className="bg-panel border border-line rounded-lg p-4 mb-6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line">
                            <th className="text-left py-2 text-foreground">Variable</th>
                            <th className="text-left py-2 text-foreground">Description</th>
                            <th className="text-left py-2 text-foreground">Default</th>
                          </tr>
                        </thead>
                        <tbody className="text-muted-foreground">
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">AGENTDB_PATH</code></td>
                            <td className="py-2">Default database path</td>
                            <td className="py-2">./agent.db</td>
                          </tr>
                          <tr className="border-b border-line">
                            <td className="py-2"><code className="text-cyan">AGENTDB_LOG_LEVEL</code></td>
                            <td className="py-2">Logging level</td>
                            <td className="py-2">info</td>
                          </tr>
                          <tr>
                            <td className="py-2"><code className="text-cyan">AGENTDB_CACHE_SIZE</code></td>
                            <td className="py-2">Cache size</td>
                            <td className="py-2">1000</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <h3>MCP Server Configuration</h3>
                    <CodeBlock code={`import { MCPServer } from '@agentdb/mcp-server';

const server = new MCPServer({
  database: db,
  port: 3000,
  host: '0.0.0.0',
  
  // Authentication
  auth: {
    enabled: true,
    secret: process.env.MCP_SECRET,
    algorithm: 'HS256'
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  },
  
  // CORS
  cors: {
    origin: '*',
    credentials: true
  }
});

await server.start();`} />
                  </div>
                )}

                {activeSection === 'best-practices' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Best Practices
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Guidelines for building production-ready applications with AgentDB.
                    </p>

                    <Card className="bg-panel border-border mb-6">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Lightbulb className="h-5 w-5 text-cyan" />
                          General Guidelines
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li>• Always normalize vectors before storing</li>
                          <li>• Use appropriate vector dimensions for your use case</li>
                          <li>• Implement proper error handling and retry logic</li>
                          <li>• Monitor memory usage in production</li>
                          <li>• Use batch operations for bulk inserts</li>
                          <li>• Regularly backup persistent databases</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Vector Normalization</h3>
                    <CodeBlock code={`function normalizeVector(vector) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, val) => sum + val * val, 0)
  );
  return vector.map(val => val / magnitude);
}

// Use before storing
const normalized = normalizeVector(embedding);
await db.store({
  id: 'doc-1',
  vector: normalized,
  metadata: { ... }
});`} />

                    <h3>Error Handling</h3>
                    <CodeBlock code={`async function safeQuery(db, vector, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await db.query({ vector, k: 10 });
    } catch (error) {
      if (i === retries - 1) throw error;
      
      console.warn(\`Query failed, retry \${i + 1}/\${retries}\`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}`} />

                    <h3>Batch Operations</h3>
                    <CodeBlock code={`async function batchStore(db, items, batchSize = 100) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(item => db.store(item))
    );
    
    // Optional: Add delay between batches
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
}`} />

                    <h3>Memory Management</h3>
                    <Card className="bg-panel border-border">
                      <CardHeader>
                        <CardTitle className="text-lg">Memory Optimization Tips</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li>
                            <strong className="text-foreground">Use lower dimensions:</strong> 
                            384 dims is often sufficient, avoids overhead of 768 or 1536
                          </li>
                          <li>
                            <strong className="text-foreground">Prune old data:</strong> 
                            Regularly remove outdated or low-quality vectors
                          </li>
                          <li>
                            <strong className="text-foreground">Use disk storage:</strong> 
                            For large datasets, persist to disk rather than memory
                          </li>
                          <li>
                            <strong className="text-foreground">Monitor usage:</strong> 
                            Track memory consumption and set limits
                          </li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Production Checklist</h3>
                    <div className="bg-panel border border-line rounded-lg p-4">
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li>✓ Set up automated backups</li>
                        <li>✓ Implement monitoring and alerting</li>
                        <li>✓ Use environment variables for configuration</li>
                        <li>✓ Enable proper logging</li>
                        <li>✓ Set up rate limiting</li>
                        <li>✓ Implement authentication for MCP server</li>
                        <li>✓ Test disaster recovery procedures</li>
                        <li>✓ Document your schema and patterns</li>
                      </ul>
                    </div>
                  </div>
                )}

                {activeSection === 'troubleshooting' && (
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                      Troubleshooting
                    </h2>
                    <p className="text-lg text-muted-foreground mb-6">
                      Common issues and solutions.
                    </p>

                    <h3>Installation Issues</h3>
                    <Card className="bg-panel border-border mb-4">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-cyan" />
                          Native module build errors
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <p className="mb-2">If you encounter build errors, ensure you have:</p>
                        <ul className="space-y-1 ml-4">
                          <li>• Node.js 16+ installed</li>
                          <li>• Python 3.x available in PATH</li>
                          <li>• Build tools (node-gyp, make, gcc)</li>
                        </ul>
                        <CodeBlock code="npm install --build-from-source" />
                      </CardContent>
                    </Card>

                    <h3>Performance Issues</h3>
                    <Card className="bg-panel border-border mb-4">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-cyan" />
                          Slow query performance
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <p className="mb-2">Solutions:</p>
                        <ul className="space-y-1 ml-4">
                          <li>• Lower efSearch parameter (trade accuracy for speed)</li>
                          <li>• Reduce vector dimensions if possible</li>
                          <li>• Use filtering before vector search</li>
                          <li>• Consider using approximate search</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <Card className="bg-panel border-border mb-4">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-cyan" />
                          High memory usage
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <p className="mb-2">Solutions:</p>
                        <ul className="space-y-1 ml-4">
                          <li>• Use disk storage instead of memory</li>
                          <li>• Lower M parameter in HNSW config</li>
                          <li>• Reduce maxElements limit</li>
                          <li>• Implement data pruning</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Database Issues</h3>
                    <Card className="bg-panel border-border mb-4">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-cyan" />
                          Database corruption
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <p className="mb-2">Recovery steps:</p>
                        <CodeBlock code={`// 1. Create backup
cp agent.db agent.db.backup

// 2. Try repair
const db = new AgentDB({ 
  path: './agent.db',
  repair: true 
});

// 3. If repair fails, rebuild from backup
await db.rebuildIndex();`} />
                      </CardContent>
                    </Card>

                    <h3>Browser Issues</h3>
                    <Card className="bg-panel border-border mb-4">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-cyan" />
                          WASM not loading
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <p className="mb-2">Check:</p>
                        <ul className="space-y-1 ml-4">
                          <li>• Browser supports WebAssembly</li>
                          <li>• CORS headers are properly configured</li>
                          <li>• WASM file is accessible</li>
                          <li>• Content-Type header is correct</li>
                        </ul>
                      </CardContent>
                    </Card>

                    <h3>Need More Help?</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="bg-panel border-border">
                        <CardContent className="p-4">
                          <h4 className="font-semibold text-foreground mb-2">GitHub Issues</h4>
                          <p className="text-sm text-muted-foreground mb-3">
                            Report bugs or request features
                          </p>
                          <Button variant="outline" size="sm" className="w-full" asChild>
                            <a 
                              href="https://github.com/ruvnet/agentic-flow/issues" 
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Open Issue
                            </a>
                          </Button>
                        </CardContent>
                      </Card>

                      <Card className="bg-panel border-border">
                        <CardContent className="p-4">
                          <h4 className="font-semibold text-foreground mb-2">Community</h4>
                          <p className="text-sm text-muted-foreground mb-3">
                            Join discussions and get help
                          </p>
                          <Button variant="outline" size="sm" className="w-full" asChild>
                            <a 
                              href="https://github.com/ruvnet/agentic-flow/discussions" 
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Discussions
                            </a>
                          </Button>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </div>
            </main>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};