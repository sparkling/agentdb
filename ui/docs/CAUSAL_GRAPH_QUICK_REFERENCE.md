# 🔗 Causal Graph Panel - Quick Reference Guide

## 🚀 Quick Start

### 1. Replace HTML (5 minutes)
```
File: /workspaces/agentdb-site/public/agentdb/examples/browser/management-ide/index.html
Lines: ~1678-1712
Action: Replace entire "Causal Graph Panel" section
Source: /workspaces/agentdb-site/docs/causal-graph-enhancement.html (Section 1)
```

### 2. Add JavaScript (5 minutes)
```
File: Same file
Location: Before closing </script> tag
Action: Copy all functions from Section 2
Lines: ~1500 lines of new code
```

### 3. Test (2 minutes)
```
1. Open index.html in browser
2. Navigate to "Causal Graph" panel
3. Add sample edges using "📚 Examples"
4. Verify graph renders correctly
```

---

## 🎮 User Controls

### Main Control Bar
```
[➕ Add Edge] [🔄 Refresh] [📚 Examples] [💾 Export] [🔬 Path Analysis] [🎯 Interventions]
```

### Graph Controls Panel
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   Layout     │  Min Weight  │  Node Size   │  View Mode   │
│              │              │              │              │
│  Force ▼     │  ━━●━━━━━━  │  Uniform ▼   │  Graph ▼     │
│  Hierarchic. │  0.0 - 1.0   │  Degree      │  List        │
│  Circular    │              │  Betweenness │  Matrix      │
│  Radial      │              │  PageRank    │  Metrics     │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

### Zoom Controls (Top-Right)
```
┌──────┐
│ 🔍+ │  Zoom In
├──────┤
│ 🔍− │  Zoom Out
├──────┤
│  ↺  │  Reset
└──────┘
```

### Quick Analysis Panel (Right Side)
```
┌────────────────────┐
│ ⚡ Quick Analysis  │
├────────────────────┤
│ [📍 Central Nodes] │
│ [👥 Communities]   │
│ [🔀 Confounders]   │
│ [🚪 Backdoor Paths]│
└────────────────────┘
```

---

## 📊 Layout Algorithms

### Force-Directed (Default)
```
Best For: General purpose, balanced view
Speed: Fast
Characteristics:
  • Nodes in circular arrangement
  • Even spacing
  • Clear relationships
  • Good for 20-100 nodes

Use When:
  ✓ Exploring new graphs
  ✓ No clear hierarchy
  ✓ Want balanced view
```

### Hierarchical
```
Best For: Causal chains, dependency trees
Speed: Fast
Characteristics:
  • Top-down flow
  • Levels based on causality
  • Clear direction
  • Shows causal order

Use When:
  ✓ Analyzing cause chains
  ✓ Finding root causes
  ✓ Understanding flow
  ✓ Presenting to others
```

### Circular
```
Best For: Showing all nodes equally
Speed: Very Fast
Characteristics:
  • Perfect circle
  • Equal node spacing
  • Symmetric layout
  • No node prioritization

Use When:
  ✓ Comparing all nodes
  ✓ No hierarchy exists
  ✓ Aesthetic presentation
  ✓ Small graphs (< 30 nodes)
```

### Radial
```
Best For: Tree structures with clear roots
Speed: Fast
Characteristics:
  • Root(s) at center
  • Concentric circles
  • Depth visualization
  • Shows distance from roots

Use When:
  ✓ Clear root nodes exist
  ✓ Tree-like structure
  ✓ Want depth visualization
  ✓ Analyzing propagation
```

---

## 🎯 Node Sizing Metrics

### Uniform (Default)
```
Formula: All nodes same size (8px radius)
Complexity: O(1)
Best For: Simple visualization

Visual:
  ○ ○ ○ ○ ○  (all equal)
```

### Degree
```
Formula: size = 8 + (degree × 2)
Complexity: O(e) - one pass through edges
Best For: Finding most connected nodes

Visual:
  ○ ◯ ● ◯ ○  (size by connection count)

Interpretation:
  Large = Hub nodes, many connections
  Small = Peripheral nodes, few connections
```

### Betweenness
```
Formula: size = 8 + (betweenness × 10)
Complexity: O(n³) - all pairs shortest paths
Best For: Finding bridge/connector nodes

Visual:
  ○ ● ○ ○ ◯  (size by bridge importance)

Interpretation:
  Large = Critical connectors, information brokers
  Small = Not on many shortest paths

Warning: Slow for large graphs (> 100 nodes)
```

