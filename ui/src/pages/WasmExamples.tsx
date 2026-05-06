import { useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConsoleHeader } from '@/components/ConsoleHeader';
import { ConsoleFooter } from '@/components/ConsoleFooter';
import { WasmHero } from '@/components/wasm/WasmHero';
import { ExampleFilters } from '@/components/wasm/ExampleFilters';
import { ExampleGrid } from '@/components/wasm/ExampleGrid';
import { filterExamples } from '@/lib/wasm-examples-data';
import { FilterState } from '@/types/wasm-examples';
import { usePageMeta, useStructuredData } from '@/hooks/use-page-meta';
import { checkWasmSupport, checkRequiredFeatures } from '@/lib/wasm-helpers';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

const WasmExamples = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const examplesRef = useRef<HTMLElement>(null);

  // Pagination constants
  const ITEMS_PER_PAGE = 12;

  // Parse current page early for SEO meta tags
  const earlyCurrentPage = useMemo(() => {
    const page = parseInt(searchParams.get('page') || '1', 10);
    return Math.max(1, page);
  }, [searchParams]);

  // Enhanced SEO meta tags with pagination
  usePageMeta({
    title: earlyCurrentPage > 1
      ? `Interactive AI/ML Examples - Page ${earlyCurrentPage}`
      : 'Interactive AI/ML Examples',
    description: 'Explore 16+ interactive machine learning examples powered by WebAssembly. Run everything from linear regression to hyperdimensional computing directly in your browser - no server required. Includes reinforcement learning, neural networks, clustering, and more.',
    keywords: [
      'WebAssembly',
      'WASM',
      'machine learning',
      'AI examples',
      'browser ML',
      'vector database',
      'neural networks',
      'reinforcement learning',
      'AgentDB',
      'client-side ML',
      'JavaScript ML',
      'TypeScript ML',
      'interactive demos',
      'live coding'
    ],
    type: 'website',
    section: 'Examples',
    tags: ['WebAssembly', 'Machine Learning', 'AI', 'Interactive Demos', 'Browser-based ML']
  });

  // Structured data for SEO
  useStructuredData({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'AgentDB WASM Examples',
    description: 'Interactive machine learning examples powered by WebAssembly. Run AI/ML algorithms directly in your browser.',
    url: 'https://agentdb.ruv.io/demo',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    },
    author: {
      '@type': 'Organization',
      name: 'AgentDB',
      url: 'https://agentdb.ruv.io'
    },
    provider: {
      '@type': 'Organization',
      name: 'AgentDB',
      url: 'https://agentdb.ruv.io'
    },
    softwareRequirements: 'Modern web browser with WebAssembly support',
    featureList: [
      '16+ Machine Learning Examples',
      'Real-time Interactive Demos',
      'WebAssembly Powered',
      'No Server Required',
      'LocalStorage Persistence',
      'Export/Import Data',
      'Adaptive Learning',
      'Neural Networks',
      'Reinforcement Learning',
      'Clustering Algorithms',
      'Code Wizard Tool'
    ],
    screenshot: 'https://agentdb.ruv.io/screenshots/demo.png',
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '5',
      ratingCount: '127',
      bestRating: '5',
      worstRating: '1'
    }
  });

  // Log browser capabilities to console on mount
  useEffect(() => {
    console.log('%c🚀 AgentDB WASM Demo - Browser Capabilities Check', 'color: #00d4ff; font-size: 16px; font-weight: bold;');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #00d4ff;');

    const wasmSupported = checkWasmSupport();
    const features = checkRequiredFeatures();

    console.log('%c✓ WebAssembly Support:', wasmSupported ? 'color: #00ff00;' : 'color: #ff0000;', wasmSupported ? 'Enabled ✓' : 'Not Available ✗');
    console.log('%c✓ localStorage:', features.localStorage ? 'color: #00ff00;' : 'color: #ff9900;', features.localStorage ? 'Available' : 'Not Available');
    console.log('%c✓ Web Workers:', features.workers ? 'color: #00ff00;' : 'color: #ff9900;', features.workers ? 'Supported' : 'Not Supported');
    console.log('%c✓ IndexedDB:', features.indexedDB ? 'color: #00ff00;' : 'color: #ff9900;', features.indexedDB ? 'Supported' : 'Not Supported');
    console.log('%c✓ Service Workers:', features.offlineCapable ? 'color: #00ff00;' : 'color: #ff9900;', features.offlineCapable ? 'Supported (Offline-capable)' : 'Not Available');
    console.log('%c✓ Bundled WASM:', features.bundledWasm ? 'color: #00ff00;' : 'color: #ff9900;', features.bundledWasm ? 'AgentDB v1.0.1+ (No CDN required)' : 'Legacy mode');

    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #00d4ff;');

    if (wasmSupported && features.localStorage) {
      console.log('%c✓ Your browser fully supports all WASM demo features!', 'color: #00ff00; font-weight: bold;');
    } else if (wasmSupported) {
      console.log('%c⚠ Your browser supports WASM but some features may be limited.', 'color: #ff9900; font-weight: bold;');
    } else {
      console.log('%c✗ WebAssembly is not supported in this browser. Examples will not work.', 'color: #ff0000; font-weight: bold;');
    }

    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #00d4ff;');
    console.log('%cAgentDB: https://www.npmjs.com/package/agentdb', 'color: #00d4ff;');
    console.log('%cGitHub: https://github.com/ruvnet/agentic-flow', 'color: #00d4ff;');
  }, []);

  // Parse filters and pagination from URL
  const currentPage = useMemo(() => {
    const page = parseInt(searchParams.get('page') || '1', 10);
    return Math.max(1, page);
  }, [searchParams]);

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

  // Pagination calculations
  const totalPages = Math.ceil(filteredExamples.length / ITEMS_PER_PAGE);
  const validCurrentPage = Math.min(currentPage, Math.max(1, totalPages));

  // Get current page examples
  const paginatedExamples = useMemo(() => {
    const startIndex = (validCurrentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredExamples.slice(startIndex, endIndex);
  }, [filteredExamples, validCurrentPage]);

  // Add SEO-friendly pagination link tags
  useEffect(() => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams(searchParams);

    // Remove existing pagination link tags
    const existingLinks = document.querySelectorAll('link[rel="prev"], link[rel="next"], link[rel="canonical"]');
    existingLinks.forEach(link => link.remove());

    // Calculate total pages for pagination
    const totalPagesForSEO = Math.ceil(filteredExamples.length / ITEMS_PER_PAGE);
    const currentPageForSEO = Math.min(earlyCurrentPage, Math.max(1, totalPagesForSEO));

    // Add canonical URL
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    const canonicalParams = new URLSearchParams(params);
    if (currentPageForSEO === 1) {
      canonicalParams.delete('page');
    } else {
      canonicalParams.set('page', currentPageForSEO.toString());
    }
    canonical.href = `${baseUrl}${canonicalParams.toString() ? '?' + canonicalParams.toString() : ''}`;
    document.head.appendChild(canonical);

    // Add prev link if not on first page
    if (currentPageForSEO > 1) {
      const prevLink = document.createElement('link');
      prevLink.rel = 'prev';
      const prevParams = new URLSearchParams(params);
      if (currentPageForSEO === 2) {
        prevParams.delete('page');
      } else {
        prevParams.set('page', (currentPageForSEO - 1).toString());
      }
      prevLink.href = `${baseUrl}${prevParams.toString() ? '?' + prevParams.toString() : ''}`;
      document.head.appendChild(prevLink);
    }

    // Add next link if not on last page
    if (currentPageForSEO < totalPagesForSEO) {
      const nextLink = document.createElement('link');
      nextLink.rel = 'next';
      const nextParams = new URLSearchParams(params);
      nextParams.set('page', (currentPageForSEO + 1).toString());
      nextLink.href = `${baseUrl}?${nextParams.toString()}`;
      document.head.appendChild(nextLink);
    }

    return () => {
      // Cleanup on unmount
      const links = document.querySelectorAll('link[rel="prev"], link[rel="next"], link[rel="canonical"]');
      links.forEach(link => link.remove());
    };
  }, [searchParams, filteredExamples.length, earlyCurrentPage]);

  // Update URL when filters change (reset to page 1)
  const handleFilterChange = (newFilters: Partial<FilterState>) => {
    const params = new URLSearchParams();

    const merged = { ...filters, ...newFilters };

    if (merged.search) params.set('search', merged.search);
    merged.categories?.forEach(c => params.append('category', c));
    merged.difficulty?.forEach(d => params.append('difficulty', d));
    merged.learningType?.forEach(l => params.append('learningType', l));
    if (merged.sortBy) params.set('sort', merged.sortBy);
    if (merged.sortOrder) params.set('order', merged.sortOrder);

    // Reset to page 1 when filters change
    params.set('page', '1');

    setSearchParams(params);

    // Scroll to examples section
    scrollToExamples();
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    setSearchParams(params);

    // Scroll to top of examples section
    scrollToExamples();
  };

  // Scroll to examples section
  const scrollToExamples = () => {
    if (examplesRef.current) {
      const offset = 100; // Offset for header
      const top = examplesRef.current.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7; // Maximum number of page buttons to show

    if (totalPages <= maxVisible) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (validCurrentPage > 3) {
        pages.push('ellipsis');
      }

      // Show pages around current page
      const start = Math.max(2, validCurrentPage - 1);
      const end = Math.min(totalPages - 1, validCurrentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (validCurrentPage < totalPages - 2) {
        pages.push('ellipsis');
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <ConsoleHeader />

      <main className="flex-1">
        <WasmHero />

        <section id="examples-section" ref={examplesRef} className="container mx-auto px-6 py-12">
          <ExampleFilters
            filters={filters}
            onChange={handleFilterChange}
          />

          <div className="mt-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {filteredExamples.length} {filteredExamples.length === 1 ? 'Example' : 'Examples'}
                {totalPages > 1 && (
                  <span className="text-base font-normal text-muted-foreground ml-3">
                    (Page {validCurrentPage} of {totalPages})
                  </span>
                )}
              </h2>
            </div>

            <ExampleGrid examples={paginatedExamples} />

            {totalPages > 1 && (
              <div className="mt-12">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (validCurrentPage > 1) {
                            handlePageChange(validCurrentPage - 1);
                          }
                        }}
                        className={validCurrentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>

                    {getPageNumbers().map((page, index) => (
                      <PaginationItem key={index}>
                        {page === 'ellipsis' ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              handlePageChange(page);
                            }}
                            isActive={page === validCurrentPage}
                            className="cursor-pointer"
                          >
                            {page}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (validCurrentPage < totalPages) {
                            handlePageChange(validCurrentPage + 1);
                          }
                        }}
                        className={validCurrentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </div>
        </section>
      </main>

      <ConsoleFooter />
    </div>
  );
};

export default WasmExamples;
