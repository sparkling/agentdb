# Testing Strategy - WASM Examples Browser

## Testing Overview

This document outlines the comprehensive testing strategy for the WASM Examples Browser, covering unit tests, integration tests, E2E tests, performance tests, and accessibility tests.

---

## Testing Pyramid

```
       /\
      /  \    E2E Tests (10%)
     /    \   - Critical user flows
    /      \  - Cross-browser testing
   /--------\
  /          \ Integration Tests (30%)
 /            \ - Component integration
/              \ - Routing tests
/--------------\ - API integration
/                \ Unit Tests (60%)
/                  \ - Component logic
/--------------------\ - Utility functions
                       - Type safety
```

---

## 1. Unit Testing

### Testing Framework
- **Vitest** - Fast, modern test runner
- **React Testing Library** - Component testing
- **Jest DOM** - DOM assertions

### Setup

```bash
# Install dependencies
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

**Configuration** (`vite.config.ts`):

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'src/test/',
      ],
    },
  },
});
```

**Test Setup** (`src/test/setup.ts`):

```typescript
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

---

### Component Tests

#### ExampleCard.test.tsx

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ExampleCard } from '../ExampleCard';
import { WASM_EXAMPLES } from '@/lib/wasm-examples-data';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ExampleCard', () => {
  const example = WASM_EXAMPLES[0];

  it('renders example title and subtitle', () => {
    render(
      <BrowserRouter>
        <ExampleCard example={example} />
      </BrowserRouter>
    );

    expect(screen.getByText(example.title)).toBeInTheDocument();
    expect(screen.getByText(example.subtitle)).toBeInTheDocument();
  });

  it('displays category badge', () => {
    render(
      <BrowserRouter>
        <ExampleCard example={example} />
      </BrowserRouter>
    );

    expect(screen.getByText(example.category)).toBeInTheDocument();
  });

  it('displays difficulty badge', () => {
    render(
      <BrowserRouter>
        <ExampleCard example={example} />
      </BrowserRouter>
    );

    expect(screen.getByText(example.difficulty)).toBeInTheDocument();
  });

  it('shows first 2 features with overflow indicator', () => {
    render(
      <BrowserRouter>
        <ExampleCard example={example} />
      </BrowserRouter>
    );

    const featureBadges = screen.getAllByText(/.*/, { selector: '.text-xs' });
    expect(featureBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('navigates to detail page on click', () => {
    render(
      <BrowserRouter>
        <ExampleCard example={example} />
      </BrowserRouter>
    );

    const card = screen.getByRole('button', { name: /explore example/i }).closest('div[role="button"]');
    fireEvent.click(card!);

    expect(mockNavigate).toHaveBeenCalledWith(`/wasm-examples/${example.id}`);
  });

  it('applies hover styles', () => {
    const { container } = render(
      <BrowserRouter>
        <ExampleCard example={example} />
      </BrowserRouter>
    );

    const card = container.querySelector('.group');
    expect(card).toHaveClass('hover:border-cyan/50');
    expect(card).toHaveClass('hover:-translate-y-1');
  });
});
```

---

#### ExampleGrid.test.tsx

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ExampleGrid } from '../ExampleGrid';
import { WASM_EXAMPLES } from '@/lib/wasm-examples-data';

