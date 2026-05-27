// charter: encoder
// Global-scalar int8 encoder for graph-edge embedding payloads
// (ADR-0261 §R1.5 / §R2.3 — fork-native ADR-130 re-implementation).
//
// Mirror of upstream's actually-shipped encoder shape (NOT product quantization
// despite upstream's file name): single global min/max per vector, no
// subspaces, no centroids, no codebook. Dim is config-chain-driven, not
// hardcoded — encoder adapts to any embedding model the substrate is
// configured for.
//
// Payload layout (little-endian):
//   bytes  0..3   magic 'SQ\0\0' (0x53 0x51 0x00 0x00)
//   bytes  4..7   dim u32
//   bytes  8..11  min f32
//   bytes 12..15  max f32   -- NB: spec'd in ADR-0261 §R2.3 as "4B header + 8B (min/max float32) + configuredDim B"
//                              The 4B magic IS the header; min/max sit between dim and codes; total = 16 + dim
//   bytes 16..16+dim-1   int8 codes (one byte per dimension)
//
// Total size: `16 + configuredDim` bytes. For mpnet-768 = 784B.
//
// ADR-0261 §Decision Outcome (cross-checked) names the layout as
// "4B magic 'SQ\0\0' + 4B dim u32 + 4B min f32 + 4B max f32 + dim×1B codes"
// → total `12 + dim` bytes when counting only after the 4B magic, OR
// `16 + dim` counting all four 4-byte fields. The ADR §R2.3 ceiling phrase
// "4B header + 8B (min/max float32) + configuredDim B" — the 4B "header"
// here is the magic; the explicit dim field IS still emitted as the second
// 4B word. The 4 explicit 4B fields + dim bytes match upstream's shipped
// layout (4B magic + 4B dims + 4B min + 4B max + dim·1B = 16+dim total,
// 400B for 384-dim, 784B for 768-dim — both match upstream's documented
// ceilings).
//
// No fire-and-forget catches; no module-scope substrate handle cache.
// Throws on dim mismatch (no fallback).

import { getConfig } from '../core/config-chain.js';

const MAGIC = Uint8Array.from([0x53, 0x51, 0x00, 0x00]); // 'SQ\0\0'
const MAGIC_LEN = 4;
const HEADER_BYTES = 4 + 4 + 4 + 4; // magic + dim + min + max = 16

/** Default batch size when config-chain has no `graphEdges.batchSize`. ADR-0261 §R2.3 default 64. */
const DEFAULT_BATCH_SIZE = 64;

/**
 * Resolve the configured embedding dimension from config-chain. Single source
 * of truth — no hardcoded 768 / 384 fallback at the encoder level. Config-chain
 * itself defaults to mpnet-768 when no `.claude-flow/embeddings.json` is found
 * (per `reference-embedding-model`).
 */
function resolvedDim(): number {
  const cfg = getConfig();
  const dim = cfg.embedding.dimension;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(
      `scalar-int8-encoder: config-chain returned an invalid embedding dimension ${dim}; ` +
        'expected positive integer (e.g. 768 for mpnet, 384 for MiniLM).',
    );
  }
  return dim;
}

/**
 * Resolve the encoder batch size from config-chain.
 *
 * Reads `graphEdges.batchSize` directly from `.claude-flow/embeddings.json` via
 * the walk-up cache shared with `getConfig()`. The shared config-chain package
 * does not expose `graphEdges` as a typed surface yet (ADR-0261 §R2.3 footnote
 * — federation+graph-edges keys are planned additions); until it does we read
 * the same JSON file directly with a minimal walk-up. The accessor stays
 * fail-soft (default on missing key) but throws on malformed values so a
 * misconfigured number does not silently pick up the default.
 */
function resolvedBatchSize(): number {
  const v = readGraphEdgesKey<number>('batchSize');
  if (v === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(
      `scalar-int8-encoder: graphEdges.batchSize must be a positive integer, got ${String(v)}`,
    );
  }
  return v;
}

