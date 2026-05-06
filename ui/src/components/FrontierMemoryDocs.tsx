import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Brain, 
  BookOpen, 
  GitBranch, 
  FileCheck, 
  Target, 
  Moon,
  Zap,
  Terminal,
  Code2,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export const FrontierMemoryDocs = () => {
  const { toast } = useToast();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Code copied successfully",
    });
  };

  const CodeBlock = ({ code, language = 'bash' }: { code: string; language?: string }) => (
    <div className="bg-background border border-line rounded-lg p-4 font-mono text-sm my-4 relative group">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => copyToClipboard(code)}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Copy className="h-4 w-4" />
      </Button>
      <pre className="text-cyan overflow-x-auto whitespace-pre-wrap break-words">{code}</pre>
    </div>
  );

  const features = [
    {
      icon: Brain,
      title: 'Reflexion Memory',
      badge: 'Episodic Replay',
      description: 'Learn from experience with self-critique and episodic replay',
      gradient: 'from-purple-500/20 to-pink-500/20',
      borderColor: 'border-purple-500/30'
    },
    {
      icon: BookOpen,
      title: 'Skill Library',
      badge: 'Lifelong Learning',
      description: 'Auto-consolidate successful patterns into reusable skills',
      gradient: 'from-blue-500/20 to-cyan-500/20',
      borderColor: 'border-blue-500/30'
    },
    {
      icon: GitBranch,
      title: 'Causal Memory',
      badge: 'Intervention-Based',
      description: 'Track p(y|do(x)) not just p(y|x) — intervention-based causality',
      gradient: 'from-green-500/20 to-emerald-500/20',
      borderColor: 'border-green-500/30'
    },
    {
      icon: FileCheck,
      title: 'Explainable Recall',
      badge: 'Provenance',
      description: 'Provenance certificates with cryptographic Merkle proofs',
      gradient: 'from-amber-500/20 to-orange-500/20',
      borderColor: 'border-amber-500/30'
    },
    {
      icon: Target,
      title: 'Causal Recall',
      badge: 'Utility-Based',
      description: 'U = α·similarity + β·uplift − γ·latency',
      gradient: 'from-red-500/20 to-rose-500/20',
      borderColor: 'border-red-500/30'
    },
    {
      icon: Moon,
      title: 'Nightly Learner',
      badge: 'Automated',
      description: 'Automated causal discovery with doubly robust learning',
      gradient: 'from-indigo-500/20 to-purple-500/20',
      borderColor: 'border-indigo-500/30'
    }
  ];

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan/10 border border-cyan/30 mb-4">
          <Zap className="h-4 w-4 text-cyan" />
          <span className="text-sm font-medium text-cyan">Version 1.1.0</span>
        </div>
        
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
          Frontier Memory Features
        </h2>
        
        <p className="text-lg text-muted-foreground mb-6">
          Advanced memory patterns that go beyond simple vector storage to enable true cognitive capabilities for autonomous AI agents.
        </p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-8">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cli">CLI Reference</TabsTrigger>
          <TabsTrigger value="sdk">SDK Guide</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <Card className="bg-gradient-to-r from-cyan/10 via-purple-500/10 to-pink-500/10 border-cyan/30">
            <CardContent className="p-6">
              <h3 className="text-xl font-semibold text-foreground mb-3">
                What Are Frontier Memory Features?
              </h3>
              <p className="text-foreground leading-relaxed mb-4">
                Traditional vector databases store embeddings and retrieve similar items. Frontier Memory goes beyond this with cognitive capabilities that enable agents to:
              </p>
              <ul className="space-y-2 text-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <span><strong>Learn from experience</strong> by storing episodic memories with self-critique</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <span><strong>Build reusable skills</strong> from successful patterns automatically</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <span><strong>Understand causality</strong> — what actions lead to which outcomes</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <span><strong>Explain decisions</strong> with cryptographic proof of completeness</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <span><strong>Discover patterns</strong> automatically while you sleep</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card 
                  key={index}
                  className={`group hover:scale-[1.02] transition-all duration-300 bg-gradient-to-br ${feature.gradient} ${feature.borderColor} backdrop-blur-sm`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <div className="p-3 rounded-lg bg-background/50 border border-border">
                        <Icon className="h-6 w-6 text-cyan" />
                      </div>
                      <Badge variant="outline" className="text-xs border-cyan/30 text-cyan">
                        {feature.badge}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg text-foreground">
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-cyan" />
                Quick Start
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Get started in seconds with the CLI. All features work out of the box:
              </p>
              <CodeBlock code={`# Install globally
npm install -g agentdb

# Store your first episode with critique
agentdb reflexion store "session-1" "fix_auth_bug" 0.95 true \\
  "OAuth2 flow worked perfectly" "login failing" "fixed tokens" 1200 500

# Search for similar experiences
agentdb reflexion retrieve "authentication issues" 10 0.8

# View database stats
agentdb db stats`} />
            </CardContent>
          </Card>

          <Card className="bg-cyan/10 border-cyan/30">
            <CardContent className="p-6">
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Practical Use Cases
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-semibold text-foreground mb-2">🐛 Debugging</h4>
                  <p className="text-muted-foreground">Store every debugging session with what worked and what didn't. Future bugs? Retrieve similar past solutions instantly.</p>
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-2">🚀 Feature Development</h4>
                  <p className="text-muted-foreground">Track which approaches succeeded. Build a library of proven patterns that can be reused across projects.</p>
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-2">⚡ Performance Optimization</h4>
                  <p className="text-muted-foreground">Learn which optimizations actually improve performance. Causal memory shows cause-and-effect, not just correlation.</p>
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-2">🏗️ Architecture Decisions</h4>
                  <p className="text-muted-foreground">Document why certain architectural choices succeeded or failed. Build institutional knowledge over time.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CLI Reference Tab */}
        <TabsContent value="cli" className="space-y-6">
          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-400" />
                Reflexion Memory
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Store and retrieve episodic memories with self-critique. Learn from both successes and failures.
              </p>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Store Episode</h4>
                <CodeBlock code={`agentdb reflexion store <session-id> <task> <reward> <success> \\
  [critique] [input] [output] [latency-ms] [tokens]`} />
                <div className="text-sm space-y-2 text-muted-foreground">
                  <p><code className="text-cyan">session-id</code> - Unique session identifier (e.g., "session-1")</p>
                  <p><code className="text-cyan">task</code> - Task description (e.g., "fix_auth_bug")</p>
                  <p><code className="text-cyan">reward</code> - Success score 0.0-1.0 (higher is better)</p>
                  <p><code className="text-cyan">success</code> - Boolean: true or false</p>
                </div>
              </div>

              <div className="bg-background/50 border border-border rounded-lg p-4">
                <p className="text-sm font-semibold text-foreground mb-2">Example: Successful Debugging</p>
                <CodeBlock code={`agentdb reflexion store "debug-001" "fix_auth_timeout" 0.95 true \\
  "Increasing JWT expiry from 1h to 24h resolved random logouts" \\
  "Users getting logged out randomly after 1 hour" \\
  "Changed JWT_EXPIRY from 3600 to 86400 in config" \\
  1800 350`} />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Retrieve Episodes</h4>
                <CodeBlock code={`agentdb reflexion retrieve <task> [k] [min-reward] [only-failures] [only-successes]`} />
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Examples:</p>
                  <CodeBlock code={`# Find similar authentication issues (top 10, min reward 0.7)
agentdb reflexion retrieve "authentication timeout issues" 10 0.7

# Learn from failures only
agentdb reflexion retrieve "authentication" 10 0.0 true false

# Best practices only (high reward, successes only)
agentdb reflexion retrieve "authentication" 10 0.8 false true`} />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Critique Summary</h4>
                <p className="text-sm text-muted-foreground mb-2">Get aggregated lessons learned from past episodes:</p>
                <CodeBlock code={`# Get all critique lessons
agentdb reflexion critique-summary "authentication" false

# Learn specifically from failures
agentdb reflexion critique-summary "authentication" true`} />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Prune Old Episodes</h4>
                <CodeBlock code={`# Remove episodes older than 90 days with reward < 0.5
agentdb reflexion prune 90 0.5

# More aggressive pruning (30 days, reward < 0.7)
agentdb reflexion prune 30 0.7`} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-400" />
                Skill Library
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Transform successful patterns into reusable skills. Build a personal code library from experience.
              </p>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Create Skill</h4>
                <CodeBlock code={`agentdb skill create <name> <description> [code]`} />
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Example: JWT Authentication Skill</p>
                  <CodeBlock code={`agentdb skill create "jwt_auth" \\
  "Generate secure JWT tokens with 24h expiry" \\
  "const jwt = require('jsonwebtoken'); jwt.sign(payload, SECRET, {expiresIn: '24h'});"`} />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Search Skills</h4>
                <CodeBlock code={`agentdb skill search <query> [k]`} />
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Examples:</p>
                  <CodeBlock code={`# Find authentication-related skills
agentdb skill search "authentication security" 5

# Find rate limiting approaches
agentdb skill search "rate limiting API protection" 3`} />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Auto-Consolidate Skills</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Automatically create skills from repeated successful patterns:
                </p>
                <CodeBlock code={`agentdb skill consolidate [min-attempts] [min-reward] [time-window-days]`} />
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Examples:</p>
                  <CodeBlock code={`# Default: 3+ attempts, 70%+ reward, last 7 days
agentdb skill consolidate

# More selective: 5+ attempts, 80%+ reward, last 14 days
agentdb skill consolidate 5 0.8 14`} />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Prune Underperforming Skills</h4>
                <CodeBlock code={`# Remove skills with <3 uses, <40% success, or >60 days old
agentdb skill prune 3 0.4 60`} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-green-400" />
                Causal Memory & Experiments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Track cause-and-effect relationships using intervention-based causality (p(y|do(x))).
              </p>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Manual Causal Edge</h4>
                <CodeBlock code={`agentdb causal add-edge <cause> <effect> <uplift> [confidence] [sample-size]`} />
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Examples:</p>
                  <CodeBlock code={`# Adding tests improves code quality (uplift = 0.25)
agentdb causal add-edge "add_tests" "code_quality" 0.25 0.95 100

# Code reviews reduce bugs (negative uplift = fewer bugs)
agentdb causal add-edge "code_review" "bug_rate" -0.30 0.92 80`} />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">A/B Experiments</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Run controlled experiments to measure causal effects:
                </p>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">Step 1: Create Experiment</p>
                    <CodeBlock code={`agentdb causal experiment create "test_coverage_quality" "add_tests" "code_quality"`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">Step 2: Record Observations</p>
                    <CodeBlock code={`# Treatment group (with tests)
agentdb causal experiment add-observation 1 true 0.85
agentdb causal experiment add-observation 1 true 0.88

# Control group (no tests)
agentdb causal experiment add-observation 1 false 0.65
agentdb causal experiment add-observation 1 false 0.60`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">Step 3: Calculate Uplift</p>
                    <CodeBlock code={`agentdb causal experiment calculate 1

# Output:
# Uplift: 0.252
# 95% CI: [0.210, 0.293]
# p-value: 0.0030
# ✅ Statistically significant`} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-red-400" />
                Causal Recall
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Utility-based retrieval that balances similarity, effectiveness, and performance.
              </p>

              <div className="bg-background/50 border border-border rounded-lg p-4 text-center mb-4">
                <code className="text-lg text-cyan">U = α·similarity + β·uplift − γ·latency</code>
              </div>

              <CodeBlock code={`agentdb recall with-certificate <query> [k] [alpha] [beta] [gamma]`} />

              <div className="bg-background/50 border border-border rounded-lg p-4">
                <p className="text-sm font-semibold text-foreground mb-2">Parameter Tuning:</p>
                <CodeBlock code={`# Balanced (default)
agentdb recall with-certificate "optimize response time" 5 0.7 0.2 0.1

# Emphasize similarity
agentdb recall with-certificate "database performance" 10 0.9 0.1 0.0

# Emphasize what works
agentdb recall with-certificate "debugging strategies" 8 0.5 0.4 0.1

# Speed-focused (high latency penalty)
agentdb recall with-certificate "algorithms" 10 0.6 0.2 0.2`} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Moon className="h-5 w-5 text-indigo-400" />
                Nightly Learner
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Automated pattern discovery that runs in the background, finding causal relationships you didn't explicitly program.
              </p>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Discover Patterns</h4>
                <CodeBlock code={`agentdb learner run [min-attempts] [min-success-rate] [min-confidence] [dry-run]`} />
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Examples:</p>
                  <CodeBlock code={`# Dry-run to see what would be discovered (safe)
agentdb learner run 3 0.6 0.7 true

# Actually discover and create patterns
agentdb learner run 3 0.6 0.7 false

# More selective (5+ attempts, 80%+ success)
agentdb learner run 5 0.8 0.8 false`} />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Prune Low-Quality Edges</h4>
                <CodeBlock code={`# Remove edges with confidence <0.5, uplift <0.05, or >90 days old
agentdb learner prune 0.5 0.05 90`} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-cyan/10 to-purple-500/10 border-cyan/30">
            <CardContent className="p-6">
              <h3 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                <Zap className="h-5 w-5 text-cyan" />
                Best Practices
              </h3>
              <div className="space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground">Write detailed critiques</p>
                    <p className="text-muted-foreground">Explain WHY something worked or failed, not just what happened</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground">Store both successes and failures</p>
                    <p className="text-muted-foreground">Failures are often more educational than successes</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground">Run experiments with adequate sample sizes</p>
                    <p className="text-muted-foreground">Aim for 10+ observations per group for reliable results</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground">Check statistical significance</p>
                    <p className="text-muted-foreground">Look for p &lt; 0.05 before trusting causal relationships</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SDK Guide Tab */}
        <TabsContent value="sdk" className="space-y-6">
          {/* Introduction Card */}
          <Card className="bg-gradient-to-r from-cyan/10 via-purple-500/10 to-pink-500/10 border-cyan/30">
            <CardContent className="p-6">
              <h3 className="text-2xl font-semibold text-foreground mb-3">
                SDK Guide
              </h3>
              <p className="text-foreground leading-relaxed mb-4">
                The AgentDB SDK provides a TypeScript/JavaScript interface to all Frontier Memory features. Build intelligent agents that learn from experience, understand causality, and improve over time.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-6">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Type-Safe</strong>
                    <p className="text-muted-foreground">Full TypeScript support with type definitions</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Promise-Based</strong>
                    <p className="text-muted-foreground">Modern async/await API for all operations</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Production-Ready</strong>
                    <p className="text-muted-foreground">Battle-tested with error handling built-in</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Installation & Setup */}
          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-cyan" />
                Installation & Setup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-foreground mb-2">📦 Installation</h4>
                <p className="text-sm text-muted-foreground mb-2">Install AgentDB via npm or yarn:</p>
                <CodeBlock code={`# Using npm
npm install agentdb

# Using yarn
yarn add agentdb

# Using pnpm
pnpm add agentdb`} language="bash" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">🚀 Quick Start</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Initialize AgentDB with default settings or customize the database path:
                </p>
                <CodeBlock code={`import { AgentDB } from 'agentdb';

// Initialize with default database path (./agentdb.db)
const db = new AgentDB();
await db.initialize();

// Or specify custom path
const db = new AgentDB('./data/my-agent.db');
await db.initialize();

// With error handling
try {
  const db = new AgentDB();
  await db.initialize();
  console.log('✅ AgentDB initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize:', error);
}`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">⚙️ Configuration Options</h4>
                <CodeBlock code={`interface AgentDBConfig {
  dbPath?: string;              // Database file path (default: ./agentdb.db)
  inMemory?: boolean;           // Use in-memory database (default: false)
  verbose?: boolean;            // Enable debug logging (default: false)
  maxConnections?: number;      // Max concurrent connections (default: 10)
}

// Example with configuration
const db = new AgentDB({
  dbPath: './data/agent.db',
  verbose: true,
  maxConnections: 5
});

await db.initialize();`} language="typescript" />
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-foreground mb-1">Important: Always Initialize</p>
                    <p className="text-muted-foreground">
                      Call <code className="text-cyan">await db.initialize()</code> before using any features. This sets up the database schema, indexes, and vector embeddings.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-400" />
                Reflexion Memory API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-muted-foreground mb-4">
                  Reflexion memory stores episodic memories with self-critique, enabling agents to learn from both successes and failures. Each episode captures what was tried, what worked, and why.
                </p>
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 text-sm">
                  <strong className="text-foreground">Use Cases:</strong>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    <li>• Store debugging sessions with solutions and insights</li>
                    <li>• Track feature development approaches and outcomes</li>
                    <li>• Document code review findings and fixes</li>
                    <li>• Build a knowledge base from past experiences</li>
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">📝 Store Episode</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Store an episodic memory with contextual information and self-critique:
                </p>
                <CodeBlock code={`interface StoreEpisodeParams {
  sessionId: string;      // Unique session identifier
  task: string;           // Task description (semantic search index)
  reward: number;         // Success score 0.0-1.0
  success: boolean;       // Did it work?
  critique?: string;      // What you learned (most important!)
  input?: string;         // Input context
  output?: string;        // Output/result
  latencyMs?: number;     // Execution time
  tokens?: number;        // Token count (for LLM calls)
}

// Example: Store successful debugging session
const episodeId = db.reflexion.store({
  sessionId: 'debug-001',
  task: 'fix_authentication_timeout',
  reward: 0.95,
  success: true,
  critique: 'JWT expiry was too short. Increasing to 24h fixed logouts.',
  input: 'Users reported being logged out randomly after about an hour',
  output: 'Changed JWT_EXPIRY from 3600 to 86400 in auth.config.ts',
  latencyMs: 1800,
  tokens: 350
});

console.log(\`✅ Stored episode \${episodeId}\`);`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">🔍 Retrieve Episodes</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Semantic search for similar past experiences:
                </p>
                <CodeBlock code={`// Retrieve similar authentication issues
const episodes = await db.reflexion.retrieve({
  task: 'authentication timeout problems',
  k: 10,
  minReward: 0.7  // Only high-quality episodes
});

episodes.forEach(ep => {
  console.log(\`📖 Episode \${ep.id}: \${ep.task}\`);
  console.log(\`   Reward: \${ep.reward.toFixed(2)}\`);
  console.log(\`   Critique: \${ep.critique}\`);
});`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">📊 Critique Summary</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Aggregate lessons learned from multiple episodes:
                </p>
                <CodeBlock code={`const summary = await db.reflexion.getCritiqueSummary({
  task: 'authentication',
  onlyFailures: false  // All episodes
});

console.log(\`Success Rate: \${(summary.successRate * 100).toFixed(1)}%\`);
console.log('Lessons Learned:');
summary.critiques.forEach((c, i) => {
  console.log(\`  \${i + 1}. \${c}\`);
});`} language="typescript" />
              </div>

              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                <strong className="text-foreground text-sm">💡 Best Practices</strong>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>✅ Write detailed critiques - they're the most valuable part</li>
                  <li>✅ Store failures too - knowing what doesn't work is crucial</li>
                  <li>✅ Use consistent task descriptions for better retrieval</li>
                  <li>❌ Don't skip the critique field - future you will thank you</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-400" />
                Skill Library API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-foreground mb-2">Create Skill</h4>
                <CodeBlock code={`const skillId = db.skills.create({
  name: 'jwt_auth',
  description: 'Generate secure JWT tokens with 24h expiry',
  code: \`
    const jwt = require('jsonwebtoken');
    function generateToken(payload, secret) {
      return jwt.sign(payload, secret, {
        expiresIn: '24h',
        algorithm: 'HS256'
      });
    }
  \`,
  schema: {
    inputs: { payload: 'object', secret: 'string' },
    outputs: { token: 'string' }
  },
  version: 1
});

console.log(\`Created skill \${skillId}\`);`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Search Skills</h4>
                <CodeBlock code={`const skills = await db.skills.search({
  query: 'authentication security',
  k: 5,
  minSuccessRate: 0.5
});

skills.forEach(skill => {
  console.log(\`\${skill.name}: \${skill.description}\`);
  console.log(\`  Success: \${(skill.successRate * 100).toFixed(1)}%\`);
  console.log(\`  Uses: \${skill.uses}\`);
  console.log(\`  Similarity: \${skill.similarity?.toFixed(3)}\`);
});`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Auto-Consolidate</h4>
                <CodeBlock code={`const newSkills = await db.skills.consolidate({
  minAttempts: 3,
  minReward: 0.7,
  timeWindowDays: 7
});

console.log(\`Created \${newSkills.length} new skills from patterns\`);
newSkills.forEach(skill => {
  console.log(\`  - \${skill.name}: \${skill.description}\`);
});`} language="typescript" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-green-400" />
                Causal Memory API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-foreground mb-2">Add Causal Edge</h4>
                <CodeBlock code={`const edgeId = db.causal.addCausalEdge({
  fromMemoryId: 0,
  fromMemoryType: 'episode',
  toMemoryId: 0,
  toMemoryType: 'episode',
  similarity: 0.85,
  uplift: 0.25,
  confidence: 0.95,
  sampleSize: 100,
  mechanism: 'Adding tests improves code quality through better coverage'
});`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Query Causal Effects</h4>
                <CodeBlock code={`const edges = db.causal.queryCausalEffects({
  interventionMemoryId: 0,
  interventionMemoryType: 'add_tests',
  minConfidence: 0.7,
  minUplift: 0.1
});

edges.forEach(edge => {
  console.log(\`\${edge.fromMemoryType} → \${edge.toMemoryType}\`);
  console.log(\`  Uplift: \${edge.uplift?.toFixed(3)}\`);
  console.log(\`  Confidence: \${edge.confidence.toFixed(2)}\`);
});`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">A/B Experiments</h4>
                <CodeBlock code={`// Create experiment
const experimentId = db.causal.createExperiment({
  name: 'test_coverage_quality',
  hypothesis: 'Does adding tests causally affect code quality?',
  treatmentId: 0,
  treatmentType: 'add_tests',
  startTime: Math.floor(Date.now() / 1000),
  sampleSize: 0,
  status: 'running'
});

// Record observations
db.causal.recordObservation({
  experimentId: 1,
  episodeId: 42,
  isTreatment: true,
  outcomeValue: 0.85,
  outcomeType: 'reward'
});

// Calculate uplift
const result = db.causal.calculateUplift(experimentId);
console.log(\`Uplift: \${result.uplift.toFixed(3)}\`);
console.log(\`p-value: \${result.pValue.toFixed(4)}\`);`} language="typescript" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-red-400" />
                Causal Recall API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-foreground mb-2">Retrieve with Certificate</h4>
                <CodeBlock code={`const result = await db.recall.retrieveWithCertificate({
  query: 'successful API optimization',
  k: 5,
  alpha: 0.7,  // Similarity weight
  beta: 0.2,   // Uplift weight
  gamma: 0.1   // Latency penalty
});

console.log(\`Found \${result.candidates.length} results\`);
result.candidates.forEach((c, i) => {
  console.log(\`#\${i + 1}: \${c.type} \${c.id}\`);
  console.log(\`  Similarity: \${c.similarity.toFixed(3)}\`);
  console.log(\`  Uplift: \${c.uplift?.toFixed(3) || 'N/A'}\`);
  console.log(\`  Utility: \${c.utility.toFixed(3)}\`);
});

console.log(\`Certificate ID: \${result.certificate.certificateId}\`);
console.log(\`Completeness: \${result.certificate.completeness.toFixed(2)}\`);`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Verify Certificate</h4>
                <CodeBlock code={`const isValid = db.recall.verifyCertificate(result.certificate);

if (isValid) {
  console.log('✅ Certificate is valid');
} else {
  console.log('❌ Certificate verification failed');
}`} language="typescript" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-panel border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Moon className="h-5 w-5 text-indigo-400" />
                Nightly Learner API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-foreground mb-2">Discover Patterns</h4>
                <CodeBlock code={`// Dry-run to see what would be discovered
const dryRunResults = await db.learner.discoverPatterns({
  minAttempts: 3,
  minSuccessRate: 0.6,
  minConfidence: 0.7,
  dryRun: true
});

console.log(\`Would discover \${dryRunResults.length} patterns\`);

// Actually discover and create
const patterns = await db.learner.discoverPatterns({
  minAttempts: 3,
  minSuccessRate: 0.6,
  minConfidence: 0.7,
  dryRun: false
});

console.log(\`Discovered \${patterns.length} causal edges\`);`} language="typescript" />
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-2">Prune Low-Quality Edges</h4>
                <CodeBlock code={`const pruned = db.learner.pruneEdges({
  minConfidence: 0.5,
  minUplift: 0.05,
  maxAgeDays: 90
});

console.log(\`Pruned \${pruned} low-quality edges\`);`} language="typescript" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-purple-500/10 to-cyan/10 border-purple-500/30">
            <CardContent className="p-6">
              <h3 className="text-xl font-semibold text-foreground mb-4">
                Complete Application Example
              </h3>
              <CodeBlock code={`import { AgentDB } from 'agentdb';

class IntelligentAgent {
  private db: AgentDB;

  constructor(dbPath: string = './agent.db') {
    this.db = new AgentDB(dbPath);
  }

  async initialize() {
    await this.db.initialize();
  }

  async executeTask(task: string, input: string): Promise<string> {
    const startTime = Date.now();

    // 1. Search for applicable skills
    const skills = await this.db.skills.search({
      query: task,
      k: 3,
      minSuccessRate: 0.7
    });

    // 2. Retrieve similar past episodes
    const pastEpisodes = await this.db.reflexion.retrieve({
      task,
      k: 5,
      minReward: 0.7
    });

    // 3. Execute task with learned patterns
    const output = await this.performTask(task, input, skills, pastEpisodes);
    const success = this.evaluateSuccess(output);
    const reward = this.calculateReward(output);

    // 4. Store episode with critique
    const episodeId = this.db.reflexion.store({
      sessionId: \`session-\${Date.now()}\`,
      task,
      reward,
      success,
      critique: this.generateCritique(output, success),
      input,
      output,
      latencyMs: Date.now() - startTime,
      tokens: this.countTokens(input + output)
    });

    // 5. Update skill statistics if used
    if (skills.length > 0) {
      this.db.skills.recordUsage({
        skillId: skills[0].id!,
        success,
        reward,
        latencyMs: Date.now() - startTime,
        sessionId: \`session-\${Date.now()}\`
      });
    }

    return output;
  }

  async runNightlyLearning() {
    // Discover patterns
    const patterns = await this.db.learner.discoverPatterns({
      minAttempts: 3,
      minSuccessRate: 0.6,
      minConfidence: 0.7
    });

    // Consolidate skills
    const newSkills = await this.db.skills.consolidate({
      minAttempts: 3,
      minReward: 0.7,
      timeWindowDays: 7
    });

    console.log(\`Discovered \${patterns.length} patterns\`);
    console.log(\`Created \${newSkills.length} new skills\`);
  }
}

// Usage
const agent = new IntelligentAgent('./my-agent.db');
await agent.initialize();
await agent.executeTask('implement_auth', 'Need OAuth2 authentication');
await agent.runNightlyLearning();`} language="typescript" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-gradient-to-r from-cyan/10 to-purple-500/10 border-cyan/30 mt-8">
        <CardContent className="p-6 text-center">
          <h3 className="text-2xl font-bold text-foreground mb-4">
            Ready to Get Started?
          </h3>
          <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
            Install AgentDB and start using frontier memory features in seconds. Build AI agents that learn from experience, understand causality, and improve over time.
          </p>
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-lg bg-background/80 border border-border font-mono text-sm">
            <span className="text-cyan">$</span>
            <span className="text-foreground">npm install -g agentdb</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