describe('ExampleGrid', () => {
  it('renders all examples', () => {
    render(
      <BrowserRouter>
        <ExampleGrid examples={WASM_EXAMPLES} />
      </BrowserRouter>
    );

    WASM_EXAMPLES.forEach((example) => {
      expect(screen.getByText(example.title)).toBeInTheDocument();
    });
  });

  it('shows loading skeletons when loading', () => {
    const { container } = render(
      <BrowserRouter>
        <ExampleGrid examples={[]} loading={true} />
      </BrowserRouter>
    );

    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no examples', () => {
    render(
      <BrowserRouter>
        <ExampleGrid examples={[]} />
      </BrowserRouter>
    );

    expect(screen.getByText(/no examples found/i)).toBeInTheDocument();
  });

  it('has responsive grid layout', () => {
    const { container } = render(
      <BrowserRouter>
        <ExampleGrid examples={WASM_EXAMPLES} />
      </BrowserRouter>
    );

    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).toHaveClass('md:grid-cols-2');
    expect(grid).toHaveClass('lg:grid-cols-3');
  });
});
```

---

#### ExampleFilters.test.tsx

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExampleFilters } from '../ExampleFilters';

describe('ExampleFilters', () => {
  const mockOnChange = vi.fn();

  const defaultFilters = {
    search: '',
    categories: [],
    difficulty: [],
    learningType: [],
    sortBy: 'popularity' as const,
    sortOrder: 'desc' as const,
  };

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders search input', () => {
    render(
      <ExampleFilters filters={defaultFilters} onChange={mockOnChange} />
    );

    expect(screen.getByPlaceholderText(/search examples/i)).toBeInTheDocument();
  });

  it('calls onChange when search text changes', async () => {
    const user = userEvent.setup();

    render(
      <ExampleFilters filters={defaultFilters} onChange={mockOnChange} />
    );

    const searchInput = screen.getByPlaceholderText(/search examples/i);
    await user.type(searchInput, 'rag');

    expect(mockOnChange).toHaveBeenCalledWith({ search: 'rag' });
  });

  it('shows advanced filters when clicked', async () => {
    const user = userEvent.setup();

    render(
      <ExampleFilters filters={defaultFilters} onChange={mockOnChange} />
    );

    const filtersButton = screen.getByRole('button', { name: /filters/i });
    await user.click(filtersButton);

    expect(screen.getByText(/category/i)).toBeInTheDocument();
    expect(screen.getByText(/difficulty/i)).toBeInTheDocument();
  });

  it('displays active filter count badge', () => {
    const filters = {
      ...defaultFilters,
      search: 'test',
      categories: ['standard' as const],
      difficulty: ['expert' as const],
    };

    render(
      <ExampleFilters filters={filters} onChange={mockOnChange} />
    );

    expect(screen.getByText('3')).toBeInTheDocument(); // 3 active filters
  });

  it('resets all filters when reset clicked', async () => {
    const user = userEvent.setup();

    const filters = {
      ...defaultFilters,
      search: 'test',
      categories: ['standard' as const],
    };

    render(
      <ExampleFilters filters={filters} onChange={mockOnChange} />
    );

    const resetButton = screen.getByRole('button', { name: /reset/i });
    await user.click(resetButton);

    expect(mockOnChange).toHaveBeenCalledWith({
      search: '',
      categories: [],
      difficulty: [],
      learningType: [],
      sortBy: 'popularity',
      sortOrder: 'desc',
    });
  });
});
```

---

### Utility Tests

#### wasm-helpers.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import {
  checkWasmSupport,
  checkRequiredFeatures,
  formatBytes,
  formatDuration,
} from '../wasm-helpers';

