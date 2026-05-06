#!/bin/bash

# AgentDB-Site Custom Statusline
# Optimized for React/Vite/TypeScript projects

# Read JSON input from stdin
INPUT=$(cat)
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "Claude"')
CWD=$(echo "$INPUT" | jq -r '.workspace.current_dir // .cwd')
DIR=$(basename "$CWD")

# AgentDB Project Branding
if [ "$DIR" = "agentdb-site" ]; then
  DIR="🗄️ AgentDB"
elif [ "$DIR" = "claude-code-flow" ]; then
  DIR="🌊 Claude Flow"
fi

# Get git branch
BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null)

# Start building statusline
printf "\033[1m$MODEL\033[0m in \033[36m$DIR\033[0m"
[ -n "$BRANCH" ] && printf " on \033[33m⎇ $BRANCH\033[0m"

# === PROJECT METRICS ===
if [ -f "$CWD/package.json" ]; then
  printf " │"

  # TypeScript Status
  if command -v tsc &> /dev/null 2>&1; then
    TS_ERRORS=$(cd "$CWD" && npx tsc --noEmit 2>&1 | grep -c "error TS" 2>/dev/null || echo "0")
    if [ "$TS_ERRORS" -gt 0 ]; then
      printf " \033[31m⚠️ $TS_ERRORS\033[0m"
    else
      printf " \033[32m✓ TS\033[0m"
    fi
  fi

  # Vite Dev Server Status
  if [ -d "$CWD/node_modules/.vite" ]; then
    printf " \033[36m⚡\033[0m"
  fi

  # Component Count
  if [ -d "$CWD/src" ]; then
    COMPONENT_COUNT=$(find "$CWD/src" -name "*.tsx" -type f 2>/dev/null | wc -l)
    [ "$COMPONENT_COUNT" -gt 0 ] && printf " \033[35m🧩$COMPONENT_COUNT\033[0m"
  fi

  # Build Status (fresh if dist modified in last hour)
  if [ -d "$CWD/dist" ]; then
    DIST_AGE=$(find "$CWD/dist" -maxdepth 0 -mmin -60 2>/dev/null | wc -l)
    if [ "$DIST_AGE" -gt 0 ]; then
      printf " \033[32m📦\033[0m"
    else
      printf " \033[90m📦\033[0m"
    fi
  fi

  # Git Status Summary
  if [ -n "$BRANCH" ]; then
    UNSTAGED=$(cd "$CWD" && git diff --name-only 2>/dev/null | wc -l)
    STAGED=$(cd "$CWD" && git diff --cached --name-only 2>/dev/null | wc -l)
    UNTRACKED=$(cd "$CWD" && git ls-files --others --exclude-standard 2>/dev/null | wc -l)

    TOTAL_CHANGES=$((UNSTAGED + STAGED + UNTRACKED))
    if [ "$TOTAL_CHANGES" -gt 0 ]; then
      printf " \033[33m±$TOTAL_CHANGES\033[0m"
    fi
  fi
fi

# === NEURAL TRADER TRACKING (AgentDB-specific) ===
TRADER_FILE="$CWD/src/lib/trading/neural-trader.ts"
if [ -f "$TRADER_FILE" ]; then
  TRADER_MODIFIED=$(find "$TRADER_FILE" -mmin -30 2>/dev/null | wc -l)
  [ "$TRADER_MODIFIED" -gt 0 ] && printf " \033[96m🧠\033[0m"
fi

# === CLAUDE-FLOW INTEGRATION ===
FLOW_DIR="$CWD/.claude-flow"

