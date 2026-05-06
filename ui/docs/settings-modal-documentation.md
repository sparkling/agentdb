# AgentDB Agentic Marketing - Settings Modal Documentation

## Overview

A comprehensive settings/configuration modal has been added to the AgentDB agentic marketing demo at `/workspaces/agentdb-site/public/agentdb/examples/browser/agentic-marketing/index.html`.

## Features Added

### 1. Settings Button
- **Location**: Added in the button group around line 825
- **Icon**: ⚙️ Settings
- **Function**: Opens the settings configuration modal

### 2. Modal Structure

The settings modal includes **4 tabs** with extensive configuration options:

#### Tab 1: Database Config (🗄️)
- **Memory Mode Toggle**: Enable/disable in-memory mode
  - Default: `true` (enabled)
  - Help: In-memory mode is faster but data is lost on refresh

- **Backend Engine Dropdown**:
  - Options: WASM (Recommended), JavaScript
  - Default: `wasm`
  - Help: WASM is faster, JS is more compatible

- **Vector Dimensions Slider**:
  - Range: 128-1024 (step: 128)
  - Default: `384`
  - Help: Embedding size for pattern matching

- **Search Results Limit Slider**:
  - Range: 1-10
  - Default: `3`
  - Help: Max results from similarity search

- **Similarity Algorithm Dropdown**:
  - Options: Cosine Similarity, Euclidean Distance, Dot Product
  - Default: `cosine`
  - Help: Algorithm for vector similarity matching

#### Tab 2: Campaign Settings (📊)
- **Total Budget Input**:
  - Type: Number
  - Default: `$5000`
  - Range: $100-$100,000
  - Help: Total budget across all campaigns

- **Optimization Interval Slider**:
  - Range: 1-10 seconds
  - Default: `3s`
  - Help: How often to run optimization cycle

- **ROAS Threshold Slider**:
  - Range: 1.0x-5.0x (step: 0.1)
  - Default: `2.0x`
  - Help: Minimum ROAS to consider successful

- **CTR Threshold Slider**:
  - Range: 0.5%-10% (step: 0.5)
  - Default: `2.0%`
  - Help: Minimum CTR to consider successful

- **Auto-Reallocate Toggle**:
  - Default: `true` (enabled)
  - Help: Auto-reallocate budget every 5 cycles

- **A/B Test Duration Slider**:
  - Range: 5-50 cycles (step: 5)
  - Default: `10 cycles`
  - Help: How many cycles to run A/B tests

#### Tab 3: AI Configuration (🤖)
- **AI Provider Dropdown**:
  - Options: Google Gemini, OpenAI GPT-4, Anthropic Claude, None (Local only)
  - Default: `gemini`
  - Help: AI provider for optimization suggestions

- **Model Selection Dropdown**:
  - Options: Gemini Pro, GPT-4, Claude 3 Opus
  - Default: `gemini-pro`
  - Help: Specific model version to use

- **Temperature Slider**:
  - Range: 0.0-1.0 (step: 0.1)
  - Default: `0.7`
  - Help: Creativity vs consistency (0=deterministic, 1=creative)

- **Max Tokens Slider**:
  - Range: 100-4000 (step: 100)
  - Default: `1000`
  - Help: Maximum response length

- **Embedding Dimensions Dropdown**:
  - Options: 384 (Default), 768 (High Quality), 1536 (Ultra Quality)
  - Default: `384`
  - Help: Vector size for semantic embeddings

#### Tab 4: Advanced (SAFLA) (🧠)
- **Pattern Storage Toggle**:
  - Default: `true` (enabled)
  - Help: Store successful campaign patterns for future optimization
  - Feature: ReasoningBank pattern storage

- **Reflexion Episodes Toggle**:
  - Default: `true` (enabled)
  - Help: Store campaign performance with self-critique for learning

- **Causal Inference Toggle**:
  - Default: `true` (enabled)
  - Help: Discover and track cause-effect relationships

- **Learning Rate Slider**:
  - Range: 0.001-0.1 (step: 0.001)
  - Default: `0.01`
  - Help: How quickly to adapt to new patterns

- **Pattern Limit Slider**:
  - Range: 10-500 (step: 10)
  - Default: `100`
  - Help: Maximum patterns to store

