import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, 
  BookOpen, 
  GitBranch, 
  FileCheck, 
  Target, 
  Moon,
  Zap,
  ChevronRight 
} from 'lucide-react';

export const FrontierMemorySection = () => {
  const features = [
    {
      icon: Brain,
      title: 'Reflexion Memory',
      badge: 'Episodic Replay',
      description: 'Learn from experience with self-critique and episodic replay',
      details: 'Store complete task episodes with self-generated critiques, then replay them to improve future performance.',
      gradient: 'from-purple-500/20 to-pink-500/20',
      borderColor: 'border-purple-500/30'
    },
    {
      icon: BookOpen,
      title: 'Skill Library',
      badge: 'Lifelong Learning',
      description: 'Auto-consolidate successful patterns into reusable skills',
      details: 'Transform repeated successful task executions into parameterized skills that can be composed and reused.',
      gradient: 'from-blue-500/20 to-cyan-500/20',
      borderColor: 'border-blue-500/30'
    },
    {
      icon: GitBranch,
      title: 'Causal Memory',
      badge: 'Intervention-Based',
      description: 'Track p(y|do(x)) not just p(y|x) — intervention-based causality',
      details: 'Learn cause-and-effect relationships between agent actions, not just correlations.',
      gradient: 'from-green-500/20 to-emerald-500/20',
      borderColor: 'border-green-500/30'
    },
    {
      icon: FileCheck,
      title: 'Explainable Recall',
      badge: 'Provenance',
      description: 'Provenance certificates with cryptographic Merkle proofs',
      details: 'Every retrieved memory comes with a certificate explaining why it was selected, with cryptographic proof of completeness.',
      gradient: 'from-amber-500/20 to-orange-500/20',
      borderColor: 'border-amber-500/30'
    },
    {
      icon: Target,
      title: 'Causal Recall',
      badge: 'Utility-Based',
      description: 'U = α·similarity + β·uplift − γ·latency',
      details: 'Smart retrieval combining similarity, causality, and latency for utility-based reranking.',
      gradient: 'from-red-500/20 to-rose-500/20',
      borderColor: 'border-red-500/30'
    },
    {
      icon: Moon,
      title: 'Nightly Learner',
      badge: 'Automated',
      description: 'Automated causal discovery with doubly robust learning',
      details: 'Background process that discovers patterns while you sleep, finding patterns you didn\'t explicitly program.',
      gradient: 'from-indigo-500/20 to-purple-500/20',
      borderColor: 'border-indigo-500/30'
    }
  ];

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-panel/50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan/10 border border-cyan/30 mb-6">
            <Zap className="h-4 w-4 text-cyan" />
            <span className="text-sm font-medium text-cyan">Version 1.1.0</span>
          </div>
          
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Frontier Memory Features
          </h2>
          
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Advanced memory patterns that go beyond simple vector storage to enable true cognitive capabilities
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
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
                  <CardTitle className="text-xl text-foreground flex items-center gap-2">
                    {feature.title}
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground font-medium mb-2">
                    {feature.description}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {feature.details}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="bg-gradient-to-r from-cyan/10 via-purple-500/10 to-pink-500/10 border-cyan/30">
          <CardContent className="p-8">
            <div className="text-center">
              <h3 className="text-2xl font-bold text-foreground mb-4">
                Get Started in Seconds
              </h3>
              <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                Experience frontier memory features with the CLI. Learn from experience, consolidate skills, and discover causal patterns automatically.
              </p>
              <div className="inline-flex items-center gap-3 px-6 py-3 rounded-lg bg-background/80 border border-border font-mono text-sm">
                <span className="text-cyan">$</span>
                <span className="text-foreground">agentdb reflexion store "session-1" "task" 0.95</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};
