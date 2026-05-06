# 🚀 Causal Graph Enhancement - Implementation Instructions

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step-by-Step Implementation](#step-by-step-implementation)
3. [Verification](#verification)
4. [Rollback](#rollback)
5. [Customization](#customization)

---

## Prerequisites

### Required
- ✅ Access to `/workspaces/agentdb-site/public/agentdb/examples/browser/management-ide/index.html`
- ✅ Text editor (VS Code, Vim, etc.)
- ✅ Modern browser (Chrome, Firefox, Safari, Edge)
- ✅ Basic understanding of HTML/JavaScript

### Optional
- 🔧 Git for version control
- 🔧 Local web server (or can use file://)
- 🔧 Browser developer tools knowledge

---

## Step-by-Step Implementation

### Step 1: Backup Original File

**Time Estimate: 1 minute**

```bash
# Navigate to directory
cd /workspaces/agentdb-site/public/agentdb/examples/browser/management-ide

# Create backup
cp index.html index.html.backup

# Verify backup created
ls -lh index.html*
```

**Expected Output:**
```
-rw-r--r-- 1 user user 245K Oct 23 12:00 index.html
-rw-r--r-- 1 user user 245K Oct 23 12:00 index.html.backup
```

---

### Step 2: Locate Replacement Section

**Time Estimate: 2 minutes**

```bash
# Open file in editor
code index.html

# Or use grep to find the section
grep -n "Causal Graph Panel" index.html
```

**Expected Output:**
```
1678:        <!-- Causal Graph Panel -->
```

**Visual Markers:**
- **Start**: Line ~1678 with comment `<!-- Causal Graph Panel -->`
- **End**: Line ~1712 with closing `</div>` tags
- **Parent**: Inside `<main class="ide-main">` section
- **Before**: Vector Search Panel
- **After**: Query Optimizer Panel

---

### Step 3: Replace HTML Section

**Time Estimate: 3 minutes**

#### Option A: Manual Copy-Paste

1. Open `/workspaces/agentdb-site/docs/causal-graph-enhancement.html` in browser
2. Scroll to **Section 1: HTML Replacement**
3. Copy entire code block (starts with `<!-- Causal Graph Panel -->`)
4. In `index.html`, select lines 1678-1712
5. Paste replacement code
6. Save file

#### Option B: Using sed (Advanced)

```bash
# Extract line numbers
START=1678
END=1712

# Remove old section (creates backup)
sed -i.bak "${START},${END}d" index.html

# Insert new section (manual paste still needed)
# Better to use manual method for accuracy
```

**Validation:**
```bash
# Count new lines (should be ~200 instead of ~35)
sed -n '1678,1878p' index.html | wc -l

# Check for key elements
grep -c "graph-svg-container" index.html  # Should be 1
grep -c "metric-nodes" index.html         # Should be 1
grep -c "graph-layout" index.html         # Should be 1
```

---

### Step 4: Add JavaScript Functions

**Time Estimate: 5 minutes**

#### Find Insertion Point

```bash
# Locate the closing script tag
grep -n "</script>" index.html | tail -1
```

**Expected Output:**
```
4850:  </script>
```

#### Insert JavaScript

1. Open `/workspaces/agentdb-site/docs/causal-graph-enhancement.html`
2. Scroll to **Section 2: JavaScript Functions**
3. Copy entire code block (~1500 lines)
4. In `index.html`, find the **last** `</script>` tag (before closing `</body>`)
5. Create new line **before** `</script>`
6. Paste JavaScript code
7. Ensure proper indentation
8. Save file

**Structure Should Look Like:**
```html
  <script>
    // ... existing JavaScript ...

    // ============================================================================
    // ADVANCED CAUSAL GRAPH VISUALIZATION & ANALYSIS
    // ============================================================================

    // Graph state
    const graphState = {
      nodes: new Map(),
      // ... rest of new code ...
    };

    // ... all new functions ...

  </script>
</body>
</html>
```

**Validation:**
```bash
# Check function count (should find ~30+ functions)
grep -c "function.*Causal\|function.*graph\|function.*node" index.html

# Verify key functions exist
grep -c "renderCausalGraphSVG" index.html      # Should be 1+
grep -c "calculateBetweenness" index.html      # Should be 1+
grep -c "updateGraphLayout" index.html         # Should be 1+
```

---

### Step 5: Add CSS (Optional)

**Time Estimate: 2 minutes**

The enhancement uses existing CSS variables, but you can add optional enhancements:

1. Open `/workspaces/agentdb-site/docs/causal-graph-enhancement.html`
2. Scroll to **Section 3: Additional CSS**
3. Copy CSS code
4. In `index.html`, find the `<style>` section (near top)
5. Paste at end of existing styles (before `</style>`)
6. Save file

**Validation:**
```bash
# Check if new CSS added
grep -c "graph-container circle:hover" index.html  # Should be 1
```

---

### Step 6: Test Implementation

**Time Estimate: 5 minutes**

#### Basic Functionality Test

```bash
# Start local server (if needed)
python3 -m http.server 8000

# Or open directly
# file:///workspaces/agentdb-site/public/agentdb/examples/browser/management-ide/index.html
```

**Test Checklist:**

1. **Page Loads**
   ```
   ✓ No JavaScript errors in console
   ✓ Page renders completely
   ✓ No layout issues
   ```

2. **Navigate to Causal Graph**
   ```
   ✓ Click "Causal Graph" in sidebar
   ✓ Panel switches to graph view
   ✓ Controls are visible
   ```

3. **UI Elements Present**
   ```
   ✓ Layout dropdown shows 4 options
   ✓ Weight slider exists
   ✓ Node size dropdown exists
   ✓ View mode dropdown exists
   ✓ Zoom controls visible
   ✓ Legend visible
   ✓ Metrics panel on right
   ✓ Quick Analysis buttons visible
   ```

4. **Add Sample Data**
   ```
   ✓ Click "📚 Examples" button
   ✓ Sample edges loaded
   ✓ Graph renders with nodes
   ✓ Edges visible with arrows
   ```

5. **Test Interactions**
   ```
   ✓ Change layout - graph updates
   ✓ Adjust weight slider - edges filter
   ✓ Click node - details show in sidebar
   ✓ Zoom in/out - graph scales
   ✓ Switch to List view - table appears
   ✓ Switch to Matrix view - grid appears
   ✓ Switch to Metrics view - dashboard appears
   ```

6. **Test Analysis**
   ```
   ✓ Click "Central Nodes" - alert shows top nodes
   ✓ Click "Communities" - alert shows communities
   ✓ Click "Confounders" - alert shows confounders
   ✓ Metrics update correctly
   ```

7. **Test Export**
   ```
   ✓ Click "Export" - JSON downloads
   ✓ Open JSON - valid format
   ✓ Contains nodes, edges, metrics
   ```

---

### Step 7: Browser Console Check

**Time Estimate: 2 minutes**

Open Developer Tools (F12) and check:

```javascript
// Should be defined
console.log(typeof renderCausalGraphSVG);     // "function"
console.log(typeof graphState);                // "object"
console.log(typeof calculateBetweenness);      // "function"

// Should render without errors
renderCausalGraphSVG();

// Check state
console.log(graphState.nodes.size);            // Should show node count
console.log(graphState.edges.length);          // Should show edge count
```

**Expected Console Output:**
```
function
object
function
Loaded X causal edges
```

**No Errors Like:**
```
❌ Uncaught ReferenceError: graphState is not defined
❌ Uncaught TypeError: Cannot read property 'nodes'
❌ Uncaught SyntaxError: Unexpected token
```

---

## Verification

### Automated Test Script

Save as `test-causal-graph.js` and run in browser console:

```javascript
// Test Suite for Causal Graph Enhancement
(async function testCausalGraph() {
  console.log('🧪 Starting Causal Graph Tests...\n');

  const tests = {
    passed: 0,
    failed: 0,
    errors: []
  };

  // Test 1: Functions exist
  console.log('Test 1: Checking function existence...');
  const requiredFunctions = [
    'renderCausalGraphSVG',
    'updateGraphLayout',
    'filterCausalEdges',
    'calculateBetweenness',
    'calculatePageRank',
    'findCentralNodes',
    'detectCommunities',
    'exportCausalGraphAdvanced'
  ];

  requiredFunctions.forEach(fn => {
    if (typeof window[fn] === 'function') {
      console.log(`  ✓ ${fn} exists`);
      tests.passed++;
    } else {
      console.log(`  ✗ ${fn} missing`);
      tests.failed++;
      tests.errors.push(`Missing function: ${fn}`);
    }
  });

  // Test 2: Graph state initialized
  console.log('\nTest 2: Checking graph state...');
  if (typeof graphState === 'object') {
    console.log('  ✓ graphState exists');
    tests.passed++;

    if (graphState.nodes instanceof Map) {
      console.log('  ✓ graphState.nodes is Map');
      tests.passed++;
    } else {
      console.log('  ✗ graphState.nodes not Map');
      tests.failed++;
    }

    if (Array.isArray(graphState.edges)) {
      console.log('  ✓ graphState.edges is Array');
      tests.passed++;
    } else {
      console.log('  ✗ graphState.edges not Array');
      tests.failed++;
    }
  } else {
    console.log('  ✗ graphState missing');
    tests.failed++;
    tests.errors.push('graphState not defined');
  }

  // Test 3: UI elements present
  console.log('\nTest 3: Checking UI elements...');
  const requiredElements = [
    'graph-layout',
    'weight-filter',
    'node-size-by',
    'view-mode',
    'causal-graph-svg',
    'graph-container',
    'metric-nodes',
    'metric-edges'
  ];

  requiredElements.forEach(id => {
    if (document.getElementById(id)) {
      console.log(`  ✓ #${id} exists`);
      tests.passed++;
    } else {
      console.log(`  ✗ #${id} missing`);
      tests.failed++;
      tests.errors.push(`Missing element: ${id}`);
    }
  });

  // Test 4: Try rendering
  console.log('\nTest 4: Testing render function...');
  try {
    await renderCausalGraphSVG();
    console.log('  ✓ renderCausalGraphSVG() executed');
    tests.passed++;
  } catch (error) {
    console.log('  ✗ renderCausalGraphSVG() failed');
    console.log(`    Error: ${error.message}`);
    tests.failed++;
    tests.errors.push(`Render error: ${error.message}`);
  }

  // Results
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Passed: ${tests.passed}`);
  console.log(`❌ Failed: ${tests.failed}`);
  console.log('='.repeat(50));

  if (tests.failed > 0) {
    console.log('\n🚨 Errors Found:');
    tests.errors.forEach(err => console.log(`  • ${err}`));
  } else {
    console.log('\n🎉 All tests passed! Enhancement successful!');
  }

  return tests;
})();
```

**Expected Output (Success):**
```
🧪 Starting Causal Graph Tests...

Test 1: Checking function existence...
  ✓ renderCausalGraphSVG exists
  ✓ updateGraphLayout exists
  ✓ filterCausalEdges exists
  ✓ calculateBetweenness exists
  ✓ calculatePageRank exists
  ✓ findCentralNodes exists
  ✓ detectCommunities exists
  ✓ exportCausalGraphAdvanced exists

Test 2: Checking graph state...
  ✓ graphState exists
  ✓ graphState.nodes is Map
  ✓ graphState.edges is Array

Test 3: Checking UI elements...
  ✓ #graph-layout exists
  ✓ #weight-filter exists
  ✓ #node-size-by exists
  ✓ #view-mode exists
  ✓ #causal-graph-svg exists
  ✓ #graph-container exists
  ✓ #metric-nodes exists
  ✓ #metric-edges exists

Test 4: Testing render function...
  ✓ renderCausalGraphSVG() executed

==================================================
✅ Passed: 19
❌ Failed: 0
==================================================

🎉 All tests passed! Enhancement successful!
```

---

## Rollback

If you encounter issues and need to revert:

### Quick Rollback

```bash
# Restore from backup
cd /workspaces/agentdb-site/public/agentdb/examples/browser/management-ide
cp index.html.backup index.html

# Verify restoration
diff index.html index.html.backup  # Should show no differences
```

### Git Rollback

```bash
# If using Git
git checkout index.html

# Or restore to specific commit
git checkout <commit-hash> -- index.html
```

---

## Customization

### Change Color Scheme

```javascript
// In renderCausalGraphSVG(), find:
circle.setAttribute('fill', '#2a4a3a');
circle.setAttribute('stroke', '#00ff88');

// Change to your colors:
circle.setAttribute('fill', '#YOUR_DARK_COLOR');
circle.setAttribute('stroke', '#YOUR_ACCENT_COLOR');
```

### Add New Layout Algorithm

```javascript
// In calculateLayout(), add new case:
case 'custom':
  nodes.forEach((node, i) => {
    positions.set(node.id, {
      x: /* your X formula */,
      y: /* your Y formula */
    });
  });
  break;
```

Then add to dropdown:
```html
<option value="custom">Custom Layout</option>
```

### Adjust Performance Limits

```javascript
// In getCausalEdges(), change LIMIT:
return sqlAll('SELECT * FROM causal_edges ORDER BY created_at DESC LIMIT 50');
//                                                                        ^^
// Increase for more edges, decrease for better performance
```

### Customize Node Sizes

```javascript
// In getNodeSize(), adjust multipliers:
case 'degree':
  return baseSize + degree * 2;  // Change 2 to make bigger/smaller

case 'betweenness':
  return baseSize + betweenness * 10;  // Change 10

case 'pagerank':
  return baseSize + pagerank * 15;  // Change 15
```

---

## Troubleshooting

### Issue: "graphState is not defined"

**Cause:** JavaScript not loaded or syntax error

**Fix:**
```bash
# Check for syntax errors
grep -n "graphState" index.html

# Ensure declaration exists:
const graphState = {
```

### Issue: Graph doesn't render

**Cause:** No data or database error

**Fix:**
```javascript
// In browser console:
sqlAll('SELECT COUNT(*) FROM causal_edges');
// Should return count > 0

// Try loading sample data:
// Click "📚 Examples" button
```

### Issue: Slow performance

**Cause:** Too many nodes/edges

**Fix:**
```javascript
// Reduce edge count
document.getElementById('weight-filter').value = 0.5;
filterCausalEdges(0.5);

// Or use simpler layout
updateGraphLayout('hierarchical');

// Or reduce query limit
// In getCausalEdges(), change LIMIT to 25
```

### Issue: Metrics show 0

**Cause:** Graph not loaded or calculation error

**Fix:**
```javascript
// Manually trigger update
renderCausalGraphSVG();
updateGraphMetrics();

// Check state
console.log(graphState.nodes.size);
console.log(graphState.edges.length);
```

---

## Success Criteria

### ✅ Implementation Complete When:

1. **Visual Check**
   - [ ] New controls panel visible
   - [ ] SVG graph renders
   - [ ] Side panels show metrics
   - [ ] Zoom controls present
   - [ ] Legend visible

2. **Functional Check**
   - [ ] All 4 layouts work
   - [ ] Weight filter updates graph
   - [ ] Node sizing changes work
   - [ ] View modes switch correctly
   - [ ] Zoom in/out functions

3. **Analysis Check**
   - [ ] Metrics calculate correctly
   - [ ] Node selection shows details
   - [ ] Central nodes identified
   - [ ] Communities detected
   - [ ] Export produces valid JSON

4. **Performance Check**
   - [ ] < 1 second render for 50 nodes
   - [ ] No console errors
   - [ ] Smooth interactions
   - [ ] No memory leaks

---

## Next Steps

After successful implementation:

1. **Add Sample Data**
   - Click "📚 Examples" to load samples
   - Or import your own causal relationships

2. **Explore Features**
   - Try all layout algorithms
   - Test different node sizing metrics
   - Switch between view modes
   - Analyze your graph

3. **Customize**
   - Adjust colors to match your theme
   - Tweak node sizes for your data
   - Add custom layouts if needed

4. **Share**
   - Export graphs for reports
   - Take screenshots for presentations
   - Share insights with team

---

## Support

### Resources
- **Main Documentation**: `/workspaces/agentdb-site/docs/CAUSAL_GRAPH_ENHANCEMENT_SUMMARY.md`
- **Quick Reference**: `/workspaces/agentdb-site/docs/CAUSAL_GRAPH_QUICK_REFERENCE.md`
- **Enhancement Code**: `/workspaces/agentdb-site/docs/causal-graph-enhancement.html`

### Getting Help
- Review browser console for errors
- Check implementation matches examples
- Verify all code copied completely
- Test with sample data first

---

**Implementation Time**: 15-20 minutes
**Difficulty**: Intermediate
**Risk**: Low (backup created)
**Reward**: High (comprehensive graph analysis)

**Last Updated**: 2025-10-23
**Version**: 1.0
