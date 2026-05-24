/**
 * Arch-test for ADR-0239 cluster 4.
 *
 * agentdb dead subtrees wrappers/compatibility/observability/search deleted (closes F-08-001 singleton)
 *
 * Trip-wire: re-adding any of the forbidden paths below sends the
 * matching it() RED. Generated from
 * ruflo-patch/lib/adr0239-arch-test-template.mjs — edit there to
 * change the template shape uniformly across clusters.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FORK_ROOT = resolve(__dirname, "../../");

describe('ADR-0239 cluster 4: agentdb dead subtrees wrappers/compatibility/observability/search deleted (closes F-08-001 singleton)', () => {
  it("src/wrappers must not exist", () => {
    const target = resolve(FORK_ROOT, "src/wrappers");
    expect(
      existsSync(target),
      `${target} should have been deleted (ADR-0239 cluster 4)`,
    ).toBe(false);
  });

  it("src/compatibility must not exist", () => {
    const target = resolve(FORK_ROOT, "src/compatibility");
    expect(
      existsSync(target),
      `${target} should have been deleted (ADR-0239 cluster 4)`,
    ).toBe(false);
  });

  it("src/observability must not exist", () => {
    const target = resolve(FORK_ROOT, "src/observability");
    expect(
      existsSync(target),
      `${target} should have been deleted (ADR-0239 cluster 4)`,
    ).toBe(false);
  });

  it("src/search must not exist", () => {
    const target = resolve(FORK_ROOT, "src/search");
    expect(
      existsSync(target),
      `${target} should have been deleted (ADR-0239 cluster 4)`,
    ).toBe(false);
  });
});
