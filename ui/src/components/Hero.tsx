import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Terminal, Zap, Database, Brain, Code2 } from "lucide-react";
import { Link } from "react-router-dom";
import { GettingStartedModal } from "./GettingStartedModal";
import { DocsModal } from "./DocsModal";

export const Hero = () => {
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  return (
    <section className="relative overflow-hidden py-20 grid-texture">
      <div className="container mx-auto px-6">
        <div className="flex flex-col items-center text-center mb-12">
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold mb-6 ml-8">
            <span className="text-cyan">Agent</span>
            <span className="text-white">DB</span>
            <span className="caret-blink ml-2 text-cyan">▍</span>
          </h1>
          
          <p className="text-2xl md:text-3xl lg:text-4xl font-semibold text-foreground mb-4">
            Instant memory. <br className="md:hidden" />Local learning.<br />Global coordination.
          </p>

          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl">
            A sub-millisecond memory engine built for autonomous agents with 29 MCP tools for seamless AI integration.
          </p>
          
          <div className="flex flex-col md:flex-row flex-wrap gap-4 justify-center items-center mb-8">
            <Button 
              size="lg" 
              className="bg-cyan text-foreground hover:bg-cyan/90 gap-2"
              onClick={() => setGettingStartedOpen(true)}
            >
              <Terminal className="h-5 w-5" />
              Get Started
            </Button>
            <Link to="/demo">
              <Button size="lg" variant="outline" className="border-border hover:border-cyan/50 hover:bg-cyan/5 hover:text-cyan gap-2">
                <Zap className="h-5 w-5" />
                View Demos
              </Button>
            </Link>
            <Link to="/demo/management-ide">
              <Button size="lg" variant="outline" className="border-border hover:border-cyan/50 hover:bg-cyan/5 hover:text-cyan gap-2">
                <Code2 className="h-5 w-5" />
                Launch IDE
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="border-border hover:border-cyan/50 hover:bg-cyan/5 hover:text-cyan gap-2"
              onClick={() => setDocsOpen(true)}
            >
              <Database className="h-5 w-5" />
              View Docs
            </Button>
            
            {/* Quick Install Command */}
            <a 
              href="https://www.npmjs.com/package/agentdb" 
              target="_blank" 
              rel="noopener noreferrer"
              className="transition-transform hover:scale-105"
            >
              <Card className="bg-panel border-cyan/30 hover:border-cyan/50 cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 font-mono text-sm">
                    <span className="text-cyan">&gt;_</span>
                    <span className="text-foreground">npx agentdb</span>
                  </div>
                </CardContent>
              </Card>
            </a>
          </div>
          
        </div>
      </div>

      <GettingStartedModal 
        open={gettingStartedOpen} 
        onOpenChange={setGettingStartedOpen} 
      />
      <DocsModal 
        open={docsOpen} 
        onOpenChange={setDocsOpen} 
      />
    </section>
  );
};
