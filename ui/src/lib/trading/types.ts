// Trading System Types

export interface StockData {
  symbol: string;
  price: number;
  volume: number;
  change: number;
  changePercent: number;
  timestamp: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

export interface SocialSentiment {
  platform: 'twitter' | 'reddit' | 'news';
  symbol: string;
  sentiment: number; // -1 to 1
  volume: number;
  mentions: number;
  trending: boolean;
  timestamp: number;
}

export interface PolymarketData {
  market: string;
  question: string;
  probability: number;
  volume: number;
  relatedSymbols: string[];
  timestamp: number;
}

export interface MarketState {
  stocks: Map<string, StockData>;
  sentiment: Map<string, SocialSentiment[]>;
  polymarket: PolymarketData[];
  timestamp: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  timestamp: number;
}

export interface TradingAction {
  type: 'buy' | 'sell' | 'hold' | 'analyze';
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  timestamp: number;
}

export interface GOAPGoal {
  id: string;
  description: string;
  priority: number;
  conditions: Record<string, any>;
  reward: number;
}

export interface GOAPAction {
  id: string;
  name: string;
  cost: number;
  preconditions: Record<string, any>;
  effects: Record<string, any>;
  execute: () => Promise<boolean>;
}

export interface SAFLAFeedback {
  actionId: string;
  success: boolean;
  reward: number;
  metrics: {
    profitability: number;
    accuracy: number;
    riskManagement: number;
    adaptability: number;
  };
  timestamp: number;
}

export interface TradingConfig {
  // Portfolio settings
  initialCapital: number;
  maxPositionSize: number;
  maxPortfolioRisk: number;

  // Trading parameters
  symbols: string[];
  tradingFrequency: number; // milliseconds
  stopLoss: number;
  takeProfit: number;

  // Learning parameters
  learningRate: number;
  explorationRate: number;
  discountFactor: number;

  // Data feed settings
  useRealFeeds: boolean;
  apiKeys: {
    gemini?: string;
    stock?: string;
    social?: string;
  };

  // GOAP settings
  goapEnabled: boolean;
  planningHorizon: number;

  // SAFLA settings
  saflaEnabled: boolean;
  feedbackWindow: number;
  adaptationThreshold: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  averageReturn: number;
  portfolioValue: number;
  timestamp: number;
}

export interface LearningPattern {
  id: string;
  marketConditions: Record<string, any>;
  action: TradingAction;
  outcome: SAFLAFeedback;
  embedding: number[];
  successRate: number;
  usageCount: number;
}
