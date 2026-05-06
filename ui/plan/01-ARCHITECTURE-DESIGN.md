# Architecture Design - WASM Examples Browser

## System Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentDB Website                          │
│                                                              │
│  ┌────────────────────┐    ┌──────────────────────────┐    │
│  │   Main Site        │    │   WASM Examples Browser   │    │
│  │   (existing)       │◄───┤   (new feature)           │    │
│  │                    │    │                           │    │
│  │  / (Index)         │    │  /wasm-examples           │    │
│  │  /404 (NotFound)   │    │  /wasm-examples/:id       │    │
│  └────────────────────┘    └──────────────────────────┘    │
│                                      │                       │
│                                      │                       │
│  ┌──────────────────────────────────▼─────────────────────┐ │
│  │              Shared Infrastructure                      │ │
│  │                                                         │ │
│  │  • React Router v6                                     │ │
│  │  • Tailwind CSS + Design System                        │ │
│  │  • Shadcn UI Components                                │ │
│  │  • React Query (State Management)                      │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  AgentDB WASM Backend                        │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │  sql.js      │   │ wasm-loader  │   │ better-      │   │
│  │  (Browser)   │   │              │   │ sqlite3      │   │
│  │              │   │              │   │ (Node.js)    │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Page-Level Components

#### 1. WasmExamples.tsx (Main Landing Page)

**Purpose**: Gallery/catalog page for browsing all WASM examples

**Structure**:
```tsx
<WasmExamples>
  ├── <WasmHero />              // Hero section
  ├── <ExampleFilters />        // Search & filter controls
  ├── <ExampleGrid>             // Grid layout
  │    └── <ExampleCard /> × 10 // Individual example cards
  ├── <WasmDocumentation />     // Educational content
  └── <WasmPerformance />       // Benchmark section
</WasmExamples>
```

**State Management**:
- Filter state (category, difficulty, search query)
- Sort state (alphabetical, popularity, difficulty)
- View mode (grid, list)
- Selected categories

**Props**: None (route-level component)

**Hooks**:
- `useSearchParams` - URL query parameters
- `useState` - Local filter/search state
- `useMemo` - Filtered/sorted example list

---

#### 2. WasmExampleDetail.tsx (Example Detail Page)

**Purpose**: Full-page view for individual example with demo + documentation

**Structure**:
```tsx
<WasmExampleDetail>
  ├── <ExampleHeader />         // Title, breadcrumb, metadata
  ├── <ExampleTabs>             // Tab navigation
  │    ├── Demo                 // Interactive example
  │    ├── Code                 // Source code viewer
  │    ├── Documentation        // Learning guide
  │    └── Metrics              // Performance stats
  └── <RelatedExamples />       // Suggestions
</WasmExampleDetail>
```

**State Management**:
- Active tab
- Example execution state
- Learning metrics
- Code visibility
- User interactions

**Props**:
- `exampleId: string` (from route params)

**Hooks**:
- `useParams` - Route parameters
- `useWasmExample` - Custom hook for WASM lifecycle
- `useState` - UI state
- `useEffect` - Lifecycle management

---

### Reusable Component Library

#### ExampleCard.tsx

**Purpose**: Display example preview in grid

```tsx
interface ExampleCardProps {
  example: WasmExample;
  onClick?: () => void;
  variant?: 'default' | 'compact' | 'featured';
}
```

**Features**:
- Hover animation (scale, glow)
- Category badge
- Difficulty indicator
- Live status indicator
- Click to navigate

**Design**:
- Dark card with cyan accent
- Gradient border on hover
- Icon representation
- Stats preview (views, likes)

---

#### ExampleGrid.tsx

**Purpose**: Responsive grid layout for example cards

```tsx
interface ExampleGridProps {
  examples: WasmExample[];
  onExampleClick: (id: string) => void;
  loading?: boolean;
  emptyMessage?: string;
}
```

**Features**:
- Responsive columns (1 mobile, 2 tablet, 3 desktop)
- Loading skeleton states
- Empty state handling
- Lazy loading support

**Layout**:
- CSS Grid with gap
- Auto-fit minmax
- Maintain aspect ratio

---

#### ExampleFilters.tsx

**Purpose**: Search and filter controls

```tsx
interface ExampleFiltersProps {
  onFilterChange: (filters: FilterState) => void;
  initialFilters?: FilterState;
}

interface FilterState {
  search: string;
  categories: string[];
  difficulty: ('beginner' | 'intermediate' | 'advanced' | 'expert')[];
  learningType: ('supervised' | 'unsupervised' | 'reinforcement' | 'hybrid')[];
}
```

