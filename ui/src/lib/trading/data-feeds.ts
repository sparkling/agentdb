// Data Feed Simulators (easily replaceable with real APIs)

import { StockData, SocialSentiment, PolymarketData } from './types';

/**
 * Stock Data Feed Simulator
 * Replace with real API: Alpha Vantage, Yahoo Finance, IEX Cloud, etc.
 */
export class StockDataFeed {
  private symbols: string[];
  private basePrice: Map<string, number> = new Map();
  private useRealFeed: boolean;
  private apiKey?: string;

  constructor(symbols: string[], useRealFeed: boolean = false, apiKey?: string) {
    this.symbols = symbols;
    this.useRealFeed = useRealFeed;
    this.apiKey = apiKey;

    // Initialize base prices
    this.symbols.forEach(symbol => {
      this.basePrice.set(symbol, this.getInitialPrice(symbol));
    });
  }

  private getInitialPrice(symbol: string): number {
    const prices: Record<string, number> = {
      'AAPL': 175.50,
      'GOOGL': 140.25,
      'MSFT': 380.00,
      'TSLA': 245.00,
      'NVDA': 495.00,
      'META': 325.00,
      'AMZN': 145.00,
      'BTC': 43500.00,
      'ETH': 2300.00
    };
    return prices[symbol] || 100.00;
  }

  async getStockData(symbol: string): Promise<StockData> {
    if (this.useRealFeed && this.apiKey) {
      return this.fetchRealData(symbol);
    }
    return this.generateSimulatedData(symbol);
  }

  private async fetchRealData(symbol: string): Promise<StockData> {
    // Placeholder for real API integration
    // Example: Alpha Vantage, Yahoo Finance, IEX Cloud
    console.log('Real API would be called here for', symbol);
    return this.generateSimulatedData(symbol);
  }

  private generateSimulatedData(symbol: string): StockData {
    const basePrice = this.basePrice.get(symbol) || 100;

    // Realistic price movement simulation
    const volatility = 0.02; // 2% volatility
    const trend = (Math.random() - 0.5) * 0.001; // Small trend
    const randomChange = (Math.random() - 0.5) * volatility;

    const change = basePrice * (trend + randomChange);
    const price = basePrice + change;

    // Update base price for next call (random walk)
    this.basePrice.set(symbol, price);

    const open = basePrice;
    const high = Math.max(price, open) * (1 + Math.random() * 0.01);
    const low = Math.min(price, open) * (1 - Math.random() * 0.01);
    const volume = Math.floor(1000000 + Math.random() * 5000000);

    return {
      symbol,
      price,
      volume,
      change,
      changePercent: (change / basePrice) * 100,
      timestamp: Date.now(),
      high,
      low,
      open,
      close: price
    };
  }

  async getAllStockData(): Promise<Map<string, StockData>> {
    const data = new Map<string, StockData>();
    for (const symbol of this.symbols) {
      data.set(symbol, await this.getStockData(symbol));
    }
    return data;
  }
}

/**
 * Social Sentiment Feed Simulator
 * Replace with real API: Twitter API, Reddit API, News APIs
 */
export class SocialSentimentFeed {
  private symbols: string[];
  private useRealFeed: boolean;
  private apiKey?: string;

  constructor(symbols: string[], useRealFeed: boolean = false, apiKey?: string) {
    this.symbols = symbols;
    this.useRealFeed = useRealFeed;
    this.apiKey = apiKey;
  }

  async getSentiment(symbol: string): Promise<SocialSentiment[]> {
    if (this.useRealFeed && this.apiKey) {
      return this.fetchRealSentiment(symbol);
    }
    return this.generateSimulatedSentiment(symbol);
  }

  private async fetchRealSentiment(symbol: string): Promise<SocialSentiment[]> {
    // Placeholder for real API integration
    console.log('Real sentiment API would be called here for', symbol);
    return this.generateSimulatedSentiment(symbol);
  }

  private generateSimulatedSentiment(symbol: string): SocialSentiment[] {
    const platforms: Array<'twitter' | 'reddit' | 'news'> = ['twitter', 'reddit', 'news'];

    return platforms.map(platform => {
      const baseSentiment = Math.random() * 2 - 1; // -1 to 1
      const noise = (Math.random() - 0.5) * 0.3;

      return {
        platform,
        symbol,
        sentiment: Math.max(-1, Math.min(1, baseSentiment + noise)),
        volume: Math.floor(1000 + Math.random() * 10000),
        mentions: Math.floor(100 + Math.random() * 1000),
        trending: Math.random() > 0.7,
        timestamp: Date.now()
      };
    });
  }

  async getAllSentiment(): Promise<Map<string, SocialSentiment[]>> {
    const data = new Map<string, SocialSentiment[]>();
    for (const symbol of this.symbols) {
      data.set(symbol, await this.getSentiment(symbol));
    }
    return data;
  }
}

/**
 * Polymarket Data Feed Simulator
 * Replace with real Polymarket API
 */
export class PolymarketFeed {
  private symbols: string[];
  private useRealFeed: boolean;
  private apiKey?: string;

  constructor(symbols: string[], useRealFeed: boolean = false, apiKey?: string) {
    this.symbols = symbols;
    this.useRealFeed = useRealFeed;
    this.apiKey = apiKey;
  }

  async getPolymarketData(): Promise<PolymarketData[]> {
    if (this.useRealFeed && this.apiKey) {
      return this.fetchRealPolymarketData();
    }
    return this.generateSimulatedData();
  }

