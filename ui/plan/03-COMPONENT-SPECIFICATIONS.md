# Component Specifications - WASM Examples Browser

## Component Hierarchy

```
WasmExamples (Page)
├── ConsoleHeader (existing)
├── WasmHero
├── ExampleFilters
│   ├── SearchBar
│   ├── CategoryFilter
│   ├── DifficultyFilter
│   └── SortControls
├── ExampleGrid
│   └── ExampleCard × N
├── WasmDocumentation
└── ConsoleFooter (existing)

WasmExampleDetail (Page)
├── ConsoleHeader (existing)
├── Breadcrumb
├── ExampleHeader
├── Tabs
│   ├── DemoTab
│   │   └── ExampleIframe
│   ├── CodeTab
│   │   └── CodePlayground
│   ├── DocsTab
│   │   └── LearningGuide
│   └── MetricsTab
│       └── LearningMetrics
├── RelatedExamples
└── ConsoleFooter (existing)
```

---

## Page Components

### WasmExamples.tsx

**File**: `/src/pages/WasmExamples.tsx`

**Purpose**: Main landing page for WASM examples gallery

```typescript
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConsoleHeader } from '@/components/ConsoleHeader';
import { ConsoleFooter } from '@/components/ConsoleFooter';
import { WasmHero } from '@/components/wasm/WasmHero';
import { ExampleFilters } from '@/components/wasm/ExampleFilters';
import { ExampleGrid } from '@/components/wasm/ExampleGrid';
import { WasmDocumentation } from '@/components/wasm/WasmDocumentation';
import { WasmPerformance } from '@/components/wasm/WasmPerformance';
import { filterExamples, WASM_EXAMPLES } from '@/lib/wasm-examples-data';
import { FilterState } from '@/types/wasm-examples';

const WasmExamples = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse filters from URL
  const filters: FilterState = useMemo(() => ({
    search: searchParams.get('search') || '',
    categories: searchParams.getAll('category') as any[],
    difficulty: searchParams.getAll('difficulty') as any[],
    learningType: searchParams.getAll('learningType') as any[],
    sortBy: (searchParams.get('sort') || 'popularity') as any,
    sortOrder: (searchParams.get('order') || 'desc') as any,
  }), [searchParams]);

  // Filter and sort examples
  const filteredExamples = useMemo(
    () => filterExamples(filters),
    [filters]
  );

  // Update URL when filters change
  const handleFilterChange = (newFilters: Partial<FilterState>) => {
    const params = new URLSearchParams();

    const merged = { ...filters, ...newFilters };

    if (merged.search) params.set('search', merged.search);
    merged.categories?.forEach(c => params.append('category', c));
    merged.difficulty?.forEach(d => params.append('difficulty', d));
    merged.learningType?.forEach(l => params.append('learningType', l));
    if (merged.sortBy) params.set('sort', merged.sortBy);
    if (merged.sortOrder) params.set('order', merged.sortOrder);

    setSearchParams(params);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <ConsoleHeader />

      <main className="flex-1">
        <WasmHero />

        <section className="container mx-auto px-6 py-12">
          <ExampleFilters
            filters={filters}
            onChange={handleFilterChange}
          />

          <div className="mt-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {filteredExamples.length} {filteredExamples.length === 1 ? 'Example' : 'Examples'}
              </h2>
            </div>

            <ExampleGrid examples={filteredExamples} />
          </div>
        </section>

        <WasmDocumentation />
        <WasmPerformance />
      </main>

      <ConsoleFooter />
    </div>
  );
};

export default WasmExamples;
```

---

### WasmExampleDetail.tsx

**File**: `/src/pages/WasmExampleDetail.tsx`

**Purpose**: Individual example detail page with demo, code, docs, and metrics

```typescript
import { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ConsoleHeader } from '@/components/ConsoleHeader';
import { ConsoleFooter } from '@/components/ConsoleFooter';
import { Breadcrumb } from '@/components/wasm/Breadcrumb';
import { ExampleHeader } from '@/components/wasm/ExampleHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExampleIframe } from '@/components/wasm/ExampleIframe';
import { CodePlayground } from '@/components/wasm/CodePlayground';
import { LearningGuide } from '@/components/wasm/LearningGuide';
import { LearningMetrics } from '@/components/wasm/LearningMetrics';
import { RelatedExamples } from '@/components/wasm/RelatedExamples';
import { getExampleById } from '@/lib/wasm-examples-data';
import { usePageMeta } from '@/hooks/use-page-meta';

const WasmExampleDetail = () => {
  const { exampleId } = useParams<{ exampleId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('demo');

  // Get example data
  const example = getExampleById(exampleId || '');

  // Set page meta
  usePageMeta(
    example?.title || 'Example Not Found',
    example?.description || ''
  );

  // Redirect if example not found
  if (!example) {
    return <Navigate to="/404" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <ConsoleHeader />

      <main className="flex-1 container mx-auto px-6 py-8">
        <Breadcrumb items={[
          { label: 'WASM Examples', href: '/wasm-examples' },
          { label: example.title }
        ]} />

        <ExampleHeader example={example} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="demo">Demo</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="docs">Documentation</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>

          <TabsContent value="demo" className="mt-6">
            <ExampleIframe example={example} />
          </TabsContent>

          <TabsContent value="code" className="mt-6">
            <CodePlayground exampleId={example.id} />
          </TabsContent>

          <TabsContent value="docs" className="mt-6">
            <LearningGuide example={example} />
          </TabsContent>

          <TabsContent value="metrics" className="mt-6">
            <LearningMetrics exampleId={example.id} />
          </TabsContent>
        </Tabs>

        <RelatedExamples currentExample={example} className="mt-12" />
      </main>

      <ConsoleFooter />
    </div>
  );
};

export default WasmExampleDetail;
```

