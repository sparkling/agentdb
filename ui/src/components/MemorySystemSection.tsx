import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Network, Zap, Layers } from "lucide-react";

export const MemorySystemSection = () => {
  return (
    <section className="py-20 bg-panel/30">
      <div className="container mx-auto px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-cyan">💾 Memory System</span>
            </h2>
            <p className="text-xl text-foreground mb-2">
              Lightning-fast vector storage for agent memories
            </p>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Three integrated layers: Vector Database, ReasoningBank cognitive layer, 
              and QUIC synchronization for distributed agents.
            </p>
          </div>

          {/* Architecture Diagram */}
          <Card className="bg-panel border-cyan/30 mb-12">
            <CardHeader>
              <CardTitle className="text-cyan flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Three-Layer Architecture
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Layer 3: QUIC Sync */}
                <div className="bg-panel-strong p-6 rounded-lg border border-cyan/20">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-cyan/10 rounded">
                      <Network className="h-6 w-6 text-cyan" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-foreground font-semibold mb-2">Layer 3: QUIC Synchronization</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Real-time coordination across distributed agents
                      </p>
                      <div className="grid md:grid-cols-3 gap-3 text-xs">
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Sync Latency</div>
                          <div className="text-foreground">&lt;100ms</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Compression</div>
                          <div className="text-foreground">Delta-based</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Topologies</div>
                          <div className="text-foreground">Hub/Mesh/Ring</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layer 2: ReasoningBank */}
                <div className="bg-panel-strong p-6 rounded-lg border border-cyan/20">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-cyan/10 rounded">
                      <Zap className="h-6 w-6 text-cyan" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-foreground font-semibold mb-2">Layer 2: ReasoningBank Cognitive Layer</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Organizes memories into patterns, experiences, and contexts
                      </p>
                      <div className="grid md:grid-cols-4 gap-3 text-xs">
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Patterns</div>
                          <div className="text-foreground">&lt;1ms search</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Experiences</div>
                          <div className="text-foreground">Quality scored</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Optimization</div>
                          <div className="text-foreground">85% savings</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Context</div>
                          <div className="text-foreground">25-40ms</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layer 1: Storage */}
                <div className="bg-panel-strong p-6 rounded-lg border border-cyan/20">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-cyan/10 rounded">
                      <Database className="h-6 w-6 text-cyan" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-foreground font-semibold mb-2">Layer 1: Vector Database (SQLite + HNSW)</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Battle-tested storage with blazing-fast similarity search
                      </p>
                      <div className="grid md:grid-cols-4 gap-3 text-xs">
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Startup</div>
                          <div className="text-foreground">&lt;10ms disk</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Insert</div>
                          <div className="text-foreground">116K/sec</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Search</div>
                          <div className="text-foreground">~5ms HNSW</div>
                        </div>
                        <div className="bg-background/30 p-3 rounded border border-border/30">
                          <div className="text-cyan font-semibold mb-1">Memory</div>
                          <div className="text-foreground">700 bytes/vec</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* QUIC Topologies */}
          <div className="mb-12">
            <h3 className="text-2xl font-bold text-foreground mb-6">
              Distributed Synchronization Topologies
            </h3>
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="bg-panel border-cyan/20 hover-lift">
                <CardHeader>
                  <CardTitle className="text-foreground text-lg">Hub-Spoke</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-panel-strong p-4 rounded border border-border/50 font-mono text-xs mb-4">
                    <div className="text-center text-cyan">Hub</div>
                    <div className="text-center text-muted-foreground">/ | \</div>
                    <div className="text-center text-foreground">A B C</div>
                  </div>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Centralized coordination</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Hub aggregates all knowledge</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Workers sync to hub</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="bg-panel border-cyan/20 hover-lift">
                <CardHeader>
                  <CardTitle className="text-foreground text-lg">Mesh (P2P)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-panel-strong p-4 rounded border border-border/50 font-mono text-xs mb-4">
                    <div className="text-center text-foreground">A ↔ B</div>
                    <div className="text-center text-muted-foreground">↕ ↕</div>
                    <div className="text-center text-foreground">C ↔ D</div>
                  </div>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>No central coordinator</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Agents sync directly</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Fault-tolerant design</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="bg-panel border-cyan/20 hover-lift">
                <CardHeader>
                  <CardTitle className="text-foreground text-lg">Ring</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-panel-strong p-4 rounded border border-border/50 font-mono text-xs mb-4">
                    <div className="text-center text-foreground">A → B → C</div>
                    <div className="text-center text-muted-foreground">↑ ↓</div>
                    <div className="text-center text-foreground">← D ←</div>
                  </div>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Sequential propagation</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Ordered updates</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">•</span>
                      <span>Predictable latency</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Why SQLite */}
          <Card className="bg-panel border-cyan/30">
            <CardHeader>
              <CardTitle className="text-cyan">Why SQLite?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3">Perfect for Agents</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">✓</span>
                      <span><span className="text-foreground">Zero configuration</span> - Works instantly</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">✓</span>
                      <span><span className="text-foreground">Universal</span> - Node, browser, edge, anywhere</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">✓</span>
                      <span><span className="text-foreground">Battle-tested</span> - Used by billions of devices</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">✓</span>
                      <span><span className="text-foreground">ACID transactions</span> - Data integrity guaranteed</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">✓</span>
                      <span><span className="text-foreground">Flexible</span> - File-based or in-memory</span>
                    </li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3">HNSW Acceleration</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Think of it like a smart library index. Instead of checking every book (vector) one by one, 
                    HNSW creates a multi-level map that jumps directly to similar items. This makes searches 116x faster.
                  </p>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">→</span>
                      <span><span className="text-foreground font-semibold">116x faster</span> than checking every vector</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">→</span>
                      <span><span className="text-foreground font-semibold">~5ms</span> to find similar items in 100K vectors</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">→</span>
                      <span><span className="text-foreground font-semibold">97% accuracy</span> — finds the right matches</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">→</span>
                      <span><span className="text-foreground font-semibold">Automatic</span> — updates itself as you add data</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan">→</span>
                      <span><span className="text-foreground font-semibold">Scales</span> — works with millions of memories</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};
