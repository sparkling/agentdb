# 🧪 Testing Guide - Strategic AI War Games

## Quick Browser Test

### 1. Open the Demo
```bash
# Option A: Simple HTTP server
cd examples
python3 -m http.server 8000

# Then open: http://localhost:8000/strategic-ai-wargames.html
```

```bash
# Option B: Direct file
# Simply open strategic-ai-wargames.html in Chrome/Firefox/Edge
```

### 2. Browser Console Checks

Open DevTools (F12) and verify these logs appear:

```
✓ ⚡ Strategic AI War Games v1.0 Initializing...
✓ Waiting for AgentDB v1.3.9 to load...
✓ AgentDB v1.3.9 script loaded, waiting for initialization...
✓ Initializing AgentDB v1.3.9 WASM with ReasoningBank...
✓ AgentDB v1.3.9 initialized with full schema
✓ ReasoningBank SAFLA ready for pattern learning
✓ 🧠 Advanced features: Reflexion + Causal Inference available
✓ ✓ Database API verified and ready
✓ Battlefield initialized: 10x10 grid
✓ 3 AI agents deployed to battlefield
✓ ✓ All systems online. Ready for combat.
```

### 3. Feature Testing Checklist

#### Basic Functionality
- [ ] Page loads without errors
- [ ] Green terminal aesthetic visible
- [ ] Scanline effect animating
- [ ] 10x10 grid rendered
- [ ] 3 agent cards showing stats
- [ ] System status shows "ONLINE"

#### UI Controls
- [ ] START WAR button works
- [ ] STOP button disables during pause
- [ ] GAME THEORY button triggers scenarios
- [ ] ANALYZE button shows patterns
- [ ] CONFIG opens settings modal
- [ ] RESET clears battlefield
- [ ] ? button opens help modal

#### Simulation
- [ ] Agents appear on grid (colored cells)
- [ ] Turn counter increments
- [ ] Agents expand territory
- [ ] Conflicts detected and resolved
- [ ] Resources increase over time
- [ ] Console logs AI decisions

#### Advanced Features
- [ ] Achievements unlock (try first conflict)
- [ ] Special events trigger (meteor, resources)
- [ ] Explosion effects on conflicts
- [ ] Combo counter for rapid conflicts
- [ ] Pattern learning logs appear
- [ ] Causal edges tracked

#### Modals
- [ ] Help modal has 4 tabs
- [ ] Settings modal has 3 tabs
- [ ] All tabs switch correctly
- [ ] Settings save and apply
- [ ] Close buttons work

#### Console Output
- [ ] Color-coded messages
- [ ] Timestamps on each line
- [ ] Different message types (system, strategy, conflict, learn)
- [ ] Clear button works
- [ ] Auto-scroll to bottom

## 🎯 Automated Tests (Browser Console)

Copy/paste into browser console after page loads:

```javascript
// Test 1: Verify AgentDB loaded
console.assert(typeof AgentDB !== 'undefined', 'AgentDB loaded');
console.assert(AgentDB.ready === true, 'AgentDB ready');

// Test 2: Verify state initialized
console.assert(state.db !== null, 'Database initialized');
console.assert(state.agents.length === 3, 'Three agents created');
console.assert(state.gridSize === 10, 'Grid size correct');

// Test 3: Verify agents
state.agents.forEach(agent => {
  console.assert(agent.territory > 0, `${agent.name} has territory`);
  console.assert(agent.resources === 100, `${agent.name} has resources`);
});

// Test 4: Verify battlefield
let cellCount = 0;
state.battlefield.forEach(row => {
  row.forEach(cell => {
    if (cell) cellCount++;
  });
});
console.assert(cellCount === 3, 'Initial territories set');

// Test 5: Run simulation for 5 turns
let initialConflicts = state.totalConflicts;
startSimulation();
setTimeout(() => {
  stopSimulation();
  console.assert(state.turnCount >= 5, 'Simulation ran');
  console.assert(state.totalConflicts >= initialConflicts, 'Conflicts occurred');
  console.log('✅ All automated tests passed!');
}, 7500);
```

## 🔍 Advanced Testing

### Performance Test
```javascript
// Measure FPS during simulation
let frameCount = 0;
let lastTime = performance.now();

function measureFPS() {
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = now;
  }
  if (state.isRunning) {
    requestAnimationFrame(measureFPS);
  }
}

startSimulation();
requestAnimationFrame(measureFPS);
```

### Memory Test
```javascript
// Monitor memory usage
setInterval(() => {
  if (performance.memory) {
    const used = performance.memory.usedJSHeapSize / 1048576;
    console.log(`Memory: ${used.toFixed(2)} MB`);
  }
}, 5000);
```