describe('wasm-helpers', () => {
  describe('checkWasmSupport', () => {
    it('returns boolean indicating WASM support', () => {
      const supported = checkWasmSupport();
      expect(typeof supported).toBe('boolean');
    });
  });

  describe('checkRequiredFeatures', () => {
    it('returns object with feature flags', () => {
      const features = checkRequiredFeatures();

      expect(features).toHaveProperty('wasm');
      expect(features).toHaveProperty('localStorage');
      expect(features).toHaveProperty('workers');
      expect(features).toHaveProperty('indexedDB');
    });
  });

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 Bytes');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });

  describe('formatDuration', () => {
    it('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
    });

    it('formats seconds', () => {
      expect(formatDuration(2500)).toBe('2.5s');
    });

    it('formats minutes', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });
  });
});
```

---

### Data Tests

#### wasm-examples-data.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import {
  WASM_EXAMPLES,
  getExampleById,
  getExamplesByCategory,
  getExamplesByDifficulty,
  filterExamples,
} from '../wasm-examples-data';

describe('wasm-examples-data', () => {
  it('has 10 examples', () => {
    expect(WASM_EXAMPLES).toHaveLength(10);
  });

  it('all examples have required fields', () => {
    WASM_EXAMPLES.forEach((example) => {
      expect(example).toHaveProperty('id');
      expect(example).toHaveProperty('title');
      expect(example).toHaveProperty('subtitle');
      expect(example).toHaveProperty('description');
      expect(example).toHaveProperty('category');
      expect(example).toHaveProperty('difficulty');
      expect(example).toHaveProperty('learningType');
      expect(example).toHaveProperty('htmlPath');
      expect(example).toHaveProperty('icon');
      expect(example).toHaveProperty('features');
      expect(example).toHaveProperty('useCases');
      expect(example).toHaveProperty('algorithms');
    });
  });

  describe('getExampleById', () => {
    it('returns example by ID', () => {
      const example = getExampleById('rag-self-learning');
      expect(example).toBeDefined();
      expect(example?.title).toBe('RAG Self-Learning');
    });

    it('returns undefined for invalid ID', () => {
      const example = getExampleById('invalid-id');
      expect(example).toBeUndefined();
    });
  });

  describe('getExamplesByCategory', () => {
    it('returns standard examples', () => {
      const examples = getExamplesByCategory('standard');
      expect(examples.length).toBeGreaterThan(0);
      examples.forEach((ex) => {
        expect(ex.category).toBe('standard');
      });
    });

    it('returns advanced examples', () => {
      const examples = getExamplesByCategory('advanced');
      expect(examples.length).toBeGreaterThan(0);
      examples.forEach((ex) => {
        expect(ex.category).toBe('advanced');
      });
    });
  });

  describe('filterExamples', () => {
    it('filters by search term', () => {
      const results = filterExamples({
        search: 'RAG',
        categories: [],
        difficulty: [],
        learningType: [],
        sortBy: 'alphabetical',
        sortOrder: 'asc',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('RAG');
    });

    it('filters by category', () => {
      const results = filterExamples({
        search: '',
        categories: ['standard'],
        difficulty: [],
        learningType: [],
        sortBy: 'alphabetical',
        sortOrder: 'asc',
      });

      results.forEach((ex) => {
        expect(ex.category).toBe('standard');
      });
    });

    it('filters by difficulty', () => {
      const results = filterExamples({
        search: '',
        categories: [],
        difficulty: ['expert'],
        learningType: [],
        sortBy: 'alphabetical',
        sortOrder: 'asc',
      });

      results.forEach((ex) => {
        expect(ex.difficulty).toBe('expert');
      });
    });

    it('sorts alphabetically', () => {
      const results = filterExamples({
        search: '',
        categories: [],
        difficulty: [],
        learningType: [],
        sortBy: 'alphabetical',
        sortOrder: 'asc',
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i].title.localeCompare(results[i - 1].title)).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
```

---

## 2. Integration Testing

### Routing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import WasmExamples from '../../pages/WasmExamples';
import WasmExampleDetail from '../../pages/WasmExampleDetail';
import NotFound from '../../pages/NotFound';

describe('Routing Integration', () => {
  it('renders gallery at /wasm-examples', async () => {
    render(
      <MemoryRouter initialEntries={['/wasm-examples']}>
        <Routes>
          <Route path="/wasm-examples" element={<WasmExamples />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/WASM Examples/i)).toBeInTheDocument();
    });
  });

  it('renders detail at /wasm-examples/:id', async () => {
    render(
      <MemoryRouter initialEntries={['/wasm-examples/rag-self-learning']}>
        <Routes>
          <Route path="/wasm-examples/:exampleId" element={<WasmExampleDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/RAG Self-Learning/i)).toBeInTheDocument();
    });
  });

  it('redirects invalid example to 404', async () => {
    render(
      <MemoryRouter initialEntries={['/wasm-examples/invalid-id']}>
        <Routes>
          <Route path="/wasm-examples/:exampleId" element={<WasmExampleDetail />} />
          <Route path="/404" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/404/i)).toBeInTheDocument();
    });
  });
});
```

---

## 3. E2E Testing (Playwright)

### Setup

```bash
npm install --save-dev @playwright/test
npx playwright install
```

**Configuration** (`playwright.config.ts`):

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

### E2E Test Cases

#### wasm-examples.spec.ts

```typescript
import { test, expect } from '@playwright/test';

