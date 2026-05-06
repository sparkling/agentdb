import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Cpu, Zap, Code2, Wand2 } from 'lucide-react';
import { WizardModal } from './WizardModal';

export const WasmHero = () => {
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleStartExploring = () => {
    document.getElementById('examples-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative overflow-hidden py-20 grid-texture">
      <div className="container mx-auto px-6">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4">
            <Cpu className="h-3 w-3 mr-2" />
            WebAssembly Powered
          </Badge>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 ml-6 md:ml-8">
            <span className="text-white">Browser Examples</span>
            <span className="caret-blink ml-2 text-cyan">▍</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-4">
            AI/ML Examples: Simple → Advanced → Exotic
          </p>

          <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            From Linear Regression to Hyperdimensional Computing. Explore interactive machine learning
            running entirely in your browser with AgentDB's ultra-fast WebAssembly backend. No server required.
          </p>

          <div className="flex flex-wrap gap-4 justify-center mb-12">
            <Button
              size="lg"
              className="bg-gradient-to-r from-purple-500 to-cyan hover:from-purple-600 hover:to-cyan/90 text-white border-0 shadow-lg"
              onClick={() => setWizardOpen(true)}
            >
              <Wand2 className="h-5 w-5 mr-2" />
              Code Wizard
            </Button>
            <Button
              size="lg"
              className="bg-cyan hover:bg-cyan/90"
              onClick={handleStartExploring}
            >
              <Zap className="h-5 w-5 mr-2" />
              Start Exploring
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
            >
              <a
                href="https://github.com/yourusername/agentdb"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Code2 className="h-5 w-5 mr-2" />
                View Source
              </a>
            </Button>
          </div>

          <WizardModal open={wizardOpen} onOpenChange={setWizardOpen} />

          {/* Feature Pills */}
          <div className="flex flex-wrap gap-3 justify-center">
            <Badge variant="outline" className="text-sm">
              ✓ 100% Client-Side
            </Badge>
            <Badge variant="outline" className="text-sm">
              ✓ Real-Time Learning
            </Badge>
            <Badge variant="outline" className="text-sm">
              ✓ LocalStorage Persistence
            </Badge>
            <Badge variant="outline" className="text-sm">
              ✓ Export/Import Data
            </Badge>
          </div>
        </div>
      </div>
    </section>
  );
};
