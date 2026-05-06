import { useState, useEffect } from "react";
import { Terminal, Github, Book, Package, Cpu, Zap, TrendingUp, Rocket, Wand2, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { DocsModal } from "./DocsModal";
import { GettingStartedModal } from "./GettingStartedModal";
import { WizardModal } from "./wasm/WizardModal";

export const ConsoleHeader = () => {
  const location = useLocation();
  const isDemoPage = location.pathname.startsWith('/demo');
  const isIdePage = location.pathname === '/demo/management-ide';
  const [docsOpen, setDocsOpen] = useState(false);
  const [quickStartOpen, setQuickStartOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Listen for custom events from FinalCTA component
  useEffect(() => {
    const handleOpenDocs = () => setDocsOpen(true);
    const handleOpenQuickStart = () => setQuickStartOpen(true);

    window.addEventListener('open-docs-modal', handleOpenDocs);
    window.addEventListener('open-quickstart-modal', handleOpenQuickStart);

    return () => {
      window.removeEventListener('open-docs-modal', handleOpenDocs);
      window.removeEventListener('open-quickstart-modal', handleOpenQuickStart);
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-full items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Terminal className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">
            <span className="text-cyan">Agent</span>
            <span className="text-white">DB</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          {location.pathname === '/' ? (
            <>
              <a href="#capabilities" className="flex items-center gap-1.5 text-muted-foreground hover:text-cyan transition-colors">
                <Zap className="h-4 w-4" />
                Features
              </a>
              <button
                onClick={() => setQuickStartOpen(true)}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-cyan transition-colors"
              >
                <Rocket className="h-4 w-4" />
                Quick Start
              </button>
              <button
                onClick={() => setDocsOpen(true)}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-cyan transition-colors"
              >
                <Book className="h-4 w-4" />
                Docs
              </button>
            </>
          ) : (
            <Link to="/" className="text-muted-foreground hover:text-cyan transition-colors">
              Home
            </Link>
          )}
          <Link
            to="/demo"
            className={`flex items-center gap-1.5 transition-colors ${
              isDemoPage && !isIdePage ? 'text-cyan' : 'text-muted-foreground hover:text-cyan'
            }`}
          >
            <Cpu className="h-4 w-4" />
            Demo
          </Link>
          <Link
            to="/demo/management-ide"
            className={`flex items-center gap-1.5 transition-colors ${
              isIdePage ? 'text-cyan' : 'text-muted-foreground hover:text-cyan'
            }`}
          >
            <Code2 className="h-4 w-4" />
            IDE
          </Link>
        </nav>
        
        <div className="flex items-center gap-3">
          {isDemoPage && (
            <Button
              size="sm"
              className="gap-2 bg-gradient-to-r from-purple-500 to-cyan hover:from-purple-600 hover:to-cyan/90 border-0"
              onClick={() => setWizardOpen(true)}
            >
              <Wand2 className="h-4 w-4" />
              <span className="hidden sm:inline">Code Wizard</span>
            </Button>
          )}
          {location.pathname !== '/' && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:flex gap-2"
              onClick={() => setDocsOpen(true)}
            >
              <Book className="h-4 w-4" />
              <span>Docs</span>
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            className="gap-2"
            asChild
          >
            <a href="https://www.npmjs.com/package/agentdb" target="_blank" rel="noopener noreferrer">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">NPM</span>
            </a>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="gap-2"
            asChild
          >
            <a href="https://github.com/ruvnet/agentic-flow/tree/main/agentic-flow" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
        </div>
      </div>

      <GettingStartedModal open={quickStartOpen} onOpenChange={setQuickStartOpen} />
      <DocsModal open={docsOpen} onOpenChange={setDocsOpen} />
      <WizardModal open={wizardOpen} onOpenChange={setWizardOpen} />
    </header>
  );
};
