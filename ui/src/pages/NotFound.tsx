import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Database, Home, BookOpen, Code2, FileText } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-2xl mx-auto px-6 text-center">
        {/* AgentDB Logo/Icon */}
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <Database className="w-24 h-24 text-green-500 animate-pulse" />
            <div className="absolute inset-0 bg-green-500/20 blur-2xl rounded-full" />
          </div>
        </div>

        {/* Error Message */}
        <h1 className="mb-4 text-6xl font-bold text-white">404</h1>
        <h2 className="mb-4 text-2xl font-semibold text-green-400">Page Not Found</h2>
        <p className="mb-8 text-lg text-gray-300">
          The page you're looking for doesn't exist or has been moved.
        </p>

        {/* Helpful Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <a
            href="/"
            className="flex items-center gap-3 p-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-500 rounded-lg transition-all group"
          >
            <Home className="w-5 h-5 text-green-500 group-hover:scale-110 transition-transform" />
            <div className="text-left">
              <div className="font-semibold text-white">Home</div>
              <div className="text-sm text-gray-400">Return to homepage</div>
            </div>
          </a>

          <a
            href="/agentdb/examples/browser/agentic-marketing/index.html"
            className="flex items-center gap-3 p-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-500 rounded-lg transition-all group"
          >
            <Code2 className="w-5 h-5 text-green-500 group-hover:scale-110 transition-transform" />
            <div className="text-left">
              <div className="font-semibold text-white">Agentic Marketing</div>
              <div className="text-sm text-gray-400">Live demo example</div>
            </div>
          </a>

          <a
            href="https://github.com/ruvnet/agentic-flow/tree/main/packages/agentdb"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-500 rounded-lg transition-all group"
          >
            <BookOpen className="w-5 h-5 text-green-500 group-hover:scale-110 transition-transform" />
            <div className="text-left">
              <div className="font-semibold text-white">Documentation</div>
              <div className="text-sm text-gray-400">Learn about AgentDB</div>
            </div>
          </a>

          <a
            href="https://agentdb.ruv.io/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-500 rounded-lg transition-all group"
          >
            <FileText className="w-5 h-5 text-green-500 group-hover:scale-110 transition-transform" />
            <div className="text-left">
              <div className="font-semibold text-white">API Reference</div>
              <div className="text-sm text-gray-400">Explore the API</div>
            </div>
          </a>
        </div>

        {/* Additional Info */}
        <div className="pt-6 border-t border-gray-700">
          <p className="text-sm text-gray-400">
            Requested path: <code className="px-2 py-1 bg-gray-800 rounded text-green-400">{location.pathname}</code>
          </p>
          <p className="mt-4 text-xs text-gray-500">
            AgentDB - SQL-based Agentic Memory with Vector Embeddings
          </p>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
