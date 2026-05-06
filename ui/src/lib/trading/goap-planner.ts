// GOAP (Goal-Oriented Action Planning) for Trading Decisions

import { GOAPGoal, GOAPAction, MarketState, TradingAction } from './types';

export class GOAPPlanner {
  private goals: GOAPGoal[] = [];
  private actions: Map<string, GOAPAction> = new Map();

  constructor() {
    this.initializeGoals();
    this.initializeActions();
  }

  private initializeGoals(): void {
    this.goals = [
      {
        id: 'maximize_profit',
        description: 'Maximize portfolio profit',
        priority: 10,
        conditions: { profitTarget: true },
        reward: 100
      },
      {
        id: 'minimize_risk',
        description: 'Minimize portfolio risk',
        priority: 8,
        conditions: { riskManaged: true },
        reward: 50
      },
      {
        id: 'capture_momentum',
        description: 'Capture market momentum',
        priority: 7,
        conditions: { momentumDetected: true },
        reward: 70
      },
      {
        id: 'hedge_positions',
        description: 'Hedge existing positions',
        priority: 6,
        conditions: { hedgeRequired: true },
        reward: 40
      }
    ];
  }

  private initializeActions(): void {
    // These are templates - actual execution happens in the trading system
    const actionTemplates = [
      {
        id: 'buy_stock',
        name: 'Buy Stock',
        cost: 1,
        preconditions: { hasCapital: true, bullishSignal: true },
        effects: { positionOpened: true, capitalReduced: true }
      },
      {
        id: 'sell_stock',
        name: 'Sell Stock',
        cost: 1,
        preconditions: { hasPosition: true, bearishSignal: true },
        effects: { positionClosed: true, capitalIncreased: true }
      },
      {
        id: 'analyze_sentiment',
        name: 'Analyze Market Sentiment',
        cost: 0.5,
        preconditions: { dataAvailable: true },
        effects: { sentimentKnown: true }
      },
      {
        id: 'check_polymarket',
        name: 'Check Polymarket Predictions',
        cost: 0.3,
        preconditions: { dataAvailable: true },
        effects: { predictionKnown: true }
      },
      {
        id: 'adjust_position',
        name: 'Adjust Position Size',
        cost: 0.8,
        preconditions: { hasPosition: true, riskCalculated: true },
        effects: { riskAdjusted: true }
      }
    ];

    actionTemplates.forEach(template => {
      this.actions.set(template.id, {
        ...template,
        execute: async () => true // Placeholder
      });
    });
  }

  /**
   * Create a plan to achieve the highest priority goal
   */
  public async createPlan(
    currentState: Record<string, any>,
    marketState: MarketState
  ): Promise<GOAPAction[]> {
    // Sort goals by priority
    const sortedGoals = [...this.goals].sort((a, b) => b.priority - a.priority);

    // Try to find a plan for each goal
    for (const goal of sortedGoals) {
      const plan = this.findPlan(currentState, goal);
      if (plan.length > 0) {
        return plan;
      }
    }

    return [];
  }

  /**
   * A* search to find optimal action sequence
   */
  private findPlan(
    initialState: Record<string, any>,
    goal: GOAPGoal
  ): GOAPAction[] {
    const openSet: Array<{
      state: Record<string, any>;
      actions: GOAPAction[];
      cost: number;
    }> = [{ state: initialState, actions: [], cost: 0 }];

    const closedSet = new Set<string>();
    const maxIterations = 100;
    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Sort by cost (A* heuristic)
      openSet.sort((a, b) => a.cost - b.cost);
      const current = openSet.shift()!;

      // Check if goal is satisfied
      if (this.goalSatisfied(current.state, goal)) {
        return current.actions;
      }

      const stateKey = JSON.stringify(current.state);
      if (closedSet.has(stateKey)) continue;
      closedSet.add(stateKey);

      // Try all possible actions
      for (const action of this.actions.values()) {
        if (this.preconditionsMet(current.state, action)) {
          const newState = this.applyEffects(current.state, action);
          const newCost = current.cost + action.cost;

          openSet.push({
            state: newState,
            actions: [...current.actions, action],
            cost: newCost
          });
        }
      }
    }

    return []; // No plan found
  }

  private goalSatisfied(state: Record<string, any>, goal: GOAPGoal): boolean {
    return Object.entries(goal.conditions).every(
      ([key, value]) => state[key] === value
    );
  }

  private preconditionsMet(state: Record<string, any>, action: GOAPAction): boolean {
    return Object.entries(action.preconditions).every(
      ([key, value]) => state[key] === value
    );
  }

  private applyEffects(
    state: Record<string, any>,
    action: GOAPAction
  ): Record<string, any> {
    return { ...state, ...action.effects };
  }

  /**
   * Translate GOAP plan to trading actions
   */
  public planToTradingActions(
    plan: GOAPAction[],
    marketState: MarketState
  ): TradingAction[] {
    return plan.map(action => ({
      type: this.actionTypeFromGOAP(action.id),
      symbol: this.selectSymbol(marketState),
      quantity: this.calculateQuantity(action, marketState),
      confidence: 0.7,
      reasoning: `GOAP: ${action.name}`,
      timestamp: Date.now()
    }));
  }

  private actionTypeFromGOAP(actionId: string): 'buy' | 'sell' | 'hold' | 'analyze' {
    if (actionId.includes('buy')) return 'buy';
    if (actionId.includes('sell')) return 'sell';
    if (actionId.includes('analyze')) return 'analyze';
    return 'hold';
  }

  private selectSymbol(marketState: MarketState): string {
    const symbols = Array.from(marketState.stocks.keys());
    return symbols[0] || 'AAPL';
  }

  private calculateQuantity(action: GOAPAction, marketState: MarketState): number {
    // Simple quantity calculation - can be enhanced
    return Math.floor(Math.random() * 10) + 1;
  }

  /**
   * Update action costs based on historical performance
   */
  public updateActionCosts(actionId: string, success: boolean, reward: number): void {
    const action = this.actions.get(actionId);
    if (action) {
      // Adjust cost based on success
      action.cost = success
        ? Math.max(0.1, action.cost * 0.9)
        : Math.min(10, action.cost * 1.1);
    }
  }
}