**Features**:
- Real-time search (debounced)
- Multi-select category filter
- Difficulty range filter
- Learning type filter
- Reset button
- Active filter count badge

**Components Used**:
- Shadcn Input (search)
- Shadcn Select (dropdowns)
- Shadcn Checkbox (multi-select)
- Shadcn Button (reset)

---

#### CodePlayground.tsx

**Purpose**: Display source code with syntax highlighting

```tsx
interface CodePlaygroundProps {
  code: string;
  language: 'javascript' | 'typescript' | 'html';
  editable?: boolean;
  onCodeChange?: (newCode: string) => void;
}
```

**Features**:
- Syntax highlighting (Prism.js or highlight.js)
- Line numbers
- Copy to clipboard
- Download code
- Live editing (optional)

**Implementation Options**:
- **Simple**: `<pre><code>` with CSS highlighting
- **Advanced**: Monaco Editor (VS Code editor)
- **Recommended**: React Syntax Highlighter (lightweight)

---

#### LearningMetrics.tsx

**Purpose**: Display learning progress and statistics

```tsx
interface LearningMetricsProps {
  metrics: {
    totalQueries: number;
    successRate: number;
    learningProgress: number;
    patternsDetected: number;
    avgResponseTime: number;
  };
  realtime?: boolean;
}
```

**Features**:
- Animated progress bars
- Real-time updates
- Sparkline charts
- Stat cards with icons
- Color-coded indicators

**Components**:
- Recharts (for visualizations)
- Shadcn Progress
- Shadcn Card
- Custom stat components

---

## Data Layer Architecture

### Type Definitions

```typescript
// /src/types/wasm-examples.ts

/**
 * Learning category classification
 */
export type LearningCategory =
  | 'standard'      // RAG, Pattern Learning, etc.
  | 'advanced'      // Swarm, Meta-learning, etc.
  | 'exotic';       // Quantum-inspired, Neuro-symbolic

/**
 * Difficulty levels for examples
 */
export type DifficultyLevel =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';

/**
 * Learning paradigm classification
 */
export type LearningType =
  | 'supervised'         // RAG, Collaborative Filtering
  | 'unsupervised'       // Pattern Learning
  | 'reinforcement'      // Experience Replay
  | 'hybrid';            // Multi-Armed Bandit

/**
 * Example status for live indicators
 */
export type ExampleStatus =
  | 'active'
  | 'loading'
  | 'error'
  | 'idle';

/**
 * Core example metadata
 */
export interface WasmExample {
  id: string;                          // Unique identifier (slug)
  title: string;                       // Display name
  subtitle: string;                    // One-liner description
  description: string;                 // Full description
  category: LearningCategory;          // Standard/Advanced/Exotic
  difficulty: DifficultyLevel;         // Beginner to Expert
  learningType: LearningType;          // Supervised/etc.

  // Files and resources
  htmlPath: string;                    // Path to standalone HTML
  sourceUrl?: string;                  // GitHub source link
  docsUrl?: string;                    // Documentation link

  // Visual
  icon: string;                        // Lucide icon name
  gradient: [string, string];          // CSS gradient colors
  thumbnail?: string;                  // Preview image

  // Metadata
  author?: string;                     // Creator
  version?: string;                    // Example version
  lastUpdated?: Date;                  // Last modified

  // Features and capabilities
  features: string[];                  // Key features list
  useCases: string[];                  // Real-world applications
  algorithms: string[];                // ML algorithms used

  // Stats (for sorting/filtering)
  views?: number;                      // View count
  likes?: number;                      // Like count
  popularity?: number;                 // Derived popularity score

  // Performance
  performanceMetrics?: {
    loadTime: number;                  // Avg load time (ms)
    memoryUsage: number;               // Avg memory (MB)
    throughput: number;                // Operations/sec
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
  history?: {
    timestamp: number;
    value: number;
  }[];
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
```

### Example Data Repository

