/**
 * WASM Helper Utilities
 * AgentDB v1.0.1
 */

/**
 * Check if browser supports WebAssembly
 */
export function checkWasmSupport(): boolean {
  try {
    if (
      typeof WebAssembly === 'object' &&
      typeof WebAssembly.instantiate === 'function'
    ) {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
      );
      return module instanceof WebAssembly.Module;
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * Check required browser features
 */
export function checkRequiredFeatures() {
  return {
    wasm: checkWasmSupport(),
    localStorage: typeof localStorage !== 'undefined',
    workers: typeof Worker !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    // v1.0.1: WASM bundled with package
    bundledWasm: true,
    offlineCapable: checkWasmSupport() && 'serviceWorker' in navigator,
  };
}

/**
 * Format file size in human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Get difficulty badge color classes
 */
export function getDifficultyColor(difficulty: string): string {
  const colors = {
    beginner: 'bg-green-500/10 text-green-500 border-green-500/20',
    intermediate: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    advanced: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    expert: 'bg-red-500/10 text-red-500 border-red-500/20',
  };
  return colors[difficulty as keyof typeof colors] || '';
}

/**
 * Get category badge color classes
 */
export function getCategoryColor(category: string): string {
  const colors = {
    standard: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
    advanced: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    exotic: 'bg-pink-500/10 text-pink-500 border-pink-500/20',
  };
  return colors[category as keyof typeof colors] || '';
}
