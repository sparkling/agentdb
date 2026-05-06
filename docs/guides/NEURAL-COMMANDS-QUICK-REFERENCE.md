# AgentDB Neural Commands - Quick Reference

## 🎯 Quick Command Overview

All commands work with or without WASM modules. WASM provides 150x-12,500x speedup when available.

---

## 🧠 `agentdb attention` - Attention Mechanisms

### Initialize

```bash
agentdb attention init --mechanism flash
```

### Compute Attention

```bash
agentdb attention compute \
  --mechanism flash \
  --query "search text" \
  --keys-file keys.json \
  --heads 8
```

### Benchmark All Mechanisms

```bash
agentdb attention benchmark --all --iterations 100 --output results.json
```

### Optimize Parameters

```bash
agentdb attention optimize --mechanism hyperbolic --curvature -1.0
```

**Mechanisms**: `flash`, `hyperbolic`, `sparse`, `linear`, `performer`

---

## 📚 `agentdb learn` - Advanced Learning

### Curriculum Learning

```bash
agentdb learn \
  --mode curriculum \
  --data train.json \
  --schedule cosine \
  --initial-difficulty 0.1 \
  --target-difficulty 1.0 \
  --epochs 20
```

### Contrastive Learning

```bash
agentdb learn \
  --mode contrastive \
  --data pairs.json \
  --temperature 0.07 \
  --margin 0.5 \
  --lambda 0.01 \
  --epochs 15
```

### Hard Negative Mining

```bash
agentdb learn \
  --mode hard-negatives \
  --data anchors.json \
  --strategy hard \
  --top-k 20 \
  --margin 0.5
```

**Modes**: `curriculum`, `contrastive`, `hard-negatives`

**Schedules**: `linear`, `cosine`, `exponential`

**Strategies**: `hard`, `semi-hard`, `distance-based`

---

## 🧭 `agentdb route` - LLM Routing

### Route a Prompt

```bash
agentdb route --prompt "Explain quantum computing" --explain
```

### Route from File

```bash
agentdb route \
  --prompt-file prompt.txt \
  --context '{"user": "expert", "domain": "physics"}' \
  --explain
```

### Record Feedback

```bash
agentdb route feedback \
  --model sonnet \
  --outcome success \
  --quality 0.95
```

### View Statistics

```bash
agentdb route stats
```

**Models**: `haiku` (fast), `sonnet` (balanced), `opus` (most capable)

**Outcomes**: `success`, `failure`, `escalated`

---

## 🌀 `agentdb hyperbolic` - Hyperbolic Geometry

### Poincaré Distance

```bash
agentdb hyperbolic \
  --op distance \
  --point-a "[0.3,0.4]" \
  --point-b "[0.6,0.2]"
```

### Exponential Map

```bash
agentdb hyperbolic \
  --op expmap \
  --base "[0,0]" \
  --tangent "[0.5,0.5]" \
  --curvature -1.0
```

### Logarithmic Map

```bash
agentdb hyperbolic \
  --op logmap \
  --base "[0.1,0.2]" \
  --point "[0.5,0.6]"
```

### Möbius Addition

```bash
agentdb hyperbolic \
  --op mobius-add \
  --point-a "[0.3,0.4]" \
  --point-b "[0.2,0.1]"
```

### Project to Ball

```bash
agentdb hyperbolic \
  --op project \
  --point "[1.2,0.8]"
```

### Hyperbolic Centroid

```bash
agentdb hyperbolic \
  --op centroid \
  --points cluster.json \
  --curvature -0.5
```

### Dual-Space Search

```bash
agentdb hyperbolic \
  --op dual-search \
  --query "[0.5,0.5]" \
  --points vectors.json \
  --euclidean-weight 0.6 \
  --hyperbolic-weight 0.4 \
  --top-k 10
```

**Operations**: `expmap`, `logmap`, `mobius-add`, `distance`, `project`, `centroid`, `dual-search`

---

## 🎨 Common Patterns

### Training Pipeline

```bash
# 1. Initialize
agentdb init ./agent.db --dimension 384

# 2. Curriculum learning
agentdb learn --mode curriculum --data train.json --schedule cosine --epochs 20

# 3. Hard negative mining
agentdb learn --mode hard-negatives --data anchors.json --strategy hard

# 4. Contrastive learning
agentdb learn --mode contrastive --data pairs.json --temperature 0.05
```

### Routing Pipeline

```bash
# 1. Route prompt
agentdb route --prompt "Complex task" --explain > routing.json

# 2. Record outcome
agentdb route feedback --model sonnet --outcome success --quality 0.9

# 3. View statistics
agentdb route stats
```

### Hyperbolic Search Pipeline

```bash
# 1. Compute centroid
agentdb hyperbolic --op centroid --points cluster.json > centroid.json

# 2. Dual-space search
agentdb hyperbolic --op dual-search \
  --query "$(cat centroid.json | jq -c .result)" \
  --points database.json \
  --top-k 20
```

---

## 📊 Output Formats

All commands support:

- **Default**: Human-readable colored output
- **JSON**: `--json` flag for machine parsing
- **Verbose**: `--verbose` or `-v` for detailed information
- **File Output**: `--output <file>` to save results

