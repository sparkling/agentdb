# AgentDB v3.0.0-alpha.6 Publishing Guide

## Pre-Publish Checklist

- [ ] All tests passing
- [ ] Build succeeds
- [ ] Benchmarks validated
- [ ] Version bumped to 3.0.0-alpha.6
- [ ] RELEASE notes complete
- [ ] README updated with memory orientation
- [ ] Git clean (no uncommitted changes)
- [ ] Security audit clean
- [ ] CHANGELOG.md created/updated

## Publishing Commands

### Publish as Alpha

```bash
cd packages/agentdb
npm publish --tag alpha --access public
```

**What this does**:
- Publishes to npm registry with `alpha` tag
- Users install via `npm install agentdb@alpha`
- Does NOT update the `latest` tag
- Safe for testing and early adopters

### Publish as Latest

```bash
cd packages/agentdb
npm publish --tag latest --access public
```

**What this does**:
- Publishes to npm registry with `latest` tag
- Users install via `npm install agentdb`
- Becomes the default version
- **Use with caution** for alpha versions

### Publish Both (Recommended)

```bash
cd packages/agentdb

# 1. Publish as alpha first
npm publish --tag alpha --access public

# 2. Then set as latest (optional for alpha versions)
npm dist-tag add agentdb@3.0.0-alpha.6 latest
```

**Recommendation for v3.0.0-alpha.6**:
- Publish with `--tag alpha` ONLY
- Do NOT set as `latest` until stable release
- Let users opt-in with `npm install agentdb@alpha`

## Pre-Publish Validation

### 1. Clean Workspace

```bash
cd packages/agentdb

# Check for uncommitted changes
git status

# Commit all changes
git add .
git commit -m "chore(agentdb): Release v3.0.0-alpha.6

Complete ADR-072 Phase 1 implementation:
- Sparse attention (10-100x speedup)
- Graph partitioning (50-80% memory reduction)
- Fused attention (10-50x faster)
- Zero-copy optimization (90% fewer allocations)
- Architecture refactoring (6 focused classes)
- 129+ comprehensive tests

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

### 2. Run Tests

```bash
npm test
```

**Expected output**:
- 129+ tests passing
- 0 failures
- Coverage reports generated

### 3. Build Package

```bash
npm run build
```

**Expected output**:
- TypeScript compilation successful
- Browser bundles generated (agentdb.browser.js)
- Schemas copied to dist/schemas/
- No errors or warnings

### 4. Run Benchmarks

```bash
npm run benchmark:adr072:fast
```

**Expected output**:
- All benchmarks passing
- Performance targets met
- No regressions detected

### 5. Security Audit

```bash
npm audit --production
```

**Expected output**:
- 0 critical vulnerabilities
- 0 high vulnerabilities
- Optional dependencies may have warnings (acceptable)

### 6. Verify Package Contents

```bash
npm pack --dry-run
```

**Expected files**:
- dist/src/ (compiled TypeScript)
- dist/schemas/ (SQL schemas)
- scripts/postinstall.cjs
- README.md
- LICENSE
- package.json

**Size check**:
- Should be < 10MB total
- Check for accidentally included files

### 7. Test Installation Locally

```bash
# Pack the package
npm pack

# Install in a test directory
cd /tmp
mkdir agentdb-test
cd agentdb-test
npm init -y
npm install /workspaces/agentic-flow/packages/agentdb/agentdb-3.0.0-alpha.6.tgz

# Test import
node -e "import('agentdb').then(m => console.log('Import successful:', Object.keys(m)))"
```

## Publishing Steps

### Step 1: Verify npm Authentication

```bash
npm whoami
```

**Expected output**: Your npm username

If not logged in:
```bash
npm login
```

### Step 2: Verify Package Configuration

```bash
cat package.json | grep -E '(name|version|main|types)'
```

**Expected output**:
```json
  "name": "agentdb",
  "version": "3.0.0-alpha.6",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
```

### Step 3: Dry Run

```bash
npm publish --dry-run --tag alpha
```

**Review the output**:
- Package contents
- File sizes
- Total package size
- No sensitive files included

### Step 4: Publish to Alpha

```bash
npm publish --tag alpha --access public
```

**Expected output**:
```
+ agentdb@3.0.0-alpha.6
```

### Step 5: Verify Publication

```bash
# Check alpha tag
npm view agentdb@alpha version