### PageRank
```
Formula: size = 8 + (pagerank × 15)
Complexity: O(n²·k) - k iterations
Best For: Finding influential nodes

Visual:
  ○ ○ ● ◯ ○  (size by influence)

Interpretation:
  Large = Important nodes, high influence
  Small = Less important in network

Note: Considers quality of connections, not just quantity
```

---

## 👁️ View Modes

### Interactive Graph (Default)
```
Features:
  ✓ Click nodes for details
  ✓ Zoom and pan
  ✓ Visual layout algorithms
  ✓ Edge thickness by weight
  ✓ Real-time interaction

Best For:
  • Exploration
  • Presentations
  • Pattern discovery
```

### Edge List
```
Features:
  ✓ Table of all relationships
  ✓ Cause → Effect pairs
  ✓ Weight strength bars
  ✓ Sortable columns
  ✓ Easy to scan

Best For:
  • Reviewing all edges
  • Finding specific relationships
  • Data validation
```

### Adjacency Matrix
```
Features:
  ✓ Grid showing all connections
  ✓ Color by weight strength
  ✓ Rows = causes
  ✓ Columns = effects
  ✓ Heat map visualization

Best For:
  • Dense graphs
  • Pattern recognition
  • Symmetry analysis
  • Mathematical analysis

Reading Matrix:
  Row X, Column Y = Effect of X on Y
  Darker = Stronger relationship
  "-" = No relationship
```

### Metrics Dashboard
```
Features:
  ✓ Top 10 nodes by each metric
  ✓ PageRank rankings
  ✓ Betweenness rankings
  ✓ Degree rankings
  ✓ Detailed statistics

Best For:
  • Identifying key nodes
  • Comparative analysis
  • Report generation
  • Quick insights
```

---

## 📈 Interpreting Metrics

### Graph-Level Metrics

#### Nodes & Edges
```
Meaning: Basic graph size
Range: 0 to ∞

Interpretation:
  < 20 nodes: Small, simple analysis
  20-50 nodes: Medium, good for visualization
  50-100 nodes: Large, may be slow
  > 100 nodes: Very large, consider filtering
```

#### Density
```
Formula: edges / (nodes × (nodes-1))
Range: 0.0 to 1.0

Interpretation:
  0.0 - 0.1: Sparse (few connections)
  0.1 - 0.3: Medium density
  0.3 - 0.5: Dense (many connections)
  > 0.5: Very dense, complex interactions

Implications:
  Low: Independent factors
  High: Highly interconnected system
```

#### Average Path Length
```
Formula: Mean of all shortest paths
Range: 1.0 to ∞

Interpretation:
  1.0 - 2.0: Very connected, direct paths
  2.0 - 3.0: Moderately connected
  3.0 - 5.0: Long causal chains
  > 5.0: Distant relationships, weak connections

Implications:
  Low: Quick propagation, strong coupling
  High: Slow propagation, weak coupling
```

#### Clustering Coefficient
```
Formula: Average local clustering
Range: 0.0 to 1.0

Interpretation:
  0.0 - 0.2: Tree-like, no triangles
  0.2 - 0.5: Some local clustering
  0.5 - 0.8: High clustering
  > 0.8: Very dense local neighborhoods

Implications:
  Low: Hierarchical structure
  High: Tight-knit groups, modules
```

#### Connected Components
```
Meaning: Number of isolated subgraphs
Range: 1 to nodes

Interpretation:
  1: Fully connected graph
  2-5: Few isolated groups
  > 5: Many disconnected parts

Implications:
  1: All nodes reachable from all others
  Many: Separate causal systems
```

### Node-Level Metrics

#### Degree
```
Formula: In-degree + Out-degree

High Degree:
  ✓ Hub nodes
  ✓ Central to many relationships
  ✓ May be confounders
  ✓ Important for network

Low Degree:
  • Peripheral nodes
  • Specific/specialized
  • Less influence
```

#### Betweenness
```
Formula: Fraction of shortest paths through node

High Betweenness:
  ✓ Bridge nodes
  ✓ Control information flow
  ✓ Critical for connectivity
  ✓ Removal would fragment network

Low Betweenness:
  • Not on main paths
  • Can be removed without impact
  • Less critical
```

#### PageRank
```
Formula: Iterative importance score

High PageRank:
  ✓ Influential nodes
  ✓ Receive many/important connections
  ✓ Key causes or effects
  ✓ Worth investigating

Low PageRank:
  • Less influential
  • Few or unimportant connections
  • Supporting roles
```

