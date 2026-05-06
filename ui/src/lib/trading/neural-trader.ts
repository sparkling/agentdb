// Neural Trading System - Main orchestrator integrating all components

import {
  TradingConfig,
  MarketState,
  Position,
  TradingAction,
  PerformanceMetrics,
  SAFLAFeedback,
  LearningPattern
} from './types';
import { GOAPPlanner } from './goap-planner';
import { SAFLALearning } from './safla-learning';
import {
  StockDataFeed,
  SocialSentimentFeed,
  PolymarketFeed,
  GeminiMarketAnalyzer
} from './data-feeds';

export class NeuralTrader {
  private config: TradingConfig;
  private db: any = null;
  private goapPlanner: GOAPPlanner;
  private saflaLearning: SAFLALearning;
  private geminiAnalyzer: GeminiMarketAnalyzer;

  // Data feeds
  private stockFeed: StockDataFeed;
  private sentimentFeed: SocialSentimentFeed;
  private polymarketFeed: PolymarketFeed;

  // Trading state
  private portfolio: Map<string, Position> = new Map();
  private cashBalance: number;
  private tradeHistory: TradingAction[] = [];
  private performanceHistory: PerformanceMetrics[] = [];

  // Running state
  private isRunning: boolean = false;
  private tradingInterval?: NodeJS.Timeout;

  constructor(config: TradingConfig) {
    this.config = config;
    this.cashBalance = config.initialCapital;

    // Initialize components
    this.goapPlanner = new GOAPPlanner();
    this.saflaLearning = new SAFLALearning(
      config.learningRate,
      config.saflaEnabled ? 0.7 : 1.0
    );
    this.geminiAnalyzer = new GeminiMarketAnalyzer(config.apiKeys.gemini);

    // Initialize data feeds
    this.stockFeed = new StockDataFeed(
      config.symbols,
      config.useRealFeeds,
      config.apiKeys.stock
    );
    this.sentimentFeed = new SocialSentimentFeed(
      config.symbols,
      config.useRealFeeds,
      config.apiKeys.social
    );
    this.polymarketFeed = new PolymarketFeed(
      config.symbols,
      config.useRealFeeds
    );
  }

  async initialize(): Promise<void> {
    try {
      // Initialize AgentDB with browser-compatible version
      // Wait for AgentDB to be available globally (loaded via script tag)
      if (typeof (window as any).AgentDB === 'undefined') {
        throw new Error('AgentDB not loaded. Make sure agentdb.min.js is included via script tag.');
      }

      const AgentDB = (window as any).AgentDB;

      // Wait for AgentDB to be ready
      if (AgentDB.onReady && !AgentDB.ready) {
        await new Promise<void>((resolve) => {
          AgentDB.onReady(() => resolve());
        });
      }

      // Create AgentDB instance using SQLiteVectorDB constructor (v1.3.9 API)
      this.db = new AgentDB.SQLiteVectorDB({
        dimensionality: 128,
        saveInterval: 5000
      });

      // Initialize SAFLA learning
      await this.saflaLearning.initialize();

      console.log('Neural Trader initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Neural Trader:', error);
      throw error;
    }
  }

  /**
   * Start automated trading
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Trading system already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting Neural Trading System...');

    // Initial trading cycle
    await this.tradingCycle();

    // Set up recurring trading cycles
    this.tradingInterval = setInterval(
      () => this.tradingCycle(),
      this.config.tradingFrequency
    );
  }

  /**
   * Stop automated trading
   */
  stop(): void {
    if (this.tradingInterval) {
      clearInterval(this.tradingInterval);
      this.tradingInterval = undefined;
    }
    this.isRunning = false;
    console.log('Trading system stopped');
  }

  /**
   * Main trading cycle
   */
  private async tradingCycle(): Promise<void> {
    try {
      // 1. Gather market data
      const marketState = await this.gatherMarketData();

      // 2. Analyze market with Gemini (for each symbol)
      const analyses = await this.analyzeMarketWithGemini(marketState);

      // 3. Use GOAP for action planning if enabled
      let actions: TradingAction[] = [];
      if (this.config.goapEnabled) {
        const currentState = this.buildCurrentState(marketState);
        const plan = await this.goapPlanner.createPlan(currentState, marketState);
        actions = this.goapPlanner.planToTradingActions(plan, marketState);
      } else {
        // Use direct analysis-based actions
        actions = this.analysesToActions(analyses, marketState);
      }

      // 4. Execute actions
      for (const action of actions) {
        await this.executeAction(action, marketState);
      }

      // 5. Update performance metrics
      this.updatePerformanceMetrics(marketState);

      // 6. SAFLA feedback loop
      if (this.config.saflaEnabled) {
        await this.processSAFLAFeedback();
      }

      // 7. Log trading cycle
      console.log('Trading cycle completed', {
        portfolioValue: this.getPortfolioValue(marketState),
        cashBalance: this.cashBalance,
        positions: this.portfolio.size
      });

    } catch (error) {
      console.error('Error in trading cycle:', error);
    }
  }

