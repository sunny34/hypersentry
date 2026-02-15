'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, Skull, Crown, Fish, Anchor, Sparkles, RefreshCw, ExternalLink } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface CohortData {
    name: string;
    sentiment: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish';
    netFlow: number;
    volume: number;
    traders: number;
    avgPnl: number;
    sparkline: number[];
    icon: string;
}

interface TopTrader {
    address: string;
    pnl: number;
    volume: number;
    winRate: number;
    recentTrade?: {
        side: 'long' | 'short';
        coin: string;
        size: number;
    };
}

interface CohortSentimentProps {
    symbol: string;
}

/**
 * CohortSentiment Component
 * 
 * Shows what smart money (whales, profitable traders) are doing.
 * Fetches real leaderboard data from Hyperliquid when available.
 */
export default function CohortSentiment({ symbol }: CohortSentimentProps) {
    const [cohorts, setCohorts] = useState<CohortData[]>([]);
    const [topTraders, setTopTraders] = useState<TopTrader[]>([]);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<'pnl' | 'size'>('pnl');
    const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
    const [dataSource, setDataSource] = useState<'live' | 'simulated'>('simulated');
    const generateSimulatedDataRef = useRef<() => void>(() => {});

    // Fetch real leaderboard data
    const fetchLeaderboardData = useCallback(async () => {
        try {
            // Try to get real leaderboard data
            const res = await axios.get(`${API_URL}/market/leaderboard?limit=100`);

            if (res.data && Array.isArray(res.data) && res.data.length > 0) {
                setDataSource('live');

                // Analyze cohorts from real data
                const traders = res.data;

                // Segment by PnL tiers
                const extremelyProfitable = traders.filter((t: any) => t.pnl > 1000000);
                const veryProfitable = traders.filter((t: any) => t.pnl > 100000 && t.pnl <= 1000000);
                const profitable = traders.filter((t: any) => t.pnl > 0 && t.pnl <= 100000);
                const rekt = traders.filter((t: any) => t.pnl < 0);

                // Calculate sentiment based on recent positions
                const calcSentiment = (group: any[]): CohortData['sentiment'] => {
                    if (group.length === 0) return 'neutral';
                    const longs = group.filter((t: any) => t.recentSide === 'long').length;
                    const ratio = longs / group.length;
                    if (ratio > 0.7) return 'very_bullish';
                    if (ratio > 0.55) return 'bullish';
                    if (ratio < 0.3) return 'very_bearish';
                    if (ratio < 0.45) return 'bearish';
                    return 'neutral';
                };

                const calcNetFlow = (group: any[]): number => {
                    return group.reduce((sum: number, t: any) => {
                        const val = t.recentVolume || 0;
                        return sum + (t.recentSide === 'long' ? val : -val);
                    }, 0);
                };

                const pnlCohorts: CohortData[] = [
                    {
                        name: 'Extremely Profitable',
                        sentiment: calcSentiment(extremelyProfitable),
                        netFlow: calcNetFlow(extremelyProfitable),
                        volume: extremelyProfitable.reduce((s: number, t: any) => s + (t.volume || 0), 0),
                        traders: extremelyProfitable.length,
                        avgPnl: extremelyProfitable.length > 0 ? extremelyProfitable.reduce((s: number, t: any) => s + t.pnl, 0) / extremelyProfitable.length : 0,
                        sparkline: generateSparkline(extremelyProfitable.length > 0 ? 0.7 : 0.5),
                        icon: '👑'
                    },
                    {
                        name: 'Very Profitable',
                        sentiment: calcSentiment(veryProfitable),
                        netFlow: calcNetFlow(veryProfitable),
                        volume: veryProfitable.reduce((s: number, t: any) => s + (t.volume || 0), 0),
                        traders: veryProfitable.length,
                        avgPnl: veryProfitable.length > 0 ? veryProfitable.reduce((s: number, t: any) => s + t.pnl, 0) / veryProfitable.length : 0,
                        sparkline: generateSparkline(0.6),
                        icon: '💎'
                    },
                    {
                        name: 'Profitable',
                        sentiment: calcSentiment(profitable),
                        netFlow: calcNetFlow(profitable),
                        volume: profitable.reduce((s: number, t: any) => s + (t.volume || 0), 0),
                        traders: profitable.length,
                        avgPnl: profitable.length > 0 ? profitable.reduce((s: number, t: any) => s + t.pnl, 0) / profitable.length : 0,
                        sparkline: generateSparkline(0.55),
                        icon: '📈'
                    },
                    {
                        name: 'Underwater',
                        sentiment: calcSentiment(rekt),
                        netFlow: calcNetFlow(rekt),
                        volume: rekt.reduce((s: number, t: any) => s + (t.volume || 0), 0),
                        traders: rekt.length,
                        avgPnl: rekt.length > 0 ? rekt.reduce((s: number, t: any) => s + t.pnl, 0) / rekt.length : 0,
                        sparkline: generateSparkline(0.35),
                        icon: '💀'
                    },
                ];

                setCohorts(pnlCohorts);
                setTopTraders(traders.slice(0, 5).map((t: any) => ({
                    address: t.address,
                    pnl: t.pnl,
                    volume: t.volume,
                    winRate: t.winRate || 0,
                    recentTrade: t.recentTrade
                })));
            } else {
                throw new Error('No data');
            }
        } catch (e) {
            // Fall back to simulated data
            setDataSource('simulated');
            generateSimulatedDataRef.current();
        } finally {
            setLoading(false);
            setLastUpdate(new Date());
        }
    }, []);

    const generateSparkline = (bias: number): number[] => {
        const points: number[] = [];
        let value = 50;
        for (let i = 0; i < 12; i++) {
            const change = (Math.random() - 0.5 + (bias - 0.5) * 0.3) * 15;
            value = Math.max(10, Math.min(90, value + change));
            points.push(value);
        }
        return points;
    };

    const generateSimulatedData = useCallback(() => {
        const pnlCohorts: CohortData[] = [
            {
                name: 'Extremely Profitable',
                sentiment: Math.random() > 0.35 ? 'very_bullish' : 'bullish',
                netFlow: (Math.random() - 0.25) * 8000000,
                volume: Math.random() * 80000000 + 20000000,
                traders: Math.floor(Math.random() * 400) + 80,
                avgPnl: Math.random() * 5000000 + 2000000,
                sparkline: generateSparkline(0.65),
                icon: '👑'
            },
            {
                name: 'Very Profitable',
                sentiment: Math.random() > 0.45 ? 'bullish' : 'neutral',
                netFlow: (Math.random() - 0.35) * 5000000,
                volume: Math.random() * 50000000 + 10000000,
                traders: Math.floor(Math.random() * 800) + 200,
                avgPnl: Math.random() * 800000 + 200000,
                sparkline: generateSparkline(0.55),
                icon: '💎'
            },
            {
                name: 'Profitable',
                sentiment: Math.random() > 0.5 ? 'bullish' : 'bearish',
                netFlow: (Math.random() - 0.5) * 3000000,
                volume: Math.random() * 30000000 + 5000000,
                traders: Math.floor(Math.random() * 2000) + 500,
                avgPnl: Math.random() * 80000 + 10000,
                sparkline: generateSparkline(0.5),
                icon: '📈'
            },
            {
                name: 'Underwater',
                sentiment: Math.random() > 0.65 ? 'bearish' : 'very_bearish',
                netFlow: (Math.random() - 0.6) * 2000000,
                volume: Math.random() * 15000000 + 2000000,
                traders: Math.floor(Math.random() * 5000) + 1500,
                avgPnl: -(Math.random() * 50000 + 10000),
                sparkline: generateSparkline(0.35),
                icon: '💀'
            },
        ];

        const sizeCohorts: CohortData[] = [
            {
                name: 'Kraken (>$10M)',
                sentiment: Math.random() > 0.4 ? 'very_bullish' : 'bullish',
                netFlow: (Math.random() - 0.2) * 15000000,
                volume: Math.random() * 150000000 + 80000000,
                traders: Math.floor(Math.random() * 30) + 5,
                avgPnl: Math.random() * 10000000,
                sparkline: generateSparkline(0.6),
                icon: '🐙'
            },
            {
                name: 'Whale ($1M-$10M)',
                sentiment: Math.random() > 0.45 ? 'bullish' : 'neutral',
                netFlow: (Math.random() - 0.35) * 8000000,
                volume: Math.random() * 80000000 + 30000000,
                traders: Math.floor(Math.random() * 150) + 40,
                avgPnl: Math.random() * 3000000,
                sparkline: generateSparkline(0.55),
                icon: '🐋'
            },
            {
                name: 'Shark ($100K-$1M)',
                sentiment: Math.random() > 0.5 ? 'bullish' : 'bearish',
                netFlow: (Math.random() - 0.5) * 4000000,
                volume: Math.random() * 40000000 + 10000000,
                traders: Math.floor(Math.random() * 500) + 100,
                avgPnl: Math.random() * 400000,
                sparkline: generateSparkline(0.5),
                icon: '🦈'
            },
            {
                name: 'Fish (<$100K)',
                sentiment: Math.random() > 0.55 ? 'bearish' : 'very_bearish',
                netFlow: (Math.random() - 0.6) * 1000000,
                volume: Math.random() * 10000000 + 2000000,
                traders: Math.floor(Math.random() * 8000) + 3000,
                avgPnl: Math.random() * 30000 - 5000,
                sparkline: generateSparkline(0.4),
                icon: '🐟'
            },
        ];

        setCohorts(mode === 'pnl' ? pnlCohorts : sizeCohorts);
    }, [mode]);

    useEffect(() => {
        generateSimulatedDataRef.current = generateSimulatedData;
    }, [generateSimulatedData]);

    useEffect(() => {
        fetchLeaderboardData();
        const interval = setInterval(fetchLeaderboardData, 30000);
        return () => clearInterval(interval);
    }, [fetchLeaderboardData, symbol, mode]);

    const getSentimentColor = (sentiment: CohortData['sentiment']) => {
        switch (sentiment) {
            case 'very_bullish': return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/40';
            case 'bullish': return 'text-green-400 bg-green-500/15 border-green-500/30';
            case 'neutral': return 'text-gray-400 bg-gray-500/15 border-gray-500/30';
            case 'bearish': return 'text-orange-400 bg-orange-500/15 border-orange-500/30';
            case 'very_bearish': return 'text-red-400 bg-red-500/20 border-red-500/40';
        }
    };

    const getSentimentLabel = (sentiment: CohortData['sentiment']) => {
        switch (sentiment) {
            case 'very_bullish': return 'V. Bullish';
            case 'bullish': return 'Bullish';
            case 'neutral': return 'Neutral';
            case 'bearish': return 'Bearish';
            case 'very_bearish': return 'V. Bearish';
        }
    };

    const formatCompact = (num: number) => {
        const abs = Math.abs(num);
        if (abs >= 1000000000) return `${(num / 1000000000).toFixed(1)}B`;
        if (abs >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return num.toFixed(0);
    };

    const Sparkline = ({ data, bullish }: { data: number[]; bullish: boolean }) => {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const points = data.map((v, i) =>
            `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 100}`
        ).join(' ');

        const gradientId = `gradient-${Math.random().toString(36).substr(2, 9)}`;

        return (
            <svg className="w-full h-8" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                    <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={bullish ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={bullish ? '#10b981' : '#ef4444'} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon
                    fill={`url(#${gradientId})`}
                    points={`0,100 ${points} 100,100`}
                />
                <polyline
                    fill="none"
                    stroke={bullish ? '#10b981' : '#ef4444'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points}
                />
            </svg>
        );
    };

    const aggregateBullish = cohorts.filter(c => c.sentiment.includes('bullish')).length;
    const aggregateSentiment = aggregateBullish > cohorts.length / 2 ? 'bullish' : 'bearish';

    return (
        <div className="h-full flex flex-col bg-gradient-to-b from-[#0a0a0a] to-black">
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-black text-white uppercase tracking-wider">Smart Money Flow</span>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${dataSource === 'live' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                        {dataSource === 'live' ? 'LIVE' : 'SIMULATED'}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {/* Mode Toggle */}
                    <div className="flex bg-gray-900/80 rounded-lg p-0.5 border border-white/5">
                        <button
                            onClick={() => setMode('pnl')}
                            className={`px-2.5 py-1 text-[9px] font-bold uppercase rounded transition-all ${mode === 'pnl'
                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            By PnL
                        </button>
                        <button
                            onClick={() => setMode('size')}
                            className={`px-2.5 py-1 text-[9px] font-bold uppercase rounded transition-all ${mode === 'size'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            By Size
                        </button>
                    </div>

                    <button
                        onClick={fetchLeaderboardData}
                        disabled={loading}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                    >
                        <RefreshCw className={`w-3 h-3 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Cohort Grid */}
            <div className="flex-1 p-3 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                    {cohorts.map((cohort) => {
                        const isBullish = cohort.sentiment.includes('bullish');

                        return (
                            <div
                                key={cohort.name}
                                className="bg-gray-900/60 border border-white/5 rounded-xl p-3 hover:border-white/15 transition-all group cursor-pointer"
                            >
                                {/* Header */}
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{cohort.icon}</span>
                                        <span className="text-[10px] font-black text-white uppercase tracking-tight">{cohort.name}</span>
                                    </div>
                                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${getSentimentColor(cohort.sentiment)}`}>
                                        {getSentimentLabel(cohort.sentiment)}
                                    </span>
                                </div>

                                {/* Sparkline */}
                                <div className="h-8 mb-2 opacity-70 group-hover:opacity-100 transition-opacity">
                                    <Sparkline data={cohort.sparkline} bullish={isBullish} />
                                </div>

                                {/* Stats */}
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9px]">
                                    <div>
                                        <span className="text-gray-500 uppercase font-bold block">Volume</span>
                                        <span className="text-white font-mono font-bold">${formatCompact(cohort.volume)}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 uppercase font-bold block">Net Flow</span>
                                        <span className={`font-mono font-bold ${cohort.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {cohort.netFlow >= 0 ? '+' : ''}{formatCompact(cohort.netFlow)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 uppercase font-bold block">Traders</span>
                                        <span className="text-white font-mono font-bold">{cohort.traders.toLocaleString()}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 uppercase font-bold block">Avg PnL</span>
                                        <span className={`font-mono font-bold ${cohort.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            ${formatCompact(cohort.avgPnl)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Top Traders Section (if available) */}
                {topTraders.length > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Crown className="w-3.5 h-3.5 text-yellow-400" />
                            <span className="text-[10px] font-black text-white uppercase tracking-wider">Top Performers</span>
                        </div>
                        <div className="space-y-1.5">
                            {topTraders.slice(0, 3).map((trader, i) => (
                                <div
                                    key={trader.address}
                                    className="flex items-center gap-3 p-2 bg-gray-900/40 rounded-lg border border-white/5 hover:border-white/10 transition-all cursor-pointer group"
                                >
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-gray-400 text-black' : 'bg-amber-700 text-white'}`}>
                                        {i + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] font-mono text-gray-400 truncate">
                                            {trader.address.slice(0, 6)}...{trader.address.slice(-4)}
                                        </div>
                                        <div className="flex items-center gap-2 text-[9px]">
                                            <span className="text-emerald-400 font-bold">+${formatCompact(trader.pnl)}</span>
                                            <span className="text-gray-500">Vol: ${formatCompact(trader.volume)}</span>
                                        </div>
                                    </div>
                                    <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-colors" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Summary */}
            <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between text-[9px] bg-black/40">
                <div className="flex items-center gap-2">
                    <span className="text-gray-500 uppercase font-bold tracking-wider">Aggregate</span>
                    {aggregateSentiment === 'bullish' ? (
                        <div className="flex items-center gap-1.5 text-emerald-400">
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span className="font-bold">NET BULLISH</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-red-400">
                            <TrendingDown className="w-3.5 h-3.5" />
                            <span className="font-bold">NET BEARISH</span>
                        </div>
                    )}
                </div>
                <span className="text-gray-600 font-mono">
                    Updated: {lastUpdate.toLocaleTimeString()}
                </span>
            </div>
        </div>
    );
}
