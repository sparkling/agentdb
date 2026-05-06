---
description: Explain why a memory is what it is — walks AgentDB's causal graph backwards to surface the chain that led to it.
---

Use the `agentdb-causal-explain` skill to walk the causal graph backwards from the user's target.

If the user names the target after `/explain-link` (a test name, an episode id, an ADR), use it. Otherwise pick the most recent failure / regression / decision in the conversation.

Render the result as a tree (or path if linear) with relations on the edges. Keep `maxDepth` at 3 unless the user asks for deeper. Cap output at 15 nodes.

If the chain has gaps (low-confidence edges), surface them explicitly — "we have evidence A→B and C→D but the link B→C is missing or weak (confidence 0.31)" — rather than papering over them.