  /**
   * Gather all market data from feeds
   */
  private async gatherMarketData(): Promise<MarketState> {
    const [stocks, sentiment, polymarket] = await Promise.all([
      this.stockFeed.getAllStockData(),
      this.sentimentFeed.getAllSentiment(),
      this.polymarketFeed.getPolymarketData()
    ]);

    return {
      stocks,
      sentiment,
      polymarket,
      timestamp: Date.now()
    };
  }

  /**
   * Analyze market using Gemini AI
   */
  private async analyzeMarketWithGemini(marketState: MarketState): Promise<Map<string, any>> {
    const analyses = new Map();

    for (const [symbol, stockData] of marketState.stocks) {
      const sentiment = marketState.sentiment.get(symbol) || [];
      const analysis = await this.geminiAnalyzer.analyzeMarket(
        stockData,
        sentiment,
        marketState.polymarket
      );
      analyses.set(symbol, analysis);
      
      // Small delay between API calls to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return analyses;
  }

  /**
   * Convert analyses to trading actions
   */
  private analysesToActions(analyses: Map<string, any>, marketState: MarketState): TradingAction[] {
    const actions: TradingAction[] = [];

    for (const [symbol, analysis] of analyses) {
      const recommendation = analysis.recommendation;
      let actionType: 'buy' | 'sell' | 'hold' = 'hold';

      if (recommendation === 'strong_buy' || recommendation === 'buy') {
        actionType = 'buy';
      } else if (recommendation === 'strong_sell' || recommendation === 'sell') {
        actionType = 'sell';
      }

      const stockData = marketState.stocks.get(symbol);
      if (!stockData) continue;

      const quantity = this.calculatePositionSize(symbol, stockData.price, analysis.confidence);

      console.log(`Action for ${symbol}: ${actionType}, qty: ${quantity}, rec: ${recommendation}, conf: ${analysis.confidence}`);

      // Only add buy/sell actions if quantity > 0
      if (actionType !== 'hold' && quantity > 0) {
        actions.push({
          type: actionType,
          symbol,
          quantity,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning.join('; '),
          timestamp: Date.now()
        });
      }
    }

    console.log(`Generated ${actions.length} executable actions`);
    return actions;
  }

  /**
   * Execute a trading action
   */
  private async executeAction(action: TradingAction, marketState: MarketState): Promise<void> {
    const stockData = marketState.stocks.get(action.symbol);
    if (!stockData) return;

    if (action.type === 'buy') {
      await this.executeBuy(action, stockData.price);
    } else if (action.type === 'sell') {
      await this.executeSell(action, stockData.price);
    }

    this.tradeHistory.push(action);
  }

  private async executeBuy(action: TradingAction, price: number): Promise<void> {
    const cost = action.quantity * price;

    if (cost > this.cashBalance) {
      console.log('Insufficient funds for buy order', { cost, balance: this.cashBalance });
      return;
    }

    this.cashBalance -= cost;

    const existingPosition = this.portfolio.get(action.symbol);
    if (existingPosition) {
      // Average in
      const totalQuantity = existingPosition.quantity + action.quantity;
      const totalCost = existingPosition.entryPrice * existingPosition.quantity + cost;
      existingPosition.quantity = totalQuantity;
      existingPosition.entryPrice = totalCost / totalQuantity;
      existingPosition.currentPrice = price;
    } else {
      this.portfolio.set(action.symbol, {
        symbol: action.symbol,
        quantity: action.quantity,
        entryPrice: price,
        currentPrice: price,
        unrealizedPnL: 0,
        realizedPnL: 0,
        timestamp: Date.now()
      });
    }

    console.log(`BUY: ${action.quantity} ${action.symbol} @ $${price.toFixed(2)}`);
  }

  private async executeSell(action: TradingAction, price: number): Promise<void> {
    const position = this.portfolio.get(action.symbol);
    if (!position || position.quantity < action.quantity) {
      console.log('Insufficient shares for sell order');
      return;
    }

    const proceeds = action.quantity * price;
    const costBasis = action.quantity * position.entryPrice;
    const pnl = proceeds - costBasis;

    this.cashBalance += proceeds;
    position.quantity -= action.quantity;
    position.realizedPnL += pnl;

    if (position.quantity === 0) {
      this.portfolio.delete(action.symbol);
    }

    console.log(`SELL: ${action.quantity} ${action.symbol} @ $${price.toFixed(2)} (PnL: $${pnl.toFixed(2)})`);
  }

  /**
   * Calculate position size based on risk management
   */
  private calculatePositionSize(symbol: string, price: number, confidence: number): number {
    const maxPositionValue = this.cashBalance * this.config.maxPositionSize;
    const targetQuantity = Math.floor((maxPositionValue * confidence) / price);
    return Math.max(0, Math.min(targetQuantity, Math.floor(this.cashBalance / price)));
  }

  /**
   * Build current state for GOAP planner
   */
  private buildCurrentState(marketState: MarketState): Record<string, any> {
    return {
      hasCapital: this.cashBalance > 0,
      hasPosition: this.portfolio.size > 0,
      bullishSignal: this.detectBullishSignal(marketState),
      bearishSignal: this.detectBearishSignal(marketState),
      dataAvailable: true,
      sentimentKnown: true,
      predictionKnown: true,
      riskCalculated: true
    };
  }

  private detectBullishSignal(marketState: MarketState): boolean {
    // Simple bullish detection
    let bullishCount = 0;
    for (const stock of marketState.stocks.values()) {
      if (stock.changePercent > 0) bullishCount++;
    }
    return bullishCount > marketState.stocks.size / 2;
  }

  private detectBearishSignal(marketState: MarketState): boolean {
    let bearishCount = 0;
    for (const stock of marketState.stocks.values()) {
      if (stock.changePercent < 0) bearishCount++;
    }
    return bearishCount > marketState.stocks.size / 2;
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(marketState: MarketState): void {
    const portfolioValue = this.getPortfolioValue(marketState);
    const totalValue = portfolioValue + this.cashBalance;
    const totalReturn = ((totalValue - this.config.initialCapital) / this.config.initialCapital) * 100;

    const metrics: PerformanceMetrics = {
      totalReturn,
      sharpeRatio: this.calculateSharpeRatio(),
      maxDrawdown: this.calculateMaxDrawdown(),
      winRate: this.calculateWinRate(),
      totalTrades: this.tradeHistory.length,
      averageReturn: this.calculateAverageReturn(),
      portfolioValue: totalValue,
      timestamp: Date.now()
    };

    this.performanceHistory.push(metrics);
  }

  private getPortfolioValue(marketState: MarketState): number {
    let value = 0;
    for (const position of this.portfolio.values()) {
      const stockData = marketState.stocks.get(position.symbol);
      if (stockData) {
        value += position.quantity * stockData.price;
      }
    }
    return value;
  }

  private calculateSharpeRatio(): number {
    if (this.performanceHistory.length < 2) return 0;

    const returns = this.performanceHistory.map(m => m.totalReturn);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  private calculateMaxDrawdown(): number {
    if (this.performanceHistory.length === 0) return 0;

    let maxValue = this.config.initialCapital;
    let maxDrawdown = 0;

    for (const metrics of this.performanceHistory) {
      maxValue = Math.max(maxValue, metrics.portfolioValue);
      const drawdown = ((maxValue - metrics.portfolioValue) / maxValue) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  private calculateWinRate(): number {
    const closedTrades = this.tradeHistory.filter(t => t.type === 'sell');
    if (closedTrades.length === 0) return 0;

    let wins = 0;
    for (const position of this.portfolio.values()) {
      if (position.realizedPnL > 0) wins++;
    }

    return (wins / closedTrades.length) * 100;
  }

  private calculateAverageReturn(): number {
    if (this.tradeHistory.length === 0) return 0;

    const totalPnL = Array.from(this.portfolio.values())
      .reduce((sum, p) => sum + p.realizedPnL, 0);

    return totalPnL / this.tradeHistory.length;
  }

  /**
   * Process SAFLA feedback loop
   */
  private async processSAFLAFeedback(): Promise<void> {
    const recentActions = this.tradeHistory.slice(-5);

    for (const action of recentActions) {
      const position = this.portfolio.get(action.symbol);
      const success = position ? position.unrealizedPnL > 0 || position.realizedPnL > 0 : false;

      const feedback: SAFLAFeedback = {
        actionId: `${action.symbol}_${action.timestamp}`,
        success,
        reward: position ? (position.unrealizedPnL + position.realizedPnL) : 0,
        metrics: {
          profitability: success ? 0.8 : 0.3,
          accuracy: action.confidence,
          riskManagement: this.calculateRiskScore(),
          adaptability: 0.7
        },
        timestamp: Date.now()
      };

      await this.saflaLearning.processFeedback(feedback);
    }
  }

  private calculateRiskScore(): number {
    const portfolioValue = Array.from(this.portfolio.values())
      .reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const totalValue = portfolioValue + this.cashBalance;
    const risk = portfolioValue / totalValue;

    return 1 - Math.min(risk, this.config.maxPortfolioRisk);
  }

  /**
   * Get current performance metrics
   */
  getPerformance(): PerformanceMetrics | null {
    return this.performanceHistory[this.performanceHistory.length - 1] || null;
  }

  /**
   * Get portfolio summary
   */
  getPortfolio(): {
    positions: Position[];
    cashBalance: number;
    totalValue: number;
  } {
    return {
      positions: Array.from(this.portfolio.values()),
      cashBalance: this.cashBalance,
      totalValue: 0 // Will be calculated with current market data
    };
  }

  /**
   * Get trade history
   */
  getTradeHistory(): TradingAction[] {
    return [...this.tradeHistory];
  }

  /**
   * Get learning statistics
   */
  getLearningStats() {
    return this.saflaLearning.getStatistics();
  }

  /**
   * Reset trading system
   */
  reset(): void {
    this.stop();
    this.portfolio.clear();
    this.cashBalance = this.config.initialCapital;
    this.tradeHistory = [];
    this.performanceHistory = [];
    this.saflaLearning.reset();
  }
}
