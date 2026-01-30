'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw, Sparkles, BarChart2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface AIAnalysisProps {
    symbol: string;
    interval?: string;
}

interface Analysis {
    direction: 'long' | 'short' | 'neutral';
    confidence: number;
    reasoning: string;
    indicators: {
        rsi: number;
        macd_signal: 'bullish' | 'bearish' | 'neutral';
        trend: 'up' | 'down' | 'sideways';
    };
    timestamp: number;
}

export default function AIAnalysis({ symbol, interval = "60" }: AIAnalysisProps) {
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchAnalysis = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const res = await axios.post(`${API_URL}/trading/analyze`, {
                token: symbol,
                interval: interval
            });
            setAnalysis(res.data);
        } catch (e: any) {
            console.error('AI analysis failed:', e);
            // Generate demo analysis
            setAnalysis(generateDemoAnalysis(symbol));
            setError('Using demo analysis (API not configured)');
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-analyze on symbol change
    useEffect(() => {
        fetchAnalysis();
    }, [symbol, interval]);

    const getDirectionColor = (dir: string) => {
        switch (dir) {
            case 'long': return 'text-emerald-400';
            case 'short': return 'text-red-400';
            default: return 'text-gray-400';
        }
    };

    const getDirectionBg = (dir: string) => {
        switch (dir) {
            case 'long': return 'bg-emerald-500/20 border-emerald-500/30';
            case 'short': return 'bg-red-500/20 border-red-500/30';
            default: return 'bg-gray-500/20 border-gray-500/30';
        }
    };

    const getDirectionIcon = (dir: string) => {
        switch (dir) {
            case 'long': return <TrendingUp className="w-8 h-8" />;
            case 'short': return <TrendingDown className="w-8 h-8" />;
            default: return <Minus className="w-8 h-8" />;
        }
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                        <Brain className="w-5 h-5 text-purple-400" />
                    </div>
                    <h3 className="text-lg font-bold">AI Analysis</h3>
                </div>
                <button
                    onClick={fetchAnalysis}
                    disabled={isLoading}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="text-xs text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-lg">
                    {error}
                </div>
            )}

            {analysis && (
                <>
                    {/* Main Recommendation */}
                    <div className={`p-4 rounded-xl border ${getDirectionBg(analysis.direction)} text-center`}>
                        <div className={`flex flex-col items-center gap-2 ${getDirectionColor(analysis.direction)}`}>
                            {getDirectionIcon(analysis.direction)}
                            <span className="text-2xl font-bold uppercase">{analysis.direction}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-center gap-2">
                            <Sparkles className="w-4 h-4 text-yellow-400" />
                            <span className="text-sm text-gray-400">
                                Confidence: <span className="font-bold text-white">{analysis.confidence}%</span>
                            </span>
                        </div>
                    </div>

                    {/* Reasoning */}
                    <div className="p-3 bg-gray-800/30 rounded-xl">
                        <p className="text-sm text-gray-300 leading-relaxed">{analysis.reasoning}</p>
                    </div>

                    {/* Indicators */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 bg-gray-800/30 rounded-xl text-center">
                            <div className="text-xs text-gray-500 mb-1">RSI</div>
                            <div className={`font-bold ${analysis.indicators.rsi > 70 ? 'text-red-400' :
                                analysis.indicators.rsi < 30 ? 'text-emerald-400' : 'text-gray-300'
                                }`}>
                                {analysis.indicators.rsi.toFixed(1)}
                            </div>
                        </div>
                        <div className="p-3 bg-gray-800/30 rounded-xl text-center">
                            <div className="text-xs text-gray-500 mb-1">MACD</div>
                            <div className={`font-bold capitalize ${analysis.indicators.macd_signal === 'bullish' ? 'text-emerald-400' :
                                analysis.indicators.macd_signal === 'bearish' ? 'text-red-400' : 'text-gray-300'
                                }`}>
                                {analysis.indicators.macd_signal}
                            </div>
                        </div>
                        <div className="p-3 bg-gray-800/30 rounded-xl text-center">
                            <div className="text-xs text-gray-500 mb-1">Trend</div>
                            <div className={`font-bold capitalize ${analysis.indicators.trend === 'up' ? 'text-emerald-400' :
                                analysis.indicators.trend === 'down' ? 'text-red-400' : 'text-gray-300'
                                }`}>
                                {analysis.indicators.trend}
                            </div>
                        </div>
                    </div>

                    {/* Timestamp */}
                    <div className="text-xs text-gray-500 text-center">
                        Updated {new Date(analysis.timestamp).toLocaleTimeString()}
                    </div>
                </>
            )}

            {isLoading && !analysis && (
                <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-gray-500" />
                </div>
            )}
        </div>
    );
}

// Demo analysis generator
function generateDemoAnalysis(symbol: string): Analysis {
    const directions: Analysis['direction'][] = ['long', 'short', 'neutral'];
    const direction = directions[Math.floor(Math.random() * 3)];
    const rsi = 30 + Math.random() * 40;

    const reasonings: Record<Analysis['direction'], string[]> = {
        long: [
            `${symbol} showing bullish divergence on RSI with price above 20 EMA. Support holding strong.`,
            `Volume surge with price breaking resistance. MACD crossing bullish. Good risk/reward setup.`,
            `Oversold bounce likely. RSI recovering from lows with higher lows forming on 4H chart.`,
        ],
        short: [
            `${symbol} rejected at resistance with bearish engulfing candle. RSI showing overbought divergence.`,
            `Breaking below key support with increasing volume. MACD bearish crossover confirmed.`,
            `Failed breakout pattern. Price below all major MAs with momentum fading.`,
        ],
        neutral: [
            `${symbol} in consolidation range. Wait for breakout confirmation before entering.`,
            `Mixed signals across timeframes. RSI neutral, no clear trend direction.`,
            `Low volume, tight range. Better to sit out until volatility picks up.`,
        ],
    };

    return {
        direction,
        confidence: 55 + Math.floor(Math.random() * 35),
        reasoning: reasonings[direction][Math.floor(Math.random() * 3)],
        indicators: {
            rsi,
            macd_signal: direction === 'long' ? 'bullish' : direction === 'short' ? 'bearish' : 'neutral',
            trend: direction === 'long' ? 'up' : direction === 'short' ? 'down' : 'sideways',
        },
        timestamp: Date.now(),
    };
}
