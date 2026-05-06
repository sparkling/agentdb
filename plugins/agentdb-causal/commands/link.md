---
description: Record a causal link between two memories — A causes B, A supersedes B, A depends on B.
---

Use the `agentdb-causal-link` skill to add a typed edge between two memories.

If the user provides explicit `(from, to, relation)` after `/link`, store that. Otherwise infer from the most recent context — the last failed test that the most recent fix targeted, the ADR that supersedes the previous one, etc. — and confirm before storing.

After storing, briefly tell the user what edge was added and offer to record uplift / confidence if they have evidence.
