import { useEffect } from 'react';

export interface PageMetaOptions {
  title: string;
  description?: string;
  keywords?: string[];
  image?: string;
  type?: 'website' | 'article' | 'product';
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  section?: string;
  tags?: string[];
}

/**
 * Enhanced hook to update page meta tags for comprehensive SEO
 * Includes support for Open Graph, Twitter Cards, and structured data
 *
 * @param options - Page meta configuration
 */
export function usePageMeta(
  titleOrOptions: string | PageMetaOptions,
  description?: string
) {
  useEffect(() => {
    // Handle both old and new API
    const options: PageMetaOptions = typeof titleOrOptions === 'string'
      ? { title: titleOrOptions, description }
      : titleOrOptions;

    const {
      title,
      description: desc,
      keywords = [],
      image = 'https://agentdb.ruv.io/og-image.png',
      type = 'website',
      publishedTime,
      modifiedTime,
      author = 'AgentDB',
      section,
      tags = []
    } = options;

    const fullTitle = title ? `${title} | AgentDB` : 'AgentDB - Ultra-Fast Vector Database for AI Agents';
    const siteUrl = 'https://agentdb.ruv.io';
    const currentUrl = `${siteUrl}${window.location.pathname}`;

    // Update page title
    document.title = fullTitle;

    // Helper function to set or create meta tag
    const setMetaTag = (selector: string, attribute: string, name: string, content: string) => {
      let tag = document.querySelector(selector);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attribute, name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    // Basic meta tags
    if (desc) {
      setMetaTag('meta[name="description"]', 'name', 'description', desc);
    }

    if (keywords.length > 0) {
      setMetaTag('meta[name="keywords"]', 'name', 'keywords', keywords.join(', '));
    }

    setMetaTag('meta[name="author"]', 'name', 'author', author);
    setMetaTag('meta[name="robots"]', 'name', 'robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');

    // Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', currentUrl);

    // Open Graph tags
    setMetaTag('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMetaTag('meta[property="og:site_name"]', 'property', 'og:site_name', 'AgentDB');
    setMetaTag('meta[property="og:type"]', 'property', 'og:type', type);
    setMetaTag('meta[property="og:url"]', 'property', 'og:url', currentUrl);
    setMetaTag('meta[property="og:image"]', 'property', 'og:image', image);
    setMetaTag('meta[property="og:image:width"]', 'property', 'og:image:width', '1200');
    setMetaTag('meta[property="og:image:height"]', 'property', 'og:image:height', '630');
    setMetaTag('meta[property="og:locale"]', 'property', 'og:locale', 'en_US');

    if (desc) {
      setMetaTag('meta[property="og:description"]', 'property', 'og:description', desc);
    }

    if (publishedTime) {
      setMetaTag('meta[property="article:published_time"]', 'property', 'article:published_time', publishedTime);
    }

    if (modifiedTime) {
      setMetaTag('meta[property="article:modified_time"]', 'property', 'article:modified_time', modifiedTime);
    }

    if (section) {
      setMetaTag('meta[property="article:section"]', 'property', 'article:section', section);
    }

    if (tags.length > 0) {
      // Remove existing article:tag meta tags
      document.querySelectorAll('meta[property="article:tag"]').forEach(tag => tag.remove());
      // Add new tags
      tags.forEach(tag => {
        const meta = document.createElement('meta');
        meta.setAttribute('property', 'article:tag');
        meta.setAttribute('content', tag);
        document.head.appendChild(meta);
      });
    }

    // Twitter Card tags
    setMetaTag('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    setMetaTag('meta[name="twitter:site"]', 'name', 'twitter:site', '@ruv');
    setMetaTag('meta[name="twitter:creator"]', 'name', 'twitter:creator', '@ruv');
    setMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMetaTag('meta[name="twitter:image"]', 'name', 'twitter:image', image);

    if (desc) {
      setMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', desc);
    }

    // Viewport and mobile optimization
    setMetaTag('meta[name="viewport"]', 'name', 'viewport', 'width=device-width, initial-scale=1.0, maximum-scale=5.0');
    setMetaTag('meta[name="theme-color"]', 'name', 'theme-color', '#00d4ff');
    setMetaTag('meta[name="apple-mobile-web-app-capable"]', 'name', 'apple-mobile-web-app-capable', 'yes');
    setMetaTag('meta[name="apple-mobile-web-app-status-bar-style"]', 'name', 'apple-mobile-web-app-status-bar-style', 'black-translucent');
  }, [titleOrOptions, description]);
}

/**
 * Hook to add structured data (JSON-LD) for enhanced SEO
 *
 * @param structuredData - JSON-LD structured data object
 */
export function useStructuredData(structuredData: any) {
  useEffect(() => {
    // Remove existing structured data
    const existing = document.querySelector('script[type="application/ld+json"]');
    if (existing) {
      existing.remove();
    }

    // Add new structured data
    if (structuredData) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.text = JSON.stringify(structuredData);
      document.head.appendChild(script);
    }

    return () => {
      const script = document.querySelector('script[type="application/ld+json"]');
      if (script) {
        script.remove();
      }
    };
  }, [structuredData]);
}