if [ -d "$FLOW_DIR" ]; then
  printf " │"

  # Swarm Configuration & Topology
  if [ -f "$FLOW_DIR/swarm-config.json" ]; then
    STRATEGY=$(jq -r '.defaultStrategy // empty' "$FLOW_DIR/swarm-config.json" 2>/dev/null)
    if [ -n "$STRATEGY" ]; then
      case "$STRATEGY" in
        "balanced") TOPO_ICON="⚡" ;;
        "conservative") TOPO_ICON="🏛️" ;;
        "aggressive") TOPO_ICON="🚀" ;;
        *) TOPO_ICON="⚡" ;;
      esac
      printf " \033[35m$TOPO_ICON\033[0m"

      AGENT_COUNT=$(jq -r '.agentProfiles | length' "$FLOW_DIR/swarm-config.json" 2>/dev/null)
      [ -n "$AGENT_COUNT" ] && [ "$AGENT_COUNT" != "null" ] && [ "$AGENT_COUNT" -gt 0 ] && \
        printf " \033[35m🤖$AGENT_COUNT\033[0m"
    fi
  fi

  # Real-time System Metrics
  if [ -f "$FLOW_DIR/metrics/system-metrics.json" ]; then
    LATEST=$(jq -r '.[-1]' "$FLOW_DIR/metrics/system-metrics.json" 2>/dev/null)

    if [ -n "$LATEST" ] && [ "$LATEST" != "null" ]; then
      # Memory
      MEM_PERCENT=$(echo "$LATEST" | jq -r '.memoryUsagePercent // 0' | awk '{printf "%.0f", $1}')
      if [ -n "$MEM_PERCENT" ] && [ "$MEM_PERCENT" != "null" ]; then
        [ "$MEM_PERCENT" -lt 60 ] && MEM_COLOR="\033[32m" || \
        [ "$MEM_PERCENT" -lt 80 ] && MEM_COLOR="\033[33m" || MEM_COLOR="\033[31m"
        printf " ${MEM_COLOR}💾${MEM_PERCENT}%%\033[0m"
      fi

      # CPU
      CPU_LOAD=$(echo "$LATEST" | jq -r '.cpuLoad // 0' | awk '{printf "%.0f", $1 * 100}')
      if [ -n "$CPU_LOAD" ] && [ "$CPU_LOAD" != "null" ]; then
        [ "$CPU_LOAD" -lt 50 ] && CPU_COLOR="\033[32m" || \
        [ "$CPU_LOAD" -lt 75 ] && CPU_COLOR="\033[33m" || CPU_COLOR="\033[31m"
        printf " ${CPU_COLOR}⚙${CPU_LOAD}%%\033[0m"
      fi
    fi
  fi

  # Task Performance
  if [ -f "$FLOW_DIR/metrics/task-metrics.json" ]; then
    METRICS=$(jq -r '
      (map(select(.success == true)) | length) as $successful |
      (length) as $total |
      (if $total > 0 then ($successful / $total * 100) else 0 end) as $success_rate |
      (reverse | reduce .[] as $task (0; if $task.success == true then . + 1 else 0 end)) as $streak |
      { success_rate: $success_rate, total: $total, streak: $streak } | @json
    ' "$FLOW_DIR/metrics/task-metrics.json" 2>/dev/null)

    if [ -n "$METRICS" ] && [ "$METRICS" != "null" ]; then
      SUCCESS_RATE=$(echo "$METRICS" | jq -r '.success_rate // 0' | awk '{printf "%.0f", $1}')
      TOTAL_TASKS=$(echo "$METRICS" | jq -r '.total // 0')
      STREAK=$(echo "$METRICS" | jq -r '.streak // 0')

      if [ "$TOTAL_TASKS" -gt 0 ]; then
        [ "$SUCCESS_RATE" -gt 80 ] && COLOR="\033[32m" || \
        [ "$SUCCESS_RATE" -ge 60 ] && COLOR="\033[33m" || COLOR="\033[31m"
        printf " ${COLOR}🎯${SUCCESS_RATE}%%\033[0m"

        [ "$STREAK" -gt 0 ] && printf " \033[91m🔥$STREAK\033[0m"
      fi
    fi
  fi

  # Active Tasks
  if [ -d "$FLOW_DIR/tasks" ]; then
    TASK_COUNT=$(find "$FLOW_DIR/tasks" -name "*.json" -type f 2>/dev/null | wc -l)
    [ "$TASK_COUNT" -gt 0 ] && printf " \033[36m📋$TASK_COUNT\033[0m"
  fi

  # Hooks Status
  if [ -f "$FLOW_DIR/hooks-state.json" ]; then
    HOOKS_ACTIVE=$(jq -r '.enabled // false' "$FLOW_DIR/hooks-state.json" 2>/dev/null)
    [ "$HOOKS_ACTIVE" = "true" ] && printf " \033[35m🔗\033[0m"
  fi
fi

echo
