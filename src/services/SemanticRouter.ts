/**
 * SemanticRouter - Wraps @ruvector/router for semantic intent routing
 *
 * Provides semantic query routing to named intent routes using
 * @ruvector/router for embedding-based matching. Falls back to
 * keyword matching if @ruvector/router is not available.
 *
 * Usage:
 *   const router = new SemanticRouter();
 *   await router.initialize();
 *   await router.addRoute('search', 'Find information in memory', ['find', 'search', 'lookup']);
 *   await router.addRoute('store', 'Save information to memory', ['save', 'store', 'remember']);
 *   const { route, confidence } = await router.route('find me the latest results');
 */

export interface RouteResult {
  route: string;
  confidence: number;
}

export interface RouteConfig {
  embedding?: number[];
  keywords: string[];
}

export class SemanticRouter {
  private router: any = null;
  private available: boolean = false;
  private engineType: 'native' | 'js' = 'js';
  private routes: Map<string, RouteConfig> = new Map();

  /**
   * Initialize the semantic router
   *
   * ADR-062 Phase 2: Tries native @ruvector/router (NAPI-RS) first,
   * falls back to keyword matching. Reports engine type for monitoring.
   *
   * @returns true if @ruvector/router was loaded, false if using fallback
   */
  async initialize(): Promise<boolean> {
    try {
      const mod = await import('@ruvector/router');
      const Router = (mod as any).Router || (mod as any).default?.Router || (mod as any).default;
      if (Router) {
        this.router = typeof Router === 'function' ? new Router() : Router;
        this.available = true;
        this.engineType = 'native';
        console.log('[SemanticRouter] Using native @ruvector/router');
        return true;
      }
      this.available = false;
      this.engineType = 'js';
      return false;
    } catch {
      this.available = false;
      this.engineType = 'js';
      return false;
    }
  }

  /**
   * Get the active engine type: 'native' or 'js'
   */
  getEngineType(): string {
    return this.engineType;
  }

  /**
   * Add a named route with description and optional keywords
   *
   * When @ruvector/router is available, the description is used to
   * generate an embedding for semantic matching. Keywords are used
   * as fallback when the router is not available.
   *
   * @param name - Unique route identifier
   * @param description - Natural language description for semantic matching
   * @param keywords - Fallback keywords for simple matching
   */
  async addRoute(name: string, description: string, keywords: string[] = []): Promise<void> {
    this.routes.set(name, { keywords });

    if (this.router) {
      try {
        if (typeof this.router.addRoute === 'function') {
          await this.router.addRoute(name, description);
        } else if (typeof this.router.add === 'function') {
          await this.router.add(name, description);
        }
      } catch {
        // Fall through to keyword matching for this route
      }
    }
  }

  /**
   * Route a query to the best matching route
   *
   * Uses semantic similarity via @ruvector/router when available,
   * otherwise falls back to keyword frequency matching.
   *
   * @param query - Natural language query to route
   * @returns Route name and confidence score (0-1)
   */
  async route(query: string): Promise<RouteResult> {
    // Try semantic routing first
    if (this.router) {
      try {
        let result: any;
        if (typeof this.router.route === 'function') {
          result = await this.router.route(query);
        } else if (typeof this.router.match === 'function') {
          result = await this.router.match(query);
        }

        if (result) {
          return {
            route: result.name || result.route || String(result),
            confidence: result.score || result.confidence || 0.9
          };
        }
      } catch {
        // Fall through to keyword matching
      }
    }

    // Keyword fallback
    return this.keywordMatch(query);
  }

  /**
   * Remove a route by name
   */
  removeRoute(name: string): boolean {
    return this.routes.delete(name);
  }

  /**
   * Get all registered route names
   */
  getRoutes(): string[] {
    return Array.from(this.routes.keys());
  }

  /**
   * Check if @ruvector/router is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Keyword-based fallback routing
   *
   * Scores each route by the fraction of its keywords
   * that appear in the query string (case-insensitive).
   */
  private keywordMatch(query: string): RouteResult {
    let bestMatch = '';
    let bestScore = 0;
    const queryLower = query.toLowerCase();

    for (const [name, config] of this.routes) {
      if (config.keywords.length === 0) continue;

      const matches = config.keywords.filter(
        k => queryLower.includes(k.toLowerCase())
      ).length;
      const score = matches / config.keywords.length;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }

    return {
      route: bestMatch || 'default',
      confidence: bestScore
    };
  }
}
