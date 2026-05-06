---
description: Pull relevant past memories from AgentDB for the current task.
---

Use the `agentdb-recall` skill to load relevant context from AgentDB.

If the user provides a query after `/recall`, use it. Otherwise infer the query from the most recent task discussion in the conversation.

Return the top 3-5 most relevant matches as a compact list. Format:

```
1. [pattern] <one-line summary>  (similarity 0.91, reward 0.85)
2. [episode] <task>: <outcome>   (similarity 0.87, success ✓)
3. [skill]   <name>              (similarity 0.84)
```

Then ask which (if any) to apply. If the user uses one, record positive feedback via `agentdb_record_feedback` so the bandit learns.
