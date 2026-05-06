---
description: Smart search across AgentDB — picks hybrid / vector / MMR based on query shape.
---

Run a smart search across AgentDB. Logic:

1. Inspect the query string. If it contains code symbols, file paths, proper nouns, or quoted phrases → use the `agentdb-hybrid-search` skill.
2. Otherwise → use vector search via `agentdb_pattern_search`.
3. Either way, if the user requested broad coverage ("show me different angles", "diverse results"), pipe through the `agentdb-mmr` skill before returning.
4. If the user asks "why?" about any result, switch to `agentdb-explainable-recall` for that id.

Default top-k is 5. Always show similarity scores. Never dump more than 10 hits without pagination.

After returning, prompt for feedback (use the `agentdb-feedback` skill from `agentdb-learning` if installed) so the bandit learns.
