# Settings Modal - Quick Reference

## 🚀 Quick Start

### Opening Settings
```javascript
// Click button or call:
showSettings();
```

### Saving Settings
1. Adjust settings
2. Click "💾 Save Settings"
3. Settings persist in localStorage

### Resetting Settings
```javascript
// Click "🔄 Reset to Defaults" or call:
resetSettings();
```

## 📋 All Settings at a Glance

### 🗄️ Database Config
| Setting | Type | Default | Range/Options |
|---------|------|---------|---------------|
| Memory Mode | Toggle | `true` | true/false |
| Backend | Dropdown | `wasm` | wasm, js |
| Vector Dimensions | Slider | `384` | 128-1024 |
| Search Limit | Slider | `3` | 1-10 |
| Similarity | Dropdown | `cosine` | cosine, euclidean, dot |

### 📊 Campaign Settings
| Setting | Type | Default | Range/Options |
|---------|------|---------|---------------|
| Total Budget | Number | `$5000` | $100-$100,000 |
| Optimize Interval | Slider | `3s` | 1-10 seconds |
| ROAS Threshold | Slider | `2.0x` | 1.0x-5.0x |
| CTR Threshold | Slider | `2.0%` | 0.5%-10% |
| Auto-Reallocate | Toggle | `true` | true/false |
| A/B Test Duration | Slider | `10` | 5-50 cycles |

### 🤖 AI Configuration
| Setting | Type | Default | Range/Options |
|---------|------|---------|---------------|
| AI Provider | Dropdown | `gemini` | gemini, openai, claude, none |
| Model | Dropdown | `gemini-pro` | gemini-pro, gpt-4, claude-3-opus |
| Temperature | Slider | `0.7` | 0.0-1.0 |
| Max Tokens | Slider | `1000` | 100-4000 |
| Embedding Dim | Dropdown | `384` | 384, 768, 1536 |

### 🧠 SAFLA Advanced
| Setting | Type | Default | Range/Options |
|---------|------|---------|---------------|
| Pattern Storage | Toggle | `true` | true/false |
| Reflexion | Toggle | `true` | true/false |
| Causal Inference | Toggle | `true` | true/false |
| Learning Rate | Slider | `0.01` | 0.001-0.1 |
| Pattern Limit | Slider | `100` | 10-500 |
| Similarity Threshold | Slider | `0.7` | 0.1-1.0 |

## 🎯 Common Use Cases

### Maximize Performance
```javascript
{
  memoryMode: true,        // ✓ Faster
  backend: 'wasm',         // ✓ Faster
  vectorDim: 256,          // ✓ Lower = faster
  searchLimit: 3,          // ✓ Lower = faster
  patternLimit: 50         // ✓ Lower = faster
}
```

### Maximize Quality
```javascript
{
  vectorDim: 1024,         // ✓ Higher = better
  searchLimit: 10,         // ✓ More results
  embeddingDim: 1536,      // ✓ Better embeddings
  patternLimit: 500,       // ✓ More patterns
  similarityThreshold: 0.9 // ✓ Stricter matching
}
```

### Aggressive Campaign
```javascript
{
  totalBudget: 10000,      // ✓ Higher budget
  roasThreshold: 1.5,      // ✓ Lower threshold
  ctrThreshold: 1.0,       // ✓ Lower threshold
  autoReallocate: true,    // ✓ Auto-optimize
  optimizeInterval: 2      // ✓ Faster cycles
}
```

### Conservative Campaign
```javascript
{
  totalBudget: 2000,       // ✓ Lower budget
  roasThreshold: 3.0,      // ✓ Higher threshold
  ctrThreshold: 3.0,       // ✓ Higher threshold
  autoReallocate: false,   // ✓ Manual control
  optimizeInterval: 5      // ✓ Slower cycles
}
```

## 💾 localStorage Key
```javascript
localStorage.getItem('agentdb-marketing-settings');
// Returns: JSON object with all settings
```

## 🔧 JavaScript API