---

## Hero & Marketing Components

### WasmHero.tsx

```typescript
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Cpu, Zap, Code2 } from 'lucide-react';

export const WasmHero = () => {
  return (
    <section className="relative overflow-hidden py-20 grid-texture">
      <div className="container mx-auto px-6">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4">
            <Cpu className="h-3 w-3 mr-2" />
            WebAssembly Powered
          </Badge>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6">
            <span className="text-white">WASM Examples</span>
            <span className="caret-blink ml-2 text-cyan">▍</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-4">
            10 Self-Learning AI Architectures
          </p>

          <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Explore interactive machine learning examples running entirely in your browser
            with AgentDB's ultra-fast WebAssembly backend. No server required.
          </p>

          <div className="flex flex-wrap gap-4 justify-center mb-12">
            <Button size="lg" className="bg-cyan hover:bg-cyan/90">
              <Zap className="h-5 w-5 mr-2" />
              Start Exploring
            </Button>
            <Button size="lg" variant="outline">
              <Code2 className="h-5 w-5 mr-2" />
              View Source
            </Button>
          </div>

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
```

---

## Filter & Search Components

### ExampleFilters.tsx

```typescript
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { FilterState } from '@/types/wasm-examples';
import { useState } from 'react';

interface ExampleFiltersProps {
  filters: FilterState;
  onChange: (filters: Partial<FilterState>) => void;
}

export const ExampleFilters = ({ filters, onChange }: ExampleFiltersProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSearchChange = (value: string) => {
    onChange({ search: value });
  };

  const handleReset = () => {
    onChange({
      search: '',
      categories: [],
      difficulty: [],
      learningType: [],
      sortBy: 'popularity',
      sortOrder: 'desc'
    });
  };

  const activeFilterCount =
    filters.categories.length +
    filters.difficulty.length +
    filters.learningType.length +
    (filters.search ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search examples..."
            value={filters.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        <Button
          variant="outline"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="gap-2"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button variant="ghost" onClick={handleReset} className="gap-2">
            <X className="h-4 w-4" />
            Reset
          </Button>
        )}
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-panel rounded-lg border border-line">
          {/* Category Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Category</label>
            <Select
              value={filters.categories[0] || 'all'}
              onValueChange={(value) =>
                onChange({ categories: value === 'all' ? [] : [value as any] })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="standard">Standard Learning</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
                <SelectItem value="exotic">Exotic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Difficulty Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Difficulty</label>
            <Select
              value={filters.difficulty[0] || 'all'}
              onValueChange={(value) =>
                onChange({ difficulty: value === 'all' ? [] : [value as any] })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
                <SelectItem value="expert">Expert</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Sort By</label>
            <Select
              value={filters.sortBy}
              onValueChange={(value) =>
                onChange({ sortBy: value as any })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="popularity">Popularity</SelectItem>
                <SelectItem value="alphabetical">Alphabetical</SelectItem>
                <SelectItem value="difficulty">Difficulty</SelectItem>
                <SelectItem value="recent">Recently Updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
};
```

---

## Grid & Card Components

### ExampleGrid.tsx

```typescript
import { ExampleCard } from './ExampleCard';
import { WasmExample } from '@/types/wasm-examples';

interface ExampleGridProps {
  examples: WasmExample[];
  loading?: boolean;
}

export const ExampleGrid = ({ examples, loading }: ExampleGridProps) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-64 bg-panel rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (examples.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">
          No examples found. Try adjusting your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {examples.map((example) => (
        <ExampleCard key={example.id} example={example} />
      ))}
    </div>
  );
};
```

### ExampleCard.tsx

