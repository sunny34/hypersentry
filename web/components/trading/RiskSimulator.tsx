'use client';

import { useState, useMemo, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, ReferenceLine, AreaChart, Area
} from 'recharts';
import { Play, RotateCcw, TrendingUp, AlertTriangle, ShieldAlert, Activity, DollarSign } from 'lucide-react';
import axios from 'axios';

interface SimulationParams {
    initialCapital: number;
    winRate: number; // 0-100
    riskPerTrade: number; // % of current equity
    rewardRatio: number; // e.g., 2.0 for 1:2
    numTrades: number;
    numSimulations: number;
    token: string; // Token to base simulation on (optional)
    useHistorical: boolean; // Toggle for historical bootstrapping
}

interface SimulationResult {
    paths: { name: string; data: { trade: number; equity: number }[] }[];
    finalEquities: number[];
    ruinProbability: number;
    medianEq: number;
    var95: number; // Value at Risk (95%)
    survivalCurve: { trade: number; probability: number }[];
}

interface RiskSimulatorProps {
    positions?: any[];
    walletBalance?: number;
}

export default function RiskSimulator({ positions = [], walletBalance = 0 }: RiskSimulatorProps) {
    const [params, setParams] = useState<SimulationParams>({
        initialCapital: walletBalance > 0 ? walletBalance : 10000,
        winRate: 50,
        riskPerTrade: 1, // 1% risk
        rewardRatio: 2.0,
        numTrades: 100,
        numSimulations: 50,
        token: 'BTC',
        useHistorical: false
    });

    const [livePortfolioMode, setLivePortfolioMode] = useState(false);

    const [result, setResult] = useState<SimulationResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<'paths' | 'survival'>('paths');
    const [tokens, setTokens] = useState<string[]>(['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC']);

    // Fetch tokens on mount
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
                const res = await axios.get(`${apiUrl}/trading/tokens`);
                if (res.data.tokens) {
                    setTokens(res.data.tokens.map((t: any) => t.symbol));
                }
            } catch (e) { console.error(e); }
        };
        fetchTokens();
    }, []);

    const runSimulation = async () => {
        setLoading(true);
        const paths = [];
        const finalEquities = [];
        let ruinCount = 0;

        let historicalReturns: number[] = [];

        if (params.useHistorical) {
            try {
                // Fetch historical candles to calculate REAL returns distribution
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
                const endTime = Date.now();
                const startTime = endTime - (30 * 24 * 60 * 60 * 1000); // 30 days

                const res = await axios.post(`${apiUrl}/trading/candles`, {
                    token: params.token,
                    interval: '1h',
                    start_time: startTime,
                    end_time: endTime
                });

                if (res.data && res.data.length > 0) {
                    // Calculate % change per candle
                    for (let i = 1; i < res.data.length; i++) {
                        const prev = parseFloat(res.data[i - 1].c);
                        const curr = parseFloat(res.data[i].c);
                        const pctChange = (curr - prev) / prev;
                        historicalReturns.push(pctChange);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch historical data", e);
                // Fallback to random if fetch fails
                historicalReturns = [];
            }
        }

        for (let sim = 0; sim < params.numSimulations; sim++) {
            let equity = params.initialCapital;
            const path = [{ trade: 0, equity }];
            let isRuined = false;

            for (let trade = 1; trade <= params.numTrades; trade++) {

                if (params.useHistorical && historicalReturns.length > 0) {
                    // BOOTSTRAP: Sample a random return from history
                    const randomIdx = Math.floor(Math.random() * historicalReturns.length);
                    const marketMove = historicalReturns[randomIdx];

                    // Simple logic: If we are LONG, return = marketMove. 
                    // This simulates passive holding or random entry dynamics on real volatility.

                    // HYBRID MODEL:
                    // Use user's Win Rate to determine direction correctness.
                    // But use Historical Return Magnitude for size of move.

                    const isWin = Math.random() * 100 < params.winRate;
                    const magnitude = Math.abs(marketMove) * 100 * 5; // Scaling factor (5x leverage simulated magnitude)
                    const riskAmount = equity * (params.riskPerTrade / 100);

                    if (isWin) {
                        equity += riskAmount * params.rewardRatio * (1 + magnitude);
                    } else {
                        equity -= riskAmount * (1 + magnitude);
                    }

                } else {
                    // STANDARD MONTE CARLO (Gaussian/Binary)
                    const isWin = Math.random() * 100 < params.winRate;
                    const riskAmount = equity * (params.riskPerTrade / 100);

                    if (isWin) {
                        equity += riskAmount * params.rewardRatio;
                    } else {
                        equity -= riskAmount;
                    }
                }

                if (equity < params.initialCapital * 0.1) {
                    isRuined = true;
                    equity = 0;
                    break;
                }
                path.push({ trade, equity });
                if (isRuined) break;
            }
            if (isRuined) path.push({ trade: params.numTrades, equity: 0 }); // ensure path ends

            paths.push({ name: `Sim ${sim}`, data: path });
            finalEquities.push(equity);
            if (isRuined) ruinCount++;
        }

        // Calculate Survival Curve
        const survivalCurve = [];
        for (let trade = 0; trade <= params.numTrades; trade++) {
            let survivors = 0;
            for (const p of paths) {
                const tradeData = p.data.find(d => d.trade === trade);
                if (tradeData && tradeData.equity > 0) {
                    survivors++;
                } else if (!tradeData && p.data[p.data.length - 1].equity > 0) {
                    // If trade number is beyond path length but equity was > 0, they survived
                    // but the loop broke for other reasons. Actually if they hit ruin, we break.
                    // So no trade data means they hit ruin earlier.
                }
            }
            survivalCurve.push({ trade, probability: (survivors / params.numSimulations) * 100 });
        }

        finalEquities.sort((a, b) => a - b);
        const medianEq = finalEquities[Math.floor(finalEquities.length / 2)];
        const varIndex = Math.floor(finalEquities.length * 0.05);
        const var95 = params.initialCapital - finalEquities[varIndex];

        setResult({
            paths: paths.slice(0, 50),
            finalEquities,
            ruinProbability: (ruinCount / params.numSimulations) * 100,
            medianEq: medianEq || 0,
            var95: var95 > 0 ? var95 : 0,
            survivalCurve
        });
        setLoading(false);
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-full p-6 text-gray-200">
            {/* Controls Panel */}
            <div className="w-full lg:w-80 flex flex-col gap-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm h-fit">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Activity className="text-blue-500" />
                        <h2 className="text-xl font-bold">Parameters</h2>
                    </div>
                </div>

                {/* Presets */}
                <div className="grid grid-cols-3 gap-2">
                    <button
                        onClick={() => setParams(p => ({ ...p, winRate: 60, riskPerTrade: 1, rewardRatio: 1.5, numTrades: 100 }))}
                        className="px-2 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase rounded border border-emerald-500/20 transition-colors"
                    >
                        Conservative
                    </button>
                    <button
                        onClick={() => setParams(p => ({ ...p, winRate: 50, riskPerTrade: 2, rewardRatio: 2.5, numTrades: 100 }))}
                        className="px-2 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase rounded border border-blue-500/20 transition-colors"
                    >
                        Moderate
                    </button>
                    <button
                        onClick={() => setParams(p => ({ ...p, winRate: 35, riskPerTrade: 5, rewardRatio: 5, numTrades: 50 }))}
                        className="px-2 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-[10px] font-bold uppercase rounded border border-purple-500/20 transition-colors"
                    >
                        Degen
                    </button>
                </div>

                {/* Live Portfolio Integration */}
                {(walletBalance > 0 || positions.length > 0) && (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 flex items-center gap-2">
                                <DollarSign className="w-3 h-3" />
                                Portfolio Seeding
                            </span>
                            <span className="text-[8px] font-bold text-gray-500 bg-white/5 px-1.5 py-0.5 rounded tracking-tighter uppercase font-mono">
                                Live Data Active
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div className="flex flex-col">
                                <span className="text-gray-500 font-bold uppercase">Balance</span>
                                <span className="text-white font-mono">${walletBalance.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-gray-500 font-bold uppercase">Exposure</span>
                                <span className="text-white font-mono">
                                    ${positions.reduce((acc, p) => acc + (parseFloat(p.positionValue) || 0), 0).toLocaleString()}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                const totalNotional = positions.reduce((acc, p) => acc + (parseFloat(p.positionValue) || 0), 0);
                                const riskFromExposure = walletBalance > 0 ? (totalNotional / walletBalance) : 1;
                                setParams(prev => ({
                                    ...prev,
                                    initialCapital: walletBalance,
                                    riskPerTrade: Math.max(0.1, Math.min(10, riskFromExposure)) // Cap at 10% for simulation sanity
                                }));
                            }}
                            className="w-full py-2 bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 text-[9px] font-black uppercase tracking-widest rounded-lg border border-blue-500/30 transition-all flex items-center justify-center gap-2"
                        >
                            Sync Portfolio to Sim
                        </button>
                    </div>
                )}

                <div className="space-y-4">

                    {/* Mode Toggle */}
                    <div className="bg-gray-800 p-2 rounded-lg flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={params.useHistorical}
                            onChange={(e) => setParams({ ...params, useHistorical: e.target.checked })}
                            className="w-4 h-4 accent-blue-500"
                        />
                        <label className="text-sm font-bold text-white">Use Actual Market Data</label>
                    </div>

                    {params.useHistorical && (
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Asset (Volatility Source)</label>
                            <select
                                value={params.token}
                                onChange={(e) => setParams({ ...params, token: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                {tokens.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <p className="text-[10px] text-gray-500 mt-1">Simulations will sample from real {params.token} hourly returns.</p>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Start Capital ($)</label>
                        <input
                            type="number"
                            value={params.initialCapital}
                            onChange={(e) => setParams({ ...params, initialCapital: Number(e.target.value) })}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Win Rate (%)</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="range" min="1" max="99"
                                value={params.winRate}
                                onChange={(e) => setParams({ ...params, winRate: Number(e.target.value) })}
                                className="flex-1"
                            />
                            <span className="w-12 text-right font-mono">{params.winRate}%</span>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Risk Reward (1:X)</label>
                        <input
                            type="number" step="0.1"
                            value={params.rewardRatio}
                            onChange={(e) => setParams({ ...params, rewardRatio: Number(e.target.value) })}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Risk Per Trade (%)</label>
                        <input
                            type="number" step="0.1"
                            value={params.riskPerTrade}
                            onChange={(e) => setParams({ ...params, riskPerTrade: Number(e.target.value) })}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Num Trades</label>
                        <input
                            type="number"
                            value={params.numTrades}
                            onChange={(e) => setParams({ ...params, numTrades: Number(e.target.value) })}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                </div>

                <button
                    onClick={runSimulation}
                    disabled={loading}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                    {loading ? <Activity className="animate-spin" /> : <Play size={18} />}
                    {loading ? 'Simulating...' : 'Run Simulation'}
                </button>
            </div>

            {/* Results Panel */}
            <div className="flex-1 flex flex-col gap-6">

                {result ? (
                    <>
                        {/* Metrics Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl backdrop-blur-sm">
                                <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Median Final Equity</div>
                                <div className={`text-2xl font-mono font-bold ${result.medianEq >= params.initialCapital ? 'text-emerald-400' : 'text-red-400'}`}>
                                    ${result.medianEq.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {((result.medianEq - params.initialCapital) / params.initialCapital * 100).toFixed(1)}% Return
                                </div>
                            </div>

                            <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl backdrop-blur-sm">
                                <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Risk of Ruin</div>
                                <div className={`text-2xl font-mono font-bold flex items-center gap-2 ${result.ruinProbability > 10 ? 'text-red-500' : 'text-yellow-400'}`}>
                                    {result.ruinProbability.toFixed(1)}%
                                    {result.ruinProbability > 10 && <AlertTriangle size={20} />}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Prob. of &lt;10% equity
                                </div>
                            </div>

                            <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl backdrop-blur-sm">
                                <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">VaR (95%)</div>
                                <div className="text-2xl font-mono font-bold text-orange-400">
                                    ${result.var95.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Worst 5% scenario loss
                                </div>
                            </div>
                        </div>

                        {/* Charts */}
                        <div className="flex-1 bg-gray-900/50 border border-gray-800 rounded-xl p-4 min-h-[400px]">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <TrendingUp className="text-emerald-500" />
                                    {view === 'paths' ?
                                        (params.useHistorical ? `Historical Bootstrap (${params.token})` : 'Monte Carlo Paths') :
                                        'Survival Probability Analysis'}
                                </h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setView('paths')}
                                        className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-all ${view === 'paths' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                                    >
                                        Equity Paths
                                    </button>
                                    <button
                                        onClick={() => setView('survival')}
                                        className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-all ${view === 'survival' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                                    >
                                        Survival Curve
                                    </button>
                                </div>
                            </div>

                            <ResponsiveContainer width="100%" height={350}>
                                {view === 'paths' ? (
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                                        <XAxis
                                            dataKey="trade"
                                            type="number"
                                            stroke="#9CA3AF"
                                            domain={[0, params.numTrades]}
                                            allowDuplicatedCategory={false}
                                        />
                                        <YAxis stroke="#9CA3AF" />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }}
                                            formatter={(value: any) => [`$${Number(value).toFixed(0)}`, 'Equity']}
                                            labelFormatter={() => ''}
                                        />
                                        {result.paths.map((series, i) => (
                                            <Line
                                                key={i}
                                                data={series.data}
                                                dataKey="equity"
                                                stroke={series.data[series.data.length - 1].equity > params.initialCapital ? "#10B981" : "#EF4444"}
                                                strokeWidth={1}
                                                dot={false}
                                                opacity={0.3}
                                                isAnimationActive={false}
                                            />
                                        ))}
                                        <ReferenceLine y={params.initialCapital} stroke="#6B7280" strokeDasharray="5 5" />
                                    </LineChart>
                                ) : (
                                    <AreaChart data={result.survivalCurve}>
                                        <defs>
                                            <linearGradient id="colorSurv" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
                                        <XAxis dataKey="trade" stroke="#9CA3AF" />
                                        <YAxis unit="%" stroke="#9CA3AF" domain={[0, 100]} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }}
                                            formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'Surv. Prob.']}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="probability"
                                            stroke="#a855f7"
                                            fillOpacity={1}
                                            fill="url(#colorSurv)"
                                            strokeWidth={3}
                                        />
                                    </AreaChart>
                                )}
                            </ResponsiveContainer>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 border border-dashed border-gray-800 rounded-xl">
                        <Activity size={48} className="mb-4 opacity-20" />
                        <p className="text-lg">Set parameters and click Run to simulate</p>
                    </div>
                )}
            </div>
        </div>
    );
}