```typescript
// /src/lib/wasm-examples-data.ts

import { WasmExample } from '@/types/wasm-examples';

/**
 * Complete catalog of WASM examples
 */
export const WASM_EXAMPLES: WasmExample[] = [
  {
    id: 'rag-self-learning',
    title: 'RAG Self-Learning',
    subtitle: 'Retrieval-Augmented Generation with Continuous Learning',
    description: 'Build a knowledge base that learns from user queries and feedback to improve responses over time.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/rag/index.html',
    icon: 'BookOpen',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Dynamic knowledge base',
      'Vector semantic search',
      'Query pattern recognition',
      'Feedback loop learning',
      'Context-aware responses'
    ],
    useCases: [
      'Personal knowledge management',
      'FAQ chatbots',
      'Document search systems',
      'Context-aware help systems'
    ],
    algorithms: [
      'Vector Similarity (Cosine)',
      'TF-IDF Embeddings',
      'Retrieval-Augmented Generation'
    ]
  },

  {
    id: 'pattern-learning',
    title: 'Pattern-Based Learning',
    subtitle: 'Discover and Predict User Interaction Patterns',
    description: 'Automatically detect behavioral patterns and provide predictive assistance.',
    category: 'standard',
    difficulty: 'beginner',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/pattern-learning/index.html',
    icon: 'TrendingUp',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Automatic pattern detection',
      'Confidence scoring',
      'Next-action prediction',
      'Temporal analysis',
      'Visual timeline'
    ],
    useCases: [
      'Workflow optimization',
      'Predictive UI/UX',
      'Task automation',
      'Productivity apps'
    ],
    algorithms: [
      'Sequence Mining',
      'Sliding Window Analysis',
      'Pattern Frequency Analysis'
    ]
  },

  {
    id: 'experience-replay',
    title: 'Experience Replay',
    subtitle: 'Q-Learning with Experience Buffer',
    description: 'Classic reinforcement learning with experience replay for optimal strategy discovery.',
    category: 'standard',
    difficulty: 'advanced',
    learningType: 'reinforcement',
    htmlPath: '/agentdb/examples/browser/experience-replay/index.html',
    icon: 'Brain',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Q-Learning algorithm',
      'Experience replay buffer',
      'Epsilon-greedy exploration',
      'Q-value visualization',
      'Auto-play training'
    ],
    useCases: [
      'Game AI',
      'Resource allocation',
      'Path planning',
      'Decision systems'
    ],
    algorithms: [
      'Q-Learning',
      'Bellman Equation',
      'Experience Replay',
      'Epsilon-Greedy Policy'
    ]
  },

  {
    id: 'collaborative-filtering',
    title: 'Collaborative Filtering',
    subtitle: 'Recommendation System Based on User Similarity',
    description: 'Build recommendations by finding users with similar tastes.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/collaborative-filtering/index.html',
    icon: 'Users',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'User similarity calculation',
      'Item-based filtering',
      'Cold-start handling',
      'Multi-category support',
      'Cross-user patterns'
    ],
    useCases: [
      'Content recommendations',
      'E-commerce suggestions',
      'Friend recommendations',
      'Media playlists'
    ],
    algorithms: [
      'Cosine Similarity',
      'K-Nearest Neighbors',
      'Matrix Factorization'
    ]
  },

  {
    id: 'adaptive-recommendations',
    title: 'Adaptive Recommendations',
    subtitle: 'Multi-Armed Bandit with Thompson Sampling',
    description: 'Real-time adaptive system balancing exploration and exploitation.',
    category: 'standard',
    difficulty: 'advanced',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/adaptive-recommendations/index.html',
    icon: 'Zap',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Thompson Sampling',
      'Beta distribution tracking',
      'Real-time adaptation',
      'Exploration/exploitation balance',
      'Category preference tracking'
    ],
    useCases: [
      'Personalized feeds',
      'A/B testing',
      'Dynamic pricing',
      'Adaptive marketing'
    ],
    algorithms: [
      'Multi-Armed Bandit',
      'Thompson Sampling',
      'Beta Distribution',
      'Bayesian Inference'
    ]
  },

  {
    id: 'swarm-intelligence',
    title: 'Swarm Intelligence',
    subtitle: 'Emergent Collective Behavior with PSO',
    description: 'Watch autonomous agents exhibit emergent intelligence through local interactions.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/swarm-intelligence/index.html',
    icon: 'Hexagon',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Particle swarm optimization',
      'Stigmergy communication',
      'Three behavior modes',
      'Emergent pathfinding',
      'Obstacle avoidance'
    ],
    useCases: [
      'Distributed optimization',
      'Route planning',
      'Swarm robotics',
      'Network optimization'
    ],
    algorithms: [
      'Particle Swarm Optimization',
      'Stigmergy',
      'Pheromone Trails',
      'Swarm Coordination'
    ]
  },

  {
    id: 'meta-learning',
    title: 'Meta-Learning (MAML)',
    subtitle: 'Learning to Learn - Few-Shot Task Adaptation',
    description: 'Model-Agnostic Meta-Learning for rapid adaptation with minimal examples.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/meta-learning/index.html',
    icon: 'GitBranch',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'MAML algorithm',
      'Inner/outer loop optimization',
      'Few-shot learning',
      'Task distribution training',
      'Rapid adaptation'
    ],
    useCases: [
      'Personalization',
      'Domain adaptation',
      'Transfer learning',
      'AI assistants'
    ],
    algorithms: [
      'Model-Agnostic Meta-Learning',
      'Gradient Descent',
      'Few-Shot Learning',
      'Task Adaptation'
    ]
  },

  {
    id: 'neuro-symbolic',
    title: 'Neuro-Symbolic Reasoning',
    subtitle: 'Hybrid AI: Neural Perception + Symbolic Logic',
    description: 'Combine neural networks with symbolic reasoning for interpretable AI.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/neuro-symbolic/index.html',
    icon: 'Network',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Dual-system architecture',
      'Logical rule knowledge base',
      'Forward chaining inference',
      'Hybrid confidence scoring',
      'Explainable reasoning'
    ],
    useCases: [
      'Explainable AI',
      'Medical diagnosis',
      'Legal reasoning',
      'Scientific hypothesis'
    ],
    algorithms: [
      'Neural-Symbolic Integration',
      'Forward Chaining',
      'Logic Programming',
      'Hybrid Inference'
    ]
  },

  {
    id: 'quantum-inspired',
    title: 'Quantum-Inspired Optimization',
    subtitle: 'Global Optimization via Quantum Principles',
    description: 'Use quantum mechanics concepts to escape local optima.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/quantum-inspired/index.html',
    icon: 'Atom',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Quantum PSO',
      'Superposition states',
      'Quantum entanglement',
      'Energy barrier tunneling',
      'Multi-modal visualization'
    ],
    useCases: [
      'Complex optimization',
      'Neural architecture search',
      'Hyperparameter tuning',
      'Portfolio optimization'
    ],
    algorithms: [
      'Quantum Particle Swarm',
      'Superposition',
      'Quantum Tunneling',
      'Entanglement'
    ]
  },

  {
    id: 'continual-learning',
    title: 'Continual Learning',
    subtitle: 'Lifelong Learning Without Forgetting',
    description: 'Learn new tasks sequentially while preserving previous knowledge.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/continual-learning/index.html',
    icon: 'RefreshCw',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Elastic Weight Consolidation',
      'Experience replay buffer',
      'Synaptic consolidation',
      'Progressive task learning',
      'Forgetting curve monitoring'
    ],
    useCases: [
      'Personal AI assistants',
      'Autonomous systems',
      'Educational platforms',
      'Robotics'
    ],
    algorithms: [
      'Elastic Weight Consolidation',
      'Fisher Information',
      'Experience Replay',
      'Memory Consolidation'
    ]
  }
];

/**
 * Get example by ID
 */
export function getExampleById(id: string): WasmExample | undefined {
  return WASM_EXAMPLES.find(ex => ex.id === id);
}

/**
 * Get examples by category
 */
export function getExamplesByCategory(category: LearningCategory): WasmExample[] {
  return WASM_EXAMPLES.filter(ex => ex.category === category);
}

/**
 * Get examples by difficulty
 */
export function getExamplesByDifficulty(difficulty: DifficultyLevel): WasmExample[] {
  return WASM_EXAMPLES.filter(ex => ex.difficulty === difficulty);
}

/**
 * Filter and sort examples
 */
export function filterExamples(filters: FilterState): WasmExample[] {
  let filtered = WASM_EXAMPLES;

  // Search filter
  if (filters.search) {
    const search = filters.search.toLowerCase();
    filtered = filtered.filter(ex =>
      ex.title.toLowerCase().includes(search) ||
      ex.description.toLowerCase().includes(search) ||
      ex.features.some(f => f.toLowerCase().includes(search)) ||
      ex.useCases.some(u => u.toLowerCase().includes(search))
    );
  }

  // Category filter
  if (filters.categories.length > 0) {
    filtered = filtered.filter(ex =>
      filters.categories.includes(ex.category)
    );
  }

  // Difficulty filter
  if (filters.difficulty.length > 0) {
    filtered = filtered.filter(ex =>
      filters.difficulty.includes(ex.difficulty)
    );
  }

  // Learning type filter
  if (filters.learningType.length > 0) {
    filtered = filtered.filter(ex =>
      filters.learningType.includes(ex.learningType)
    );
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let comparison = 0;

    switch (filters.sortBy) {
      case 'alphabetical':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'popularity':
        comparison = (b.popularity || 0) - (a.popularity || 0);
        break;
      case 'difficulty':
        const difficultyOrder = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 };
        comparison = difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
        break;
      case 'recent':
        const aDate = a.lastUpdated?.getTime() || 0;
        const bDate = b.lastUpdated?.getTime() || 0;
        comparison = bDate - aDate;
        break;
    }

    return filters.sortOrder === 'asc' ? comparison : -comparison;
  });

  return sorted;
}
```

