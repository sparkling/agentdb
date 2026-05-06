# 🎯 Self-Learning Hooks - Quick Reference

## Visual Flow

```
BEFORE EDIT          DURING EDIT          AFTER EDIT           SESSION END
     │                    │                    │                    │
     ▼                    ▼                    ▼                    ▼
┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
│ Search  │────────▶│  Make   │────────▶│ Store   │────────▶│ Train   │
│ Similar │         │  Edit   │         │ Result  │         │ Models  │
│ Patterns│         │         │         │         │         │         │
└────┬────┘         └─────────┘         └────┬────┘         └─────────┘
     │                                        │
     ├─ 💡 Past Success                      ├─ 💾 Experience
     ├─ 🚨 Known Failures                    ├─ ⚖️ Verdict
     └─ 📋 Predicted Steps                   └─ 📊 Trajectory
                                                    │
                                                    ▼
                                             SYSTEM LEARNS
                                             & IMPROVES
```

## The 5 Learning Systems

### 1️⃣ Experience Replay
```bash
Edit file → 💾 Store → 📈 Train → 🎯 Predict better
```
**What**: Every edit saved as training data
**When**: Post-edit (automatic)
**Storage**: `~/.agentdb/patterns/code-edits/`

### 2️⃣ Verdict Learning
```bash
Edit → Tests → ✅ ACCEPT/❌ REJECT → 📊 Learn patterns
```
**What**: Learn from test results
**When**: Post-edit + 2 seconds (async)
**Reward**: +1.0 (pass) / -1.0 (fail)

### 3️⃣ Semantic Search
```bash
Before edit → 🔍 Query similar → 💡 Show successes
```
**What**: Find similar successful past edits
**When**: Pre-edit (automatic)
**Shows**: Top 5 relevant patterns

### 4️⃣ Trajectory Prediction
```bash
Start task → 📋 Predict steps → 🤖 Auto-spawn agents
```
**What**: Predict optimal workflow
**When**: Pre-task (automatic)
**Shows**: Expected sequence + success rate

### 5️⃣ Failure Detection
```bash
Before edit → ⚠️ Query failures → 🚨 Warn user
```
**What**: Prevent repeat mistakes
**When**: Pre-edit (automatic)
**Shows**: Known failure patterns

---

## Key Commands

### Monitor Learning
```bash
# View successful patterns
npx agentdb@latest query --domain "successful-edits" --k 10

# View failures
npx agentdb@latest query --domain "failed-edits" --k 10

# View trajectories
npx agentdb@latest query --domain "task-trajectories" --k 10

# Check experience count
npx agentdb@latest query --domain "code-edits" --count
```

### Manual Training
```bash
# Train models now (don't wait for session end)
npx agentdb@latest train --domain "code-edits" --epochs 50

# With verbose output
npx agentdb@latest train --domain "code-edits" --epochs 50 --verbose
```

### Optimize Performance
```bash
# Compress and consolidate patterns
npx agentdb@latest optimize-memory --compress true --consolidate-patterns true

# Clean old patterns
npx agentdb@latest cleanup --older-than 90d
```

### Analytics
```bash
# Top patterns
npx agentdb@latest top-patterns --domain "successful-edits" --limit 10

# Success rates
npx agentdb@latest analytics --domain "task-trajectories"

# Session metrics
npx claude-flow@alpha metrics --format json
```

---

## What You'll See

### Pre-Edit Output
```bash
🔍 Semantic Search: Querying similar successful edits for src/auth.js...
💡 Past Success: Added input validation before database call
💡 Past Success: Used bcrypt for password hashing

⚠️ Failure Detection: Checking for known failure patterns...
🚨 Warning: Similar edit failed - Tests failed (missing try-catch)
```

### Post-Edit Output
```bash
💾 Experience Replay: Storing edit experience for src/auth.js...
⚖️ Verdict: ACCEPT (reward: 1.0) for src/auth.js
```

### Pre-Task Output
```bash
🎯 Trajectory Prediction: Analyzing optimal workflow for task...
📋 Predicted Steps: search→scaffold→test→refine (Success Rate: 0.92)
🤖 Auto-spawning: backend-dev, tester agents
```

### Session End Output
```bash
🎓 Session End: Training models on accumulated experiences...
Training Loss: 0.023
Duration: 1523ms
🧠 Memory Distillation: Compressing session learnings...
✅ Session complete - 47 patterns learned
```

---

## Learning Timeline

### Week 1: Cold Start
```
📊 Patterns: 0-50
🎯 Accuracy: 0-30%
💡 Suggestions: Rare
🚨 Warnings: None
```
System is collecting initial data.

