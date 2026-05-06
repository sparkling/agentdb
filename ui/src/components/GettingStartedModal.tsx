import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Terminal, Package, Plug, CheckCircle, Copy, ExternalLink, Book } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DocsModal } from './DocsModal';

interface GettingStartedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'npm-install' | 'quick-start' | 'mcp-setup' | 'next-steps';

// Add custom scrollbar hiding styles
const customStyles = `
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
`;

export const GettingStartedModal = ({ open, onOpenChange }: GettingStartedModalProps) => {
  const [activeStep, setActiveStep] = useState<Step>('npm-install');
  const [docsOpen, setDocsOpen] = useState(false);
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to top when step changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeStep]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Command copied successfully",
    });
  };

  const steps = [
    { id: 'npm-install' as Step, label: 'NPM Install', icon: Package },
    { id: 'quick-start' as Step, label: 'Quick Start', icon: Terminal },
    { id: 'mcp-setup' as Step, label: 'MCP Setup', icon: Plug },
    { id: 'next-steps' as Step, label: 'Next Steps', icon: CheckCircle },
  ];

  return (
    <>
      <style>{customStyles}</style>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] md:h-[80vh] h-[90vh] p-0 overflow-hidden bg-background border-border">
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          {/* Mobile Header */}
          <div className="md:hidden border-b border-border bg-panel p-4">
            <DialogTitle className="text-xl font-bold text-cyan mb-3">
              Getting Started
            </DialogTitle>
            
            {/* Mobile Navigation */}
            <nav className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
              {steps.map((step) => {
                const Icon = step.icon;
                const isActive = activeStep === step.id;
                
                return (
                  <button
                    key={step.id}
                    onClick={() => setActiveStep(step.id)}
                    className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                      isActive
                        ? 'bg-cyan/10 border border-cyan/30 text-cyan'
                        : 'bg-background/50 text-foreground border border-line'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-cyan' : 'text-muted-foreground'}`} />
                    <span className="font-medium whitespace-nowrap">{step.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Desktop Sidebar */}
          <aside className="hidden md:block w-64 border-r border-border bg-panel p-6 flex-shrink-0 overflow-y-auto">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-bold text-cyan">
                Getting Started
              </DialogTitle>
            </DialogHeader>

            <nav className="space-y-2">
              {steps.map((step) => {
                const Icon = step.icon;
                const isActive = activeStep === step.id;
                
                return (
                  <button
                    key={step.id}
                    onClick={() => setActiveStep(step.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                      isActive
                        ? 'bg-cyan/10 border border-cyan/30 text-cyan'
                        : 'hover:bg-background/50 text-foreground border border-transparent'
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${isActive ? 'text-cyan' : 'text-muted-foreground'}`} />
                    <span className="font-medium text-sm">{step.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <main ref={contentRef} className="flex-1 overflow-y-auto p-4 md:p-8" style={{ maxHeight: '80vh' }}>
            {activeStep === 'npm-install' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Install AgentDB</h2>
                  <p className="text-sm md:text-base text-muted-foreground">Get started with AgentDB using npm or npx</p>
                </div>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-cyan" />
                      NPM Installation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Install AgentDB as a dependency in your project:
                      </p>
                      <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm flex items-center justify-between group">
                        <code className="text-cyan">npm install agentdb</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard('npm install agentdb')}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-line">
                      <p className="text-sm text-muted-foreground mb-3">
                        Or use with yarn:
                      </p>
                      <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm flex items-center justify-between group">
                        <code className="text-cyan">yarn add agentdb</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard('yarn add agentdb')}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-5 w-5 text-cyan" />
                      Quick Start with NPX
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Try AgentDB instantly without installation:
                      </p>
                      <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm flex items-center justify-between group">
                        <code className="text-cyan">npx agentdb</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard('npx agentdb')}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Button 
                  onClick={() => setActiveStep('quick-start')}
                  className="w-full bg-cyan text-foreground hover:bg-cyan/90"
                >
                  Next: Quick Start →
                </Button>
              </div>
            )}

            {activeStep === 'quick-start' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Quick Start Guide</h2>
                  <p className="text-sm md:text-base text-muted-foreground">Initialize and use AgentDB in your project</p>
                </div>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 1</Badge>
                      Import AgentDB
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm">
                      <pre className="text-cyan overflow-x-auto">
{`import AgentDB from 'agentdb';

// Initialize the database
const db = new AgentDB({
  path: './agent.db',
  memory: true
});`}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 2</Badge>
                      Store and Query Vectors
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm">
                      <pre className="text-cyan overflow-x-auto">
{`// Store a vector
await db.store({
  id: 'memory-1',
  vector: [0.1, 0.2, 0.3, ...],
  metadata: { type: 'reasoning' }
});

// Query similar vectors
const results = await db.query({
  vector: [0.1, 0.2, 0.3, ...],
  k: 5
});`}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 3</Badge>
                      Use ReasoningBank
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm">
                      <pre className="text-cyan overflow-x-auto">
{`// Store reasoning patterns
await db.reasoningBank.store({
  pattern: 'problem-solving',
  context: 'user query',
  reasoning: 'step-by-step solution',
  outcome: 'successful'
});

// Query similar patterns
const patterns = await db.reasoningBank.query({
  context: 'new user query',
  k: 3
});`}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex gap-4">
                  <Button 
                    onClick={() => setActiveStep('npm-install')}
                    variant="outline"
                    className="flex-1"
                  >
                    ← Previous
                  </Button>
                  <Button 
                    onClick={() => setActiveStep('mcp-setup')}
                    className="flex-1 bg-cyan text-foreground hover:bg-cyan/90"
                  >
                    Next: MCP Setup →
                  </Button>
                </div>
              </div>
            )}

            {activeStep === 'mcp-setup' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">MCP Integration</h2>
                  <p className="text-sm md:text-base text-muted-foreground">Set up Model Context Protocol for AI agents and Claude Code</p>
                </div>

                <Card className="bg-cyan/10 border-cyan/30">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Plug className="h-5 w-5 text-cyan mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          What is MCP?
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Model Context Protocol enables AI agents to access and manage long-term memory,
                          allowing them to learn and adapt over time. AgentDB provides 29 MCP tools for
                          seamless integration with Claude Code and other AI assistants.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 1</Badge>
                      Add AgentDB MCP to Claude Code
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Add AgentDB as an MCP server to Claude Code for instant access to all 29 tools:
                      </p>
                      <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm flex items-center justify-between group">
                        <code className="text-cyan">claude mcp add agentdb npx agentdb mcp start</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard('claude mcp add agentdb npx agentdb mcp start')}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="bg-cyan/5 border border-cyan/20 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">
                        💡 <strong className="text-foreground">Tip:</strong> This gives Claude Code access to all 29 tools
                        (5 core vector + 5 core agentdb + 9 frontier memory + 10 learning tools) instantly.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 2</Badge>
                      Install MCP Server (Optional)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-3">
                        For custom MCP server implementations:
                      </p>
                      <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm flex items-center justify-between group">
                        <code className="text-cyan">npm install @agentdb/mcp-server</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard('npm install @agentdb/mcp-server')}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 3</Badge>
                      Configure Custom MCP Server (Optional)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm">
                      <pre className="text-cyan overflow-x-auto">
{`import { MCPServer } from '@agentdb/mcp-server';

const server = new MCPServer({
  database: db,
  port: 3000,
  auth: {
    enabled: true,
    secret: process.env.MCP_SECRET
  }
});

await server.start();`}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline" className="mr-2">Step 4</Badge>
                      Connect Your AI Agent (Optional)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm">
                      <pre className="text-cyan overflow-x-auto">
{`// In your AI agent code
const mcp = await connectMCP({
  url: 'http://localhost:3000',
  apiKey: process.env.MCP_API_KEY
});

// Agent can now access memory
const context = await mcp.getContext({
  query: 'user question',
  k: 5
});`}
                      </pre>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex gap-4">
                  <Button 
                    onClick={() => setActiveStep('quick-start')}
                    variant="outline"
                    className="flex-1"
                  >
                    ← Previous
                  </Button>
                  <Button 
                    onClick={() => setActiveStep('next-steps')}
                    className="flex-1 bg-cyan text-foreground hover:bg-cyan/90"
                  >
                    Next: Next Steps →
                  </Button>
                </div>
              </div>
            )}

            {activeStep === 'next-steps' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Next Steps</h2>
                  <p className="text-sm md:text-base text-muted-foreground">Explore more features and resources</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Card className="bg-panel border-border hover:border-cyan/50 transition-colors cursor-pointer">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Terminal className="h-5 w-5 text-cyan" />
                        View Demo Examples
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">
                        Explore interactive demos showcasing AgentDB's capabilities
                      </p>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => {
                          onOpenChange(false);
                          window.location.href = '/demo';
                        }}
                      >
                        View Demos
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-panel border-border hover:border-cyan/50 transition-colors cursor-pointer">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Book className="h-5 w-5 text-cyan" />
                        Documentation
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">
                        Read the full documentation and API reference
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setDocsOpen(true);
                        }}
                      >
                        View Docs
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-panel border-border hover:border-cyan/50 transition-colors">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Package className="h-5 w-5 text-cyan" />
                        NPM Package
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">
                        View package details and release notes
                      </p>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        asChild
                      >
                        <a 
                          href="https://www.npmjs.com/package/agentdb" 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          View on NPM
                        </a>
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-panel border-border hover:border-cyan/50 transition-colors">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <CheckCircle className="h-5 w-5 text-cyan" />
                        GitHub Repository
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">
                        Star the repo and contribute to the project
                      </p>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        asChild
                      >
                        <a 
                          href="https://github.com/ruvnet/agentic-flow" 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          View on GitHub
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-cyan/10 border-cyan/30">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      Ready to Build? 🚀
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      You're all set! Start building intelligent agents with AgentDB.
                      Check out the examples and documentation for more advanced features.
                    </p>
                    <Button 
                      onClick={() => onOpenChange(false)}
                      className="bg-cyan text-foreground hover:bg-cyan/90"
                    >
                      Get Started Building
                    </Button>
                  </CardContent>
                </Card>

                <Button 
                  onClick={() => setActiveStep('mcp-setup')}
                  variant="outline"
                  className="w-full"
                >
                  ← Previous
                </Button>
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
    <DocsModal open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  );
};