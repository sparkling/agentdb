/**
 * Unit Tests for SemanticRouter Service
 *
 * Tests semantic intent routing via @ruvector/router with a deterministic
 * keyword-matching fallback. The service is engine-agnostic: routing
 * decisions are asserted on observable behavior (keyword scores, route
 * selection) which holds whether the native engine or the JS fallback is
 * active. Engine-state methods (getEngineType / isAvailable) are asserted
 * against whatever initialize() actually resolves at runtime.
 *
 * Runtime note: @ruvector/router resolves to an object exposing
 * {DistanceMetric, VectorDb, SemanticRouter} but no addRoute/route/match
 * method, so addRoute()/route() always fall through to keyword matching
 * even when initialize() reports engineType='native'. These tests verify
 * that fallthrough behavior is correct and deterministic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticRouter, RouteResult } from '../../../src/services/SemanticRouter.js';

describe('SemanticRouter', () => {
  let router: SemanticRouter;

  beforeEach(async () => {
    router = new SemanticRouter();
    await router.initialize();
  });

  describe('initialize', () => {
    it('returns a boolean and is idempotent across instances', async () => {
      const r1 = new SemanticRouter();
      const result = await r1.initialize();
      expect(typeof result).toBe('boolean');

      // Calling again returns a boolean too (no throw, deterministic)
      const result2 = await r1.initialize();
      expect(typeof result2).toBe('boolean');
      expect(result2).toBe(result);
    });

    it('keeps engine type consistent with availability', async () => {
      const r = new SemanticRouter();
      const loaded = await r.initialize();
      // When initialize() reports success, engine is native; otherwise js.
      if (loaded) {
        expect(r.getEngineType()).toBe('native');
        expect(r.isAvailable()).toBe(true);
      } else {
        expect(r.getEngineType()).toBe('js');
        expect(r.isAvailable()).toBe(false);
      }
    });

    it('reports a valid engine type string', () => {
      expect(['native', 'js']).toContain(router.getEngineType());
    });
  });

  describe('addRoute / getRoutes', () => {
    it('registers a route and exposes it via getRoutes', async () => {
      await router.addRoute('search', 'Find information in memory', ['find', 'search', 'lookup']);
      expect(router.getRoutes()).toContain('search');
    });

    it('registers multiple distinct routes', async () => {
      await router.addRoute('search', 'Find information', ['find', 'search']);
      await router.addRoute('store', 'Save information', ['save', 'store']);
      await router.addRoute('delete', 'Remove information', ['delete', 'remove']);

      const routes = router.getRoutes();
      expect(routes).toEqual(expect.arrayContaining(['search', 'store', 'delete']));
      expect(routes).toHaveLength(3);
    });

    it('overwrites a route registered under the same name', async () => {
      await router.addRoute('store', 'Save info', ['save']);
      await router.addRoute('store', 'Persist info', ['persist', 'write']);

      // Still a single entry (Map keyed by name)
      expect(router.getRoutes().filter(r => r === 'store')).toHaveLength(1);

      // The keyword set was replaced: 'save' no longer routes here, 'persist' does
      const saveResult = await router.route('please save this');
      expect(saveResult.route).not.toBe('store'); // 'save' keyword was overwritten
      const persistResult = await router.route('persist this data');
      expect(persistResult.route).toBe('store');
    });

    it('accepts a route with no keywords (defaults to empty array)', async () => {
      await router.addRoute('empty', 'A route with no keywords');
      expect(router.getRoutes()).toContain('empty');
    });

    it('does not throw when the native engine path is exercised', async () => {
      // addRoute internally tries router.addRoute/add when available;
      // the resolved object lacks those methods, so it must not throw.
      await expect(
        router.addRoute('safe', 'Description for native attempt', ['x'])
      ).resolves.toBeUndefined();
    });
  });

  describe('route - keyword matching behavior', () => {
    beforeEach(async () => {
      await router.addRoute('search', 'Find information in memory', ['find', 'search', 'lookup']);
      await router.addRoute('store', 'Save information to memory', ['save', 'store', 'remember']);
      await router.addRoute('delete', 'Remove information', ['delete', 'remove', 'purge']);
    });

    it('routes a query to the best keyword match', async () => {
      const result = await router.route('find me the latest results');
      expect(result.route).toBe('search');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('routes a store-intent query to the store route', async () => {
      const result = await router.route('please remember this fact');
      expect(result.route).toBe('store');
    });

    it('routes a delete-intent query to the delete route', async () => {
      const result = await router.route('purge old entries now');
      expect(result.route).toBe('delete');
    });

    it('produces confidence as a fraction of matched keywords', async () => {
      // Query hits 2 of the 3 'search' keywords ('search', 'find'); none others.
      const result = await router.route('search and find things');
      expect(result.route).toBe('search');
      expect(result.confidence).toBeCloseTo(2 / 3, 5);
    });

    it('confidence is 1 when every keyword of a route matches', async () => {
      await router.addRoute('single', 'one keyword', ['unicorn']);
      const result = await router.route('a wild unicorn appeared');
      expect(result.route).toBe('single');
      expect(result.confidence).toBe(1);
    });

    it('is case-insensitive', async () => {
      const result = await router.route('SEARCH THE DATABASE');
      expect(result.route).toBe('search');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('returns the default route with zero confidence on no match', async () => {
      const result = await router.route('completely unrelated gibberish xyzzy');
      expect(result.route).toBe('default');
      expect(result.confidence).toBe(0);
    });

    it('returns default route with no registered routes', async () => {
      const empty = new SemanticRouter();
      await empty.initialize();
      const result = await empty.route('anything at all');
      expect(result.route).toBe('default');
      expect(result.confidence).toBe(0);
    });

    it('ignores routes that have no keywords during matching', async () => {
      const r = new SemanticRouter();
      await r.initialize();
      await r.addRoute('keywordless', 'no keywords here'); // empty keyword set
      const result = await r.route('no keywords here'); // even matching description
      expect(result.route).toBe('default');
      expect(result.confidence).toBe(0);
    });

    it('returns a well-formed RouteResult shape', async () => {
      const result: RouteResult = await router.route('find data');
      expect(result).toHaveProperty('route');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.route).toBe('string');
      expect(typeof result.confidence).toBe('number');
    });
  });

  describe('route - tie-breaking and ranking invariants', () => {
    it('picks the strictly-higher scoring route', async () => {
      await router.addRoute('broad', 'broad route', ['data', 'info', 'thing']); // 3 keywords
      await router.addRoute('narrow', 'narrow route', ['data']); // 1 keyword

      // Query contains only 'data': broad scores 1/3, narrow scores 1/1 -> narrow wins
      const result = await router.route('show me the data');
      expect(result.route).toBe('narrow');
      expect(result.confidence).toBe(1);
    });

    it('keeps the first-seen route on a score tie (does not overwrite on equality)', async () => {
      await router.addRoute('first', 'first', ['alpha']);
      await router.addRoute('second', 'second', ['alpha']);

      // Both score 1.0 for 'alpha'; selection uses strict > so 'first' is kept.
      const result = await router.route('alpha signal');
      expect(result.route).toBe('first');
      expect(result.confidence).toBe(1);
    });
  });

  describe('removeRoute', () => {
    beforeEach(async () => {
      await router.addRoute('search', 'Find', ['find']);
      await router.addRoute('store', 'Save', ['save']);
    });

    it('removes an existing route and returns true', () => {
      expect(router.removeRoute('search')).toBe(true);
      expect(router.getRoutes()).not.toContain('search');
      expect(router.getRoutes()).toContain('store');
    });

    it('returns false when removing a non-existent route', () => {
      expect(router.removeRoute('nonexistent')).toBe(false);
    });

    it('a removed route no longer participates in routing', async () => {
      router.removeRoute('search');
      const result = await router.route('find me things');
      expect(result.route).not.toBe('search');
    });
  });

  describe('edge cases', () => {
    it('handles an empty query string', async () => {
      await router.addRoute('search', 'Find', ['find']);
      const result = await router.route('');
      expect(result.route).toBe('default');
      expect(result.confidence).toBe(0);
    });

    it('handles Unicode in queries and keywords', async () => {
      await router.addRoute('emoji', 'emoji route', ['🚀', 'rocket']);
      const result = await router.route('launch the 🚀 now');
      expect(result.route).toBe('emoji');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('matches keywords that appear as substrings (documents includes() semantics)', async () => {
      await router.addRoute('cat', 'cat route', ['cat']);
      // 'cat' is a substring of 'category' -> match per String.includes semantics
      const result = await router.route('what category is this');
      expect(result.route).toBe('cat');
      expect(result.confidence).toBe(1);
    });

    it('keeps getRoutes order-stable as insertion order', async () => {
      const r = new SemanticRouter();
      await r.initialize();
      await r.addRoute('a', 'a', ['a']);
      await r.addRoute('b', 'b', ['b']);
      await r.addRoute('c', 'c', ['c']);
      expect(r.getRoutes()).toEqual(['a', 'b', 'c']);
    });
  });
});
