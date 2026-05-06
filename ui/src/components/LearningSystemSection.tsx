import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Code, Sparkles, Zap } from "lucide-react";

export const LearningSystemSection = () => {
  const algorithms = [
    {
      name: "Decision Transformer",
      badge: "Recommended",
      type: "Sequence Modeling",
      bestFor: "Sequential decision-making, code generation, multi-step tasks",
      description: "Treats RL as sequence prediction—learns patterns from successful task sequences"
    },
    {
      name: "Q-Learning",
      type: "Value-Based",
      bestFor: "Discrete action spaces, simple environments",
      description: "Learns value of state-action pairs, selects highest value action"
    },
    {
      name: "SARSA",
      type: "On-Policy Q-Learning",
      bestFor: "Safe exploration, real-time control",
      description: "Like Q-learning but more conservative—learns from actual actions taken"
    },
    {
      name: "Actor-Critic",
      type: "Policy Gradient",
      bestFor: "Continuous action spaces, complex policies",
      description: "Two networks—actor chooses actions, critic evaluates them"
    },
    {
      name: "Federated Learning",
      type: "Distributed",
      bestFor: "Privacy-preserving learning across multiple agents",
      description: "Agents learn locally, share model updates (not data)"
    },
    {
      name: "Curriculum Learning",
      type: "Progressive",
      bestFor: "Tasks with progressive difficulty",
      description: "Start easy, gradually increase difficulty for faster learning"
    },
    {
      name: "Active Learning",
      type: "Data-Efficient",
      bestFor: "Learning with minimal data requirements",
      description: "Agent queries labels on most uncertain examples"
    },
    {
      name: "Adversarial Training",
      type: "Robustness",
      bestFor: "Edge cases and outlier handling",
      description: "Generates adversarial examples to make agent robust"
    },
    {
      name: "Neural Architecture Search",
      badge: "Advanced",
      type: "Auto-ML",
      bestFor: "Auto-optimizing model architecture",
      description: "Evolutionary algorithms search for optimal architecture"
    },
    {
      name: "Multi-Task Learning",
      type: "Transfer Learning",
      bestFor: "Learning across related tasks",
      description: "Shared representations across tasks for efficiency"
    },
    {
      name: "Meta-Learning",
      type: "Learning-to-Learn",
      bestFor: "Few-shot adaptation, rapid learning",
      description: "Learns how to learn new tasks quickly from minimal examples"
    },
    {
      name: "Hierarchical RL",
      type: "Temporal Abstraction",
      bestFor: "Complex long-horizon tasks",
      description: "Multi-level policies from high-level goals to low-level actions"
    }
  ];

  const applications = [
    { name: "Code generation", complexity: "Simple" },
    { name: "API design patterns", complexity: "Simple" },
    { name: "Bug detection & fixing", complexity: "Moderate" },
    { name: "Database query optimization", complexity: "Moderate" },
    { name: "Architecture recommendations", complexity: "Moderate" },
    { name: "Multi-agent task coordination", complexity: "Complex" },
    { name: "Automated refactoring", complexity: "Complex" },
    { name: "Security vulnerability analysis", complexity: "Complex" },
    { name: "Real-time system adaptation", complexity: "Exotic" },
    { name: "Emergent behavior synthesis", complexity: "Exotic" },
    { name: "Cross-domain knowledge transfer", complexity: "Exotic" }
  ];

  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-cyan">🚀 Learning System</span>
            </h2>
            <p className="text-xl text-foreground mb-2">
              Custom reinforcement learning through interactive wizards
            </p>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Create sophisticated learning algorithms without writing code. Just answer prompts 
              and AgentDB generates complete, tested plugins.
            </p>
          </div>

          {/* Interactive Wizard */}
          <Card className="bg-panel border-cyan/30 mb-12 scanline-overlay">
            <CardHeader>
              <CardTitle className="text-cyan flex items-center gap-2">
                <Code className="h-5 w-5" />
                Interactive Plugin Wizard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-panel-strong p-6 rounded-lg border border-border/50 font-mono text-sm">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-cyan">$</span>
                    <span className="text-foreground">agentdb create-plugin</span>
                  </div>
                  <div className="pl-4 space-y-2 text-muted-foreground">
                    <div>? Plugin name: <span className="text-cyan">code-optimizer</span></div>
                    <div>? Select algorithm: <span className="text-cyan">Decision Transformer</span> (Recommended)</div>
                    <div>? Task domain: <span className="text-cyan">code_generation</span></div>
                    <div>? Reward function: <span className="text-cyan">quality * 0.7 + efficiency * 0.3</span></div>
                    <div>? Training frequency: <span className="text-cyan">After every 10 tasks</span></div>
                  </div>
                  <div className="pl-4 space-y-1 mt-4">
                    <div className="text-cyan">✓ Plugin created: ./plugins/code-optimizer/</div>
                    <div className="text-cyan">✓ Tests generated</div>
                    <div className="text-cyan">✓ Documentation created</div>
                    <div className="text-cyan">✓ Ready to use</div>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 mt-6">
                <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20 text-center">
                  <div className="text-2xl font-bold text-cyan mb-1">2 min</div>
                  <div className="text-xs text-muted-foreground">Setup Time</div>
                </div>
                <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20 text-center">
                  <div className="text-2xl font-bold text-cyan mb-1">Zero</div>
                  <div className="text-xs text-muted-foreground">Code Required</div>
                </div>
                <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20 text-center">
                  <div className="text-2xl font-bold text-cyan mb-1">100%</div>
                  <div className="text-xs text-muted-foreground">Auto-Generated</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Algorithm Library */}
          <div className="mb-12">
            <h3 className="text-2xl font-bold text-foreground mb-6">
              12 Learning Algorithms
            </h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {algorithms.map((algo, index) => (
                <Card key={index} className="bg-panel border-border/50 hover-lift">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <CardTitle className="text-sm text-foreground">{algo.name}</CardTitle>
                      {algo.badge && (
                        <Badge variant="secondary" className="bg-cyan/20 text-cyan text-xs">
                          {algo.badge}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs w-fit">
                      {algo.type}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs">
                      <span className="text-cyan font-semibold">Best for: </span>
                      <span className="text-muted-foreground">{algo.bestFor}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {algo.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Applications */}
          <div className="mb-12">
            <h3 className="text-2xl font-bold text-foreground mb-6">
              Real-World Applications
            </h3>
            <Card className="bg-panel border-cyan/30">
              <CardHeader>
                <CardTitle className="text-cyan flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  From Simple to Exotic
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  AgentDB powers everything from basic automation to cutting-edge AI research
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {applications.map((app, index) => (
                    <div 
                      key={index}
                      className="bg-panel-strong p-3 rounded-lg border border-border/50 hover:border-cyan/30 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{app.name}</span>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            app.complexity === 'Simple' ? 'text-cyan border-cyan/30' :
                            app.complexity === 'Moderate' ? 'text-foreground border-border' :
                            app.complexity === 'Complex' ? 'text-foreground border-border' :
                            'text-cyan border-cyan/50'
                          }`}
                        >
                          {app.complexity}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Integration Features */}
          <Card className="bg-panel border-cyan/30">
            <CardHeader>
              <CardTitle className="text-cyan flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Automatic ReasoningBank Integration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm mb-4">
                Plugins automatically integrate with all ReasoningBank components for seamless learning.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-panel-strong p-4 rounded-lg border border-border/50">
                  <h4 className="text-sm font-semibold text-foreground mb-3">What's Generated</h4>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">✓</span>
                      <span>Complete TypeScript implementation</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">✓</span>
                      <span>Configuration file (YAML)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">✓</span>
                      <span>Comprehensive test suite</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">✓</span>
                      <span>Documentation and examples</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">✓</span>
                      <span>ReasoningBank hooks</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-panel-strong p-4 rounded-lg border border-cyan/20">
                  <h4 className="text-sm font-semibold text-cyan mb-3">Integrated Components</h4>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">→</span>
                      <span>PatternMatcher for action selection</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">→</span>
                      <span>ExperienceCurator for storage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">→</span>
                      <span>MemoryOptimizer for efficiency</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">→</span>
                      <span>ContextSynthesizer for context</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan">→</span>
                      <span>Automatic metric tracking</span>
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
