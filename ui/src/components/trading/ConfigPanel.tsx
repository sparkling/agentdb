import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Settings, Play, Square, RotateCcw } from "lucide-react";
import { useState } from "react";
import { TradingConfig } from "@/lib/trading/types";

interface ConfigPanelProps {
  config: TradingConfig;
  onConfigChange: (config: Partial<TradingConfig>) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  isRunning: boolean;
}

export const ConfigPanel = ({
  config,
  onConfigChange,
  onStart,
  onStop,
  onReset,
  isRunning
}: ConfigPanelProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card className="bg-panel border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-cyan" />
            <CardTitle>Trading Configuration</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-green-500/20 text-green-400 border-green-500/30" : ""}>
              {isRunning ? "Running" : "Stopped"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Control Buttons */}
        <div className="flex gap-2">
          {!isRunning ? (
            <Button
              onClick={onStart}
              className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/30"
            >
              <Play className="h-4 w-4 mr-2" />
              Start Trading
            </Button>
          ) : (
            <Button
              onClick={onStop}
              variant="destructive"
              className="flex-1"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop Trading
            </Button>
          )}
          <Button
            onClick={onReset}
            variant="outline"
            disabled={isRunning}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </div>

        {/* Basic Settings */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="capital">Initial Capital ($)</Label>
            <Input
              id="capital"
              type="number"
              value={config.initialCapital}
              onChange={(e) => onConfigChange({ initialCapital: parseFloat(e.target.value) })}
              disabled={isRunning}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="symbols">Trading Symbols (comma-separated)</Label>
            <Input
              id="symbols"
              value={config.symbols.join(', ')}
              onChange={(e) => onConfigChange({ symbols: e.target.value.split(',').map(s => s.trim()) })}
              disabled={isRunning}
              placeholder="AAPL, GOOGL, MSFT"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequency">Trading Frequency (seconds)</Label>
            <div className="flex items-center gap-4">
              <Slider
                id="frequency"
                min={1}
                max={60}
                step={1}
                value={[config.tradingFrequency / 1000]}
                onValueChange={([value]) => onConfigChange({ tradingFrequency: value * 1000 })}
                disabled={isRunning}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-12">
                {config.tradingFrequency / 1000}s
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>GOAP Planning</Label>
              <div className="text-xs text-muted-foreground">
                Goal-Oriented Action Planning
              </div>
            </div>
            <Switch
              checked={config.goapEnabled}
              onCheckedChange={(checked) => onConfigChange({ goapEnabled: checked })}
              disabled={isRunning}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>SAFLA Learning</Label>
              <div className="text-xs text-muted-foreground">
                Self-Aware Feedback Loop Algorithm
              </div>
            </div>
            <Switch
              checked={config.saflaEnabled}
              onCheckedChange={(checked) => onConfigChange({ saflaEnabled: checked })}
              disabled={isRunning}
            />
          </div>
        </div>

        {/* Advanced Settings Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full"
        >
          {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
        </Button>

        {showAdvanced && (
          <div className="space-y-4 pt-4 border-t border-border/50">
            <div className="space-y-2">
              <Label htmlFor="maxPosition">Max Position Size (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="maxPosition"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={[config.maxPositionSize]}
                  onValueChange={([value]) => onConfigChange({ maxPositionSize: value })}
                  disabled={isRunning}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(config.maxPositionSize * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="learningRate">Learning Rate</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="learningRate"
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  value={[config.learningRate]}
                  onValueChange={([value]) => onConfigChange({ learningRate: value })}
                  disabled={isRunning}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground w-16">
                  {config.learningRate.toFixed(3)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stopLoss">Stop Loss (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="stopLoss"
                  min={1}
                  max={20}
                  step={1}
                  value={[config.stopLoss * 100]}
                  onValueChange={([value]) => onConfigChange({ stopLoss: value / 100 })}
                  disabled={isRunning}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(config.stopLoss * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="takeProfit">Take Profit (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="takeProfit"
                  min={5}
                  max={50}
                  step={5}
                  value={[config.takeProfit * 100]}
                  onValueChange={([value]) => onConfigChange({ takeProfit: value / 100 })}
                  disabled={isRunning}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(config.takeProfit * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Use Real Data Feeds</Label>
                <div className="text-xs text-muted-foreground">
                  Requires API keys
                </div>
              </div>
              <Switch
                checked={config.useRealFeeds}
                onCheckedChange={(checked) => onConfigChange({ useRealFeeds: checked })}
                disabled={isRunning}
              />
            </div>

            {config.useRealFeeds && (
              <div className="space-y-2 pl-4 border-l-2 border-cyan/30">
                <div className="space-y-2">
                  <Label htmlFor="geminiKey">Gemini API Key</Label>
                  <Input
                    id="geminiKey"
                    type="password"
                    placeholder="Enter Gemini API key"
                    disabled={isRunning}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Get your free API key at{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">
                    Google AI Studio
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
