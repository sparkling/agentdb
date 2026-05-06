# Routing Setup - WASM Examples Browser

## Overview

This document details the routing configuration, navigation flow, and URL structure for the WASM Examples Browser feature.

## Route Definitions

### 1. Main Routes (App.tsx)

```typescript
// /src/App.tsx

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";

// Eager-loaded pages (critical)
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-loaded pages (non-critical)
const WasmExamples = lazy(() => import("./pages/WasmExamples"));
const WasmExampleDetail = lazy(() => import("./pages/WasmExampleDetail"));

// Loading component for lazy routes
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-cyan border-t-transparent rounded-full animate-spin" />
      <p className="text-muted-foreground">Loading...</p>
    </div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Homepage */}
            <Route path="/" element={<Index />} />

            {/* WASM Examples Gallery */}
            <Route path="/wasm-examples" element={<WasmExamples />} />

            {/* Individual Example Detail */}
            <Route
              path="/wasm-examples/:exampleId"
              element={<WasmExampleDetail />}
            />

            {/* Catch-all 404 - MUST BE LAST */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
```

---

## Route Hierarchy

```
/
├── / (Index)                          - Homepage
├── /wasm-examples                     - Gallery landing page
│   ├── ?search=rag                    - Search results
│   ├── ?category=advanced             - Filter by category
│   ├── ?difficulty=expert             - Filter by difficulty
│   └── ?sort=popularity               - Sort options
├── /wasm-examples/:exampleId          - Example detail pages
│   ├── /wasm-examples/rag-self-learning
│   ├── /wasm-examples/pattern-learning
│   ├── /wasm-examples/experience-replay
│   ├── /wasm-examples/collaborative-filtering
│   ├── /wasm-examples/adaptive-recommendations
│   ├── /wasm-examples/swarm-intelligence
│   ├── /wasm-examples/meta-learning
│   ├── /wasm-examples/neuro-symbolic
│   ├── /wasm-examples/quantum-inspired
│   └── /wasm-examples/continual-learning
└── * (NotFound)                       - 404 error page
```

---

## URL Parameter Handling

### WasmExamples Page (Gallery)

```typescript
// /src/pages/WasmExamples.tsx

import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import { filterExamples } from '@/lib/wasm-examples-data';

const WasmExamples = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse URL parameters
  const filters = useMemo(() => ({
    search: searchParams.get('search') || '',
    categories: searchParams.getAll('category') as LearningCategory[],
    difficulty: searchParams.getAll('difficulty') as DifficultyLevel[],
    learningType: searchParams.getAll('learningType') as LearningType[],
    sortBy: (searchParams.get('sort') || 'popularity') as any,
    sortOrder: (searchParams.get('order') || 'desc') as 'asc' | 'desc',
  }), [searchParams]);

  // Filter examples based on URL parameters
  const filteredExamples = useMemo(
    () => filterExamples(filters),
    [filters]
  );

  // Update URL when filters change
  const handleFilterChange = (newFilters: Partial<FilterState>) => {
    const params = new URLSearchParams();

    if (newFilters.search) params.set('search', newFilters.search);
    newFilters.categories?.forEach(c => params.append('category', c));
    newFilters.difficulty?.forEach(d => params.append('difficulty', d));
    newFilters.learningType?.forEach(l => params.append('learningType', l));
    if (newFilters.sortBy) params.set('sort', newFilters.sortBy);
    if (newFilters.sortOrder) params.set('order', newFilters.sortOrder);

    setSearchParams(params);
  };

  return (
    <div>
      <ExampleFilters
        filters={filters}
        onChange={handleFilterChange}
      />
      <ExampleGrid examples={filteredExamples} />
    </div>
  );
};
```

### Example URL Patterns

```
# Search for "RAG"
/wasm-examples?search=rag

# Filter by category
/wasm-examples?category=advanced

# Multiple filters
/wasm-examples?category=advanced&difficulty=expert

# Sorted by difficulty
/wasm-examples?sort=difficulty&order=asc

# Combined filters and search
/wasm-examples?search=learning&category=standard&difficulty=intermediate&sort=popularity
```

---

### WasmExampleDetail Page (Individual Example)

```typescript
// /src/pages/WasmExampleDetail.tsx

import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { getExampleById } from '@/lib/wasm-examples-data';

const WasmExampleDetail = () => {
  const { exampleId } = useParams<{ exampleId: string }>();
  const navigate = useNavigate();

  // Validate example exists
  const example = getExampleById(exampleId || '');

  // Redirect to 404 if example not found
  if (!example) {
    return <Navigate to="/404" replace />;
  }

  // Breadcrumb navigation
  const handleBackToGallery = () => {
    navigate('/wasm-examples');
  };

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex gap-2 text-sm mb-4">
        <button
          onClick={handleBackToGallery}
          className="text-cyan hover:underline"
        >
          WASM Examples
        </button>
        <span className="text-muted">/</span>
        <span className="text-foreground">{example.title}</span>
      </nav>

      {/* Example content */}
      <ExampleDemo example={example} />
    </div>
  );
};
```

