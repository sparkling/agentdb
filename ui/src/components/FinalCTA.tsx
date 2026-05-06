import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Terminal, Rocket, Book, Play, Copy, Check, Sparkles } from "lucide-react";

export const FinalCTA = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText("npx agentdb");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="py-20 bg-gradient-to-b from-panel to-background relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 bg-grid-cyan/5" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-4xl mx-auto">
          {/* Main CTA */}
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">
              <Sparkles className="h-3 w-3 mr-2" />
              Ready to Build?
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Start Building with{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-cyan to-purple-400">
                AgentDB
              </span>
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Get started in seconds with our interactive wizard, explore live demos, or dive into the documentation.
            </p>
          </div>

          {/* Quick Install */}
          <Card className="bg-panel border-cyan/30 mb-12 hover:border-cyan/50 transition-all">
            <CardContent className="p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Terminal className="h-6 w-6 text-cyan" />
                  <span className="text-sm font-semibold text-foreground">Quick Start</span>
                </div>
                <Badge variant="outline" className="text-xs">One command</Badge>
              </div>

              <div className="flex items-center gap-3 bg-background border border-border rounded-lg p-4 mb-4">
                <code className="flex-1 text-cyan font-mono text-lg">
                  npx agentdb
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopy}
                  className="hover:bg-cyan/10"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-500" />
                      <span className="text-green-500">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                Launch an interactive wizard to create custom AgentDB configurations,
                examples, and integrations in minutes.
              </p>
            </CardContent>
          </Card>

          {/* Action Cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {/* Demos */}
            <Card className="bg-panel border-purple-500/30 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/20 transition-all group">
              <CardContent className="p-6 text-center">
                <div className="p-4 bg-purple-500/10 rounded-full w-fit mx-auto mb-4 group-hover:bg-purple-500/20 transition-colors">
                  <Play className="h-8 w-8 text-purple-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Try Live Demos</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Explore 16+ interactive examples running in your browser
                </p>
                <Button
                  className="w-full bg-purple-500 hover:bg-purple-600"
                  asChild
                >
                  <Link to="/demo">
                    Explore Demos
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Quick Start */}
            <Card className="bg-panel border-cyan/30 hover:border-cyan/50 hover:shadow-lg hover:shadow-cyan/20 transition-all group">
              <CardContent className="p-6 text-center">
                <div className="p-4 bg-cyan/10 rounded-full w-fit mx-auto mb-4 group-hover:bg-cyan/20 transition-colors">
                  <Rocket className="h-8 w-8 text-cyan" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Quick Start Guide</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Step-by-step tutorials to get you up and running fast
                </p>
                <Button
                  className="w-full bg-cyan hover:bg-cyan/90"
                  onClick={() => {
                    // This will trigger the modal from the header
                    const event = new CustomEvent('open-quickstart-modal');
                    window.dispatchEvent(event);
                  }}
                >
                  Get Started
                </Button>
              </CardContent>
            </Card>

            {/* Documentation */}
            <Card className="bg-panel border-green-500/30 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20 transition-all group">
              <CardContent className="p-6 text-center">
                <div className="p-4 bg-green-500/10 rounded-full w-fit mx-auto mb-4 group-hover:bg-green-500/20 transition-colors">
                  <Book className="h-8 w-8 text-green-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Read the Docs</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Complete API reference and detailed guides
                </p>
                <Button
                  className="w-full bg-green-500 hover:bg-green-600"
                  onClick={() => {
                    // This will trigger the modal from the header
                    const event = new CustomEvent('open-docs-modal');
                    window.dispatchEvent(event);
                  }}
                >
                  View Docs
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Stats */}
          <div className="text-center">
            <p className="text-muted-foreground mb-6">Trusted by developers worldwide</p>
            <div className="flex flex-wrap items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan mb-1">89KB</div>
                <div className="text-xs text-muted-foreground">Bundle Size</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan mb-1">116K</div>
                <div className="text-xs text-muted-foreground">Inserts/sec</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan mb-1">&lt;1ms</div>
                <div className="text-xs text-muted-foreground">Search Time</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan mb-1">100%</div>
                <div className="text-xs text-muted-foreground">Client-Side</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
