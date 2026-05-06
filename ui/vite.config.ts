import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import fs from "fs";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Middleware to handle directory index serving
    middlewareMode: false,
    proxy: {},
    fs: {
      strict: false
    },
    // Configure middleware to serve index.html for directories
    middlewares: [
      function directoryIndexMiddleware(req: any, res: any, next: any) {
        if (req.url && req.url.endsWith('/') && req.url !== '/') {
          const indexPath = path.join(__dirname, 'public', req.url, 'index.html');
          if (fs.existsSync(indexPath)) {
            req.url = req.url + 'index.html';
          }
        }
        next();
      }
    ]
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
