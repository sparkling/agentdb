import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, Database, Network, Code, TrendingUp, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

export const CapabilitiesOverview = () => {
  return (
    <section id="capabilities" className="py-20 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="text-cyan">Complete Agent Cognitive Stack</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
            Six integrated systems working together to give your agents memory, learning, and coordination
          </p>
        </div>

        {/* Primary Systems */}
        <div className="max-w-6xl mx-auto mb-12">
          <div className="flex items-center justify-center gap-2 mb-6">
            <h3 className="text-xl font-semibold text-foreground text-center">Primary Systems</h3>
            <Link to="/demo">
              <Badge variant="outline" className="text-xs cursor-pointer hover:bg-cyan/10 transition-colors">Click to explore demos</Badge>
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {/* ReasoningBank */}
            <Link to="/demo" className="block group">
              <Card className="bg-panel border-cyan/30 hover-lift transition-all hover:border-cyan/60 hover:shadow-lg hover:shadow-cyan/20 h-full">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-cyan/10 rounded-lg group-hover:bg-cyan/20 transition-colors">
                      <Brain className="h-7 w-7 text-cyan" />
                    </div>
                    <CardTitle className="text-foreground text-lg">ReasoningBank</CardTitle>
                  </div>
                  <ExternalLink className="h-4 w-4 text-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Cognitive Layer
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  Learn from experience and improve over time. Stores successful patterns, tracks performance, and synthesizes context.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Pattern Matching</span>
                    <span className="text-cyan font-semibold">&lt;1ms</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Memory Reduction</span>
                    <span className="text-cyan font-semibold">85%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Components</span>
                    <span className="text-foreground font-semibold">4</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Improvement</span>
                    <span className="text-cyan font-semibold">+350%</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-border/30">
                  <div className="text-xs text-muted-foreground mb-2">Includes:</div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-xs">PatternMatcher</Badge>
                    <Badge variant="secondary" className="text-xs">ExperienceCurator</Badge>
                    <Badge variant="secondary" className="text-xs">MemoryOptimizer</Badge>
                    <Badge variant="secondary" className="text-xs">ContextSynthesizer</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            </Link>

            {/* Learning System */}
            <Link to="/demo" className="block group">
              <Card className="bg-panel border-cyan/30 hover-lift transition-all hover:border-cyan/60 hover:shadow-lg hover:shadow-cyan/20 h-full">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-cyan/10 rounded-lg group-hover:bg-cyan/20 transition-colors">
                      <TrendingUp className="h-7 w-7 text-cyan" />
                    </div>
                    <CardTitle className="text-foreground text-lg">Learning Plugins</CardTitle>
                  </div>
                  <ExternalLink className="h-4 w-4 text-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Reinforcement Learning
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  Custom reinforcement learning through interactive wizards. No code required—just answer prompts.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Algorithms</span>
                    <span className="text-cyan font-semibold">12+</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Setup Time</span>
                    <span className="text-cyan font-semibold">2 min</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Code Required</span>
                    <span className="text-foreground font-semibold">Zero</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Auto-Generated</span>
                    <span className="text-cyan font-semibold">100%</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-border/30">
                  <div className="text-xs text-muted-foreground mb-2">Popular algorithms:</div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-xs bg-cyan/20 text-cyan">Decision Transformer</Badge>
                    <Badge variant="secondary" className="text-xs">Q-Learning</Badge>
                    <Badge variant="secondary" className="text-xs">Federated</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            </Link>

            {/* Vector Storage */}
            <Link to="/demo" className="block group">
              <Card className="bg-panel border-cyan/30 hover-lift transition-all hover:border-cyan/60 hover:shadow-lg hover:shadow-cyan/20 h-full">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-cyan/10 rounded-lg group-hover:bg-cyan/20 transition-colors">
                      <Database className="h-7 w-7 text-cyan" />
                    </div>
                    <CardTitle className="text-foreground text-lg">Vector Storage</CardTitle>
                  </div>
                  <ExternalLink className="h-4 w-4 text-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground">
                  HNSW Index · Graph-Based Search
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  Lightning-fast vector database with HNSW graph indexing for sub-millisecond search.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Startup Time</span>
                    <span className="text-cyan font-semibold">&lt;10ms</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Search Speed</span>
                    <span className="text-cyan font-semibold">~5ms</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Insert Rate</span>
                    <span className="text-foreground font-semibold">116K/s</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Footprint</span>
                    <span className="text-cyan font-semibold">700B/vec</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-border/30">
                  <div className="text-xs text-muted-foreground mb-2">Features:</div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-xs">ACID</Badge>
                    <Badge variant="secondary" className="text-xs">Zero-config</Badge>
                    <Badge variant="secondary" className="text-xs">Universal</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            </Link>
          </div>
        </div>

        {/* Supporting Systems */}
        <div className="max-w-6xl mx-auto">
          <h3 className="text-xl font-semibold text-foreground mb-6 text-center">Supporting Systems</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {/* QUIC Sync */}
            <Card className="bg-panel border-border/50 hover-lift">
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-cyan/10 rounded-lg">
                    <Network className="h-6 w-6 text-cyan" />
                  </div>
                  <CardTitle className="text-foreground">QUIC Sync</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Keeps agents in sync instantly across your network. Only sends what changed, and handles conflicts automatically.
                </p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Sync Latency</span>
                    <span className="text-cyan">&lt;100ms</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Compression</span>
                    <span className="text-foreground">Delta-based</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Topologies</span>
                    <span className="text-cyan">3 types</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* MCP Integration */}
            <Card className="bg-panel border-border/50 hover-lift">
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-cyan/10 rounded-lg">
                    <Code className="h-6 w-6 text-cyan" />
                  </div>
                  <CardTitle className="text-foreground">MCP Integration</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Model Context Protocol support with 29 built-in tools. Works with Claude, Cursor, and more.
                </p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Built-in Tools</span>
                    <span className="text-cyan">29</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Setup</span>
                    <span className="text-foreground">Automatic</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Compatible</span>
                    <span className="text-cyan">Universal</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Universal Runtime */}
            <Card className="bg-panel border-border/50 hover-lift">
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-cyan/10 rounded-lg">
                    <Zap className="h-6 w-6 text-cyan" />
                  </div>
                  <CardTitle className="text-foreground">Universal Runtime</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Runs anywhere your agents live. Node.js, browser, edge functions, and distributed networks.
                </p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Platforms</span>
                    <span className="text-cyan">All</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Configuration</span>
                    <span className="text-foreground">Zero</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Dependencies</span>
                    <span className="text-cyan">None</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};
