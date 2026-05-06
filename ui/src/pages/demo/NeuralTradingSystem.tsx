import { useState, useEffect, useRef } from 'react';
import { ConsoleHeader } from '@/components/ConsoleHeader';
import { ConsoleFooter } from '@/components/ConsoleFooter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TradingDashboard } from '@/components/trading/TradingDashboard';
import { ConfigPanel } from '@/components/trading/ConfigPanel';
import { Brain, TrendingUp, Sparkles, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import { NeuralTrader } from '@/lib/trading/neural-trader';
import { TradingConfig, PerformanceMetrics, Position } from '@/lib/trading/types';

const defaultConfig: TradingConfig = {
  initialCapital: 100000,
  maxPositionSize: 0.2,
  maxPortfolioRisk: 0.5,
  symbols: ['AAPL', 'GOOGL', 'MSFT', 'NVDA', 'TSLA'],
  tradingFrequency: 15000, // 15 seconds to avoid rate limits
  stopLoss: 0.05,
  takeProfit: 0.15,
  learningRate: 0.01,
  explorationRate: 0.1,
  discountFactor: 0.95,
  useRealFeeds: false,
  apiKeys: {},
  goapEnabled: false,
  planningHorizon: 10,
  saflaEnabled: true,
  feedbackWindow: 20,
  adaptationThreshold: 0.7
};

const NeuralTradingSystem = () => {
  const [config, setConfig] = useState<TradingConfig>(defaultConfig);
  const [trader, setTrader] = useState<NeuralTrader | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [cashBalance, setCashBalance] = useState(config.initialCapital);
  const [learningStats, setLearningStats] = useState({
    totalFeedback: 0,
    successRate: 0,
    avgReward: 0,
    learningRate: config.learningRate
  });
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const updateInterval = useRef<NodeJS.Timeout>();

  // Initialize trader
  useEffect(() => {
    const waitForAgentDB = async (): Promise<void> => {
      // Wait for AgentDB to load from script tag
      const maxAttempts = 50; // 5 seconds max
      for (let i = 0; i < maxAttempts; i++) {
        if (typeof (window as any).AgentDB !== 'undefined') {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('AgentDB failed to load after 5 seconds');
    };

    const initTrader = async () => {
      try {
        addLog('⏳ Waiting for AgentDB to load...');
        await waitForAgentDB();
        addLog('✓ AgentDB library loaded');

        const newTrader = new NeuralTrader(config);
        await newTrader.initialize();
        setTrader(newTrader);
        setIsInitialized(true);
        addLog('✓ Neural Trading System initialized successfully');
        addLog('✓ AgentDB vector database ready');
        addLog('✓ GOAP planner initialized');
        addLog('✓ SAFLA learning system active');
      } catch (error) {
        console.error('Failed to initialize trader:', error);
        addLog('✗ Failed to initialize trading system');
        addLog(`✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    initTrader();

    return () => {
      if (trader) {
        trader.stop();
      }
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
      }
    };
  }, []);

  const addLog = (message: string) => {
    setActivityLog(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleStart = async () => {
    if (!trader || isRunning) return;

    // Set state immediately to prevent double-clicks
    setIsRunning(true);
    addLog('🚀 Starting trading system...');

    try {
      await trader.start();
      addLog('✓ Trading system started successfully');

      // Set up UI update interval
      updateInterval.current = setInterval(() => {
        const perf = trader.getPerformance();
        const portfolio = trader.getPortfolio();
        const stats = trader.getLearningStats();

        setPerformance(perf);
        setPositions(portfolio.positions);
        setCashBalance(portfolio.cashBalance);
        setLearningStats(stats);
      }, 1000);
    } catch (error) {
      console.error('Failed to start trader:', error);
      addLog('✗ Failed to start trading');
      setIsRunning(false); // Reset state on error
    }
  };

  const handleStop = () => {
    if (!trader) return;

    trader.stop();
    setIsRunning(false);
    addLog('⏸ Trading system stopped');

    if (updateInterval.current) {
      clearInterval(updateInterval.current);
    }
  };

  const handleReset = () => {
    if (!trader) return;

    trader.reset();
    setPerformance(null);
    setPositions([]);
    setCashBalance(config.initialCapital);
    setActivityLog([]);
    addLog('🔄 Trading system reset');
  };

  const handleConfigChange = (newConfig: Partial<TradingConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <ConsoleHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-12 bg-gradient-to-b from-background via-panel/50 to-background border-b border-border/50">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-4xl mx-auto">
              <Badge variant="secondary" className="mb-4">
                <Brain className="h-3 w-3 mr-2" />
                Advanced AI Trading
              </Badge>
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                Neural <span className="text-cyan">Trading</span> System
              </h1>
              <p className="text-lg text-muted-foreground mb-6">
                Multi-source AI trading with <strong>GOAP</strong> (Goal-Oriented Action Planning),
                <strong> SAFLA</strong> (Self-Aware Feedback Loop Algorithm), and <strong>AgentDB</strong> vector learning.
                Integrates stock feeds, social sentiment, and prediction markets.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
                <div className="flex items-center gap-2 px-4 py-2 bg-panel rounded-lg border border-border/50">
                  <TrendingUp className="h-4 w-4 text-cyan" />
                  <span className="text-sm">Real-time Market Data</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-panel rounded-lg border border-border/50">
                  <Brain className="h-4 w-4 text-purple-400" />
                  <span className="text-sm">GOAP Planning</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-panel rounded-lg border border-border/50">
                  <Sparkles className="h-4 w-4 text-green-400" />
                  <span className="text-sm">SAFLA Learning</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-panel rounded-lg border border-border/50">
                  <Activity className="h-4 w-4 text-cyan" />
                  <span className="text-sm">AgentDB WASM</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Status Alert */}
        <section className="container mx-auto px-6 py-6">
          <Alert className={isInitialized ? "border-green-500/30 bg-green-500/10" : "border-cyan/30 bg-cyan/10"}>
            {isInitialized ? (
              <CheckCircle2 className="h-4 w-4 text-green-400" />
            ) : (
              <AlertCircle className="h-4 w-4 text-cyan" />
            )}
            <AlertDescription>
              {isInitialized ? (
                <>
                  <strong>System Ready:</strong> AgentDB initialized with vector search, GOAP planner active, SAFLA learning enabled.
                  This is a realistic simulation - replace data feeds with real APIs for live trading.
                </>
              ) : (
                <>
                  <strong>Initializing:</strong> Setting up AgentDB, GOAP planner, and SAFLA learning system...
                </>
              )}
            </AlertDescription>
          </Alert>
        </section>

        {/* Main Dashboard */}
        <section className="container mx-auto px-6 pb-12">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: Config Panel */}
            <div className="lg:col-span-1">
              <ConfigPanel
                config={config}
                onConfigChange={handleConfigChange}
                onStart={handleStart}
                onStop={handleStop}
                onReset={handleReset}
                isRunning={isRunning}
              />

              {/* Activity Log */}
              <Card className="bg-panel border-border/50 mt-6">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Activity Log
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-xs">
                    {activityLog.length === 0 ? (
                      <div className="text-muted-foreground text-center py-4">
                        No activity yet
                      </div>
                    ) : (
                      activityLog.map((log, i) => (
                        <div key={i} className="text-muted-foreground">
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: Dashboard */}
            <div className="lg:col-span-2">
              <TradingDashboard
                performance={performance}
                positions={positions}
                cashBalance={cashBalance}
                isRunning={isRunning}
                learningStats={learningStats}
              />

              {/* Information Cards */}
              <div className="grid md:grid-cols-3 gap-4 mt-6">
                <Card className="bg-panel border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Brain className="h-4 w-4 text-purple-400" />
                      GOAP Planning
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Goal-Oriented Action Planning creates optimal action sequences to achieve trading goals.
                      Uses A* search to plan trades based on market conditions.
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-green-400" />
                      SAFLA Learning
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Self-Aware Feedback Loop Algorithm continuously learns from trading outcomes and adapts strategies in real-time.
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-panel border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="h-4 w-4 text-cyan" />
                      AgentDB WASM
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Vector database stores and retrieves successful trading patterns using similarity search in WebAssembly.
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Data Sources Info */}
              <Card className="bg-panel border-border/50 mt-6">
                <CardHeader>
                  <CardTitle className="text-sm">Multi-Source Data Integration</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="font-semibold text-cyan mb-2">Stock Market Data</div>
                      <div className="text-muted-foreground">
                        Real-time price, volume, and technical indicators. Replace simulation with Alpha Vantage, Yahoo Finance, or IEX Cloud APIs.
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-purple-400 mb-2">Social Sentiment</div>
                      <div className="text-muted-foreground">
                        Twitter, Reddit, and news sentiment analysis. Replace with Twitter API v2, Reddit API, or news sentiment APIs.
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-green-400 mb-2">Prediction Markets</div>
                      <div className="text-muted-foreground">
                        Polymarket probability data for market events. Replace with official Polymarket API for real predictions.
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Gemini Integration */}
              <Card className="bg-gradient-to-r from-purple-500/10 to-cyan/10 border-purple-500/30 mt-6">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    Gemini AI Market Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">
                    The system uses Google's Gemini AI to analyze market conditions by combining stock data, social sentiment, and prediction market probabilities into actionable insights.
                  </p>
                  <div className="text-xs bg-background/50 p-3 rounded border border-border/50">
                    <div className="font-semibold mb-2">Enable real Gemini integration:</div>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                      <li>Get a free API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">Google AI Studio</a></li>
                      <li>Enable "Use Real Data Feeds" in advanced settings</li>
                      <li>Enter your Gemini API key</li>
                      <li>The system will use real AI analysis for market decisions</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <ConsoleFooter />
    </div>
  );
};

export default NeuralTradingSystem;