test.describe('WASM Examples Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wasm-examples');
  });

  test('displays all 10 examples', async ({ page }) => {
    const cards = page.locator('.grid > div');
    await expect(cards).toHaveCount(10);
  });

  test('search filters examples', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('RAG');

    const cards = page.locator('.grid > div');
    await expect(cards).toHaveCount(1);
    await expect(page.getByText('RAG Self-Learning')).toBeVisible();
  });

  test('category filter works', async ({ page }) => {
    const filtersButton = page.getByRole('button', { name: /filters/i });
    await filtersButton.click();

    const categorySelect = page.locator('select').first();
    await categorySelect.selectOption('advanced');

    // Should show only advanced examples
    const cards = page.locator('.grid > div');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  test('navigates to example detail on click', async ({ page }) => {
    const firstCard = page.locator('.grid > div').first();
    await firstCard.click();

    await expect(page).toHaveURL(/\/wasm-examples\/.+/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('reset button clears filters', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('RAG');

    const resetButton = page.getByRole('button', { name: /reset/i });
    await resetButton.click();

    await expect(searchInput).toHaveValue('');
    const cards = page.locator('.grid > div');
    await expect(cards).toHaveCount(10);
  });
});

test.describe('Example Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wasm-examples/rag-self-learning');
  });

  test('displays example header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /RAG Self-Learning/i })).toBeVisible();
  });

  test('breadcrumb navigation works', async ({ page }) => {
    const breadcrumb = page.getByRole('navigation').first();
    await expect(breadcrumb).toBeVisible();

    const galleryLink = breadcrumb.getByText('WASM Examples');
    await galleryLink.click();

    await expect(page).toHaveURL('/wasm-examples');
  });

  test('tabs switch content', async ({ page }) => {
    // Demo tab (default)
    await expect(page.getByRole('tabpanel')).toContainText(/demo/i);

    // Code tab
    const codeTab = page.getByRole('tab', { name: /code/i });
    await codeTab.click();
    await expect(page.locator('pre code')).toBeVisible();

    // Docs tab
    const docsTab = page.getByRole('tab', { name: /documentation/i });
    await docsTab.click();
    await expect(page.getByText(/Overview/i)).toBeVisible();
  });

  test('iframe loads example', async ({ page }) => {
    const iframe = page.frameLocator('iframe').first();
    await expect(iframe.locator('body')).toBeVisible();
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile navigation works', async ({ page }) => {
    await page.goto('/wasm-examples');

    // Mobile menu should be visible
    const mobileMenu = page.getByRole('button', { name: /menu/i });
    await expect(mobileMenu).toBeVisible();
  });

  test('cards display in single column on mobile', async ({ page }) => {
    await page.goto('/wasm-examples');

    const grid = page.locator('.grid');
    const gridClasses = await grid.getAttribute('class');
    expect(gridClasses).toContain('grid-cols-1');
  });
});
```

Run E2E tests:
```bash
npx playwright test
npx playwright test --headed  # With browser UI
npx playwright show-report    # View report
```

---

## 4. Performance Testing

### Lighthouse CI

```bash
npm install --save-dev @lhci/cli
```

**Configuration** (`.lighthouserc.js`):

```javascript
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:8080/',
        'http://localhost:8080/wasm-examples',
        'http://localhost:8080/wasm-examples/rag-self-learning',
      ],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
```

Run Lighthouse:
```bash
npm run build
npm run preview &
lhci autorun
```

---

## 5. Accessibility Testing

### Axe Core

```bash
npm install --save-dev @axe-core/playwright
```

**Accessibility Test**:

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('gallery page has no violations', async ({ page }) => {
    await page.goto('/wasm-examples');

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('detail page has no violations', async ({ page }) => {
    await page.goto('/wasm-examples/rag-self-learning');

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
```

---

## Test Coverage Goals

### Coverage Targets

| Category | Target | Current |
|----------|--------|---------|
| Statements | 80% | TBD |
| Branches | 75% | TBD |
| Functions | 80% | TBD |
| Lines | 80% | TBD |

**Generate coverage report:**

```bash
npm run test -- --coverage
```

---

## CI/CD Integration

### GitHub Actions Workflow

`.github/workflows/test.yml`:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test -- --coverage

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload coverage
        uses: codecov/codecov-action@v3

      - name: Upload Playwright report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

---

## Testing Checklist

### Before Each Release

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All E2E tests passing (Chrome, Firefox, Safari)
- [ ] Mobile tests passing (iOS, Android)
- [ ] Performance tests passing (Lighthouse > 90)
- [ ] Accessibility tests passing (no violations)
- [ ] Coverage > 80%
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Build succeeds

---

**Next**: See `07-DEPLOYMENT-CHECKLIST.md` for deployment guidelines