---

## Navigation Components

### 1. Update ConsoleHeader (Global Navigation)

```typescript
// /src/components/ConsoleHeader.tsx

import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';

export const ConsoleHeader = () => {
  const location = useLocation();

  // Check if current path is active
  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-50 bg-panel-strong border-b border-line">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold">
              <span className="text-cyan">Agent</span>
              <span className="text-white">DB</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <a
              href="/#features"
              className="text-foreground hover:text-cyan transition-colors"
            >
              Features
            </a>
            <a
              href="/#quickstart"
              className="text-foreground hover:text-cyan transition-colors"
            >
              Quick Start
            </a>

            {/* NEW: WASM Examples Link */}
            <Link
              to="/wasm-examples"
              className={`
                text-foreground hover:text-cyan transition-colors
                ${isActive('/wasm-examples') ? 'text-cyan font-semibold' : ''}
              `}
            >
              WASM Examples
            </Link>

            <a
              href="https://github.com/ruvnet/agentdb"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-cyan transition-colors"
            >
              GitHub
            </a>

            <Button variant="outline" size="sm" className="border-cyan text-cyan">
              Get Started
            </Button>
          </nav>

          {/* Mobile Menu Button */}
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </header>
  );
};
```

---

### 2. Example Card Navigation

```typescript
// /src/components/wasm/ExampleCard.tsx

import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WasmExample } from '@/types/wasm-examples';

interface ExampleCardProps {
  example: WasmExample;
}

export const ExampleCard = ({ example }: ExampleCardProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/wasm-examples/${example.id}`);
  };

  return (
    <Card
      className="cursor-pointer hover:border-cyan/50 transition-all hover:scale-105"
      onClick={handleClick}
    >
      <CardHeader>
        <div className="flex justify-between items-start mb-2">
          <Badge variant="secondary">{example.category}</Badge>
          <Badge variant="outline">{example.difficulty}</Badge>
        </div>
        <CardTitle className="text-cyan">{example.title}</CardTitle>
        <CardDescription>{example.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2">
          {example.description}
        </p>
      </CardContent>
    </Card>
  );
};
```

---

### 3. Breadcrumb Component

```typescript
// /src/components/wasm/Breadcrumb.tsx

import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbProps {
  items: Array<{
    label: string;
    href?: string;
  }>;
}

export const Breadcrumb = ({ items }: BreadcrumbProps) => {
  const navigate = useNavigate();

  return (
    <nav className="flex items-center gap-2 text-sm mb-6">
      <Link
        to="/"
        className="text-muted-foreground hover:text-cyan transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>

      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-muted" />

          {item.href ? (
            <Link
              to={item.href}
              className="text-muted-foreground hover:text-cyan transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
};

// Usage in WasmExampleDetail.tsx
<Breadcrumb items={[
  { label: 'WASM Examples', href: '/wasm-examples' },
  { label: example.title }
]} />
```

---

## Deep Linking Support

### 1. Direct Example Access

Users can share direct links to specific examples:

```
https://agentdb.dev/wasm-examples/rag-self-learning
https://agentdb.dev/wasm-examples/swarm-intelligence
```

### 2. Filtered Gallery Links

Share filtered views:

```
https://agentdb.dev/wasm-examples?category=advanced&difficulty=expert
https://agentdb.dev/wasm-examples?search=learning&sort=popularity
```

### 3. Anchor Links (Future Enhancement)

Within example detail pages:

```
https://agentdb.dev/wasm-examples/rag-self-learning#demo
https://agentdb.dev/wasm-examples/rag-self-learning#code
https://agentdb.dev/wasm-examples/rag-self-learning#metrics
```

---

## URL State Persistence

### LocalStorage Integration

```typescript
// /src/hooks/use-persistent-filters.ts

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterState } from '@/types/wasm-examples';

const STORAGE_KEY = 'wasm-examples-filters';

export const usePersistentFilters = () => {
  const [searchParams] = useSearchParams();

  // Load from localStorage or URL
  const [filters, setFilters] = useState<FilterState>(() => {
    // Try URL first
    const urlFilters = getFiltersFromURL(searchParams);
    if (hasFilters(urlFilters)) return urlFilters;

    // Fallback to localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return getDefaultFilters();
      }
    }

    return getDefaultFilters();
  });

  // Save to localStorage when filters change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  return [filters, setFilters] as const;
};

