// Gemini AI Service for Trading Analysis
// Uses the same edge function pattern as other examples

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const AI_ENDPOINT = `${SUPABASE_URL}/functions/v1/agentdb-ai`;

export interface MarketAnalysisRequest {
  stockData: {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
  };
  sentiment: Array<{
    platform: string;
    sentiment: number;
    volume: number;
  }>;
  polymarket: Array<{
    market: string;
    question: string;
    probability: number;
    relatedSymbols: string[];
  }>;
}

export interface MarketAnalysisResponse {
  analysis: string;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number;
  reasoning: string[];
}

export class GeminiTradingService {
  /**
   * Analyze market conditions using Gemini AI with retry logic
   */
  async analyzeMarket(request: MarketAnalysisRequest): Promise<MarketAnalysisResponse> {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Prepare the market context for Gemini
        const marketContext = this.prepareMarketContext(request);

        // Call the edge function
        const response = await fetch(AI_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'analyze',
            context: marketContext,
            model: 'google/gemini-2.5-flash'
          })
        });

        if (!response.ok) {
          let details = '';
          try {
            details = await response.text();
          } catch {}
          
          // For 429 or 500 errors, retry with exponential backoff
          if ((response.status === 429 || response.status === 500) && attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`AI gateway error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          console.error('Gemini AI gateway error', response.status, details);
          throw new Error(`AI gateway error: ${response.status}`);
        }

        const result = await response.json();
        const aiResponse = result.response;

        // Parse the AI response
        return this.parseAIResponse(aiResponse, request);

      } catch (error) {
        // If this is the last attempt or a non-retryable error, fall back
        if (attempt === maxRetries - 1) {
          console.error('Gemini analysis error after retries:', error);
          return this.fallbackAnalysis(request);
        }
        
        // For network errors, retry with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Fallback (shouldn't reach here, but TypeScript needs it)
    return this.fallbackAnalysis(request);
  }

  /**
   * Prepare market context for Gemini
   */
  private prepareMarketContext(request: MarketAnalysisRequest): string {
    const { stockData, sentiment, polymarket } = request;

    const avgSentiment = sentiment.reduce((sum, s) => sum + s.sentiment, 0) / sentiment.length;
    const sentimentDesc = avgSentiment > 0.3 ? 'positive' : avgSentiment < -0.3 ? 'negative' : 'neutral';

    const relevantPredictions = polymarket.filter(p =>
      p.relatedSymbols.includes(stockData.symbol) || p.relatedSymbols.includes('all')
    );

    return `
Analyze this trading opportunity for ${stockData.symbol}:

MARKET DATA:
- Current Price: $${stockData.price.toFixed(2)}
- Price Change: ${stockData.changePercent >= 0 ? '+' : ''}${stockData.changePercent.toFixed(2)}%
- Volume: ${stockData.volume.toLocaleString()}

SOCIAL SENTIMENT:
${sentiment.map(s => `- ${s.platform}: ${(s.sentiment * 100).toFixed(1)}% (${s.volume} mentions)`).join('\n')}
- Overall sentiment: ${sentimentDesc} (${(avgSentiment * 100).toFixed(1)}%)

PREDICTION MARKETS:
${relevantPredictions.length > 0
  ? relevantPredictions.map(p => `- ${p.question}: ${(p.probability * 100).toFixed(1)}% probability`).join('\n')
  : '- No relevant prediction markets found'}

Based on this multi-source data, provide:
1. A brief analysis (2-3 sentences)
2. A clear recommendation: STRONG_BUY, BUY, HOLD, SELL, or STRONG_SELL
3. A confidence level (0-100%)
4. 2-3 key reasoning points

Format your response as:
ANALYSIS: [your analysis]
RECOMMENDATION: [recommendation]
CONFIDENCE: [percentage]
REASONING:
- [point 1]
- [point 2]
- [point 3]
`;
  }

  /**
   * Parse AI response into structured format
   */
  private parseAIResponse(aiResponse: string, request: MarketAnalysisRequest): MarketAnalysisResponse {
    try {
      const lines = aiResponse.split('\n').map(l => l.trim()).filter(l => l);

      let analysis = '';
      let recommendation: MarketAnalysisResponse['recommendation'] = 'hold';
      let confidence = 0.5;
      const reasoning: string[] = [];

      let currentSection = '';

      for (const line of lines) {
        if (line.startsWith('ANALYSIS:')) {
          analysis = line.replace('ANALYSIS:', '').trim();
          currentSection = 'analysis';
        } else if (line.startsWith('RECOMMENDATION:')) {
          const rec = line.replace('RECOMMENDATION:', '').trim().toLowerCase();
          recommendation = this.parseRecommendation(rec);
          currentSection = 'recommendation';
        } else if (line.startsWith('CONFIDENCE:')) {
          const confStr = line.replace('CONFIDENCE:', '').replace('%', '').trim();
          confidence = parseInt(confStr) / 100;
          currentSection = 'confidence';
        } else if (line.startsWith('REASONING:')) {
          currentSection = 'reasoning';
        } else if (line.startsWith('-') && currentSection === 'reasoning') {
          reasoning.push(line.replace('-', '').trim());
        } else if (currentSection === 'analysis' && !line.includes(':')) {
          analysis += ' ' + line;
        }
      }

      return {
        analysis: analysis || `AI analysis for ${request.stockData.symbol}`,
        recommendation,
        confidence: Math.max(0.3, Math.min(0.95, confidence)),
        reasoning: reasoning.length > 0 ? reasoning : ['Market analysis based on multi-source data']
      };

    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return this.fallbackAnalysis(request);
    }
  }

  /**
   * Parse recommendation string
   */
  private parseRecommendation(rec: string): MarketAnalysisResponse['recommendation'] {
    if (rec.includes('strong') && rec.includes('buy')) return 'strong_buy';
    if (rec.includes('strong') && rec.includes('sell')) return 'strong_sell';
    if (rec.includes('buy')) return 'buy';
    if (rec.includes('sell')) return 'sell';
    return 'hold';
  }

  /**
   * Fallback analysis when Gemini is unavailable
   */
  private fallbackAnalysis(request: MarketAnalysisRequest): MarketAnalysisResponse {
    const { stockData, sentiment, polymarket } = request;

    const avgSentiment = sentiment.reduce((sum, s) => sum + s.sentiment, 0) / sentiment.length;
    const priceChange = stockData.changePercent;

    const relevantPredictions = polymarket.filter(p =>
      p.relatedSymbols.includes(stockData.symbol) || p.relatedSymbols.includes('all')
    );
    const avgProbability = relevantPredictions.length > 0
      ? relevantPredictions.reduce((sum, p) => sum + p.probability, 0) / relevantPredictions.length
      : 0.5;

    const reasoning: string[] = [];
    let score = 0;

    // Price momentum
    if (priceChange > 0.3) {
      reasoning.push(`Strong upward price momentum (+${priceChange.toFixed(2)}%)`);
      score += 2;
    } else if (priceChange < -0.3) {
      reasoning.push(`Downward price momentum (${priceChange.toFixed(2)}%)`);
      score -= 2;
    }

    // Sentiment analysis
    if (avgSentiment > 0.1) {
      reasoning.push(`Positive social sentiment (${(avgSentiment * 100).toFixed(1)}%)`);
      score += 2;
    } else if (avgSentiment < -0.1) {
      reasoning.push(`Negative social sentiment (${(avgSentiment * 100).toFixed(1)}%)`);
      score -= 2;
    }

    // Polymarket predictions
    if (avgProbability > 0.55) {
      reasoning.push(`High prediction market probability (${(avgProbability * 100).toFixed(1)}%)`);
      score += 1;
    } else if (avgProbability < 0.45) {
      reasoning.push(`Low prediction market probability (${(avgProbability * 100).toFixed(1)}%)`);
      score -= 1;
    }

    // Volume analysis
    if (stockData.volume > 3000000) {
      reasoning.push('High trading volume indicates strong interest');
      score += 1;
    }

    let recommendation: MarketAnalysisResponse['recommendation'];
    if (score >= 4) recommendation = 'strong_buy';
    else if (score >= 2) recommendation = 'buy';
    else if (score <= -4) recommendation = 'strong_sell';
    else if (score <= -2) recommendation = 'sell';
    else recommendation = 'hold';

    const confidence = Math.min(0.95, 0.5 + Math.abs(score) * 0.1);

    return {
      analysis: `Multi-source analysis indicates ${recommendation} for ${stockData.symbol}. ` +
                `Price momentum ${priceChange >= 0 ? 'positive' : 'negative'}, sentiment ${avgSentiment >= 0 ? 'favorable' : 'concerning'}.`,
      recommendation,
      confidence,
      reasoning: reasoning.length > 0 ? reasoning : ['Insufficient data for detailed analysis']
    };
  }
}