### Read Setting
```javascript
currentSettings.totalBudget     // 5000
currentSettings.patternStorage  // true
```

### Check if Enabled
```javascript
if (currentSettings.reflexion) {
  // Reflexion is enabled
}
```

### Manual Save
```javascript
saveSettings(); // Validates and saves
```

### Manual Load
```javascript
loadSettings(); // Loads into form
```

## 🎨 CSS Classes Reference

### Form Elements
- `.settings-form` - Form container
- `.form-section` - Section wrapper
- `.form-group` - Input group
- `.form-label` - Label text
- `.form-input` - Text/number input
- `.form-select` - Dropdown
- `.form-range` - Range slider

### Toggle Switch
- `.toggle-switch` - Switch container
- `.toggle-slider` - Visual slider
- `.toggle-label` - Label text

### Range Slider
- `.range-group` - Slider container
- `.range-header` - Header with value
- `.range-value` - Live value display
- `.range-labels` - Min/max labels

### Other
- `.help-icon` - Help tooltip
- `.form-help` - Help text
- `.settings-footer` - Modal footer

## 📱 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Navigate form fields |
| `Enter` | Save settings (when focused) |
| `Esc` | Close modal |
| `Space` | Toggle switches/checkboxes |
| `←/→` | Adjust sliders |

## 🐛 Troubleshooting

### Settings Not Saving
1. Check browser console for errors
2. Verify localStorage is enabled
3. Check for quota exceeded error
4. Try clearing localStorage

### Settings Not Loading
1. Check if `agentdb-marketing-settings` exists in localStorage
2. Verify JSON is valid
3. Check browser console for parse errors
4. Try resetting to defaults

### Visual Issues
1. Clear browser cache
2. Check CSS is loaded
3. Verify no CSS conflicts
4. Try different browser

## 🎯 Best Practices

### Performance
- Start with defaults
- Lower `vectorDim` for speed
- Reduce `searchLimit` to 3-5
- Use `memoryMode: true`
- Choose `backend: 'wasm'`

### Quality
- Increase `similarityThreshold` to 0.8+
- Use higher `embeddingDim`
- Enable all SAFLA features
- Increase `patternLimit`

### Campaigns
- Test with small budgets first
- Adjust thresholds based on industry
- Enable `autoReallocate`
- Monitor patterns learned
- Review console logs

## 📊 Validation Rules

| Field | Validation |
|-------|-----------|
| Total Budget | $100 - $100,000 |
| Vector Dim | 128, 256, 384, 512, 640, 768, 896, 1024 |
| Search Limit | 1-10 |
| Optimize Interval | 1-10 seconds |
| ROAS Threshold | 1.0x-5.0x |
| CTR Threshold | 0.5%-10% |
| Temperature | 0.0-1.0 |
| Max Tokens | 100-4000 |
| Learning Rate | 0.001-0.1 |
| Pattern Limit | 10-500 |
| Similarity Threshold | 0.1-1.0 |

## 🔗 Related Files

- **Main File**: `public/agentdb/examples/browser/agentic-marketing/index.html`
- **Documentation**: `docs/settings-modal-documentation.md`
- **Summary**: `docs/SETTINGS_IMPLEMENTATION_SUMMARY.md`

## 💡 Tips

1. **Always save**: Changes only apply after clicking "Save Settings"
2. **Check defaults**: Reset button shows original values
3. **Read tooltips**: Hover over ? icons for explanations
4. **Test thoroughly**: Try different combinations
5. **Monitor console**: Watch for settings-related logs
6. **Use presets**: Create your own saved configurations

## 🚀 Quick Commands

```javascript
// Open settings
showSettings();

// Close settings
closeSettings();

// Switch tab
showSettingsTab('database');  // or 'campaign', 'ai', 'safla'

// Save
saveSettings();

// Reset
resetSettings();

// Check current
console.log(currentSettings);

// Clear all
localStorage.removeItem('agentdb-marketing-settings');
```

---

**Last Updated**: Implementation complete
**Version**: 1.0.0
**Status**: Production Ready ✓