---

## 🔍 Analysis Workflows

### Finding Most Important Nodes
```
Steps:
1. Click "🔄 Refresh" to load graph
2. Set "Node Size By: PageRank"
3. Observe largest nodes
4. Click "📍 Central Nodes"
5. Review top 5 in popup
6. Click nodes to see details

Expected Output:
  • List of 5 most influential nodes
  • PageRank scores (0.0-1.0)
  • Visual sizing in graph
```

### Identifying Confounders
```
Steps:
1. Load graph with your data
2. Click "🔀 Confounders"
3. Review nodes with multiple effects
4. Select a potential confounder node
5. Check "Outgoing Edges" in details
6. Consider adjusting for confounding

Red Flags:
  ⚠️ Node causes 3+ effects
  ⚠️ Effects are your X and Y
  ⚠️ High betweenness score

Action:
  → Control for confounder in analysis
  → Add as covariate
  → Stratify by confounder levels
```

### Tracing Causal Chains
```
Steps:
1. Switch to "Hierarchical" layout
2. Identify root node (no causes)
3. Click root node
4. Read "Effects" in side panel
5. Click an effect node
6. Continue following chain

Visualization:
  Top → Bottom = Cause → Effect

Use For:
  • Understanding mechanisms
  • Finding mediators
  • Explaining outcomes
  • Root cause analysis
```

### Community Detection
```
Steps:
1. Load graph (any layout)
2. Click "👥 Communities"
3. Note number of communities
4. Review community sizes
5. Switch to "Circular" layout
6. Observe natural groupings

Interpretation:
  1 community: Fully connected
  2-3 communities: Clear subsystems
  Many communities: Fragmented

Use For:
  • Identifying modules
  • Finding subsystems
  • Grouping related factors
```

### Comparing Layouts
```
Steps:
1. Select "Force-Directed"
2. Note node positions
3. Change to "Hierarchical"
4. Observe different perspective
5. Try "Circular" for symmetry
6. Use "Radial" if tree-like

Tips:
  • Hierarchical: Best for presentations
  • Force: Best for exploration
  • Circular: Best for aesthetics
  • Radial: Best for trees
```

---

## 🎨 Visual Legend

### Edge Weight Encoding
```
Weak (0.0-0.3)
━━━━━━━━━  (thin, faint)
          Opacity: 0.3
          Width: 1-2px

Medium (0.3-0.7)
━━━━━━━━━  (medium, visible)
          Opacity: 0.6
          Width: 2-3px

Strong (0.7-1.0)
━━━━━━━━━  (thick, bright)
          Opacity: 1.0
          Width: 3-4px
```

### Node States
```
Default
  ○  Fill: #2a4a3a (dark green)
     Stroke: #00ff88 (bright green)
     Width: 2px

Selected
  ●  Fill: #00ff88 (bright green)
     Stroke: #00ff88 (bright green)
     Width: 2px
     Glow effect

Hovered
  ◉  Fill: #2a4a3a (dark green)
     Stroke: #00ff88 (bright green)
     Width: 3px
     Drop shadow
```

### Color Palette
```
Primary: #00ff88  (Bright Green) - Accent/Active
Dark:    #2a4a3a  (Dark Green)   - Nodes
Gray:    #666666  (Medium Gray)  - Text Secondary
Light:   #e0e0e0  (Light Gray)   - Text Primary
BG:      #1a1a1a  (Near Black)   - Background
```

---

## ⌨️ Keyboard Shortcuts

### Navigation (Coming Soon)
```
Space     Pan mode on/off
+         Zoom in
-         Zoom out
0         Reset zoom
R         Refresh graph
L         Cycle layouts
V         Cycle views
```

### Selection (Coming Soon)
```
Click     Select node
Esc       Deselect all
Delete    Remove selected edge
```

---

## 💡 Pro Tips

### Performance Optimization
```
✓ Use weight filter to reduce edges
✓ Switch to List/Matrix for large graphs
✓ Avoid Betweenness on > 100 nodes
✓ Use Hierarchical layout (fastest)
✓ Limit database query to recent edges
```

### Better Visualizations
```
✓ Hierarchical: Best for presentations
✓ Color code by communities (manual)
✓ Use PageRank sizing for influence
✓ Filter weak edges (< 0.3) for clarity
✓ Export SVG for publication
```

