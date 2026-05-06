import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  Zap, 
  Globe, 
  Database, 
  Brain, 
  Plug, 
  Radio,
  TrendingUp,
  Shield
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Blazing Fast",
    description: "116K vectors/sec insert, ~5ms search with HNSW index at 100K vectors",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: Globe,
    title: "Universal Runtime",
    description: "Works in Node.js (native) and browsers (WASM) automatically",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: Database,
    title: "Persistent Memory",
    description: "File-based storage with zero-config persistence and ACID guarantees",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: Brain,
    title: "Agent-First Design",
    description: "Built-in ReasoningBank for agent memory, learning, and pattern recognition",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: Plug,
    title: "MCP Integration",
    description: "Native Model Context Protocol support with 29 tools and 3 resources",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: TrendingUp,
    title: "No-Code Learning",
    description: "Plugin wizard for custom RL algorithms without deep ML expertise",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: Radio,
    title: "QUIC Sync",
    description: "Real-time synchronization across distributed agents with delta compression",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  },
  {
    icon: Shield,
    title: "Production Ready",
    description: "100% test coverage, battle-tested components, Docker validated",
    color: "text-cyan",
    bgColor: "bg-cyan/10",
    borderColor: "border-cyan/30"
  }
];

export const Features = () => {
  return (
    <section id="features" className="py-20 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
            Core Capabilities
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need for production-grade agent memory systems
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={index}
                className={`bg-card/50 border hover-lift ${feature.borderColor}`}
              >
                <CardHeader>
                  <div className={`w-12 h-12 rounded-xl ${feature.bgColor} flex items-center justify-center mb-4`}>
                    <Icon className={`h-6 w-6 ${feature.color}`} />
                  </div>
                  <CardTitle className="text-lg text-foreground">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};
