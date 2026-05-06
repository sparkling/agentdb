import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export const ConsolePanel = () => {
  const [activeTab, setActiveTab] = useState("console");
  
  return (
    <section className="py-16">
      <div className="container mx-auto px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 bg-panel border border-border/50 p-1 mb-6 h-auto gap-1">
            <TabsTrigger 
              value="console" 
              className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan data-[state=active]:shadow-lg data-[state=active]:shadow-cyan/20 transition-all duration-300 py-3 font-semibold relative data-[state=inactive]:text-muted-foreground hover:text-foreground"
            >
              Console
            </TabsTrigger>
            <TabsTrigger 
              value="memory" 
              className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan data-[state=active]:shadow-lg data-[state=active]:shadow-cyan/20 transition-all duration-300 py-3 font-semibold relative data-[state=inactive]:text-muted-foreground hover:text-foreground"
            >
              Memory
            </TabsTrigger>
            <TabsTrigger 
              value="vectors" 
              className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan data-[state=active]:shadow-lg data-[state=active]:shadow-cyan/20 transition-all duration-300 py-3 font-semibold relative data-[state=inactive]:text-muted-foreground hover:text-foreground"
            >
              Vectors
            </TabsTrigger>
            <TabsTrigger 
              value="sync" 
              className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan data-[state=active]:shadow-lg data-[state=active]:shadow-cyan/20 transition-all duration-300 py-3 font-semibold relative data-[state=inactive]:text-muted-foreground hover:text-foreground"
            >
              Sync
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="console" className="mt-0 animate-fade-in">
            <Card className="bg-panel border-cyan/30 scanline-overlay shadow-lg">
              <div className="p-4 border-b border-border/50 bg-panel-strong">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
                  <span className="font-mono text-xs text-cyan font-semibold">LIVE TERMINAL</span>
                </div>
              </div>
              <CardContent className="p-0">
                <ScrollArea className="h-96">
                  <div className="p-6 font-mono text-sm space-y-3">
                    <div className="text-muted-foreground">$ agentdb init --path ./memory.db</div>
                    <div className="text-cyan flex items-center gap-2">
                      <span>✓</span>
                      <span>Database initialized</span>
                    </div>
                    
                    <div className="text-muted-foreground mt-4">$ agentdb sync --status</div>
                    <div className="space-y-1">
                      <div className="text-cyan flex items-center gap-2">
                        <span>✓</span>
                        <span>QUIC link established</span>
                      </div>
                      <div className="text-cyan flex items-center gap-2">
                        <span>✓</span>
                        <span>MCP tools discovered: 29</span>
                      </div>
                      <div className="text-cyan flex items-center gap-2">
                        <span>✓</span>
                        <span>ReasoningBank warm cache ready</span>
                      </div>
                    </div>
                    
                    <div className="text-muted-foreground mt-6 pt-4 border-t border-border/30">$ agentdb stats</div>
                    <div className="grid grid-cols-2 gap-4 pl-4">
                      <div className="space-y-2">
                        <div className="text-foreground">
                          <span className="text-cyan font-semibold">Vectors:</span> <span className="text-foreground">100,000</span>
                        </div>
                        <div className="text-foreground">
                          <span className="text-cyan font-semibold">Storage:</span> <span className="text-foreground">74MB</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-foreground">
                          <span className="text-cyan font-semibold">Index:</span> <span className="text-foreground">HNSW</span>
                        </div>
                        <div className="text-foreground">
                          <span className="text-cyan font-semibold">Search:</span> <span className="text-foreground">~5ms avg</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-6 pt-4">
                      <span className="text-cyan">$</span>
                      <span className="caret-blink text-cyan">▍</span>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="memory" className="mt-0 animate-fade-in">
            <Card className="bg-panel border-cyan/30 shadow-lg">
              <div className="p-4 border-b border-border/50 bg-panel-strong">
                <div className="flex items-center gap-2">
                  <span className="text-cyan text-lg">🧠</span>
                  <span className="font-mono text-xs text-cyan font-semibold">REASONING BANK</span>
                </div>
              </div>
              <CardContent className="p-0">
                <ScrollArea className="h-96">
                  <div className="p-6 font-mono text-sm space-y-4">
                    <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20">
                      <div className="text-cyan text-xs font-semibold mb-3">PATTERN STATISTICS</div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground text-xs">Total Patterns</span>
                          <span className="text-foreground font-bold">1,247</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground text-xs">Avg Success Rate</span>
                          <span className="text-cyan font-bold">87.3%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground text-xs">Active Domains</span>
                          <span className="text-foreground text-xs">3</span>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-cyan text-xs font-semibold mb-3">TOP PATTERNS</div>
                      <div className="space-y-2">
                        <div className="flex items-start gap-3 p-3 bg-panel-strong rounded-lg border border-border/50 hover:border-cyan/30 transition-colors">
                          <Badge variant="secondary" className="bg-cyan/20 text-cyan text-xs font-bold px-2">95%</Badge>
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground text-xs font-semibold mb-1">Sequential task decomposition</div>
                            <div className="text-muted-foreground text-xs">Used 23 times • 18ms avg • code_gen</div>
                          </div>
                        </div>
                        
                        <div className="flex items-start gap-3 p-3 bg-panel-strong rounded-lg border border-border/50 hover:border-cyan/30 transition-colors">
                          <Badge variant="secondary" className="bg-cyan/20 text-cyan text-xs font-bold px-2">91%</Badge>
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground text-xs font-semibold mb-1">Context-aware code generation</div>
                            <div className="text-muted-foreground text-xs">Used 47 times • 12ms avg • task_planning</div>
                          </div>
                        </div>
                        
                        <div className="flex items-start gap-3 p-3 bg-panel-strong rounded-lg border border-border/50 hover:border-cyan/30 transition-colors">
                          <Badge variant="secondary" className="bg-cyan/20 text-cyan text-xs font-bold px-2">88%</Badge>
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground text-xs font-semibold mb-1">Adaptive error recovery</div>
                            <div className="text-muted-foreground text-xs">Used 31 times • 9ms avg • data_analysis</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="vectors" className="mt-0 animate-fade-in">
            <Card className="bg-panel border-cyan/30 shadow-lg">
              <div className="p-4 border-b border-border/50 bg-panel-strong">
                <div className="flex items-center gap-2">
                  <span className="text-cyan text-lg">⚡</span>
                  <span className="font-mono text-xs text-cyan font-semibold">VECTOR DATABASE</span>
                </div>
              </div>
              <CardContent className="p-0">
                <ScrollArea className="h-96">
                  <div className="p-6 font-mono text-sm space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-panel-strong border border-cyan/20 p-4 rounded-lg">
                        <div className="text-cyan text-xs font-semibold mb-2">Insert Performance</div>
                        <div className="text-3xl font-bold text-foreground mb-1">116K/sec</div>
                        <div className="text-muted-foreground text-xs">Native backend</div>
                      </div>
                      <div className="bg-panel-strong border border-cyan/20 p-4 rounded-lg">
                        <div className="text-cyan text-xs font-semibold mb-2">Search Latency</div>
                        <div className="text-3xl font-bold text-foreground mb-1">~5ms</div>
                        <div className="text-muted-foreground text-xs">HNSW @ 100K vectors</div>
                      </div>
                    </div>
                    
                    <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20">
                      <div className="text-cyan text-xs font-semibold mb-3">HNSW INDEX STATUS</div>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">Graph Construction</span>
                          <span className="text-cyan font-semibold">Complete</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">M (connections/node)</span>
                          <span className="text-foreground font-semibold">16</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">efConstruction</span>
                          <span className="text-foreground font-semibold">200</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">efSearch</span>
                          <span className="text-foreground font-semibold">50</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-t border-border/30 pt-2 mt-2">
                          <span className="text-muted-foreground">Recall Accuracy</span>
                          <span className="text-cyan font-bold text-sm">97%</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-panel-strong p-4 rounded-lg border border-border/50">
                      <div className="text-xs space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-cyan" />
                          <span className="text-muted-foreground">Total vectors: <span className="text-foreground font-semibold">100,000</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-cyan" />
                          <span className="text-muted-foreground">Storage size: <span className="text-foreground font-semibold">74 MB</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-cyan" />
                          <span className="text-muted-foreground">Avg vector size: <span className="text-foreground font-semibold">768 bytes</span></span>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="sync" className="mt-0 animate-fade-in">
            <Card className="bg-panel border-cyan/30 shadow-lg">
              <div className="p-4 border-b border-border/50 bg-panel-strong">
                <div className="flex items-center gap-2">
                  <span className="text-cyan text-lg">🔄</span>
                  <span className="font-mono text-xs text-cyan font-semibold">QUIC SYNCHRONIZATION</span>
                </div>
              </div>
              <CardContent className="p-0">
                <ScrollArea className="h-96">
                  <div className="p-6 font-mono text-sm space-y-4">
                    <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-3 w-3 rounded-full bg-cyan animate-pulse shadow-lg shadow-cyan/50" />
                        <span className="text-cyan font-bold text-sm">CONNECTED</span>
                      </div>
                      
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">Protocol</span>
                          <span className="text-cyan font-semibold">QUIC/UDP</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">Round Trip Time</span>
                          <span className="text-foreground font-semibold">12ms</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">Bandwidth</span>
                          <span className="text-foreground font-semibold">2.4 MB/s</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-t border-border/30 pt-2 mt-2">
                          <span className="text-muted-foreground">Delta Compression</span>
                          <span className="text-cyan font-bold">85% reduction</span>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-cyan text-xs font-semibold mb-3">RECENT SYNC EVENTS</div>
                      <div className="space-y-2">
                        <div className="bg-panel-strong p-3 rounded-lg border border-border/50 text-xs">
                          <div className="flex items-start gap-2">
                            <span className="text-cyan font-bold">[12:34:56]</span>
                            <div className="flex-1">
                              <div className="text-foreground font-semibold">Delta sync completed</div>
                              <div className="text-muted-foreground">127 vectors synchronized</div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="bg-panel-strong p-3 rounded-lg border border-border/50 text-xs">
                          <div className="flex items-start gap-2">
                            <span className="text-cyan font-bold">[12:34:51]</span>
                            <div className="flex-1">
                              <div className="text-foreground font-semibold">Conflict resolved</div>
                              <div className="text-muted-foreground">Strategy: Last-write-wins</div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="bg-panel-strong p-3 rounded-lg border border-border/50 text-xs">
                          <div className="flex items-start gap-2">
                            <span className="text-cyan font-bold">[12:34:45]</span>
                            <div className="flex-1">
                              <div className="text-foreground font-semibold">Peer connected</div>
                              <div className="text-muted-foreground">Node: agent-node-02</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
};
