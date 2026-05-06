import { Card } from "@/components/ui/card";

export const IntroCard = () => {
  return (
    <section className="py-16 grid-texture">
      <div className="container mx-auto px-6">
        <Card className="bg-panel border-border max-w-5xl mx-auto scanline-overlay">
          <div className="p-8 md:p-12">
            <div className="flex items-center gap-2 mb-6">
              <span className="text-cyan text-lg">$</span>
              <span className="text-cyan font-mono">cat intro.md</span>
            </div>
            
            <div className="space-y-6 text-muted-foreground leading-relaxed">
              <p>
                AgentDB gives agents a real cognitive layer that starts in milliseconds, runs entirely in disk or memory, 
                and keeps swarms synchronized in real time. <span className="text-foreground">No servers. No latency overhead.</span> Just instant recall, 
                continuous learning, and distributed coordination—all happening inside the agent, not behind a network call.
              </p>
              
              <p>
                When you build agentic systems, every millisecond matters. Most memory layers slow agents down with 
                remote hops and orchestration overhead. <span className="text-cyan">AgentDB flips that.</span> It embeds memory within the agent loop—lightweight, 
                adaptive, and always ready to learn.
              </p>
              
              <div className="pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-cyan mb-4">⚙️ Built for engineers who care about milliseconds</h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <span>⚡</span>
                    <span><span className="font-semibold text-foreground">Instant startup</span> – Boots in under 10 ms (disk) or ~100 ms (browser)</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span>🪶</span>
                    <span><span className="font-semibold text-foreground">Lightweight</span> – Memory or disk mode, zero config, minimal footprint</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span>🧠</span>
                    <span><span className="font-semibold text-foreground">Reasoning-aware</span> – Stores patterns, tracks outcomes, recalls context</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span>🔗</span>
                    <span><span className="font-semibold text-foreground">Vector graph search</span> – HNSW multi-level graph for 116x faster similarity queries</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span>🔄</span>
                    <span><span className="font-semibold text-foreground">Real-time sync</span> – Swarms share discoveries in sub-second intervals</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span>🌍</span>
                    <span><span className="font-semibold text-foreground">Universal runtime</span> – Node.js, browser, edge, and agent hosts</span>
                  </li>
                </ul>
              </div>
              
              <p className="text-sm italic pt-4">
                AgentDB runs anywhere: Claude Code, Cursor, GitHub Copilot, Node.js, browsers, edge functions, 
                or distributed agent networks. It's memory designed for motion.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
};
