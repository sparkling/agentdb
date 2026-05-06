---
description: Save the current insight into AgentDB memory — pattern, episode, or skill.
---

Use the `agentdb-remember` skill to determine which memory type fits the user's intent (pattern / episode / skill) and persist it via the appropriate MCP tool.

If the user provides explicit content after `/remember`, store that directly. If they don't, summarize the most recent significant exchange in this conversation — what was tried, what worked, what to do differently — and ask for confirmation before storing.

After the store completes, briefly tell the user what was saved (one sentence) and offer to record feedback (`agentdb_record_feedback`) on it.
