/**
 * Type definitions for WASM Examples Browser
 * AgentDB v1.0.1
 */

/**
 * Learning category classification
 */
export type LearningCategory = 'standard' | 'advanced' | 'exotic';

/**
 * Difficulty levels for examples
 */
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * Learning paradigm classification
 */
export type LearningType = 'supervised' | 'unsupervised' | 'reinforcement' | 'hybrid';

/**
 * Example status for live indicators
 */
export type ExampleStatus = 'active' | 'loading' | 'error' | 'idle';

/**
 * Core example metadata
 */
export interface WasmExample {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: LearningCategory;
  difficulty: DifficultyLevel;
  learningType: LearningType;

  // Files and resources
  htmlPath: string;
  sourceUrl?: string;
  docsUrl?: string;

  // Visual
  icon: string;
  gradient: [string, string];
  thumbnail?: string;

  // Metadata
  author?: string;
  version?: string;
  lastUpdated?: Date;

  // Features and capabilities
  features: string[];
  useCases: string[];
  algorithms: string[];
  tags?: string[];

  // Stats (for sorting/filtering)
  views?: number;
  likes?: number;
  popularity?: number;

  // Performance
  performanceMetrics?: {
    loadTime: number;
    memoryUsage: number;
    throughput: number;
  };
}

/**
 * Filter state for example browsing
 */
export interface FilterState {
  search: string;
  categories: LearningCategory[];
  difficulty: DifficultyLevel[];
  learningType: LearningType[];
  sortBy: 'alphabetical' | 'popularity' | 'difficulty' | 'recent';
  sortOrder: 'asc' | 'desc';
}

/**
 * Learning metrics for tracking progress
 */
export interface LearningMetrics {
  totalQueries: number;
  successRate: number;
  learningProgress: number;
  patternsDetected: number;
  avgResponseTime: number;
  accuracy?: number;

  // Time-series data for charts
  history?: Array<{
    timestamp: number;
    value: number;
  }>;
}

/**
 * WASM execution state
 */
export interface WasmExecutionState {
  status: ExampleStatus;
  error?: Error;
  metrics?: LearningMetrics;
  initialized: boolean;
  loading: boolean;
}
