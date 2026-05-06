# Deployment Checklist - WASM Examples Browser

## Pre-Deployment Checklist

### Code Quality

- [ ] All TypeScript errors resolved
- [ ] All ESLint warnings addressed
- [ ] Code formatted with Prettier
- [ ] No console.log statements in production code
- [ ] No commented-out code
- [ ] All TODOs documented or resolved

### Testing

- [ ] Unit tests passing (100%)
- [ ] Integration tests passing (100%)
- [ ] E2E tests passing (all browsers)
- [ ] Mobile tests passing (iOS + Android)
- [ ] Accessibility tests passing (no violations)
- [ ] Performance tests passing (Lighthouse > 90)
- [ ] Test coverage > 80%

### Functionality

- [ ] All 10 examples load correctly
- [ ] Search functionality works
- [ ] All filters work (category, difficulty, learning type)
- [ ] Sort controls work
- [ ] URL parameters persist
- [ ] Breadcrumb navigation works
- [ ] All tabs functional (Demo, Code, Docs, Metrics)
- [ ] iframe examples load and execute
- [ ] Code viewer displays correctly
- [ ] Related examples show
- [ ] Mobile responsive on all breakpoints

### Performance

- [ ] Page load time < 2 seconds
- [ ] Time to Interactive < 3 seconds
- [ ] First Contentful Paint < 1 second
- [ ] Largest Contentful Paint < 2.5 seconds
- [ ] Cumulative Layout Shift < 0.1
- [ ] Total Blocking Time < 200ms
- [ ] No memory leaks detected
- [ ] Bundle size optimized (<500KB gzipped)

### SEO & Meta Tags

- [ ] Page titles set correctly for all routes
- [ ] Meta descriptions present
- [ ] Open Graph tags configured
- [ ] Twitter Card tags configured
- [ ] Canonical URLs set
- [ ] Structured data (JSON-LD) present
- [ ] robots.txt configured
- [ ] sitemap.xml generated

### Security

- [ ] No sensitive data exposed in client code
- [ ] iframe sandbox attributes configured
- [ ] Content Security Policy headers set
- [ ] HTTPS enforced
- [ ] No mixed content warnings
- [ ] XSS prevention measures in place
- [ ] CORS configured correctly

### Accessibility (WCAG 2.1 AA)

- [ ] All images have alt text
- [ ] Proper heading hierarchy (h1, h2, h3...)
- [ ] Keyboard navigation works throughout
- [ ] Focus indicators visible
- [ ] Color contrast ratio > 4.5:1
- [ ] ARIA labels present where needed
- [ ] Screen reader tested
- [ ] No keyboard traps
- [ ] Skip to content link present

### Browser Compatibility

- [ ] Chrome (latest) - tested
- [ ] Firefox (latest) - tested
- [ ] Safari (latest) - tested
- [ ] Edge (latest) - tested
- [ ] Mobile Safari iOS 14+ - tested
- [ ] Mobile Chrome Android 10+ - tested

### Documentation

- [ ] README updated with new feature
- [ ] Component documentation complete
- [ ] API documentation (if applicable)
- [ ] User guide created
- [ ] Developer guide updated
- [ ] Changelog updated

---

## Build Process

### Production Build

```bash
# Clean previous build
rm -rf dist/

# Run production build
npm run build

# Verify build output
ls -lah dist/

# Check bundle sizes
npx vite-bundle-visualizer dist/stats.html
```

**Expected Output:**
```
dist/
├── assets/
│   ├── index-[hash].js       (~200KB gzipped)
│   ├── vendor-[hash].js      (~150KB gzipped)
│   ├── wasm-[hash].js        (~50KB gzipped)
│   └── index-[hash].css      (~20KB gzipped)
├── agentdb/
│   └── examples/
│       └── browser/          (10 example HTML files)
├── index.html
└── favicon.ico
```

### Build Verification

```bash
# Preview production build locally
npm run preview

# Visit http://localhost:4173
# Test all routes and functionality
```

**Verification Steps:**
1. Homepage loads
2. Navigation to /wasm-examples works
3. All 10 examples display
4. Search and filters function
5. Example detail pages load
6. iframes execute correctly
7. No console errors
8. Performance acceptable

---

