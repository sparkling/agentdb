import { Circle, Package, Code2 } from "lucide-react";
import { Link } from "react-router-dom";

export const ConsoleFooter = () => {
  return (
    <footer className="sticky bottom-0 z-40 h-auto md:h-10 border-t border-border bg-background/80 backdrop-blur-md">
      <div className="w-full max-w-full flex flex-col md:flex-row h-full items-center justify-between px-2 md:px-6 py-2 md:py-0 gap-2 md:gap-0 text-xs overflow-hidden">
        <div className="flex items-center gap-1.5 md:gap-3 text-muted-foreground flex-wrap justify-center md:justify-start text-center max-w-full">
          <span className="whitespace-nowrap">© AgentDB 2025</span>
          <span className="hidden lg:inline">·</span>
          <span className="hidden lg:inline whitespace-nowrap">Created by <a href="https://ruv.io" target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">rUv</a></span>
          <span className="hidden lg:inline">·</span>
          <span className="hidden lg:inline whitespace-nowrap">MIT License</span>
          <span className="hidden sm:inline">·</span>
          <a href="https://github.com/ruvnet/agentic-flow/tree/main/agentic-flow" target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline whitespace-nowrap">GitHub</a>
          <span className="hidden sm:inline">·</span>
          <a href="https://www.npmjs.com/package/agentdb" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan hover:underline whitespace-nowrap">
            <Package className="h-3 w-3" />
            NPM
          </a>
          <span className="inline">·</span>
          <Link to="/demo/management-ide" className="flex items-center gap-1 text-cyan hover:underline whitespace-nowrap">
            <Code2 className="h-3 w-3" />
            IDE
          </Link>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4 text-[10px] md:text-xs flex-shrink-0">
          <div className="flex items-center gap-1">
            <Circle className="h-2 w-2 fill-cyan text-cyan animate-pulse" />
            <span className="text-muted-foreground whitespace-nowrap">Synced</span>
          </div>
          <span className="text-cyan whitespace-nowrap">12ms</span>
          <span className="text-cyan whitespace-nowrap">20</span>
        </div>
      </div>
    </footer>
  );
};