// ─── Local config-chain extension (graphEdges.* keys) ────────────────────────
// The shared `@claude-flow/config-chain` package only exposes the embedding
// triple today. ADR-0261 §R2.3 commits to graphEdges.* keys living in
// `.claude-flow/embeddings.json` (or sibling file). Until the shared package
// gains a typed surface for these, we read them directly via a minimal cached
// walk-up. Same file path conventions as the embedding chain accessor.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';

interface GraphEdgesConfig {
  readonly batchSize?: number;
  readonly sweep?: { readonly maxAgeDays?: number; readonly cadence?: string };
  readonly decay?: { readonly defaultRate?: number };
  readonly installationId?: string;
}

// Module-scope cached config — JSON only, not a substrate/DB handle. Mirrors
// the shared `@claude-flow/config-chain` package's singleton pattern; reset
// for tests via `resetGraphEdgesConfig()`. Not a violation of ADR-0202's
// no-module-scope-substrate-cache rule (which targets DB handles).
let graphEdgesCache: GraphEdgesConfig | null = null;
let graphEdgesResolved = false;

function loadGraphEdgesConfig(): GraphEdgesConfig {
  if (graphEdgesResolved && graphEdgesCache) return graphEdgesCache;
  // Walk up from cwd looking for `.claude-flow/embeddings.json`.
  let dir = process.cwd();
  let found: { graphEdges?: GraphEdgesConfig } | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(dir, '.claude-flow', 'embeddings.json');
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf-8');
      // Malformed JSON must fail loudly, not silently degrade to defaults.
      const parsed = JSON.parse(raw) as { graphEdges?: GraphEdgesConfig };
      found = parsed;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  graphEdgesCache = found?.graphEdges ?? {};
  graphEdgesResolved = true;
  return graphEdgesCache;
}

/** Reset for tests. Mirrors `resetConfig()` semantics from config-chain. */
export function resetGraphEdgesConfig(): void {
  graphEdgesCache = null;
  graphEdgesResolved = false;
}

function readGraphEdgesKey<T>(name: keyof GraphEdgesConfig): T | undefined {
  const cfg = loadGraphEdgesConfig();
  return cfg[name] as T | undefined;
}

/** Public accessor — used by sweep worker, handler, and tests for the same triple. */
export function getGraphEdgesConfig(): {
  readonly batchSize: number;
  readonly sweep: { readonly maxAgeDays: number; readonly cadence: string };
  readonly decay: { readonly defaultRate: number };
} {
  const raw = loadGraphEdgesConfig();
  return {
    batchSize: raw.batchSize ?? DEFAULT_BATCH_SIZE,
    sweep: {
      maxAgeDays: raw.sweep?.maxAgeDays ?? 90,
      cadence: raw.sweep?.cadence ?? '0 3 * * *',
    },
    decay: { defaultRate: raw.decay?.defaultRate ?? 0.01 },
  };
}

/**
 * Read the installation id from config-chain. Returns the configured value
 * when set, or `undefined` to let callers decide a stable fallback. ADR-0261
 * §R1.4 federation wire-up is deferred; callers today use the projectRoot
 * hash as a stable per-installation surrogate (see `handler` for the
 * derivation).
 */
export function getInstallationId(): string | undefined {
  return readGraphEdgesKey<string>('installationId');
}

// ─── Encoder primitives ──────────────────────────────────────────────────────

/**
 * Encode a single float32 embedding into the scalar-int8 payload format.
 *
 * Steps:
 *   1. Compute global min/max over the vector.
 *   2. Scale each element to int8 via `code = round((v - min) / (max - min) * 255) - 128`.
 *      Degenerate case (max === min): every code = 0.
 *   3. Pack `magic | dim | min | max | codes` into a `Uint8Array` of length 16 + dim.
 *
 * Throws on dim mismatch vs config-chain. No try/return; no fire-and-forget.
 */