### Pattern Learning Test
```javascript
// Force pattern learning
async function testPatternLearning() {
  console.log('Testing pattern learning...');

  // Run 50 turns to generate patterns
  startSimulation();

  setTimeout(async () => {
    stopSimulation();
    await analyzeStrategies();

    console.log(`Patterns learned: ${state.strategiesLearned}`);
    console.log(`Causal edges: ${state.causalEdges.length}`);
    console.log('✅ Pattern learning test complete');
  }, 75000); // 50 turns * 1.5s
}

testPatternLearning();
```

### Achievement Test
```javascript
// Test achievement system
async function testAchievements() {
  console.log('Testing achievements...');

  // Force first blood
  state.totalConflicts = 0;
  state.totalConflicts = 1;
  checkAchievements();

  // Force war lord
  state.totalConflicts = 10;
  checkAchievements();

  // Force strategist
  state.strategiesLearned = 50;
  checkAchievements();

  console.log(`Achievements unlocked: ${state.achievements.size}`);
  console.log('✅ Achievement test complete');
}

testAchievements();
```

### Special Events Test
```javascript
// Force special events
function testSpecialEvents() {
  console.log('Testing special events...');

  // Force meteor strike
  const events = [
    { name: 'METEOR', emoji: '☄️' },
    { name: 'RESOURCE', emoji: '💎' },
    { name: 'TECH', emoji: '🚀' },
    { name: 'REBELLION', emoji: '⚡' }
  ];

  events.forEach((event, i) => {
    setTimeout(() => {
      triggerSpecialEvent();
      console.log(`Triggered event ${i + 1}/4`);
    }, i * 2000);
  });

  setTimeout(() => {
    console.log('✅ Special events test complete');
  }, 10000);
}

testSpecialEvents();
```

## 🐛 Common Issues

### Issue: AgentDB not loading
**Symptoms**: Console shows "AgentDB is not defined"
**Fix**: Check internet connection for CDN access

### Issue: WASM not initializing
**Symptoms**: "WASM initialization failed"
**Fix**: Use modern browser (Chrome 90+, Firefox 88+, Edge 90+)

### Issue: Simulation freezing
**Symptoms**: Turn counter stops
**Fix**: Check browser console for errors, try reducing grid size

### Issue: No patterns learned
**Symptoms**: Strategy count stays at 0
**Fix**: Run simulation for 10+ turns, patterns need conflicts

### Issue: Achievements not unlocking
**Symptoms**: Achievement area empty
**Fix**: Check console for errors, verify conditions are met

## ✅ Expected Behavior

### Normal Simulation
- Turn counter increments every 1.5s (default)
- Agents expand by 1-2 cells per turn
- 1-3 conflicts per 10 turns
- Resources increase gradually
- Patterns learned every 5-10 conflicts

### Game Theory Scenarios
- Prisoner's Dilemma: 3 pairs tested
- Nash Equilibrium: Current state analyzed
- Coalition: Forms when one agent dominates

### Pattern Learning
- First patterns appear after 5+ conflicts
- Learning accelerates with more data
- Similar situations retrieve past patterns
- Win rate improves over time

## 📊 Success Metrics

After 100 turns, you should see:
- ✓ 10+ conflicts resolved
- ✓ 5+ patterns learned
- ✓ 2+ achievements unlocked
- ✓ 1+ special event triggered
- ✓ Coalition formed or attempted
- ✓ Territory changes hands multiple times

## 🎓 Educational Testing

Use these scenarios to teach AI concepts:

### Scenario 1: Pattern Recognition
1. Run for 20 turns
2. Click ANALYZE
3. Show pattern similarity scores
4. Explain vector embeddings

### Scenario 2: Game Theory
1. Click GAME THEORY
2. Watch Prisoner's Dilemma
3. Explain Nash Equilibrium
4. Show coalition formation

### Scenario 3: Causal Inference
1. Run for 30 turns
2. Check console for causal edges
3. Explain cause → effect relationships
4. Show strategy effectiveness

### Scenario 4: Reflexion Learning
1. Let agents learn for 50 turns
2. Compare early vs late strategies
3. Show self-critique in console
4. Demonstrate improvement

## 🔬 Research Use

For testing AI algorithms:

```javascript
// Custom agent behavior
state.agents[0].riskTolerance = 1.0; // Max aggression
state.agents[1].riskTolerance = 0.0; // Max defense

// Custom learning rate
state.settings.learningRate = 0.5; // High learning

// Fast simulation
state.settings.speed = 100; // 10x faster

// Large battlefield
state.settings.gridSize = 15;
resetSimulation();
```

## 📈 Performance Benchmarks

Target performance on modern hardware:
- **Page load**: < 2s
- **AgentDB init**: < 500ms
- **Turn processing**: < 100ms
- **Pattern search**: < 50ms
- **Memory usage**: < 50MB
- **FPS**: 60 (smooth animations)

---

**Happy Testing! May your tests pass and your agents learn! 🤖**