### Accurate Analysis
```
✓ Check for confounders before inferring causality
✓ Look for backdoor paths
✓ Verify no selection bias
✓ Consider measurement error
✓ Test robustness with simulations
```

### Common Pitfalls
```
✗ Don't confuse correlation with causation
✗ Don't ignore confounders
✗ Don't over-interpret weak edges
✗ Don't rely solely on automated metrics
✗ Don't forget domain knowledge
```

---

## 🐛 Troubleshooting

### Graph Not Rendering
```
Problem: Empty or error message
Solution:
  1. Check browser console (F12)
  2. Verify edges exist: SELECT * FROM causal_edges
  3. Click "🔄 Refresh"
  4. Try different view mode
  5. Reload page
```

### Slow Performance
```
Problem: Laggy interactions, slow rendering
Solution:
  1. Increase weight filter (reduce edges)
  2. Switch to "List" or "Matrix" view
  3. Use "Uniform" node sizing
  4. Limit query: LIMIT 50
  5. Use "Hierarchical" layout
```

### Metrics Show 0
```
Problem: All metrics display 0.00
Solution:
  1. Ensure edges loaded: Check metric-edges value
  2. Click "🔄 Refresh"
  3. Verify database has data
  4. Check browser console for errors
  5. Try switching layouts
```

### Export Not Working
```
Problem: Download doesn't start
Solution:
  1. Check browser allows downloads
  2. Disable popup blocker
  3. Try different browser
  4. Check file permissions
  5. Use copy-paste from console
```

### Node Details Empty
```
Problem: Side panel shows no information
Solution:
  1. Click a node in graph view
  2. Switch to "Interactive Graph" view
  3. Ensure graph has rendered
  4. Try clicking different node
  5. Refresh and try again
```

---

## 📚 Additional Resources

### Learn Graph Theory
- NetworkX Tutorial (Python)
- igraph Documentation (R)
- Graph Theory Textbooks

### Learn Causal Inference
- "The Book of Why" - Judea Pearl
- "Causal Inference" - Hernán & Robins
- dagitty.net (online tool)

### Export & Analysis
```
Export JSON → Import to:
  • NetworkX (Python)
  • igraph (R)
  • Gephi (visualization)
  • Cytoscape (biology)
  • Neo4j (graph database)
```

---

## 🎯 Common Use Cases

### 1. Root Cause Analysis
```
Goal: Find what caused an outcome

Steps:
1. Add outcome as effect
2. Add potential causes
3. Use Hierarchical layout
4. Trace backwards from outcome
5. Identify root causes at top

Layout: Hierarchical
Metric: Betweenness
View: Interactive Graph
```

### 2. Impact Assessment
```
Goal: Predict effects of intervention

Steps:
1. Identify intervention node
2. View outgoing edges
3. Trace causal chains forward
4. List all affected outcomes
5. Estimate effect sizes

Layout: Radial (intervention at center)
Metric: PageRank
View: Interactive Graph
```

### 3. Confounding Check
```
Goal: Ensure valid causal inference

Steps:
1. Identify X (treatment) and Y (outcome)
2. Click "🔀 Confounders"
3. Look for common causes of X and Y
4. Check for backdoor paths
5. Adjust for confounders

Layout: Force-Directed
Metric: Degree
View: Interactive Graph
```

### 4. Network Optimization
```
Goal: Find most efficient interventions

Steps:
1. Load full causal network
2. Click "📍 Central Nodes"
3. Identify high-leverage points
4. Use PageRank to prioritize
5. Target top nodes for maximum impact

Layout: Force-Directed
Metric: PageRank
View: Metrics Dashboard
```

### 5. Documentation
```
Goal: Create clear diagrams for reports

Steps:
1. Clean data (remove weak edges)
2. Use Hierarchical layout
3. Adjust for clarity
4. Export as SVG/PNG
5. Annotate in external tool

Layout: Hierarchical
Metric: Uniform
View: Interactive Graph
Export: SVG
```

---

## ⚡ Quick Command Reference

```javascript
// Programmatic Control

// Render graph
renderCausalGraphSVG();

// Change layout
updateGraphLayout('hierarchical');

// Filter by weight
filterCausalEdges(0.5);

// Select node
selectNode('nodeId');

// Calculate metrics
updateGraphMetrics();

// Find central nodes
findCentralNodes();

// Detect communities
detectCommunities();

// Export data
exportCausalGraphAdvanced();
```

---

**Version**: 1.0
**Last Updated**: 2025-10-23
**Print**: Single-page reference