  private async fetchRealPolymarketData(): Promise<PolymarketData[]> {
    // Placeholder for real Polymarket API
    console.log('Real Polymarket API would be called here');
    return this.generateSimulatedData();
  }

  private generateSimulatedData(): PolymarketData[] {
    const markets = [
      {
        market: 'tech_earnings_q4',
        question: 'Will tech stocks beat earnings expectations in Q4?',
        relatedSymbols: ['AAPL', 'GOOGL', 'MSFT']
      },
      {
        market: 'ai_boom_2024',
        question: 'Will AI stocks outperform S&P 500 in 2024?',
        relatedSymbols: ['NVDA', 'MSFT', 'GOOGL']
      },
      {
        market: 'fed_rate_decision',
        question: 'Will Fed cut rates in next meeting?',
        relatedSymbols: ['all']
      },
      {
        market: 'crypto_adoption',
        question: 'Will Bitcoin ETF get approved this quarter?',
        relatedSymbols: ['BTC', 'ETH']
      }
    ];

    return markets.map(market => ({
      market: market.market,
      question: market.question,
      probability: 0.3 + Math.random() * 0.4, // 30% to 70%
      volume: Math.floor(50000 + Math.random() * 200000),
      relatedSymbols: market.relatedSymbols,
      timestamp: Date.now()
    }));
  }
}

/**
 * Gemini AI Integration for Market Analysis
 * Now uses the real Gemini edge function
 */
export class GeminiMarketAnalyzer {
  private geminiService: any = null;

  constructor(_apiKey?: string) {
    // API key not needed - using edge function
  }

  async analyzeMarket(
    stockData: StockData,
    sentiment: SocialSentiment[],
    polymarket: PolymarketData[]
  ): Promise<{
    analysis: string;
    recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
    confidence: number;
    reasoning: string[];
  }> {
    // Lazy load the Gemini service
    if (!this.geminiService) {
      const { GeminiTradingService } = await import('./gemini-service');
      this.geminiService = new GeminiTradingService();
    }

    try {
      return await this.geminiService.analyzeMarket({
        stockData: {
          symbol: stockData.symbol,
          price: stockData.price,
          change: stockData.change,
          changePercent: stockData.changePercent,
          volume: stockData.volume
        },
        sentiment: sentiment.map(s => ({
          platform: s.platform,
          sentiment: s.sentiment,
          volume: s.volume
        })),
        polymarket: polymarket.map(p => ({
          market: p.market,
          question: p.question,
          probability: p.probability,
          relatedSymbols: p.relatedSymbols
        }))
      });
    } catch (error) {
      console.error('Gemini analysis failed, using fallback:', error);
      return this.simulateAnalysis(stockData, sentiment, polymarket);
    }
  }

  private simulateAnalysis(
    stockData: StockData,
    sentiment: SocialSentiment[],
    polymarket: PolymarketData[]
  ): {
    analysis: string;
    recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
    confidence: number;
    reasoning: string[];
  } {
    const avgSentiment = sentiment.reduce((sum, s) => sum + s.sentiment, 0) / sentiment.length;
    const priceChange = stockData.changePercent;

    // Find relevant polymarket predictions
    const relevantPredictions = polymarket.filter(p =>
      p.relatedSymbols.includes(stockData.symbol) || p.relatedSymbols.includes('all')
    );
    const avgProbability = relevantPredictions.length > 0
      ? relevantPredictions.reduce((sum, p) => sum + p.probability, 0) / relevantPredictions.length
      : 0.5;

    const reasoning: string[] = [];
    let score = 0;

    // Price momentum
    if (priceChange > 1) {
      reasoning.push(`Strong upward price momentum (+${priceChange.toFixed(2)}%)`);
      score += 2;
    } else if (priceChange < -1) {
      reasoning.push(`Downward price momentum (${priceChange.toFixed(2)}%)`);
      score -= 2;
    }

    // Sentiment analysis
    if (avgSentiment > 0.3) {
      reasoning.push(`Positive social sentiment (${(avgSentiment * 100).toFixed(1)}%)`);
      score += 2;
    } else if (avgSentiment < -0.3) {
      reasoning.push(`Negative social sentiment (${(avgSentiment * 100).toFixed(1)}%)`);
      score -= 2;
    }

    // Polymarket predictions
    if (avgProbability > 0.6) {
      reasoning.push(`High prediction market probability (${(avgProbability * 100).toFixed(1)}%)`);
      score += 1;
    } else if (avgProbability < 0.4) {
      reasoning.push(`Low prediction market probability (${(avgProbability * 100).toFixed(1)}%)`);
      score -= 1;
    }

    // Volume analysis
    if (stockData.volume > 3000000) {
      reasoning.push('High trading volume indicates strong interest');
      score += 1;
    }

    let recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
    if (score >= 4) recommendation = 'strong_buy';
    else if (score >= 2) recommendation = 'buy';
    else if (score <= -4) recommendation = 'strong_sell';
    else if (score <= -2) recommendation = 'sell';
    else recommendation = 'hold';

    const confidence = Math.min(0.95, 0.5 + Math.abs(score) * 0.1);

    return {
      analysis: `Based on multi-source analysis of ${stockData.symbol}, the recommendation is ${recommendation}`,
      recommendation,
      confidence,
      reasoning
    };
  }
}
