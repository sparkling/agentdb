// charter: mutation-invariants
// Per-handler invariant tests for `ruvllm_microlora_adapt` (ADR-0231 Wave 2).
//
// Coverage:
//   1. `inputWellFormed` rejects missing / empty / non-finite input.
//   2. `inputIsNotAllZero` rejects all-zero input (Q-3 root cause —
//      pre-fork no-op bug per feedback-no-fallbacks) and accepts any vector
//      with ≥1 non-zero element.
//   3. `consolidateBoolean` rejects non-boolean `consolidate` and accepts
//      `true | false | undefined`.
//   4. All other pre-existing invariants (loraId, quality, learningRate,
//      success, loraIdEquality) still hold on a well-formed payload.
//
// Replay backwards-compat (ADR-0231 gap #1) is NOT exercised here — the
// replay code path lives in cli (`forks/ruflo`) via
// `cli/src/mcp-tools/ruvllm-store.ts`'s `loadMicroLoraStore`, NOT in
// agentdb. This fork's archivist handler is journal-append-only; the
// per-entry `input?` optionality on `RuvllmMicroLoraJournalEntry` is the
// only schema change needed here so cli's replay can skip-and-log legacy
// entries without a type error. Sister B3 owns the replay-skip in cli.

import { describe, it, expect } from 'vitest';
import { microLoraAdaptInvariants } from '../../../../src/archivist/invariants/ruvllm/microlora-adapt.js';
import type { RuvllmMicroLoraAdaptPayload } from '../../../../src/archivist/handlers/ruvllm/microlora-adapt.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function basePayload(overrides: Partial<RuvllmMicroLoraAdaptPayload> = {}): RuvllmMicroLoraAdaptPayload {
  return {
    loraId: 'lora-test',
    input: [0.1, 0.2, 0.3, 0.4],
    quality: 0.8,
    ...overrides,
  };
}

function runAll(payload: RuvllmMicroLoraAdaptPayload): Array<{ name: string; verdict: 'pass' | { violated: true; detail: string } }> {
  return microLoraAdaptInvariants.map((inv) => ({
    name: inv.name || 'anonymous',
    verdict: inv({
      callerIntent: payload,
      recordedPayload: payload,
      substrateStateBefore: undefined,
      substrateStateAfter: undefined,
    }),
  }));
}

function firstViolation(payload: RuvllmMicroLoraAdaptPayload): { name: string; detail: string } | null {
  for (const { name, verdict } of runAll(payload)) {
    if (typeof verdict === 'object' && verdict.violated === true) {
      return { name, detail: verdict.detail };
    }
  }
  return null;
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('ruvllm_microlora_adapt invariants (ADR-0231 Wave 2)', () => {
  describe('baseline', () => {
    it('well-formed payload passes ALL invariants', () => {
      const verdicts = runAll(basePayload());
      const violations = verdicts.filter((v) => typeof v.verdict === 'object');
      expect(violations).toEqual([]);
    });

    it('passes with optional fields populated (learningRate + success + consolidate)', () => {
      const verdicts = runAll(
        basePayload({ learningRate: 0.01, success: true, consolidate: true }),
      );
      const violations = verdicts.filter((v) => typeof v.verdict === 'object');
      expect(violations).toEqual([]);
    });
  });

  describe('inputWellFormed', () => {
    it('rejects missing input (undefined)', () => {
      // Force-cast to bypass the readonly type system — runtime defence.
      const payload = { ...basePayload(), input: undefined as unknown as ReadonlyArray<number> };
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/input must be an array/);
    });

    it('rejects empty input', () => {
      const payload = basePayload({ input: [] });
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/non-empty/);
    });

    it('rejects input containing NaN', () => {
      const payload = basePayload({ input: [0.1, Number.NaN, 0.3, 0.4] });
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/input\[1\] must be a finite number/);
    });

    it('rejects input containing Infinity', () => {
      const payload = basePayload({ input: [0.1, 0.2, Number.POSITIVE_INFINITY, 0.4] });
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/input\[2\] must be a finite number/);
    });
  });

  describe('inputIsNotAllZero (Q-3 root-cause guard)', () => {
    it('rejects all-zero input vector', () => {
      const payload = basePayload({ input: [0, 0, 0, 0] });
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/all-zero/);
      expect(v!.detail).toMatch(/ADR-0231/);
      expect(v!.detail).toMatch(/feedback-no-fallbacks/);
    });

    it('rejects single-element all-zero input', () => {
      const payload = basePayload({ input: [0] });
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/all-zero/);
    });

    it('accepts input with at least one non-zero element at any position', () => {
      // First position non-zero
      expect(firstViolation(basePayload({ input: [0.5, 0, 0, 0] }))).toBeNull();
      // Middle position non-zero
      expect(firstViolation(basePayload({ input: [0, 0, 0.5, 0] }))).toBeNull();
      // Last position non-zero
      expect(firstViolation(basePayload({ input: [0, 0, 0, -0.001] }))).toBeNull();
    });

    it('accepts negative non-zero values', () => {
      expect(firstViolation(basePayload({ input: [-0.1, -0.2, -0.3, -0.4] }))).toBeNull();
    });
  });

  describe('consolidateBoolean', () => {
    it('accepts consolidate: true', () => {
      expect(firstViolation(basePayload({ consolidate: true }))).toBeNull();
    });

    it('accepts consolidate: false', () => {
      expect(firstViolation(basePayload({ consolidate: false }))).toBeNull();
    });

    it('accepts consolidate: undefined (default)', () => {
      expect(firstViolation(basePayload({ consolidate: undefined }))).toBeNull();
    });

    it('rejects non-boolean consolidate', () => {
      // Force-cast to bypass the readonly type system.
      const payload = { ...basePayload(), consolidate: 'yes' as unknown as boolean };
      const v = firstViolation(payload);
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/consolidate must be a boolean/);
    });
  });

  describe('regression: pre-existing invariants still wired', () => {
    it('still rejects empty loraId', () => {
      const v = firstViolation(basePayload({ loraId: '' }));
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/loraId/);
    });

    it('still rejects quality > 1', () => {
      const v = firstViolation(basePayload({ quality: 1.5 }));
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/quality/);
    });

    it('still rejects learningRate > 1', () => {
      const v = firstViolation(basePayload({ learningRate: 2 }));
      expect(v).not.toBeNull();
      expect(v!.detail).toMatch(/learningRate/);
    });
  });
});
