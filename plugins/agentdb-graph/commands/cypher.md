---
description: Run a Cypher query against AgentDB's graph backend.
---

Use the `agentdb-cypher` skill.

Take the Cypher after `/cypher`. If parameters are needed, prompt for them rather than letting the user inline values (avoid Cypher injection).

Render rows as a table; if more than 30 rows, paginate. Always show `stats.execMs` and `stats.rowsReturned`.

For destructive queries (CREATE/DELETE/MERGE), confirm with the user first and recommend the typed delete tools (`agentdb_causal_node_delete`) when applicable.
