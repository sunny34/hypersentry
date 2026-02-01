'use client';
import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Play, TrendingUp, TrendingDown, Activity, DollarSign, Copy, RefreshCw, ChevronRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface StrategySimulatorProps {
    symbol: string;
    currentPrice: number;
    fundingRate: number; // Daily rate? Usually hourly from HL.
    onCopyTrade: (side: 'buy' | 'sell', price: number, type: 'market' | 'limit') => void;
}

type StrategyType = 'funding_arb' | 'rsi_reversal' | 'momentum' | 'liquidation';

interface BacktestResult {
    pnl: number;
    winRate: number;
    trades: number;
    params: string;
    sharpeRatio?: number;
    reasoning?: string;
    equityCurve: { time: string; value: number }[];
    recommendation: 'long' | 'short' | 'neutral';
    entryPrice: number;
}

export default function StrategySimulator({ symbol, currentPrice, fundingRate, onCopyTrade }: StrategySimulatorProps) {
    const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('funding_arb');
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<BacktestResult | null>(null);

    // Real Backtest Engine (Server-Side)
    const runBacktest = async () => {
        setIsRunning(true);
        setResult(null);

        try {
            // Use environment variable or default to localhost for dev
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

            // Map UI strategy names to backend endpoints if needed, actually name matches or mapped here
            const strategyMap: Record<StrategyType, string> = {
                'funding_arb': 'funding',
                'rsi_reversal': 'rsi',
                'momentum': 'momentum',
                'liquidation': 'liquidation'
            };

            const res = await axios.post(`${apiUrl}/strategies/backtest`, {
                strategy: strategyMap[selectedStrategy],
                token: symbol,
                params: {
                    interval: '1h',
                    fundingRate: fundingRate
                }
            });

            if (res.data.error) {
                console.error("Backtest error:", res.data.error);
                return;
            }

            setResult(res.data);
        } catch (e) {
            console.error("Backtest connection failed:", e);
            // Fallback for UI resilience if backend is down
            setResult({
                pnl: 0,
                winRate: 0,
                trades: 0,
                params: 'Backend connection failed',
                equityCurve: [],
                recommendation: 'neutral',
                entryPrice: currentPrice,
                reasoning: "Unable to connect to strategy engine."
            });
        } finally {
            setIsRunning(false);
        }
    };
    useEffect(() => {
        // Only run if we have a valid price (and not 0/stale) to avoid weird results
        if (currentPrice > 0) {
            runBacktest();
        }
    }, [selectedStrategy, symbol, currentPrice]);

    return (
        <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-full">
            {/* Header */}
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                        <Activity className="w-4 h-4" />
                    </div>
                    <h3 className="font-bold text-sm">Strategy Lab</h3>
                </div>
                <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5 overflow-x-auto max-w-[200px] lg:max-w-none scrollbar-hide">
                    {(['funding_arb', 'rsi_reversal', 'momentum', 'liquidation'] as StrategyType[]).map(s => (
                        <button
                            key={s}
                            onClick={() => setSelectedStrategy(s)}
                            className={`px-2 py-1 text-[10px] uppercase font-bold rounded-md transition-all whitespace-nowrap ${selectedStrategy === s ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {s.replace('_', ' ').split(' ')[0]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {isRunning ? (
                    <div className="h-40 flex flex-col items-center justify-center text-gray-500 gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                        <span className="text-xs font-mono">Simulating {symbol} 24h...</span>
                    </div>
                ) : result ? (
                    <>
                        {/* PnL Card */}
                        <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/50 relative overflow-hidden">
                            <div className="flex justify-between items-start mb-2 relative z-10">
                                <div>
                                    <div className="text-xs text-gray-500 mb-0.5">Est. 24h PnL</div>
                                    <div className={`text-xl font-bold font-mono ${result.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {result.pnl >= 0 ? '+' : ''}{result.pnl.toFixed(2)}%
                                    </div>
                                </div>
                                <div className="text-right space-y-1">
                                    <div>
                                        <div className="text-[10px] text-gray-500">Win Rate</div>
                                        <div className="text-xs font-bold text-gray-200">{result.winRate.toFixed(0)}%</div>
                                    </div>
                                    {result.sharpeRatio !== undefined && (
                                        <div>
                                            <div className="text-[10px] text-gray-500">Sharpe</div>
                                            <div className={`text-xs font-bold ${result.sharpeRatio > 2 ? 'text-emerald-400' : 'text-gray-300'}`}>
                                                {result.sharpeRatio.toFixed(2)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Mini Chart */}
                            <div className="h-24 -mx-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={result.equityCurve}>
                                        <defs>
                                            <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={result.pnl >= 0 ? '#10B981' : '#EF4444'} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={result.pnl >= 0 ? '#10B981' : '#EF4444'} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke={result.pnl >= 0 ? '#10B981' : '#EF4444'}
                                            strokeWidth={2}
                                            fill="url(#colorPnl)"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* AI Insight */}
                        {result.reasoning && (
                            <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></div>
                                    <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider">AI Insight</span>
                                </div>
                                <p className="text-xs text-blue-100/80 leading-relaxed">
                                    {result.reasoning}
                                </p>
                            </div>
                        )}

                        {/* Signal & Action */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                                <span>Signal:</span>
                                <span className={`uppercase font-bold ${result.recommendation === 'long' ? 'text-emerald-400' :
                                    result.recommendation === 'short' ? 'text-red-400' : 'text-gray-500'
                                    }`}>
                                    {result.recommendation} NOW
                                </span>
                            </div>

                            {result.recommendation !== 'neutral' && (
                                <button
                                    onClick={() => onCopyTrade(result.recommendation as 'buy' | 'sell', result.entryPrice, 'limit')}
                                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold text-sm transition-all shadow-lg shadow-blue-900/20 active:scale-95"
                                >
                                    <Copy className="w-4 h-4" />
                                    Copy {result.recommendation.toUpperCase()} Signal
                                </button>
                            )}
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}