```typescript
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WasmExample } from '@/types/wasm-examples';
import { ArrowRight, Zap } from 'lucide-react';
import * as Icons from 'lucide-react';

interface ExampleCardProps {
  example: WasmExample;
}

export const ExampleCard = ({ example }: ExampleCardProps) => {
  const navigate = useNavigate();

  // Dynamically get icon component
  const Icon = (Icons as any)[example.icon] || Icons.FileCode;

  const handleClick = () => {
    navigate(`/wasm-examples/${example.id}`);
  };

  const getDifficultyColor = (difficulty: string) => {
    const colors = {
      beginner: 'bg-green-500/10 text-green-500 border-green-500/20',
      intermediate: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      advanced: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      expert: 'bg-red-500/10 text-red-500 border-red-500/20',
    };
    return colors[difficulty as keyof typeof colors] || '';
  };

  return (
    <Card
      className="group cursor-pointer hover:border-cyan/50 transition-all hover:shadow-lg hover:shadow-cyan/10 hover:-translate-y-1"
      onClick={handleClick}
    >
      <CardHeader>
        <div className="flex justify-between items-start mb-3">
          <div className="p-2 bg-cyan/10 rounded-lg">
            <Icon className="h-6 w-6 text-cyan" />
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="capitalize">
              {example.category}
            </Badge>
          </div>
        </div>

        <CardTitle className="text-cyan group-hover:text-cyan/80 transition-colors">
          {example.title}
        </CardTitle>
        <CardDescription>{example.subtitle}</CardDescription>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {example.description}
        </p>

        {/* Features */}
        <div className="flex flex-wrap gap-2 mb-4">
          {example.features.slice(0, 2).map((feature, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {feature}
            </Badge>
          ))}
          {example.features.length > 2 && (
            <Badge variant="secondary" className="text-xs">
              +{example.features.length - 2} more
            </Badge>
          )}
        </div>

        {/* Difficulty Badge */}
        <Badge className={getDifficultyColor(example.difficulty)}>
          {example.difficulty}
        </Badge>
      </CardContent>

      <CardFooter>
        <Button
          variant="ghost"
          className="w-full group-hover:bg-cyan/10 group-hover:text-cyan"
        >
          Explore Example
          <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
        </Button>
      </CardFooter>
    </Card>
  );
};
```

---

## Example Detail Components

### ExampleHeader.tsx

```typescript
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WasmExample } from '@/types/wasm-examples';
import { Github, ExternalLink, Star } from 'lucide-react';
import * as Icons from 'lucide-react';

interface ExampleHeaderProps {
  example: WasmExample;
}

export const ExampleHeader = ({ example }: ExampleHeaderProps) => {
  const Icon = (Icons as any)[example.icon] || Icons.FileCode;

  return (
    <div className="border-b border-line pb-6">
      <div className="flex items-start justify-between">
        <div className="flex gap-4">
          <div className="p-3 bg-cyan/10 rounded-lg">
            <Icon className="h-8 w-8 text-cyan" />
          </div>

          <div>
            <div className="flex gap-2 mb-2">
              <Badge variant="outline" className="capitalize">
                {example.category}
              </Badge>
              <Badge variant="secondary">{example.difficulty}</Badge>
              <Badge variant="outline">{example.learningType}</Badge>
            </div>

            <h1 className="text-3xl font-bold mb-2">{example.title}</h1>
            <p className="text-lg text-muted-foreground mb-4">
              {example.subtitle}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {example.sourceUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={example.sourceUrl} target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4 mr-2" />
                Source
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={example.htmlPath} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Standalone
            </a>
          </Button>
        </div>
      </div>

      <p className="text-foreground mt-4">{example.description}</p>
    </div>
  );
};
```

### ExampleIframe.tsx

```typescript
import { useState, useEffect } from 'react';
import { WasmExample } from '@/types/wasm-examples';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ExampleIframeProps {
  example: WasmExample;
}

export const ExampleIframe = ({ example }: ExampleIframeProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
  }, [example.id]);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel rounded-lg">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-cyan mx-auto mb-2" />
            <p className="text-muted-foreground">Loading example...</p>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load example. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      )}

      <iframe
        src={example.htmlPath}
        className="w-full h-[600px] md:h-[700px] lg:h-[800px] rounded-lg border border-line"
        sandbox="allow-scripts allow-same-origin allow-forms"
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
};
```

---

## Documentation Components

### LearningGuide.tsx

```typescript
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WasmExample } from '@/types/wasm-examples';
import { BookOpen, Lightbulb, Code, Zap } from 'lucide-react';

interface LearningGuideProps {
  example: WasmExample;
}

export const LearningGuide = ({ example }: LearningGuideProps) => {
  return (
    <div className="space-y-6">
      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-cyan" />
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-foreground leading-relaxed">
            {example.description}
          </p>
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan" />
            Key Features
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {example.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-cyan mt-1">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Use Cases */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-cyan" />
            Use Cases
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {example.useCases.map((useCase, i) => (
              <div key={i} className="flex items-center gap-2 p-3 bg-panel-strong rounded-lg">
                <Badge variant="outline" className="shrink-0">
                  {i + 1}
                </Badge>
                <span className="text-sm">{useCase}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Algorithms */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5 text-cyan" />
            Algorithms Used
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {example.algorithms.map((algorithm, i) => (
              <Badge key={i} variant="secondary">
                {algorithm}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
```

---

**Component Count**: 15+ custom components specified

**Total Lines**: ~1500+ lines of component code

**Next**: See `04-WASM-INTEGRATION.md` for WASM integration details
