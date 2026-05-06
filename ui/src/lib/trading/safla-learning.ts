// SAFLA (Self-Aware Feedback Loop Algorithm) Learning System

import { SAFLAFeedback, TradingAction, PerformanceMetrics, LearningPattern } from './types';

export class SAFLALearning {
  private db: any = null;
  private feedbackHistory: SAFLAFeedback[] = [];
  private learningRate: number;
  private adaptationThreshold: number;
  private sessionId: string;

  constructor(learningRate: number = 0.01, adaptationThreshold: number = 0.7) {
    this.learningRate = learningRate;
    this.adaptationThreshold = adaptationThreshold;
    this.sessionId = `trading_${Date.now()}`;
  }

  async initialize(): Promise<void> {
    try {
      // Use browser-compatible AgentDB from global window object (loaded via script tag)
      if (typeof (window as any).AgentDB === 'undefined') {
        throw new Error('AgentDB not loaded globally');
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

      console.log('SAFLA: AgentDB initialized');
    } catch (error) {
      console.error('SAFLA: Failed to initialize AgentDB', error);
    }
  }

  /**
   * Store a learning pattern in AgentDB
   */
  async storePattern(pattern: LearningPattern): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.insert({
        id: pattern.id,
        embedding: pattern.embedding,
        metadata: {
          marketConditions: pattern.marketConditions,
          action: pattern.action,
          outcome: pattern.outcome,
          successRate: pattern.successRate,
          usageCount: pattern.usageCount,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('SAFLA: Failed to store pattern', error);
    }
  }

  /**
   * Find similar patterns using vector search
   */
  async findSimilarPatterns(
    marketConditions: Record<string, any>,
    k: number = 5
  ): Promise<LearningPattern[]> {
    if (!this.db) return [];

    try {
      // Convert market conditions to embedding
      const embedding = this.marketConditionsToEmbedding(marketConditions);

      // Search for similar patterns
      const results = await this.db.search(embedding, k);

      return results.map(result => ({
        id: result.id || `pattern_${Date.now()}`,
        marketConditions: result.metadata?.marketConditions || {},
        action: result.metadata?.action || {} as TradingAction,
        outcome: result.metadata?.outcome || {} as SAFLAFeedback,
        embedding: result.embedding || [],
        successRate: result.metadata?.successRate || 0,
        usageCount: result.metadata?.usageCount || 0
      }));
    } catch (error) {
      console.error('SAFLA: Failed to find similar patterns', error);
      return [];
    }
  }

  /**
   * Process feedback and adapt learning
   */
  async processFeedback(feedback: SAFLAFeedback): Promise<void> {
    this.feedbackHistory.push(feedback);

    // Calculate moving average of success
    const recentFeedback = this.feedbackHistory.slice(-20);
    const successRate = recentFeedback.filter(f => f.success).length / recentFeedback.length;

    // Self-awareness: Analyze own performance
    const awareness = this.analyzeSelfAwareness(recentFeedback);

    // Adapt if performance is below threshold
    if (successRate < this.adaptationThreshold) {
      await this.triggerAdaptation(awareness);
    }

    // Update learning patterns in AgentDB
    await this.updateLearningPatterns(feedback);
  }

  /**
   * Self-awareness analysis
   */
  private analyzeSelfAwareness(feedback: SAFLAFeedback[]): {
    strengths: string[];
    weaknesses: string[];
    adaptationNeeded: boolean;
  } {
    const avgMetrics = this.calculateAverageMetrics(feedback);

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (avgMetrics.profitability > 0.7) strengths.push('profitability');
    else weaknesses.push('profitability');

    if (avgMetrics.accuracy > 0.7) strengths.push('accuracy');
    else weaknesses.push('accuracy');

    if (avgMetrics.riskManagement > 0.7) strengths.push('risk_management');
    else weaknesses.push('risk_management');

    if (avgMetrics.adaptability > 0.7) strengths.push('adaptability');
    else weaknesses.push('adaptability');

    return {
      strengths,
      weaknesses,
      adaptationNeeded: weaknesses.length > strengths.length
    };
  }

  private calculateAverageMetrics(feedback: SAFLAFeedback[]): {
    profitability: number;
    accuracy: number;
    riskManagement: number;
    adaptability: number;
  } {
    if (feedback.length === 0) {
      return { profitability: 0, accuracy: 0, riskManagement: 0, adaptability: 0 };
    }

    const sum = feedback.reduce(
      (acc, f) => ({
        profitability: acc.profitability + f.metrics.profitability,
        accuracy: acc.accuracy + f.metrics.accuracy,
        riskManagement: acc.riskManagement + f.metrics.riskManagement,
        adaptability: acc.adaptability + f.metrics.adaptability
      }),
      { profitability: 0, accuracy: 0, riskManagement: 0, adaptability: 0 }
    );

    return {
      profitability: sum.profitability / feedback.length,
      accuracy: sum.accuracy / feedback.length,
      riskManagement: sum.riskManagement / feedback.length,
      adaptability: sum.adaptability / feedback.length
    };
  }

  /**
   * Trigger adaptation based on self-awareness
   */
  private async triggerAdaptation(awareness: {
    strengths: string[];
    weaknesses: string[];
    adaptationNeeded: boolean;
  }): Promise<void> {
    console.log('SAFLA: Triggering adaptation', {
      strengths: awareness.strengths,
      weaknesses: awareness.weaknesses
    });

    // Adjust learning rate based on weaknesses
    if (awareness.weaknesses.includes('adaptability')) {
      this.learningRate = Math.min(0.1, this.learningRate * 1.2);
    }

    // Could trigger retraining, strategy adjustment, etc.
  }

  /**
   * Update learning patterns based on feedback
   */
  private async updateLearningPatterns(feedback: SAFLAFeedback): Promise<void> {
    // This would update existing patterns or create new ones
    // For now, just log
    console.log('SAFLA: Updating learning patterns', {
      success: feedback.success,
      reward: feedback.reward
    });
  }

  /**
   * Convert market conditions to embedding vector
   */
  private marketConditionsToEmbedding(conditions: Record<string, any>): number[] {
    // Simple embedding - in production, use proper feature engineering
    const features: number[] = [];

    // Price-based features
    features.push(conditions.price || 0);
    features.push(conditions.volume || 0);
    features.push(conditions.volatility || 0);
    features.push(conditions.trend || 0);

    // Sentiment features
    features.push(conditions.sentiment || 0);
    features.push(conditions.socialVolume || 0);

    // Polymarket features
    features.push(conditions.predictionProbability || 0);

    // Normalize to unit vector
    const magnitude = Math.sqrt(features.reduce((sum, f) => sum + f * f, 0));
    return magnitude > 0 ? features.map(f => f / magnitude) : features;
  }

  /**
   * Get learning statistics
   */
  getStatistics(): {
    totalFeedback: number;
    successRate: number;
    avgReward: number;
    learningRate: number;
  } {
    const successCount = this.feedbackHistory.filter(f => f.success).length;
    const avgReward = this.feedbackHistory.length > 0
      ? this.feedbackHistory.reduce((sum, f) => sum + f.reward, 0) / this.feedbackHistory.length
      : 0;

    return {
      totalFeedback: this.feedbackHistory.length,
      successRate: this.feedbackHistory.length > 0 ? successCount / this.feedbackHistory.length : 0,
      avgReward,
      learningRate: this.learningRate
    };
  }

  /**
   * Reset learning state
   */
  reset(): void {
    this.feedbackHistory = [];
    this.sessionId = `trading_${Date.now()}`;
  }
}
