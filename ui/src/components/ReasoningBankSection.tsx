import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Target, Archive, Sparkles } from "lucide-react";

export const ReasoningBankSection = () => {
  return (
    <section className="py-20 bg-panel/30">
      <div className="container mx-auto px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-cyan">🧠 ReasoningBank System</span>
            </h2>
            <p className="text-xl text-foreground mb-2">
              Give agents the ability to learn from experience
            </p>
            <p className="text-muted-foreground">
              A cognitive layer that stores, organizes, and retrieves reasoning patterns. 
              Think of it as your agent's brain that remembers what worked, what didn't, and why.
            </p>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid grid-cols-4 bg-panel border border-border/50 p-1 mb-6 h-auto gap-1">
              <TabsTrigger 
                value="overview"
                className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan transition-all duration-300 py-3"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger 
                value="pattern"
                className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan transition-all duration-300 py-3"
              >
                PatternMatcher
              </TabsTrigger>
              <TabsTrigger 
                value="experience"
                className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan transition-all duration-300 py-3"
              >
                ExperienceCurator
              </TabsTrigger>
              <TabsTrigger 
                value="optimizer"
                className="data-[state=active]:bg-cyan/10 data-[state=active]:text-cyan data-[state=active]:border-b-2 data-[state=active]:border-cyan transition-all duration-300 py-3"
              >
                MemoryOptimizer
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="animate-fade-in">
              <div className="grid md:grid-cols-2 gap-6">
                <Card className="bg-panel border-cyan/20">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Brain className="h-5 w-5 text-cyan" />
                      4 Core Components
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 text-sm">
                      <li className="flex items-start gap-2">
                        <span className="text-cyan mt-1">1.</span>
                        <div>
                          <span className="text-foreground font-semibold">PatternMatcher</span>
                          <p className="text-muted-foreground text-xs">Store and retrieve successful reasoning patterns</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan mt-1">2.</span>
                        <div>
                          <span className="text-foreground font-semibold">ExperienceCurator</span>
                          <p className="text-muted-foreground text-xs">Track detailed execution history with quality scoring</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan mt-1">3.</span>
                        <div>
                          <span className="text-foreground font-semibold">MemoryOptimizer</span>
                          <p className="text-muted-foreground text-xs">Compress old memories, 85% reduction maintained</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan mt-1">4.</span>
                        <div>
                          <span className="text-foreground font-semibold">ContextSynthesizer</span>
                          <p className="text-muted-foreground text-xs">Combine all sources into actionable context</p>
                        </div>
                      </li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-cyan/20">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Target className="h-5 w-5 text-cyan" />
                      Measured Improvement
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4 text-sm">
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-muted-foreground">Success Rate</span>
                          <span className="text-cyan font-bold">+350%</span>
                        </div>
                        <div className="text-xs text-muted-foreground">20% → 90% over 10 iterations</div>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-muted-foreground">Execution Time</span>
                          <span className="text-cyan font-bold">-40%</span>
                        </div>
                        <div className="text-xs text-muted-foreground">5000ms → 3000ms average</div>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-muted-foreground">Quality Score</span>
                          <span className="text-cyan font-bold">+200%</span>
                        </div>
                        <div className="text-xs text-muted-foreground">30% → 90% quality improvement</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="pattern" className="animate-fade-in">
              <Card className="bg-panel border-cyan/30">
                <CardHeader>
                  <CardTitle className="text-cyan">PatternMatcher: Learning What Works</CardTitle>
                  <p className="text-sm text-muted-foreground">Store and retrieve successful reasoning patterns</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-panel-strong p-4 rounded-lg border border-border/50">
                    <h4 className="text-sm font-semibold text-foreground mb-2">How It Works</h4>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="text-cyan">•</span>
                        <span>Successful task completions stored as patterns</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan">•</span>
                        <span>Each pattern includes: task type, approach, success rate, metrics</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan">•</span>
                        <span>Similar patterns retrieved via vector similarity search</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan">•</span>
                        <span>Highest success pattern recommended for reuse</span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20 font-mono text-xs">
                    <div className="text-cyan mb-2"># Example Pattern</div>
                    <div className="space-y-1 text-muted-foreground">
                      <div>Task: "Build authentication system"</div>
                      <div>Pattern: &#123;</div>
                      <div className="pl-4">approach: "JWT with refresh tokens",</div>
                      <div className="pl-4">successRate: 92%,</div>
                      <div className="pl-4">avgDuration: 1500ms,</div>
                      <div className="pl-4">taskType: "api-security"</div>
                      <div>&#125;</div>
                      <div className="mt-2 text-cyan">Performance: &lt;1ms to find patterns in 1K+ stored</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="experience" className="animate-fade-in">
              <Card className="bg-panel border-cyan/30">
                <CardHeader>
                  <CardTitle className="text-cyan">ExperienceCurator: Tracking Performance</CardTitle>
                  <p className="text-sm text-muted-foreground">Store detailed execution history and filter by quality</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-panel-strong p-4 rounded-lg border border-border/50">
                    <h4 className="text-sm font-semibold text-foreground mb-3">What It Does</h4>
                    <p className="text-sm text-muted-foreground mb-3">
                      Think of ExperienceCurator as your agent's performance tracker. Every time your agent completes a task, 
                      it records not just whether it succeeded or failed, but <span className="text-foreground">how well</span> it performed. 
                      This helps your agent identify which approaches work best.
                    </p>
                    <div className="bg-background/30 p-3 rounded border border-cyan/20">
                      <p className="text-xs text-muted-foreground">
                        <span className="text-cyan font-semibold">Example:</span> If your agent processes 100 user requests, 
                        ExperienceCurator tracks which ones were fastest, used least resources, and had highest success rates. 
                        Next time, it prioritizes the most efficient approaches.
                      </p>
                    </div>
                  </div>

                  <div className="bg-panel-strong p-4 rounded-lg border border-border/50">
                    <h4 className="text-sm font-semibold text-foreground mb-3">How Quality is Calculated</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Each experience gets a quality score from 0 to 1 (1 being perfect). Here's how it's calculated:
                    </p>
                    <div className="space-y-3">
                      <div className="bg-background/30 p-3 rounded border border-cyan/20">
                        <div className="font-mono text-xs text-cyan mb-2">
                          Quality = (Success × 60%) + (Speed × 20%) + (Tokens × 10%) + (Iterations × 10%)
                        </div>
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <div>
                            <span className="text-foreground font-semibold">Success (60%):</span> Did it work? This matters most. 
                            Success = 1 if task completed correctly, 0 if failed.
                          </div>
                          <div>
                            <span className="text-foreground font-semibold">Speed (20%):</span> How fast was it? 
                            Faster = better score. Normalized so average speed = 0.5.
                          </div>
                          <div>
                            <span className="text-foreground font-semibold">Tokens (10%):</span> How efficient with resources? 
                            Fewer tokens used = higher score.
                          </div>
                          <div>
                            <span className="text-foreground font-semibold">Iterations (10%):</span> How many tries needed? 
                            Solving on first try = 1.0, multiple retries = lower score.
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-background/30 p-3 rounded border border-border/50">
                        <p className="text-xs text-cyan font-semibold mb-2">Real Example:</p>
                        <div className="space-y-1 text-xs text-muted-foreground font-mono">
                          <div>Task: "Generate API documentation"</div>
                          <div className="text-foreground">• Success: ✓ (1.0 × 60% = 0.60)</div>
                          <div className="text-foreground">• Speed: 2000ms vs 3000ms avg (0.7 × 20% = 0.14)</div>
                          <div className="text-foreground">• Tokens: 500 vs 800 avg (0.8 × 10% = 0.08)</div>
                          <div className="text-foreground">• Iterations: First try (1.0 × 10% = 0.10)</div>
                          <div className="text-cyan font-semibold mt-2">Total Quality Score: 0.92 (Excellent!)</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-panel-strong p-4 rounded-lg border border-border/50">
                      <h4 className="text-sm font-semibold text-cyan mb-3">What Gets Tracked</h4>
                      <p className="text-xs text-muted-foreground mb-2">Every execution records:</p>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Outcome:</span> Success or failure</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Execution time:</span> How long it took (milliseconds)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Tokens used:</span> Resource consumption</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Quality score:</span> Overall performance (0-1)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Approach used:</span> Which strategy worked</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Iterations:</span> How many attempts needed</span>
                        </li>
                      </ul>
                    </div>

                    <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20">
                      <h4 className="text-sm font-semibold text-cyan mb-3">Smart Filtering</h4>
                      <p className="text-xs text-muted-foreground mb-2">Query experiences by:</p>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Domain:</span> "auth", "database", "API", etc.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Quality threshold:</span> Only show scores above 0.7</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Success only:</span> Filter out failures</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-foreground">Time range:</span> Last week, month, etc.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-cyan">•</span>
                          <span><span className="text-cyan font-semibold">Lightning fast:</span> 1-2ms for 2,000+ records</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-cyan/10 to-transparent p-4 rounded-lg border border-cyan/30">
                    <h4 className="text-sm font-semibold text-cyan mb-2">Why This Matters</h4>
                    <p className="text-xs text-muted-foreground">
                      By tracking performance over time, your agent learns which approaches consistently deliver the best results. 
                      High-quality experiences get reused, while low-quality ones are avoided. This means your agent gets <span className="text-foreground">smarter and faster</span> with 
                      every task it completes—automatically improving without manual tuning.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="optimizer" className="animate-fade-in">
              <Card className="bg-panel border-cyan/30">
                <CardHeader>
                  <CardTitle className="text-cyan">MemoryOptimizer: Efficient Long-Term Storage</CardTitle>
                  <p className="text-sm text-muted-foreground">Compress old memories while preserving searchability</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-4">
                    <Card className="bg-panel-strong border-border/50">
                      <CardHeader>
                        <CardTitle className="text-sm text-cyan">Graph-Based</CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs">
                        <p className="text-muted-foreground mb-2">Clusters similar memories by vector similarity</p>
                        <p className="text-foreground"><span className="text-cyan">Best for:</span> Varied tasks across domains</p>
                      </CardContent>
                    </Card>

                    <Card className="bg-panel-strong border-border/50">
                      <CardHeader>
                        <CardTitle className="text-sm text-cyan">Hierarchical</CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs">
                        <p className="text-muted-foreground mb-2">Time-based buckets (daily, weekly, monthly)</p>
                        <p className="text-foreground"><span className="text-cyan">Best for:</span> Temporal patterns</p>
                      </CardContent>
                    </Card>

                    <Card className="bg-panel-strong border-border/50">
                      <CardHeader>
                        <CardTitle className="text-sm text-cyan">Temporal</CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs">
                        <p className="text-muted-foreground mb-2">Sequential merging of adjacent memories</p>
                        <p className="text-foreground"><span className="text-cyan">Best for:</span> Sequential workflows</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20">
                    <h4 className="text-sm font-semibold text-cyan mb-3">Optimization Results</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-foreground">1000</div>
                        <div className="text-xs text-muted-foreground">Before (experiences)</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-cyan">200</div>
                        <div className="text-xs text-muted-foreground">After (summary nodes)</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-cyan">85%</div>
                        <div className="text-xs text-muted-foreground">Memory saved</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-foreground">100%</div>
                        <div className="text-xs text-muted-foreground">Searchability kept</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
};