function getDefaultFilters(): FilterState {
  return {
    search: '',
    categories: [],
    difficulty: [],
    learningType: [],
    sortBy: 'popularity',
    sortOrder: 'desc'
  };
}

function hasFilters(filters: FilterState): boolean {
  return !!(
    filters.search ||
    filters.categories.length > 0 ||
    filters.difficulty.length > 0 ||
    filters.learningType.length > 0
  );
}
```

---

## Scroll Behavior

### Scroll to Top on Route Change

```typescript
// /src/components/ScrollToTop.tsx

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, [pathname]);

  return null;
};

// Add to App.tsx
<BrowserRouter>
  <ScrollToTop />
  <Routes>
    {/* ... routes */}
  </Routes>
</BrowserRouter>
```

### Preserve Scroll Position

```typescript
// /src/hooks/use-scroll-restoration.ts

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export const useScrollRestoration = () => {
  const location = useLocation();
  const scrollPositions = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Save scroll position before leaving
    return () => {
      scrollPositions.current.set(location.pathname, window.scrollY);
    };
  }, [location.pathname]);

  useEffect(() => {
    // Restore scroll position when returning
    const savedPosition = scrollPositions.current.get(location.pathname);
    if (savedPosition !== undefined) {
      window.scrollTo(0, savedPosition);
    }
  }, [location.pathname]);
};
```

---

## Route Guards & Redirects

### 404 Handling

```typescript
// Enhanced 404 with suggestions

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-cyan mb-4">404</h1>
        <h2 className="text-2xl font-semibold mb-2">Page Not Found</h2>
        <p className="text-muted-foreground mb-6">
          The page you're looking for doesn't exist.
        </p>

        <div className="flex flex-col gap-3">
          <Button onClick={() => navigate('/')}>
            Go to Homepage
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/wasm-examples')}
          >
            Browse WASM Examples
          </Button>
        </div>
      </div>
    </div>
  );
};
```

### Example Validation

```typescript
// Redirect invalid example IDs to 404

const WasmExampleDetail = () => {
  const { exampleId } = useParams();
  const example = getExampleById(exampleId || '');

  if (!example) {
    return <Navigate to="/404" replace />;
  }

  // ... render example
};
```

---

## SEO & Meta Tags

### Dynamic Meta Tags per Route

```typescript
// /src/hooks/use-page-meta.ts

import { useEffect } from 'react';

export const usePageMeta = (title: string, description: string) => {
  useEffect(() => {
    // Update title
    document.title = `${title} | AgentDB`;

    // Update meta description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', description);
    }

    // Update Open Graph tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute('content', title);
    }

    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) {
      ogDescription.setAttribute('content', description);
    }
  }, [title, description]);
};

// Usage in WasmExamples.tsx
const WasmExamples = () => {
  usePageMeta(
    'WASM Examples Browser',
    'Explore 10 self-learning AI architectures running in your browser with AgentDB WASM'
  );

  // ... rest of component
};

// Usage in WasmExampleDetail.tsx
const WasmExampleDetail = () => {
  const { exampleId } = useParams();
  const example = getExampleById(exampleId || '');

  usePageMeta(
    example.title,
    example.description
  );

  // ... rest of component
};
```

---

## Testing Routing

### Route Test Cases

```typescript
// /src/pages/__tests__/routing.test.tsx

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import WasmExamples from '../WasmExamples';
import WasmExampleDetail from '../WasmExampleDetail';
import NotFound from '../NotFound';

describe('Routing', () => {
  test('renders gallery page at /wasm-examples', () => {
    render(
      <MemoryRouter initialEntries={['/wasm-examples']}>
        <Routes>
          <Route path="/wasm-examples" element={<WasmExamples />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/WASM Examples/i)).toBeInTheDocument();
  });

  test('renders example detail at /wasm-examples/:id', () => {
    render(
      <MemoryRouter initialEntries={['/wasm-examples/rag-self-learning']}>
        <Routes>
          <Route path="/wasm-examples/:exampleId" element={<WasmExampleDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/RAG Self-Learning/i)).toBeInTheDocument();
  });

  test('redirects invalid example to 404', () => {
    render(
      <MemoryRouter initialEntries={['/wasm-examples/invalid-id']}>
        <Routes>
          <Route path="/wasm-examples/:exampleId" element={<WasmExampleDetail />} />
          <Route path="/404" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/404/i)).toBeInTheDocument();
  });
});
```

---

**Next**: See `03-COMPONENT-SPECIFICATIONS.md` for detailed component implementations
