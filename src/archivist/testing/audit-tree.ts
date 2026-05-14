// charter: testing-surface
// Audit-tree shape + helpers for re-entrancy and Phase 9 Scenario A/C assertions.
// One AuditEntry can be viewed two ways: flat (chronological) and tree (parent/child
// per ctx.child(reason)). Both views are required by ADR-0180 Follow-up #20:
// flat for back-compat, tree for Scenario A (NightlyLearner depth ≤ 3) and
// Scenario C (MemoryConsolidation 10×4 cascade shape).

import type { AuditEntry } from '../audit-types.js';

export type AuditNodeMode = 'sequential' | 'parallel';

/**
 * Tree node attached to a single audit entry. The root represents the outer
 * MutationContext; each child represents one ctx.child(reason) descent.
 * `mode` distinguishes sequential descent (default) from parallel fan-out;
 * Scenario A/C handlers do not currently fan out in parallel — the field is
 * future-proofing for inter-controller orchestrators (Phase 8).
 */
export interface AuditNode {
  readonly entry: AuditEntry;
  readonly children: AuditNode[];
  readonly mode: AuditNodeMode;
}

/** Maximum depth from `node` to any leaf, counting `node` itself as depth 1. */
export function treeDepth(node: AuditNode): number {
  if (node.children.length === 0) return 1;
  let max = 0;
  for (const child of node.children) {
    const d = treeDepth(child);
    if (d > max) max = d;
  }
  return 1 + max;
}

/**
 * Depth-first pre-order traversal returning all entries in encounter order.
 * Mirrors the chronological flat `audit` view when no parallel children exist;
 * for `mode: 'parallel'` siblings the order matches insertion, not wall-clock.
 */
export function flattenTree(node: AuditNode): AuditEntry[] {
  const out: AuditEntry[] = [];
  visit(node, out);
  return out;
}

function visit(node: AuditNode, out: AuditEntry[]): void {
  out.push(node.entry);
  for (const child of node.children) visit(child, out);
}

/**
 * Compare two trees treating `mode: 'parallel'` sibling sets as unordered.
 * Sequential siblings still compare positionally. Used by Phase 9 Scenario A/C
 * replay assertions, where re-entrancy order is sequential but parallel fan-out
 * (future-proofing) must not regress to false negatives.
 */
export function unorderedEqualForParallel(a: AuditNode, b: AuditNode): boolean {
  if (a.entry.auditId !== b.entry.auditId) return false;
  if (a.mode !== b.mode) return false;
  if (a.children.length !== b.children.length) return false;
  if (a.mode === 'parallel') {
    const remaining = b.children.slice();
    for (const ac of a.children) {
      const idx = remaining.findIndex((bc) => unorderedEqualForParallel(ac, bc));
      if (idx === -1) return false;
      remaining.splice(idx, 1);
    }
    return true;
  }
  for (let i = 0; i < a.children.length; i++) {
    if (!unorderedEqualForParallel(a.children[i]!, b.children[i]!)) return false;
  }
  return true;
}
