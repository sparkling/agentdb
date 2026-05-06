import { Card } from "@/components/ui/card";
import { Check, X } from "lucide-react";

export const WhyAgentDB = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-cyan">🎯 Why AgentDB?</span>
            </h2>
            <p className="text-xl text-foreground font-semibold mb-6">
              Built for the Agentic Era
            </p>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                Most memory systems were designed for data retrieval. AgentDB was built for <span className="text-foreground">autonomous cognition</span> — agents that need to remember, learn, and act together in real time.
              </p>
              <p>
                In agentic systems, memory isn't a feature. <span className="text-cyan">It's the foundation of continuity.</span> AgentDB gives each agent a lightweight, persistent brain that grows through experience and syncs with others as needed. Whether running solo or as part of a swarm, every agent stays informed, adaptive, and self-improving.
              </p>
              <Card className="bg-panel/50 border-cyan/20 p-6 mt-6">
                <p className="text-sm text-foreground">
                  <span className="text-cyan font-semibold">What makes it different:</span><br />
                  AgentDB lives where the agent lives — inside the runtime, not as an external service. It turns short-term execution into long-term intelligence without touching a network call.
                </p>
              </Card>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="mb-12">
            <h3 className="text-2xl font-bold text-cyan mb-6">⚡ Core Advantages</h3>
            <Card className="bg-card border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-panel">
                      <th className="text-left p-4 font-semibold text-foreground">Capability</th>
                      <th className="text-left p-4 font-semibold text-cyan">AgentDB</th>
                      <th className="text-left p-4 font-semibold text-muted-foreground">Typical Systems</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Startup Time</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>⚡</span>
                          <span className="text-foreground">&lt;10 ms (disk) / ~100 ms (browser)</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🐌</span>
                          <span className="text-muted-foreground">Seconds – minutes</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Footprint</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🪶</span>
                          <span className="text-foreground">0.7 MB per 1K vectors</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>💾</span>
                          <span className="text-muted-foreground">10–100× larger</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Memory Model</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🧠</span>
                          <span className="text-foreground">ReasoningBank built-in</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span className="text-muted-foreground">Add-on or manual</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Learning Layer</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🔧</span>
                          <span className="text-foreground">RL plugins, no code</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span className="text-muted-foreground">External ML stack</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Runtime Scope</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🌐</span>
                          <span className="text-foreground">Node · Browser · Edge · MCP</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span className="text-muted-foreground">Server-only</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Coordination</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🔄</span>
                          <span className="text-foreground">QUIC sync built-in</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span className="text-muted-foreground">External services</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Query Speed</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>⚡</span>
                          <span className="text-foreground">~5ms for 100K vectors</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🐌</span>
                          <span className="text-muted-foreground">100ms+ typical</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Insert Performance</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🚀</span>
                          <span className="text-foreground">10K+ writes/sec</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>📊</span>
                          <span className="text-muted-foreground">Batch-dependent</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Adaptive Learning</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🧠</span>
                          <span className="text-foreground">Built-in RL + experience tracking</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span className="text-muted-foreground">Custom ML required</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Agent Orchestration</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🤖</span>
                          <span className="text-foreground">Swarm-optimized · shared context</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span className="text-muted-foreground">Single-agent focus</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="hover:bg-panel/30 transition-colors">
                      <td className="p-4 text-muted-foreground">Setup</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>⚙️</span>
                          <span className="text-foreground">Zero config · instant start</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>🐢</span>
                          <span className="text-muted-foreground">Complex deployment</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Vector Query Capabilities */}
          <div className="mb-12">
            <h3 className="text-2xl font-bold text-cyan mb-4">🔍 Powerful Query Builder</h3>
            <p className="text-muted-foreground mb-6">
              Type-safe, fluent API for complex vector operations — filter, sort, and paginate with ease.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="bg-card border-border p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🎯</span>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">Flexible Similarity Search</h4>
                    <p className="text-sm text-muted-foreground">Cosine, Euclidean, Dot Product metrics with threshold filtering</p>
                  </div>
                </div>
              </Card>
              <Card className="bg-card border-border p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🔧</span>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">Advanced Filtering</h4>
                    <p className="text-sm text-muted-foreground">Where clauses, range queries, metadata paths with full type safety</p>
                  </div>
                </div>
              </Card>
              <Card className="bg-card border-border p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📊</span>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">Smart Pagination</h4>
                    <p className="text-sm text-muted-foreground">Efficient offset/limit with count queries for large result sets</p>
                  </div>
                </div>
              </Card>
              <Card className="bg-card border-border p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">Chainable API</h4>
                    <p className="text-sm text-muted-foreground">Fluent builder pattern for readable, maintainable query logic</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Bottom CTA */}
          <Card className="bg-panel border-cyan/30 p-8 scanline-overlay">
            <h3 className="text-2xl font-bold text-cyan mb-4">
              🧠 For Engineers Who Build Agents That Think
            </h3>
            <ul className="space-y-3 text-muted-foreground mb-6">
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 text-cyan mt-0.5 flex-shrink-0" />
                <span>Run reasoning where it happens — inside the control loop</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 text-cyan mt-0.5 flex-shrink-0" />
                <span>Persist experiences without remote dependencies</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 text-cyan mt-0.5 flex-shrink-0" />
                <span>Sync distributed cognition in real time</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 text-cyan mt-0.5 flex-shrink-0" />
                <span>Deploy anywhere: Node, browser, edge, MCP</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-5 w-5 text-cyan mt-0.5 flex-shrink-0" />
                <span>Scale from one agent to thousands without re-architecture</span>
              </li>
            </ul>
            <div className="pt-6 border-t border-border">
              <p className="text-foreground font-semibold text-lg">
                AgentDB isn't just a faster vector store.<br />
                <span className="text-cyan">It's the missing layer that lets agents remember what worked, learn what didn't, and share what matters.</span>
              </p>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
};
