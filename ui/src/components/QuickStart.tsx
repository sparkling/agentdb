import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const nodeExample = `import { createVectorDB } from 'agentdb';

// Initialize database
const db = createVectorDB({ 
  path: './memory.db' 
});

// Insert vectors
await db.insertBatch([
  {
    embedding: [0.1, 0.2, 0.3, ...],
    metadata: { type: 'pattern', task: 'code_gen' }
  }
]);

// Search similar vectors
const results = await db.search(
  queryEmbedding, 
  10, 
  'cosine',
  0.8
);

console.log('Found:', results.length);`;

const browserExample = `<!-- Via CDN -->
<script src="https://unpkg.com/agentdb@1.3.9/dist/agentdb.min.js"></script>
<script>
  AgentDB.onReady(async () => {
    // Create database
    const db = new AgentDB.Database();
    await db.initializeAsync();
    
    // Insert pattern
    db.insert('patterns', {
      pattern: 'optimization',
      metadata: JSON.stringify({ domain: 'ml' })
    });
    
    // Query data
    const results = db.exec(
      'SELECT * FROM patterns'
    );
    console.log('Patterns:', results);
  });
</script>`;

export const QuickStart = () => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'node' | 'browser'>('node');
  const { toast } = useToast();
  
  const handleCopy = () => {
    const code = activeTab === 'node' ? nodeExample : browserExample;
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast({
      title: "Copied to clipboard",
      description: "Code example copied successfully",
    });
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <section id="quickstart" className="py-20 bg-background">
      <div className="container mx-auto px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
              Quick Start
            </h2>
            <p className="text-lg text-muted-foreground">
              Get started with AgentDB in under 60 seconds
            </p>
          </div>
          
          <Card className="bg-panel border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-4">
                <CardTitle className="text-xl font-mono">
                  <span className="text-muted-foreground">$</span> npm install agentdb
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={activeTab === 'node' ? 'default' : 'ghost'}
                    onClick={() => setActiveTab('node')}
                    className={activeTab === 'node' ? 'bg-cyan text-foreground' : ''}
                  >
                    Node.js
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === 'browser' ? 'default' : 'ghost'}
                    onClick={() => setActiveTab('browser')}
                    className={activeTab === 'browser' ? 'bg-cyan text-foreground' : ''}
                  >
                    Browser
                  </Button>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleCopy}
                className="gap-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-cyan" />
                    <span className="text-cyan">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="font-mono text-sm overflow-x-auto">
                <code className="text-foreground/90 leading-relaxed">
                  {activeTab === 'node' ? nodeExample : browserExample}
                </code>
              </pre>
            </CardContent>
          </Card>
          
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card/30 border-border">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-cyan mb-2">1</div>
                <div className="text-sm text-muted-foreground">
                  Install with npm, yarn, or pnpm
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-card/30 border-border">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-cyan mb-2">2</div>
                <div className="text-sm text-muted-foreground">
                  Import and initialize database
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-card/30 border-border">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-cyan mb-2">3</div>
                <div className="text-sm text-muted-foreground">
                  Start inserting and searching vectors
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};