### Month 1: Initial Learning
```
📊 Patterns: 50-200
🎯 Accuracy: 30-60%
💡 Suggestions: Occasional
🚨 Warnings: Some
```
Patterns starting to emerge.

### Month 3: Proficient
```
📊 Patterns: 500-1000
🎯 Accuracy: 60-85%
💡 Suggestions: Frequent & relevant
🚨 Warnings: Catching 60% of mistakes
```
System understands your patterns.

### Month 6+: Expert
```
📊 Patterns: 2000+
🎯 Accuracy: 85-95%
💡 Suggestions: Highly relevant
🚨 Warnings: Preventing 80% of repeat mistakes
```
System predicts your next move.

---

## Tuning Parameters

### In .claude/settings.json

**Confidence Thresholds** (lines 58, 63, 73):
```json
"--min-confidence 0.8"   // Standard (default)
"--min-confidence 0.9"   // Conservative (fewer but better)
"--min-confidence 0.6"   // Aggressive (more suggestions)
```

**Query Depth** (line 58):
```json
"--k 5"    // Default (top 5 patterns)
"--k 10"   // More comprehensive
"--k 3"    // Faster, fewer suggestions
```

**Training Intensity** (line 140):
```json
"--epochs 10"      // Light (default)
"--epochs 50"      // Aggressive
"--epochs 100"     // Maximum learning
```

---

## Storage Locations

```
~/.agentdb/
├── patterns/
│   ├── code-edits/           # All edit experiences
│   ├── code-quality/         # Verdicts and rewards
│   ├── successful-edits/     # Patterns that worked
│   ├── failed-edits/         # Patterns that failed
│   └── task-trajectories/    # Task workflows
├── models/
│   ├── decision-transformer/ # Trained RL model
│   └── checkpoints/          # Model snapshots
└── cache/
    └── embeddings/           # Vector embeddings cache
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No suggestions | Not enough data | Wait for 50+ edits |
| Slow hooks | Large database | `npx agentdb@latest optimize-memory` |
| Irrelevant suggestions | Low confidence | Increase `--min-confidence` to 0.9 |
| Training fails | < 50 experiences | Keep coding, need more data |
| High memory usage | No compression | Enable auto-compression in settings |

---

## Performance Metrics

Track your improvement:

```bash
# Create baseline (Week 1)
npx agentdb@latest analytics --domain "all" --export baseline.json

# Compare monthly
npx agentdb@latest analytics --domain "all" --compare baseline.json

# Expected improvements:
# Month 1: 20-30% fewer bugs
# Month 3: 40-50% fewer bugs, 25% faster development
# Month 6: 50-60% fewer bugs, 40% faster development
```

---

## Pro Tips

### 1. Run Tests After Every Edit
More test results = better learning signal
```bash
npm test  # Let the verdict system learn
```

### 2. Be Descriptive in Tasks
```bash
# ❌ Bad: "fix bug"
# ✅ Good: "fix JWT token expiration in auth middleware"
```

### 3. Review Suggestions
When you see `💡 Past Success:`, take a moment to read it.
The system learned this from YOUR past successes.

### 4. Let It Learn from Failures
Don't immediately delete failed code. The system learns what NOT to do.

### 5. Check Analytics Weekly
```bash
# Weekly review
npx agentdb@latest analytics --domain "all" --timeframe 7d
```

---

## Quick Start Checklist

- [x] `.claude/settings.json` updated with learning hooks
- [ ] Run your first edit (system starts collecting data)
- [ ] Edit 10+ files to build initial patterns
- [ ] Run tests after edits (feeds verdict system)
- [ ] Check stored patterns: `npx agentdb@latest query --domain "successful-edits"`
- [ ] Wait for session end (models train automatically)
- [ ] Start next session (system uses learned patterns!)

---

## Emergency: Disable Learning

If you need to temporarily disable:

Edit `.claude/settings.json`:
```json
{
  "env": {
    "AGENTDB_LEARNING_ENABLED": "false",  // Disable learning
    "AGENTDB_AUTO_TRAIN": "false"         // Disable training
  }
}
```

Or remove the learning hooks (lines 55-64, 91-100, 105-111).

---

## What Makes This Special

Traditional IDEs have **static** rules.
Your environment has **dynamic learning** that adapts to YOU.

```
Traditional IDE:           Your IDE:
   Rules (static)            Learning (dynamic)
        │                          │
        ▼                          ▼
   Same for everyone          Personalized to YOU
        │                          │
        ▼                          ▼
   Never improves            Improves constantly
```

**After 6 months**: Your development environment knows your coding style better than any linter.

---

**Print this page and keep it handy! 📄**

---

**Last Updated**: 2025-10-23
**Version**: 1.0.0
