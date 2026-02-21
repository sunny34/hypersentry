'use client';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Play, TrendingUp, TrendingDown, Activity,
    Copy, RefreshCw, Settings2, ShieldCheck,
    BarChart3, Info, AlertTriangle, Target
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface StrategySimulatorProps {
    symbol: string;
    currentPrice: number;
    fundingRate: number;
    onCopyTrade: (side: 'buy' | 'sell', price: number, type: 'market' | 'limit') => void;
}

type StrategyType = 'rsi' | 'momentum' | 'funding' | 'liquidation';

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
    monteCarloPaths?: { time: number;[key: string]: number }[];
}

export default function StrategySimulator({ symbol, currentPrice, fundingRate, onCopyTrade }: StrategySimulatorProps) {
    const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('rsi');
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<BacktestResult | null>(null);
    const [showParams, setShowParams] = useState(true);
    const [view, setView] = useState<'backtest' | 'montecarlo'>('backtest');

    // Strategy Parameters
    const [params, setParams] = useState({
        rsi: { period: 14, overbought: 70, oversold: 30 },
        momentum: { short: 12, long: 26 },
        risk: { stopLoss: 2.5, takeProfit: 5.0, leverage: 5 }
    });

    const runBacktest = useCallback(async () => {
        setIsRunning(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const res = await axios.post(`${apiUrl}/strategies/backtest`, {
                strategy: selectedStrategy,
                token: symbol,
                params: {
                    ...params[selectedStrategy === 'momentum' ? 'momentum' : 'rsi'],
                    ...params.risk,
                    interval: '1h',
                    fundingRate: fundingRate
                }
            });

            if (res.data.error) throw new Error(res.data.error);

            // Generate Monte Carlo paths locally for visualization depth
            const mcPaths = generateMonteCarlo(res.data.winRate || 50, params.risk.leverage, params.risk.takeProfit, params.risk.stopLoss);

            setResult({
                ...res.data,
                monteCarloPaths: mcPaths
            });
        } catch (e) {
            console.error("Backtest failed:", e);
            const demoPnL = -2.4;
            const demoWinRate = 45;
            const mcPaths = generateMonteCarlo(demoWinRate, params.risk.leverage, params.risk.takeProfit, params.risk.stopLoss);

            setResult({
                pnl: demoPnL,
                winRate: demoWinRate,
                trades: 12,
                params: 'Demo Mode (Backend Unavailable)',
                equityCurve: Array.from({ length: 20 }, (_, i) => ({ time: `T-${20 - i}`, value: 1000 + Math.random() * 100 - 50 })),
                recommendation: 'neutral',
                entryPrice: currentPrice,
                reasoning: "Strategy Lab: Adjust parameters to find edge.",
                monteCarloPaths: mcPaths
            });
        } finally {
            setIsRunning(false);
        }
    }, [selectedStrategy, symbol, params, fundingRate, currentPrice]);

    const generateMonteCarlo = (winRate: number, leverage: number, tp: number, sl: number) => {
        const paths = 20;
        const steps = 30;
        const results = [];

        for (let i = 0; i <= steps; i++) {
            const step: any = { time: i };
            for (let p = 0; p < paths; p++) {
                if (i === 0) {
                    step[`path${p}`] = 1000;
                } else {
                    const prev = results[i - 1][`path${p}`];
                    const win = Math.random() * 100 < winRate;
                    const change = win ? (tp / 100 * leverage) : (-sl / 100 * leverage);
                    step[`path${p}`] = prev * (1 + change);
                }
            }
            results.push(step);
        }
        return results;
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            if (currentPrice > 0) runBacktest();
        }, 500); // Debounce
        return () => clearTimeout(timer);
    }, [runBacktest, currentPrice]);

    return (
        <div className="flex flex-col h-full bg-[#050505] font-mono select-none overflow-hidden">
            {/* Header / Strategy Selector */}
            <div className="flex items-center justify-between p-3 border-b border-white/5 bg-black/40">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                        <BarChart3 className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Strategy Simulator</h3>
                        <span className="text-[8px] text-gray-500 font-bold">V1.2 - Backtest Engine</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex bg-white/5 rounded-lg p-1 border border-white/5">
                        {(['rsi', 'momentum', 'funding', 'liquidation'] as StrategyType[]).map(s => (
                            <button
                                key={s}
                                onClick={() => setSelectedStrategy(s)}
                                className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-tighter rounded-md transition-all ${selectedStrategy === s ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => setShowParams(!showParams)}
                        className={`p-1.5 rounded-lg transition-colors ${showParams ? 'text-blue-400 bg-blue-400/10' : 'text-gray-500 hover:text-white bg-white/5'}`}
                    >
                        <Settings2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Parameter Sidebar */}
                {showParams && (
                    <div className="w-[180px] border-r border-white/5 bg-black/20 p-4 space-y-6 overflow-y-auto">
                        <div className="space-y-4">
                            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500 flex items-center gap-2">
                                <ShieldCheck className="w-3 h-3" /> Risk Guard
                            </h4>
                            <div className="space-y-3">
                                <div>
                                    <div className="flex justify-between text-[8px] text-gray-500 mb-1.5 uppercase font-bold">
                                        <span>Lev: {params.risk.leverage}x</span>
                                    </div>
                                    <input
                                        type="range" min="1" max="50" step="1"
                                        value={params.risk.leverage}
                                        onChange={(e) => setParams(prev => ({ ...prev, risk: { ...prev.risk, leverage: parseInt(e.target.value) } }))}
                                        className="w-full accent-blue-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between text-[8px] text-gray-500 mb-1.5 uppercase font-bold">
                                        <span>TP: {params.risk.takeProfit}%</span>
                                    </div>
                                    <input
                                        type="range" min="1" max="20" step="0.5"
                                        value={params.risk.takeProfit}
                                        onChange={(e) => setParams(prev => ({ ...prev, risk: { ...prev.risk, takeProfit: parseFloat(e.target.value) } }))}
                                        className="w-full accent-emerald-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between text-[8px] text-gray-500 mb-1.5 uppercase font-bold">
                                        <span>SL: {params.risk.stopLoss}%</span>
                                    </div>
                                    <input
                                        type="range" min="0.5" max="10" step="0.1"
                                        value={params.risk.stopLoss}
                                        onChange={(e) => setParams(prev => ({ ...prev, risk: { ...prev.risk, stopLoss: parseFloat(e.target.value) } }))}
                                        className="w-full accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500 flex items-center gap-2 border-t border-white/5 pt-4">
                                <Play className="w-3 h-3" /> Strategy
                            </h4>
                            {selectedStrategy === 'rsi' && (
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between text-[8px] text-gray-500 mb-1.5 uppercase font-bold">
                                            <span>Period: {params.rsi.period}</span>
                                        </div>
                                        <input
                                            type="range" min="5" max="30" step="1"
                                            value={params.rsi.period}
                                            onChange={(e) => setParams(prev => ({ ...prev, rsi: { ...prev.rsi, period: parseInt(e.target.value) } }))}
                                            className="w-full accent-blue-400 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="p-2 bg-white/5 rounded border border-white/5">
                                            <span className="text-[7px] text-gray-500 block mb-1">OB</span>
                                            <span className="text-[10px] font-bold text-red-400">{params.rsi.overbought}</span>
                                        </div>
                                        <div className="p-2 bg-white/5 rounded border border-white/5">
                                            <span className="text-[7px] text-gray-500 block mb-1">OS</span>
                                            <span className="text-[10px] font-bold text-emerald-400">{params.rsi.oversold}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {selectedStrategy === 'momentum' && (
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between text-[8px] text-gray-500 mb-1.5 uppercase font-bold">
                                            <span>Fast: {params.momentum.short}</span>
                                        </div>
                                        <input
                                            type="range" min="5" max="25" step="1"
                                            value={params.momentum.short}
                                            onChange={(e) => setParams(prev => ({ ...prev, momentum: { ...prev.momentum, short: parseInt(e.target.value) } }))}
                                            className="w-full accent-blue-400 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Results View */}
                <div className="flex-1 p-6 relative flex flex-col gap-6 overflow-y-auto min-w-0">
                    {isRunning && (
                        <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                            <div className="relative">
                                <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
                                <div className="absolute inset-0 scale-150 blur-xl bg-blue-500/20 rounded-full"></div>
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-black uppercase tracking-widest text-white block mb-1">Hypertesting {symbol}</span>
                                <span className="text-[10px] text-gray-500 font-bold">Aggregating 30D historical candles...</span>
                            </div>
                        </div>
                    )}

                    {result ? (
                        <>
                            {/* Analytics Grid */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
                                    <div className="text-[8px] text-gray-500 uppercase font-black tracking-widest mb-1.5 flex items-center gap-1.5">
                                        <TrendingUp className="w-3 h-3 text-emerald-400" /> Projected PnL
                                    </div>
                                    <div className={`text-xl font-black ${result.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'} flex items-baseline gap-1`}>
                                        {result.pnl >= 0 ? '+' : ''}{result.pnl.toFixed(2)}%
                                        <span className="text-[10px] text-gray-500 font-bold uppercase ml-1">Est</span>
                                    </div>
                                </div>
                                <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
                                    <div className="text-[8px] text-gray-500 uppercase font-black tracking-widest mb-1.5 flex items-center gap-1.5">
                                        <ShieldCheck className="w-3 h-3 text-blue-400" /> Win Rate
                                    </div>
                                    <div className="text-xl font-black text-white">
                                        {result.winRate.toFixed(1)}%
                                        <span className="text-[10px] text-gray-500 font-bold block">OF {result.trades} TRADES</span>
                                    </div>
                                </div>
                                <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
                                    <div className="text-[8px] text-gray-500 uppercase font-black tracking-widest mb-1.5 flex items-center gap-1.5">
                                        <Target className="w-3 h-3 text-purple-400" /> Success Prob.
                                    </div>
                                    <div className={`text-xl font-black text-white`}>
                                        {result.monteCarloPaths ?
                                            Math.round((result.monteCarloPaths[result.monteCarloPaths.length - 1].path0 > 1000 ? 1 : 0 +
                                                result.monteCarloPaths[result.monteCarloPaths.length - 1].path1 > 1000 ? 1 : 0 +
                                                    result.monteCarloPaths[result.monteCarloPaths.length - 1].path2 > 1000 ? 1 : 0) / 3 * 100) : 58}%
                                        <span className="text-[10px] text-gray-500 font-bold block uppercase">Monte Carlo</span>
                                    </div>
                                </div>
                            </div>

                            {/* Equity Curve Main Chart */}
                            <div className="flex-1 min-h-[220px] bg-black/40 border border-white/5 rounded-2xl p-4 flex flex-col">
                                <div className="flex justify-between items-center mb-4">
                                    <div className="flex items-center gap-2">
                                        <Target className="w-3.5 h-3.5 text-blue-400" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-300">Portfolio Growth Simulation</span>
                                    </div>
                                    <div className="flex gap-4">
                                        <button
                                            onClick={() => setView('backtest')}
                                            className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded transition-all ${view === 'backtest' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                        >
                                            Historical
                                        </button>
                                        <button
                                            onClick={() => setView('montecarlo')}
                                            className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded transition-all ${view === 'montecarlo' ? 'bg-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                                        >
                                            Monte Carlo
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 w-full translate-x-[-20px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        {view === 'backtest' ? (
                                            <AreaChart data={result.equityCurve}>
                                                <defs>
                                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <XAxis hide dataKey="time" />
                                                <YAxis
                                                    domain={['dataMin - 50', 'dataMax + 50']}
                                                    tick={{ fontSize: 8, fill: '#4b5563', fontWeight: 'bold' }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tickFormatter={(val) => `$${val.toFixed(0)}`}
                                                />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
                                                    itemStyle={{ color: '#3b82f6' }}
                                                />
                                                <Area
                                                    type="stepAfter"
                                                    dataKey="value"
                                                    stroke="#3b82f6"
                                                    strokeWidth={2}
                                                    fillOpacity={1}
                                                    fill="url(#colorValue)"
                                                />
                                            </AreaChart>
                                        ) : (
                                            <LineChart data={result.monteCarloPaths}>
                                                <XAxis hide dataKey="time" />
                                                <YAxis
                                                    domain={['dataMin - 100', 'dataMax + 100']}
                                                    tick={{ fontSize: 8, fill: '#4b5563', fontWeight: 'bold' }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tickFormatter={(val) => `$${val.toFixed(0)}`}
                                                />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
                                                />
                                                {Array.from({ length: 15 }).map((_, i) => (
                                                    <Line
                                                        key={i}
                                                        type="monotone"
                                                        dataKey={`path${i}`}
                                                        stroke={i === 0 ? "#a855f7" : "#a855f744"}
                                                        strokeWidth={i === 0 ? 2 : 1}
                                                        dot={false}
                                                        isAnimationActive={false}
                                                    />
                                                ))}
                                            </LineChart>
                                        )}
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* AI Rationale & Execution */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Info className="w-4 h-4 text-blue-400" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-300 tracking-widest">Trade Logic Deployment</span>
                                    </div>
                                    <p className="text-[11px] text-blue-100/70 leading-relaxed italic pr-4">
                                        &quot;{result.reasoning || 'The current market regime favors this strategy due to normalized funding and low-volatile accumulation phase.'}&quot;
                                    </p>
                                </div>

                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between bg-black/40 border border-white/10 px-4 py-3 rounded-xl">
                                        <span className="text-[10px] font-bold text-gray-500 uppercase">Live Signal:</span>
                                        <div className="flex items-center gap-2">
                                            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${result.recommendation === 'long' ? 'bg-emerald-500' : result.recommendation === 'short' ? 'bg-red-500' : 'bg-gray-500'}`}></div>
                                            <span className={`text-xs font-black uppercase tracking-widest ${result.recommendation === 'long' ? 'text-emerald-400' : result.recommendation === 'short' ? 'text-red-400' : 'text-gray-400'}`}>
                                                {result.recommendation || 'Neutral'}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        disabled={result.recommendation === 'neutral'}
                                        onClick={() => onCopyTrade(result.recommendation as 'buy' | 'sell', result.entryPrice, 'market')}
                                        className="flex-1 flex items-center justify-center gap-3 bg-white text-black py-3 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all hover:bg-white/90 active:scale-95 disabled:opacity-50 disabled:grayscale"
                                    >
                                        <Copy className="w-4 h-4" />
                                        Launch Automated Execution
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-4 opacity-40">
                            <Activity className="w-12 h-12" />
                            <span className="text-xs font-black uppercase">Initialize Backtest Engine</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Warning Footer */}
            <div className="p-2.5 bg-red-500/5 border-t border-white/5 flex items-center gap-3">
                <AlertTriangle className="w-3 h-3 text-red-500/50" />
                <span className="text-[8px] font-bold text-gray-600 uppercase tracking-tighter">
                    Simulation results do not guarantee future performance. Subject to slippage and execution latency.
                </span>
            </div>
        </div>
    );
}
