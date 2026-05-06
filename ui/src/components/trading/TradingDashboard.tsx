import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign, Activity, Brain, Zap } from "lucide-react";
import { PerformanceMetrics, Position } from "@/lib/trading/types";

interface TradingDashboardProps {
  performance: PerformanceMetrics | null;
  positions: Position[];
  cashBalance: number;
  isRunning: boolean;
  learningStats: {
    totalFeedback: number;
    successRate: number;
    avgReward: number;
    learningRate: number;
  };
}

export const TradingDashboard = ({
  performance,
  positions,
  cashBalance,
  isRunning,
  learningStats
}: TradingDashboardProps) => {
  const totalValue = performance?.portfolioValue || cashBalance;
  const returnPercent = performance?.totalReturn || 0;
  const isPositive = returnPercent >= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Portfolio Value */}
      <Card className="bg-panel border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Portfolio Value
          </CardTitle>
          <DollarSign className="h-4 w-4 text-cyan" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            ${totalValue.toFixed(2)}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-green-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
            <span className={`text-sm ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {returnPercent >= 0 ? '+' : ''}{returnPercent.toFixed(2)}%
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Cash Balance */}
      <Card className="bg-panel border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cash Balance
          </CardTitle>
          <DollarSign className="h-4 w-4 text-purple-400" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            ${cashBalance.toFixed(2)}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {positions.length} active positions
          </div>
        </CardContent>
      </Card>

      {/* Win Rate */}
      <Card className="bg-panel border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Win Rate
          </CardTitle>
          <Activity className="h-4 w-4 text-green-400" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {performance?.winRate.toFixed(1) || 0}%
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {performance?.totalTrades || 0} total trades
          </div>
        </CardContent>
      </Card>

      {/* Learning Status */}
      <Card className="bg-panel border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            AI Learning
          </CardTitle>
          <Brain className="h-4 w-4 text-cyan" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {(learningStats.successRate * 100).toFixed(1)}%
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isRunning && <Zap className="h-3 w-3 text-cyan animate-pulse" />}
            <span className="text-sm text-muted-foreground">
              {learningStats.totalFeedback} patterns learned
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Risk Metrics */}
      <Card className="bg-panel border-border/50 md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Risk Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Sharpe Ratio</div>
              <div className="text-lg font-bold text-foreground">
                {performance?.sharpeRatio.toFixed(2) || '0.00'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Max Drawdown</div>
              <div className="text-lg font-bold text-red-400">
                -{performance?.maxDrawdown.toFixed(2) || '0.00'}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Avg Return</div>
              <div className="text-lg font-bold text-foreground">
                ${performance?.averageReturn.toFixed(2) || '0.00'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Positions */}
      <Card className="bg-panel border-border/50 md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Active Positions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No active positions
            </div>
          ) : (
            <div className="space-y-2">
              {positions.slice(0, 5).map((position) => {
                const pnl = position.unrealizedPnL + position.realizedPnL;
                const pnlPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
                const isProfitable = pnl >= 0;

                return (
                  <div key={position.symbol} className="flex items-center justify-between p-2 rounded bg-background/50">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono">
                        {position.symbol}
                      </Badge>
                      <div>
                        <div className="text-sm font-medium">{position.quantity} shares</div>
                        <div className="text-xs text-muted-foreground">
                          Entry: ${position.entryPrice.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-medium ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                        {isProfitable ? '+' : ''}${pnl.toFixed(2)}
                      </div>
                      <div className={`text-xs ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                        {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