---

## Routing Architecture

### Route Structure

```typescript
// /src/App.tsx (updated)

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import WasmExamples from "./pages/WasmExamples";

<BrowserRouter>
  <Routes>
    <Route path="/" element={<Index />} />
    <Route path="/wasm-examples" element={<WasmExamples />} />
    <Route path="/wasm-examples/:exampleId" element={<WasmExampleDetail />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
</BrowserRouter>
```

### URL Patterns

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Index | Homepage (existing) |
| `/wasm-examples` | WasmExamples | Example gallery landing page |
| `/wasm-examples/rag-self-learning` | WasmExampleDetail | RAG example detail |
| `/wasm-examples/swarm-intelligence` | WasmExampleDetail | Swarm example detail |
| `/wasm-examples?category=advanced` | WasmExamples (filtered) | Filter by category |
| `/wasm-examples?difficulty=expert` | WasmExamples (filtered) | Filter by difficulty |

### Navigation Integration

Update `ConsoleHeader.tsx` to include WASM Examples link:

```tsx
// Add to navigation
<nav className="flex gap-6">
  <a href="/#features">Features</a>
  <a href="/#quickstart">Quick Start</a>
  <a href="/wasm-examples">WASM Examples</a> {/* NEW */}
  <a href="https://github.com/ruvnet/agentdb">GitHub</a>
</nav>
```

