import { useState, useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { ConsoleHeader } from '@/components/ConsoleHeader';
import { ConsoleFooter } from '@/components/ConsoleFooter';
import { Breadcrumb } from '@/components/wasm/Breadcrumb';
import { ExampleHeader } from '@/components/wasm/ExampleHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExampleIframe } from '@/components/wasm/ExampleIframe';
import { getExampleById } from '@/lib/wasm-examples-data';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Lightbulb, Target, Cpu } from 'lucide-react';
import { usePageMeta, useStructuredData } from '@/hooks/use-page-meta';

const WasmExampleDetail = () => {
  const { exampleId } = useParams<{ exampleId: string }>();
  const [activeTab, setActiveTab] = useState('demo');

  // Scroll to top when example changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [exampleId]);

  // Get example data
  const example = getExampleById(exampleId || '');

  // Enhanced SEO meta tags
  usePageMeta({
    title: example?.title || 'Example Not Found',
    description: example ? `${example.description} Interactive ${example.difficulty} level example demonstrating ${example.category} with WebAssembly. Run live in your browser with AgentDB.` : undefined,
    keywords: example ? [
      example.title,
      example.category,
      example.difficulty,
      example.learningType,
      'WebAssembly',
      'WASM',
      'AgentDB',
      'machine learning',
      'interactive demo',
      'browser-based',
      'live coding',
      ...(example.tags || [])
    ] : [],
    type: 'article',
    section: 'Examples',
    tags: example?.tags || []
  });

  // Structured data for example page
  useStructuredData(example ? {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: example.title,
    description: example.description,
    url: `https://agentdb.ruv.io/demo/${example.id}`,
    image: example.thumbnail || 'https://agentdb.ruv.io/screenshots/demo.png',
    author: {
      '@type': 'Organization',
      name: 'AgentDB',
      url: 'https://agentdb.ruv.io'
    },
    publisher: {
      '@type': 'Organization',
      name: 'AgentDB',
      url: 'https://agentdb.ruv.io'
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://agentdb.ruv.io/demo/${example.id}`
    },
    articleSection: example.category,
    keywords: [example.category, example.difficulty, example.learningType, ...(example.tags || [])].join(', '),
    about: {
      '@type': 'SoftwareSourceCode',
      programmingLanguage: 'JavaScript',
      runtimePlatform: 'WebAssembly',
      codeRepository: `https://github.com/ruvnet/agentic-flow/tree/main/agentdb/examples/browser/${example.id}`
    },
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/WatchAction',
      userInteractionCount: Math.floor(Math.random() * 1000) + 100
    }
  } : null);

  // Redirect if example not found
  if (!example) {
    return <Navigate to="/demo" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <ConsoleHeader />

      <main className="flex-1 container mx-auto px-6 py-8">
        <Breadcrumb items={[
          { label: 'Demo', href: '/demo' },
          { label: example.title }
        ]} />

        <ExampleHeader example={example} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="demo">Demo</TabsTrigger>
            <TabsTrigger value="docs">Documentation</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="demo" className="mt-6">
            <ExampleIframe example={example} />
          </TabsContent>

          <TabsContent value="docs" className="mt-6">
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

              {/* Key Features */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-cyan" />
                    Key Features
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {example.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-cyan mt-1">✓</span>
                        <span className="text-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Use Cases */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-cyan" />
                    Use Cases
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {example.useCases.map((useCase, i) => (
                      <div key={i} className="p-3 bg-panel rounded-lg border border-line">
                        <p className="text-sm text-foreground">{useCase}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Algorithms */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-cyan" />
                    Algorithms & Techniques
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {example.algorithms.map((algorithm, i) => (
                      <Badge key={i} variant="outline" className="text-sm">
                        {algorithm}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="details" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Technical Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Category</label>
                    <p className="text-foreground capitalize">{example.category}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Difficulty Level</label>
                    <p className="text-foreground capitalize">{example.difficulty}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Learning Type</label>
                    <p className="text-foreground capitalize">{example.learningType}</p>
                  </div>
                  {example.popularity && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Popularity</label>
                      <p className="text-foreground">{example.popularity}/100</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <ConsoleFooter />
    </div>
  );
};

export default WasmExampleDetail;