# Check package info
npm view agentdb@alpha

# Verify installation
npm install agentdb@alpha --dry-run
```

## Verification

After publishing:

```bash
# Check alpha tag
npm view agentdb@alpha version
# Expected: 3.0.0-alpha.6

# Check latest tag (should NOT be updated)
npm view agentdb@latest version
# Expected: Previous stable version (e.g., 2.x.x)

# Test installation in fresh directory
mkdir -p /tmp/test-agentdb-alpha
cd /tmp/test-agentdb-alpha
npm init -y
npm install agentdb@alpha

# Test import
node -e "import('agentdb').then(m => console.log('Success:', m.default ? 'Yes' : 'No'))"
```

## Post-Publication Tasks

### 1. Tag Git Commit

```bash
cd /workspaces/agentic-flow

# Create git tag
git tag -a agentdb-v3.0.0-alpha.6 -m "AgentDB v3.0.0-alpha.6

ADR-072 Phase 1 Complete:
- Sparse attention (10-100x speedup)
- Graph partitioning (50-80% memory reduction)
- Fused attention (10-50x faster)
- 129+ tests, 100% passing"

# Push tag to remote
git push origin agentdb-v3.0.0-alpha.6
```

### 2. Create GitHub Release

```bash
# Use gh CLI
gh release create agentdb-v3.0.0-alpha.6 \
  --title "AgentDB v3.0.0-alpha.6: Sparse Attention & Memory Revolution" \
  --notes-file packages/agentdb/RELEASE-v3.0.0-alpha.6.md \
  --prerelease

# Or create manually at:
# https://github.com/ruvnet/agentic-flow/releases/new
```

### 3. Update Documentation

- [ ] Update main README.md with alpha.6 highlights ✓
- [ ] Update AgentDB README.md with memory orientation ✓
- [ ] Add to CHANGELOG.md
- [ ] Update docs site (if applicable)

### 4. Announce Release

- [ ] Tweet/social media announcement
- [ ] Discord/community announcement
- [ ] Blog post (optional)
- [ ] Email newsletter (optional)

## Rollback (if needed)

### Unpublish (within 72 hours only)

```bash
npm unpublish agentdb@3.0.0-alpha.6
```

**WARNING**: Only works within 72 hours of publication

### Deprecate Version

```bash
npm deprecate agentdb@3.0.0-alpha.6 "Please use a newer version"
```

**Use when**: Issues found after 72 hours

### Revert Latest Tag

```bash
# If you accidentally set as latest
npm dist-tag add agentdb@3.0.0-alpha.5 latest
npm dist-tag rm agentdb@3.0.0-alpha.6 latest
```

## Troubleshooting

### Error: "You do not have permission to publish"

**Solution**:
```bash
# Verify npm login
npm whoami

# Check package scope
# If scoped package: @yourscope/agentdb
# Ensure you have access to the scope
```

### Error: "Version already exists"

**Solution**:
```bash
# Bump version in package.json
npm version patch --no-git-tag-version
# Or manually edit package.json

# Then publish again
npm publish --tag alpha --access public
```

### Error: "Package size too large"

**Solution**:
```bash
# Check what's being included
npm pack --dry-run

# Add to .npmignore:
# tests/
# benchmarks/
# docs/
# *.test.ts
# *.test.js

# Rebuild and try again
npm run build
npm publish --tag alpha --access public
```

### Error: "E404 Not found"

**Solution**:
```bash
# Check package name availability
npm view agentdb

# If taken, use scoped package:
# @yourscope/agentdb
```

## Success Criteria

✅ **Publication Successful** when all of these are true:

1. `npm view agentdb@alpha version` returns `3.0.0-alpha.6`
2. Fresh installation works: `npm install agentdb@alpha`
3. Import works: `import { AttentionService } from 'agentdb'`
4. Git tag created and pushed
5. GitHub release published
6. No critical issues reported within 24 hours

## Support

If you encounter issues:

1. Check npm registry status: https://status.npmjs.org/
2. Review npm documentation: https://docs.npmjs.com/
3. Open an issue: https://github.com/ruvnet/agentic-flow/issues
4. Contact maintainer: ruv@ruv.net

---

**Last Updated**: 2026-03-26
**Maintainer**: RUV
**Package**: agentdb@3.0.0-alpha.6
