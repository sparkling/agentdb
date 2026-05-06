---
description: Train an RL policy on accumulated episodes for a task type.
---

Use the `agentdb-learn` skill to train a policy.

If the user names the task after `/learn-task`, use it. Otherwise list the task names with the most episodes (top 5 from `agentdb_pattern_stats`) and ask which to train on.

If the bandit recommends 'auto' for the algorithm, accept it. Otherwise show the user the top 3 algorithms by expected reward and ask which to use.

After training completes, report:
- Algorithm picked
- Episodes trained on
- Final / best reward during training
- Whether the trained skill was added to the library

Then suggest `/route-task <task>` to test the new policy.