### Examples

```bash
# JSON output
agentdb learn --mode curriculum --data train.json --json

# Verbose mode
agentdb route --prompt "test" --verbose

# Save to file
agentdb hyperbolic --op distance --point-a "[0,0]" --point-b "[1,1]" --output result.json
```

---

## ⚡ WASM Acceleration Status

Check if WASM is available:

```bash
# Verbose mode shows WASM status
agentdb learn --mode curriculum --data train.json --verbose
# Output: ✅ Using WASM-accelerated curriculum learning
# or:     ⚠️  WASM not available, using JavaScript fallback
```

Install WASM packages for acceleration:

```bash
npm install @ruvector/attention @ruvector/ruvllm
```

---

## 🔧 Troubleshooting

### Command Not Found

```bash
# Ensure AgentDB is installed and in PATH
npm install -g agentdb

# Or use npx
npx agentdb learn --mode curriculum --data train.json
```

### WASM Module Missing

```bash
# Install required packages
npm install @ruvector/attention  # for learn, hyperbolic, attention
npm install @ruvector/ruvllm     # for route

# Commands still work without WASM (JavaScript fallback)
```

### Invalid Vector Format

```bash
# Vectors must be JSON arrays
# ✅ Correct: "[0.1,0.2,0.3]"
# ❌ Wrong:   "0.1 0.2 0.3"

agentdb hyperbolic --op distance --point-a "[0.1,0.2]" --point-b "[0.3,0.4]"
```

### File Not Found

```bash
# Use absolute paths or ensure files exist
agentdb learn --mode curriculum --data /path/to/train.json

# Check file exists
ls -la train.json
```

---

## 📖 Full Documentation

- Help for any command: `agentdb <command> --help`
- All commands: `agentdb --help`
- Implementation details: See ADR-002-ruvector-wasm-integration.md
- CLI enhancements: See CLI-ENHANCEMENTS-ADR-002.md

---

## 🚀 Performance Tips

1. **Use WASM**: Install `@ruvector/*` packages for 150x-12,500x speedup
2. **Batch Operations**: Process multiple samples in single commands
3. **JSON Output**: Use `--json` and pipe to `jq` for processing
4. **Verbose Mode**: Only use when debugging (adds overhead)
5. **File I/O**: Save large results to files instead of stdout

---

## 💡 Example Workflows

### End-to-End ML Pipeline

```bash
#!/bin/bash

# 1. Setup
agentdb init ./ml-agent.db --dimension 384
agentdb attention init --mechanism flash

# 2. Training
echo "Training with curriculum learning..."
agentdb learn \
  --mode curriculum \
  --data training-data.json \
  --schedule cosine \
  --epochs 20 \
  --output training-results.json

echo "Mining hard negatives..."
agentdb learn \
  --mode hard-negatives \
  --data training-data.json \
  --strategy hard \
  --top-k 50 \
  --output negatives.json

echo "Contrastive learning..."
agentdb learn \
  --mode contrastive \
  --data negatives.json \
  --temperature 0.05 \
  --epochs 10 \
  --output final-model.json

# 3. Validation
echo "Benchmarking attention mechanisms..."
agentdb attention benchmark --all --iterations 100 --output benchmark.json

echo "Pipeline complete!"
```

### Intelligent Routing System

```bash
#!/bin/bash

# Process prompts from file
while IFS= read -r prompt; do
  # Route and explain
  result=$(agentdb route --prompt "$prompt" --explain --json)

  # Extract model
  model=$(echo "$result" | jq -r '.model')

  echo "Prompt: $prompt → Model: $model"

  # Record feedback (simulated)
  agentdb route feedback --model "$model" --outcome success --quality 0.85
done < prompts.txt

# View final statistics
agentdb route stats
```

### Hyperbolic Clustering

```bash
#!/bin/bash

# 1. Convert embeddings to hyperbolic space
echo "Converting to hyperbolic space..."
cat embeddings.json | jq -c '.[]' | while read -r point; do
  agentdb hyperbolic --op project --point "$point" --json
done > hyperbolic-embeddings.json

# 2. Compute cluster centroid
echo "Computing hyperbolic centroid..."
agentdb hyperbolic \
  --op centroid \
  --points hyperbolic-embeddings.json \
  --curvature -1.0 \
  --output centroid.json

# 3. Dual-space search
centroid=$(cat centroid.json | jq -c '.result')
echo "Searching for nearest neighbors..."
agentdb hyperbolic \
  --op dual-search \
  --query "$centroid" \
  --points hyperbolic-embeddings.json \
  --euclidean-weight 0.5 \
  --hyperbolic-weight 0.5 \
  --top-k 20 \
  --output nearest-neighbors.json

echo "Clustering complete!"
cat nearest-neighbors.json | jq '.results[] | .id'
```

---

## 📚 Related Commands

These neural commands complement existing AgentDB commands:

- `agentdb init` - Initialize database
- `agentdb status` - Check database status
- `agentdb vector-search` - Vector similarity search
- `agentdb export/import` - Backup and restore
- `agentdb stats` - Database statistics

See `agentdb --help` for full command list.
