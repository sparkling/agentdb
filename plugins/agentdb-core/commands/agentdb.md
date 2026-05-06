---
description: Show AgentDB plugin help — what's installed, what each command does, how to add more plugins.
---

Show a compact help screen for the user's currently-installed AgentDB plugins.

For each installed `agentdb-*` plugin, list:
- The slash commands it adds
- The skills it adds
- The MCP tools it surfaces

If only `agentdb-core` is installed, suggest the next plugin to add based on what the user has been doing in this session:
- They've been writing code that takes notes / tracks decisions → `agentdb-memory`
- They've been debugging cause-effect / tracing dependencies → `agentdb-causal`
- They've been picking between approaches / running experiments → `agentdb-learning`

End with the marketplace install line:

```
/plugin marketplace add ruvnet/agentdb
/plugin install agentdb-memory@agentdb
```