---

## State Management Strategy

### Local Component State (useState)
- UI state (filters, tabs, modals)
- Form inputs
- Temporary data

### URL State (useSearchParams)
- Filters (shareable)
- Sort options
- View mode

### Context API
- Theme
- Toast notifications
- Global UI settings

### React Query
- Example metadata (if fetched from API in future)
- Performance metrics
- User stats

### LocalStorage
- User preferences
- Recently viewed examples
- Favorite examples

---

## Performance Optimization

### Code Splitting

```tsx
// Lazy load example detail page
const WasmExampleDetail = lazy(() => import('./pages/WasmExampleDetail'));

// Lazy load heavy components
const CodePlayground = lazy(() => import('./components/wasm/CodePlayground'));
```

### WASM Loading Strategy

```typescript
// Lazy load WASM modules only when needed
const loadWasmModule = async (exampleId: string) => {
  const module = await import(
    /* webpackChunkName: "wasm-[request]" */
    `@/wasm-examples/${exampleId}/module.wasm`
  );
  return module;
};
```

### Asset Optimization
- Lazy load iframe content
- Preconnect to example domains
- Service worker caching
- Image optimization (WebP)

---

## Security Considerations

### iframe Sandbox

```html
<iframe
  src={example.htmlPath}
  sandbox="allow-scripts allow-same-origin"
  allow="clipboard-write"
  loading="lazy"
/>
```

### Content Security Policy

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' 'unsafe-eval';
               style-src 'self' 'unsafe-inline';
               connect-src 'self' https://api.openai.com;" />
```

### WASM Security
- No file system access
- Sandboxed execution
- Memory limits
- No network access (unless explicitly enabled)

---

## Accessibility (WCAG 2.1 AA)

### Keyboard Navigation
- All interactive elements focusable
- Tab order logical
- Focus indicators visible
- Escape to close modals

### Screen Reader Support
- Semantic HTML
- ARIA labels
- Role attributes
- Live regions for dynamic content

### Visual Accessibility
- Color contrast ratio > 4.5:1
- Text resizable up to 200%
- No content flashing
- Focus indicators

---

**Next**: See `02-ROUTING-SETUP.md` for detailed routing implementation
