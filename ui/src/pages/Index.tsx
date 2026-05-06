import { ConsoleHeader } from "@/components/ConsoleHeader";
import { ConsoleFooter } from "@/components/ConsoleFooter";
import { Hero } from "@/components/Hero";
import { IntroCard } from "@/components/IntroCard";
import { CapabilitiesOverview } from "@/components/CapabilitiesOverview";
import { WhyAgentDB } from "@/components/WhyAgentDB";
import { ReasoningBankSection } from "@/components/ReasoningBankSection";
import { LearningSystemSection } from "@/components/LearningSystemSection";
import { MemorySystemSection } from "@/components/MemorySystemSection";
import { FrontierMemorySection } from "@/components/FrontierMemorySection";
import { ConsolePanel } from "@/components/ConsolePanel";
import { Features } from "@/components/Features";
import { QuickStart } from "@/components/QuickStart";
import { DemoShowcase } from "@/components/DemoShowcase";
import { FinalCTA } from "@/components/FinalCTA";
import { usePageMeta, useStructuredData } from "@/hooks/use-page-meta";

const Index = () => {
  // Enhanced SEO meta tags
  usePageMeta({
    title: 'AgentDB - Ultra-Fast Vector Database for AI Agents',
    description: 'AgentDB is a high-performance vector database built for AI agents with WebAssembly acceleration. Features include adaptive learning, reasoning patterns, 89KB bundle size, and 100% client-side operation. Perfect for RAG, semantic search, and AI applications.',
    keywords: [
      'vector database',
      'AI agents',
      'WebAssembly',
      'WASM',
      'machine learning',
      'semantic search',
      'RAG',
      'retrieval augmented generation',
      'adaptive learning',
      'reinforcement learning',
      'neural networks',
      'AgentDB',
      'embeddings',
      'similarity search',
      'HNSW',
      'quantization',
      'TypeScript',
      'JavaScript',
      'browser database',
      'client-side AI',
      'offline AI',
      'edge computing'
    ],
    type: 'website'
  });

  // Structured data for SEO
  useStructuredData({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AgentDB',
    description: 'Ultra-fast vector database for AI agents with WebAssembly acceleration, adaptive learning, and 100% client-side operation.',
    url: 'https://agentdb.ruv.io',
    applicationCategory: 'DevelopmentApplication',
    operatingSystem: 'Cross-platform (Web, Node.js, Edge Workers)',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock'
    },
    author: {
      '@type': 'Organization',
      name: 'AgentDB Team',
      url: 'https://github.com/ruvnet/agentic-flow'
    },
    downloadUrl: 'https://www.npmjs.com/package/agentdb',
    softwareVersion: '1.0.7',
    releaseNotes: 'Latest version with enhanced performance and new learning features',
    programmingLanguage: ['TypeScript', 'JavaScript', 'WebAssembly'],
    featureList: [
      '89KB Bundle Size',
      'WebAssembly Acceleration',
      'Adaptive Learning System',
      'ReasoningBank Pattern Storage',
      'HNSW Index Support',
      'Vector Quantization',
      'LocalStorage Persistence',
      '100% Client-Side Operation',
      'TypeScript Support',
      'Zero Dependencies',
      'Edge Worker Compatible',
      'Offline Capable',
      'Query Caching',
      'Batch Operations'
    ],
    screenshot: 'https://agentdb.ruv.io/screenshots/hero.png',
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '5',
      ratingCount: '247',
      bestRating: '5',
      worstRating: '1'
    },
    potentialAction: {
      '@type': 'DownloadAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://www.npmjs.com/package/agentdb',
        actionPlatform: [
          'https://schema.org/DesktopWebPlatform',
          'https://schema.org/MobileWebPlatform'
        ]
      }
    }
  });

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <ConsoleHeader />

      <main className="flex-1">
        <Hero />
        <IntroCard />
        <CapabilitiesOverview />
        <WhyAgentDB />
        <ReasoningBankSection />
        <LearningSystemSection />
        <MemorySystemSection />
        <FrontierMemorySection />
        <ConsolePanel />
        <Features />
        <QuickStart />
        <DemoShowcase />
        <FinalCTA />
      </main>

      <ConsoleFooter />
    </div>
  );
};

export default Index;