- **Similarity Threshold Slider**:
  - Range: 0.1-1.0 (step: 0.05)
  - Default: `0.7`
  - Help: Minimum similarity to retrieve patterns

### 3. UI Components

#### Form Elements
- **Toggle Switches**: Custom-styled checkbox toggles with smooth animations
- **Range Sliders**: Live value display with visual feedback
- **Dropdowns**: Styled select elements matching the dark theme
- **Number Inputs**: Validated input fields with min/max constraints
- **Help Icons**: Tooltips (?) for each setting with explanations

#### Visual Design
- **Dark Theme**: Matches existing UI with HSL color scheme
- **Smooth Transitions**: All interactions have 0.2s-0.3s transitions
- **Responsive Layout**: Grid-based layout adapts to screen size
- **Form Validation**: Visual feedback for invalid inputs
- **Accessibility**: Proper labels, ARIA attributes, and keyboard navigation

### 4. JavaScript Functions

#### Core Functions
```javascript
showSettings()           // Open settings modal
closeSettings()          // Close settings modal
showSettingsTab(name)    // Switch between tabs
saveSettings()           // Save to localStorage and apply
resetSettings()          // Reset to defaults with confirmation
loadSettings()           // Load from localStorage on init
```

#### Settings Storage
- **Storage Key**: `agentdb-marketing-settings`
- **Format**: JSON object in localStorage
- **Persistence**: Settings survive page refreshes
- **Validation**: Input validation before saving

#### Default Values
All settings have sensible defaults defined in `defaultSettings` object:
```javascript
{
  memoryMode: true,
  backend: 'wasm',
  vectorDim: 384,
  searchLimit: 3,
  similarity: 'cosine',
  totalBudget: 5000,
  optimizeInterval: 3,
  roasThreshold: 2.0,
  ctrThreshold: 2.0,
  autoReallocate: true,
  abTestDuration: 10,
  aiProvider: 'gemini',
  aiModel: 'gemini-pro',
  temperature: 0.7,
  maxTokens: 1000,
  embeddingDim: 384,
  patternStorage: true,
  reflexion: true,
  causalInference: true,
  learningRate: 0.01,
  patternLimit: 100,
  similarityThreshold: 0.7
}
```

### 5. CSS Styling

#### New CSS Classes
- `.settings-form` - Form container with flex layout
- `.form-section` - Grouped form sections
- `.form-group` - Individual form fields
- `.form-label` - Field labels with help icons
- `.form-input` - Text/number inputs
- `.form-select` - Dropdown selects
- `.toggle-switch` - Custom toggle switches
- `.toggle-slider` - Toggle visual element
- `.range-group` - Range slider container
- `.range-value` - Live value display
- `.form-range` - Styled range inputs
- `.settings-footer` - Modal footer buttons
- `.button-reset` - Reset button styling
- `.form-help` - Help text styling
- `.form-grid` - Responsive grid layout
- `.help-icon` - Tooltip help icons

#### Theme Integration
- Consistent HSL color scheme: `hsl(0 0% X%)`
- Primary accent: `hsl(142 76% 50%)` (green)
- Background layers: 8%, 10%, 15%, 18%, 20%, 25%
- Smooth hover states and transitions

## Usage

### Opening Settings
Click the "⚙️ Settings" button in the Campaign Control Center or call:
```javascript
showSettings();
```

### Changing Settings
1. Open settings modal
2. Navigate to desired tab
3. Adjust settings using toggles, sliders, or dropdowns
4. Click "💾 Save Settings" to apply and persist

### Resetting Settings
1. Open settings modal
2. Click "🔄 Reset to Defaults"
3. Confirm in dialog
4. All settings revert to defaults

### Programmatic Access
```javascript
// Get current settings
console.log(currentSettings);

// Load settings
loadSettings();

// Check if setting is enabled
if (currentSettings.patternStorage) {
  // Pattern storage is enabled
}
```

## AgentDB API Showcase

The settings modal demonstrates AgentDB browser capabilities:

### Database Configuration
- **Memory Mode**: In-memory vs persistent storage
- **Backend Selection**: WASM vs JavaScript engines
- **Vector Dimensions**: Configurable embedding sizes
- **Similarity Algorithms**: Multiple distance metrics