export function encode(vec: Float32Array): Uint8Array {
  const dim = resolvedDim();
  if (vec.length !== dim) {
    throw new Error(
      `scalar-int8-encoder.encode: vector length ${vec.length} does not match configured dimension ${dim} ` +
        '(reset config-chain or re-init the substrate to switch models).',
    );
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < dim; i++) {
    const v = vec[i];
    if (!Number.isFinite(v)) {
      throw new Error(
        `scalar-int8-encoder.encode: vector contains non-finite value at index ${i}: ${String(v)}`,
      );
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const payload = new Uint8Array(HEADER_BYTES + dim);
  // Magic 'SQ\0\0'.
  payload.set(MAGIC, 0);
  // Dim u32 (little-endian) at offset 4.
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  dv.setUint32(4, dim, true);
  dv.setFloat32(8, min, true);
  dv.setFloat32(12, max, true);

  // Codes — degenerate max===min collapses to a flat zero payload.
  const range = max - min;
  const codes = new Uint8Array(payload.buffer, payload.byteOffset + HEADER_BYTES, dim);
  if (range === 0) {
    codes.fill(0);
  } else {
    for (let i = 0; i < dim; i++) {
      const normalized = (vec[i] - min) / range; // [0, 1]
      // Int8 range is [-128, 127]; we map [0,1] -> [-128, 127].
      const code = Math.round(normalized * 255) - 128;
      // Stored as unsigned byte in a Uint8Array; interpret-on-decode via Int8Array view.
      codes[i] = code & 0xff;
    }
  }
  return payload;
}

/**
 * Decode a scalar-int8 payload back into a Float32Array.
 *
 * Validates magic + dim header; throws on shape mismatch. Degenerate
 * range (max===min) reconstructs every element to `min` exactly.
 */
export function decode(payload: Uint8Array): Float32Array {
  if (payload.length < HEADER_BYTES) {
    throw new Error(
      `scalar-int8-encoder.decode: payload too short (${payload.length}B); ` +
        `header alone is ${HEADER_BYTES}B`,
    );
  }
  for (let i = 0; i < MAGIC_LEN; i++) {
    if (payload[i] !== MAGIC[i]) {
      throw new Error(
        `scalar-int8-encoder.decode: magic mismatch at byte ${i} ` +
          `(got 0x${payload[i].toString(16)}, expected 0x${MAGIC[i].toString(16)})`,
      );
    }
  }
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const dim = dv.getUint32(4, true);
  const min = dv.getFloat32(8, true);
  const max = dv.getFloat32(12, true);
  if (payload.length !== HEADER_BYTES + dim) {
    throw new Error(
      `scalar-int8-encoder.decode: payload length ${payload.length} does not match ` +
        `header dim ${dim} (expected ${HEADER_BYTES + dim}B)`,
    );
  }

  const out = new Float32Array(dim);
  const range = max - min;
  // Read each byte as signed int8 then map back to f32.
  const codesUnsigned = new Uint8Array(payload.buffer, payload.byteOffset + HEADER_BYTES, dim);
  if (range === 0) {
    for (let i = 0; i < dim; i++) out[i] = min;
    return out;
  }
  for (let i = 0; i < dim; i++) {
    // Interpret as signed int8: -128..127.
    const signed = (codesUnsigned[i] << 24) >> 24;
    const normalized = (signed + 128) / 255; // [0,1]
    out[i] = min + normalized * range;
  }
  return out;
}

/**
 * Encode many vectors in one call. Batch size from config-chain
 * (`graphEdges.batchSize`, default 64). Splits the input into chunks of that
 * size so encoder allocations stay bounded under high-volume writes; the
 * actual encode loop is identical per-vector, just sliced.
 */
export function encodeBatch(vecs: ReadonlyArray<Float32Array>): Uint8Array[] {
  const batchSize = resolvedBatchSize();
  const out: Uint8Array[] = new Array(vecs.length);
  for (let start = 0; start < vecs.length; start += batchSize) {
    const end = Math.min(start + batchSize, vecs.length);
    for (let i = start; i < end; i++) {
      out[i] = encode(vecs[i]);
    }
  }
  return out;
}

/**
 * Compute cosine similarity between two scalar-int8 payloads WITHOUT a full
 * float32 round-trip. Used by graph-query semantic mode and graph-pathfinder
 * temporal-centrality (ADR-0261 §R2.4 / §R2.9 footnote — upstream's
 * `embedding-quantization.ts:134` analogue).
 *
 * Reconstructs floats per-index inline (cheap arithmetic, no allocations
 * beyond the four header floats). Throws on shape mismatch — fail-loud per
 * `feedback-no-fallbacks`.
 *
 * Returns cosine ∈ [-1, 1]; degenerate zero-norm inputs return 0.
 */
export function inlineCosine(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `scalar-int8-encoder.inlineCosine: payload length mismatch (${a.length} vs ${b.length})`,
    );
  }
  if (a.length < HEADER_BYTES) {
    throw new Error(
      `scalar-int8-encoder.inlineCosine: payload too short (${a.length}B); header is ${HEADER_BYTES}B`,
    );
  }
  // Validate magic on both inputs (any caller-side corruption surfaces here).
  for (let i = 0; i < MAGIC_LEN; i++) {
    if (a[i] !== MAGIC[i]) {
      throw new Error(`scalar-int8-encoder.inlineCosine: magic mismatch on lhs at byte ${i}`);
    }
    if (b[i] !== MAGIC[i]) {
      throw new Error(`scalar-int8-encoder.inlineCosine: magic mismatch on rhs at byte ${i}`);
    }
  }
  const dvA = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const dvB = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dimA = dvA.getUint32(4, true);
  const dimB = dvB.getUint32(4, true);
  if (dimA !== dimB) {
    throw new Error(
      `scalar-int8-encoder.inlineCosine: dim mismatch (${dimA} vs ${dimB}); ` +
        'payloads from different encoder configurations cannot be compared.',
    );
  }
  const minA = dvA.getFloat32(8, true);
  const maxA = dvA.getFloat32(12, true);
  const minB = dvB.getFloat32(8, true);
  const maxB = dvB.getFloat32(12, true);
  const rangeA = maxA - minA;
  const rangeB = maxB - minB;
  const codesA = new Uint8Array(a.buffer, a.byteOffset + HEADER_BYTES, dimA);
  const codesB = new Uint8Array(b.buffer, b.byteOffset + HEADER_BYTES, dimB);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < dimA; i++) {
    const sa = (codesA[i] << 24) >> 24;
    const sb = (codesB[i] << 24) >> 24;
    const fa = rangeA === 0 ? minA : minA + ((sa + 128) / 255) * rangeA;
    const fb = rangeB === 0 ? minB : minB + ((sb + 128) / 255) * rangeB;
    dot += fa * fb;
    normA += fa * fa;
    normB += fb * fb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Payload byte length for the current config (16 + configured dim). Exposed
 * for invariants + tests so call sites do not re-derive the formula.
 */
export function payloadBytesForCurrentConfig(): number {
  return HEADER_BYTES + resolvedDim();
}

/**
 * Decode an `inline:base64(scalar-int8-payload)` `embedding_ref` cell back to
 * a Float32Array. ADR-0261 §R2 port-to-upstream alignment: the schema stores
 * `embedding_ref` as TEXT with the `inline:` prefix; consumers (cli's graph-
 * query semantic mode, graph-pathfinder temporal-centrality) call this helper
 * to round-trip back to floats.
 *
 * Returns `null` when `ref` is null/undefined; throws on prefix mismatch or
 * invalid magic (`feedback-no-fallbacks` — bad refs surface, not silently
 * skip).
 *
 * Imported by Agent B's `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/
 * agentdb-tools.ts` via `await import('agentdb/encoders/scalar-int8-encoder')`.
 */
export function decodeEmbedding(ref: string | null | undefined): Float32Array | null {
  if (ref === null || ref === undefined) return null;
  if (typeof ref !== 'string') {
    throw new Error(
      `scalar-int8-encoder.decodeEmbedding: embedding_ref must be string, got ${typeof ref}`,
    );
  }
  if (!ref.startsWith('inline:')) {
    throw new Error(
      `scalar-int8-encoder.decodeEmbedding: embedding_ref must start with 'inline:'; got ${ref.slice(0, 16)}`,
    );
  }
  // Decode base64 to bytes; Buffer.from doesn't throw on bad base64 — the
  // magic-byte check inside `decode()` is the load-bearing validation.
  const b64 = ref.slice('inline:'.length);
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error(
      `scalar-int8-encoder.decodeEmbedding: payload too short after base64 decode (${bytes.byteLength}B); ` +
        `header alone is ${HEADER_BYTES}B`,
    );
  }
  return decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