## Deployment Platform Guides

### Netlify Deployment

#### Option 1: Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy to production
netlify deploy --prod --dir=dist
```

#### Option 2: Git Integration

**netlify.toml**:
```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/agentdb/examples/browser/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.wasm"
  [headers.values]
    Content-Type = "application/wasm"
    Cache-Control = "public, max-age=31536000, immutable"
```

**Connect to Git:**
1. Push code to GitHub
2. Go to Netlify Dashboard
3. Click "New site from Git"
4. Select repository
5. Set build command: `npm run build`
6. Set publish directory: `dist`
7. Deploy

**Verify:**
- [ ] Site deployed successfully
- [ ] All routes accessible
- [ ] HTTPS working
- [ ] Custom domain (if applicable) configured
- [ ] Environment variables set (if needed)

---

### Vercel Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to production
vercel --prod
```

**vercel.json**:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "SAMEORIGIN"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    },
    {
      "source": "/agentdb/examples/browser/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

**Verify:**
- [ ] Site deployed
- [ ] All routes work
- [ ] HTTPS active
- [ ] Analytics configured

---

### GitHub Pages Deployment

**vite.config.ts** (add base path):
```typescript
export default defineConfig({
  base: '/agentdb-site/',  // Repository name
  // ... rest of config
});
```

**Deploy Script** (package.json):
```json
{
  "scripts": {
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

```bash
# Install gh-pages
npm install --save-dev gh-pages

# Deploy
npm run deploy
```

**Verify:**
- [ ] GitHub Pages enabled in repo settings
- [ ] Site accessible at username.github.io/agentdb-site
- [ ] All assets loading correctly

---

### Custom Server / VPS

#### Nginx Configuration

**/etc/nginx/sites-available/agentdb**:
```nginx
server {
    listen 80;
    server_name agentdb.dev www.agentdb.dev;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agentdb.dev www.agentdb.dev;

    # SSL certificates (from Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/agentdb.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agentdb.dev/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Document root
    root /var/www/agentdb/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # WASM files
    location ~* \.wasm$ {
        types {
            application/wasm wasm;
        }
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Example files
    location /agentdb/examples/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Deploy:**
```bash
# Upload build to server
rsync -avz dist/ user@server:/var/www/agentdb/

# Restart Nginx
sudo systemctl restart nginx
```

**Verify:**
- [ ] Site accessible via domain
- [ ] HTTPS working
- [ ] Compression enabled
- [ ] Security headers present

---

## Post-Deployment Verification

### Automated Checks

**Health Check Script**:
```bash
#!/bin/bash

SITE_URL="https://agentdb.dev"

echo "Running post-deployment checks..."

# Check homepage
echo "✓ Checking homepage..."
curl -f -s -o /dev/null "$SITE_URL" || echo "❌ Homepage failed"

# Check WASM examples page
echo "✓ Checking /wasm-examples..."
curl -f -s -o /dev/null "$SITE_URL/wasm-examples" || echo "❌ Examples page failed"

# Check example detail
echo "✓ Checking example detail..."
curl -f -s -o /dev/null "$SITE_URL/wasm-examples/rag-self-learning" || echo "❌ Detail page failed"

# Check HTTPS
echo "✓ Checking HTTPS..."
curl -I "$SITE_URL" | grep "HTTP/2 200" || echo "❌ HTTPS failed"

# Check headers
echo "✓ Checking security headers..."
curl -I "$SITE_URL" | grep "X-Frame-Options" || echo "❌ Security headers missing"

echo "Post-deployment checks complete!"
```

---

### Manual Verification

**Critical User Journeys:**

1. **Browse Examples**
   - [ ] Visit homepage
   - [ ] Click "WASM Examples" in nav
   - [ ] See all 10 examples
   - [ ] Search for "RAG"
   - [ ] Click RAG example card

2. **View Example Detail**
   - [ ] See example header
   - [ ] Demo tab shows iframe
   - [ ] Code tab shows source
   - [ ] Docs tab shows guide
   - [ ] Metrics tab shows stats
   - [ ] Breadcrumb works

3. **Filter and Sort**
   - [ ] Open filters
   - [ ] Select category
   - [ ] Select difficulty
   - [ ] Change sort order
   - [ ] URL updates
   - [ ] Reset filters works

4. **Mobile Experience**
   - [ ] Navigation menu works
   - [ ] Cards display correctly
   - [ ] Examples load in iframe
   - [ ] Touch interactions work
   - [ ] No horizontal scroll

---

### Monitoring Setup

#### Google Analytics

```html
<!-- Add to index.html -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

**Track Events:**
```typescript
// Track example views
gtag('event', 'example_view', {
  example_id: 'rag-self-learning',
  example_title: 'RAG Self-Learning'
});

// Track filter usage
gtag('event', 'filter_used', {
  filter_type: 'category',
  filter_value: 'advanced'
});
```

---

#### Error Tracking (Sentry)

```bash
npm install @sentry/react
```

```typescript
// src/main.tsx
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  environment: import.meta.env.MODE,
  integrations: [
    new Sentry.BrowserTracing(),
    new Sentry.Replay(),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

---

#### Uptime Monitoring

**Recommended Services:**
- UptimeRobot (free tier)
- Pingdom
- StatusCake

**Monitor URLs:**
- https://agentdb.dev
- https://agentdb.dev/wasm-examples
- https://agentdb.dev/wasm-examples/rag-self-learning

---

## Rollback Plan

### Emergency Rollback

**Netlify:**
```bash
# List deployments
netlify deploy:list

# Rollback to previous deployment
netlify rollback
```

**Vercel:**
```bash
# List deployments
vercel list

# Promote previous deployment
vercel promote [deployment-url]
```

**GitHub Pages:**
```bash
# Checkout previous commit
git checkout HEAD~1

# Force push
git push -f origin gh-pages
```

---

## Post-Launch Tasks

### Week 1

- [ ] Monitor error rates
- [ ] Check analytics data
- [ ] Review user feedback
- [ ] Address critical bugs
- [ ] Update documentation

### Week 2-4

- [ ] Analyze usage patterns
- [ ] Gather user feedback
- [ ] Plan enhancements
- [ ] Optimize performance
- [ ] Fix non-critical issues

### Month 2+

- [ ] Integrate real WASM backend
- [ ] Convert popular examples to React
- [ ] Add community features
- [ ] Enhance metrics dashboard
- [ ] A/B test improvements

---

## Success Metrics

### Technical KPIs

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Page Load Time | < 2s | TBD | ⏳ |
| Time to Interactive | < 3s | TBD | ⏳ |
| Lighthouse Score | > 90 | TBD | ⏳ |
| Error Rate | < 0.1% | TBD | ⏳ |
| Uptime | > 99.9% | TBD | ⏳ |

### User Engagement KPIs

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Example Views | 1000/month | TBD | ⏳ |
| Time on Page | > 2 min | TBD | ⏳ |
| Bounce Rate | < 40% | TBD | ⏳ |
| Return Visits | > 20% | TBD | ⏳ |

### Business KPIs

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| NPM Installs | +20% | TBD | ⏳ |
| GitHub Stars | +50 | TBD | ⏳ |
| User Signups | TBD | TBD | ⏳ |

---

## Deployment Sign-Off

**Deployment Date**: _________________

**Deployed By**: _________________

**Deployment Version**: v1.0.0

**Sign-Off:**

- [ ] Technical Lead: _________________
- [ ] Product Owner: _________________
- [ ] QA Lead: _________________

---

## Emergency Contacts

**Technical Issues:**
- Developer: [email/phone]
- DevOps: [email/phone]

**Hosting Issues:**
- Netlify Support: support@netlify.com
- Vercel Support: support@vercel.com

**DNS Issues:**
- Domain Registrar: [support contact]

---

## Appendix: Environment Variables

**Production Environment:**
```bash
NODE_ENV=production
VITE_API_URL=https://api.agentdb.dev
VITE_ANALYTICS_ID=G-XXXXXXXXXX
VITE_SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

**Staging Environment:**
```bash
NODE_ENV=staging
VITE_API_URL=https://staging-api.agentdb.dev
VITE_ANALYTICS_ID=G-YYYYYYYYYY
VITE_SENTRY_DSN=https://yyyyy@sentry.io/yyyyy
```

---

**Deployment Complete! 🚀**

Monitor the site for 24 hours and address any issues that arise.
