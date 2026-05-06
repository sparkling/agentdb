---
description: Ask the AgentDB bandit which approach fits the current task.
---

Use the `agentdb-route` skill to query the Thompson Sampling bandit.

If the user provides a task description after `/route-task`, use it. Otherwise infer from the most recent task discussion in the conversation.

Show the picked candidate, expected reward, confidence, and the top 2 alternatives. If confidence < 0.6, flag that the bandit is still exploring and the pick is provisional.

Then ask: do they want to use the picked approach? If yes, run it and call `agentdb_record_feedback` afterwards (use the `agentdb-feedback` skill).