### SAFLA Features
- **ReasoningBank**: Pattern storage toggle
- **Reflexion**: Self-critique episode tracking
- **Causal Inference**: Cause-effect relationship discovery
- **Learning Parameters**: Configurable learning rates and thresholds

### Performance Optimization
- **Search Limits**: Control result set sizes
- **Pattern Limits**: Manage memory usage
- **Similarity Thresholds**: Filter low-quality matches

## Best Practices

### For Users
1. **Start with defaults** - Only adjust if you understand the implications
2. **Increase budget gradually** - Don't jump from $5K to $100K
3. **Monitor performance** - Check if changes improve ROAS
4. **Enable all SAFLA features** - Pattern storage, Reflexion, and Causal Inference work together
5. **Adjust thresholds based on industry** - E-commerce may have different ROAS goals than B2B

### For Developers
1. **Validate all inputs** - Never trust user input
2. **Provide help text** - Explain each setting clearly
3. **Use sensible defaults** - Most users won't change settings
4. **Persist settings** - Use localStorage for convenience
5. **Show feedback** - Alert users when settings are saved
6. **Handle errors gracefully** - Catch and display localStorage errors

## Performance Tips

### Memory Management
- Lower `vectorDim` (128 or 256) for faster performance
- Reduce `patternLimit` if experiencing slowdowns
- Use `searchLimit` of 3-5 for optimal speed/quality balance

### Learning Optimization
- Start with `learningRate` of 0.01
- Increase `similarityThreshold` to 0.8+ for strict matching
- Enable `autoReallocate` for hands-free optimization

### AI Configuration
- Use `temperature` 0.7 for balanced creativity
- Set `maxTokens` 500-1000 for concise responses
- Choose appropriate `embeddingDim` based on quality needs

## Browser Compatibility

### Supported Browsers
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

### Required Features
- localStorage API
- CSS Grid and Flexbox
- CSS Custom Properties
- Modern JavaScript (ES6+)
- Input range styling

## Future Enhancements

### Potential Features
1. **Export/Import Settings** - JSON file download/upload
2. **Setting Presets** - Saved configurations (Aggressive, Conservative, Balanced)
3. **Real-time Preview** - Show impact before saving
4. **Setting History** - Undo/redo configuration changes
5. **Advanced Validation** - Warn about incompatible setting combinations
6. **Performance Metrics** - Show how settings affect speed/accuracy
7. **Guided Setup** - Wizard for first-time users
8. **API Keys Management** - Secure storage for AI provider keys

## File Structure

```
index.html
├── CSS (lines 756-1008)
│   ├── Settings form styles
│   ├── Toggle switch styles
│   ├── Range slider styles
│   └── Modal footer styles
│
├── HTML (lines 2860-3281)
│   ├── Settings modal overlay
│   ├── Tab navigation
│   ├── Tab 1: Database Config
│   ├── Tab 2: Campaign Settings
│   ├── Tab 3: AI Configuration
│   ├── Tab 4: Advanced SAFLA
│   └── Modal footer buttons
│
└── JavaScript (lines 1442-1666)
    ├── Default settings object
    ├── showSettings()
    ├── closeSettings()
    ├── showSettingsTab()
    ├── loadSettings()
    ├── saveSettings()
    ├── resetSettings()
    └── DOMContentLoaded listener
```

## Testing Checklist

- [ ] Settings button opens modal
- [ ] All 4 tabs switch correctly
- [ ] Toggle switches work
- [ ] Range sliders update values
- [ ] Dropdowns change selections
- [ ] Number inputs validate
- [ ] Save button persists to localStorage
- [ ] Reset button confirms and resets
- [ ] Close button/overlay closes modal
- [ ] Settings survive page refresh
- [ ] Invalid inputs show feedback
- [ ] Help icons show tooltips
- [ ] Mobile responsive layout
- [ ] Keyboard navigation works
- [ ] Settings apply to state

## Conclusion

The settings modal provides a comprehensive, user-friendly interface for configuring all aspects of the AgentDB agentic marketing demo. It showcases AgentDB's browser capabilities while maintaining the existing dark theme and professional UI design.

The implementation demonstrates:
- ✅ Modern UI/UX best practices
- ✅ Clean, maintainable code
- ✅ Comprehensive documentation
- ✅ localStorage persistence
- ✅ Form validation
- ✅ Responsive design
- ✅ Accessibility features
- ✅ AgentDB API showcase
