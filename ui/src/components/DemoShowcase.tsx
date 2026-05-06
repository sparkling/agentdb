import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Play, Code2, Sparkles, Cpu, Brain, Network, TrendingUp, Swords } from "lucide-react";

export const DemoShowcase = () => {
  const demos = [
    {
      title: "Strategic AI Battleship",
      description: "Naval combat with game theory AI, Bayesian targeting, and adaptive pattern learning",
      category: "Game Theory",
      icon: Swords,
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/30",
      path: "/agentdb/examples/browser/wargames"
    },
    {
      title: "Autonomous Training System",
      description: "AI-coordinated multi-model training using Gemini for optimization and management",
      category: "Advanced",
      icon: Cpu,
      color: "text-cyan",
      bgColor: "bg-cyan/10",
      borderColor: "border-cyan/30",
      path: "/demo/autonomous-training"
    },
    {
      title: "Agentic Marketing Intelligence",
      description: "ROAS-optimized Meta Ads with AI-driven budget allocation and SAFLA learning",
      category: "Marketing",
      icon: TrendingUp,
      color: "text-green-400",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/30",
      path: "/demo/agentic-marketing"
    },
    {
      title: "Swarm Intelligence",
      description: "Multiple agents collaborating to solve complex optimization problems",
      category: "Coordination",
      icon: Network,
      color: "text-cyan",
      bgColor: "bg-cyan/10",
      borderColor: "border-cyan/30",
      path: "/demo/swarm-intelligence"
    },
    {
      title: "Pattern Learning",
      description: "ReasoningBank system learning and reusing successful problem-solving patterns",
      category: "Reasoning",
      icon: Sparkles,
      color: "text-green-400",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/30",
      path: "/demo/pattern-learning"
    }
  ];

  return (
    <section className="py-20 bg-gradient-to-b from-background to-panel">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">
            <Play className="h-3 w-3 mr-2" />
            Live Demos
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            See <span className="text-cyan">AgentDB</span> in Action
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explore 36 interactive examples running entirely in your browser with WebAssembly.
            From simple machine learning to exotic neural architectures—no server required.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
          {demos.map((demo) => {
            const Icon = demo.icon;
            return (
              <Link key={demo.title} to={demo.path} className="block">
                <Card
                  className={`bg-panel border ${demo.borderColor} hover:border-opacity-60 transition-all hover:shadow-lg hover:shadow-${demo.color.replace('text-', '')}/20 hover:-translate-y-1 cursor-pointer h-full`}
                >
                  <CardContent className="p-6">
                    <div className={`p-3 ${demo.bgColor} rounded-lg w-fit mb-4`}>
                      <Icon className={`h-6 w-6 ${demo.color}`} />
                    </div>
                    <Badge variant="outline" className="mb-3 text-xs">
                      {demo.category}
                    </Badge>
                    <h3 className="font-semibold text-foreground mb-2">{demo.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {demo.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            size="lg"
            className="bg-gradient-to-r from-purple-500 to-cyan hover:from-purple-600 hover:to-cyan/90 border-0 shadow-lg"
            asChild
          >
            <Link to="/demo">
              <Play className="h-5 w-5 mr-2" />
              Explore All Demos
            </Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-cyan/30 hover:border-cyan/60 hover:bg-cyan/10"
            asChild
          >
            <Link to="/demo">
              <Code2 className="h-5 w-5 mr-2" />
              View Source Code
            </Link>
          </Button>
        </div>

        <div className="mt-12 text-center hidden md:block">
          <div className="inline-flex items-center gap-8 px-6 py-4 bg-panel border border-border/50 rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan">36</div>
              <div className="text-xs text-muted-foreground">Examples</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan">100%</div>
              <div className="text-xs text-muted-foreground">Client-Side</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan">0ms</div>
              <div className="text-xs text-muted-foreground">Server Latency</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan">∞</div>
              <div className="text-xs text-muted-foreground">Scalability</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
