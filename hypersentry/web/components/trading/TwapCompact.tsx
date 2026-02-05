'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Activity, TrendingUp, TrendingDown, ArrowUp, ArrowDown, AlertTriangle, RefreshCw, Users, ExternalLink } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface TwapCompactProps {
    symbol: string;
    onExpand?: () => void;
}

interface TwapSummary {
    buyVolume: number;
    sellVolume: number;
    netDelta: number;
    activeCount: number;
    buyersCount: number;
    sellersCount: number;
    sentiment: 'accumulating' | 'distributing' | 'neutral';
}

export default function TwapCompact({ symbol, onExpand }: TwapCompactProps) {
    const [summary, setSummary] = useState<TwapSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTwaps = async () => {
            try {
                const res = await axios.get(`${API_URL}/twap/public/${symbol}`).catch(() => null);
                if (res?.data?.summary) {
                    const s = res.data.summary;
                    setSummary({
                        buyVolume: s.buy_volume || 0,
                        sellVolume: s.sell_volume || 0,
                        netDelta: s.net_delta || 0,
                        activeCount: s.active_count || 0,
                        buyersCount: (res.data.buyers || []).length,
                        sellersCount: (res.data.sellers || []).length,
                        sentiment: s.sentiment || 'neutral'
                    });
                }
            } catch (err) {
                console.error('TWAP fetch error:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchTwaps();
        const interval = setInterval(fetchTwaps, 30000);
        return () => clearInterval(interval);
    }, [symbol]);

    const formatDollar = (value: number) => {
        if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
        if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
        return `$${value.toFixed(0)}`;
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] rounded-lg border border-white/5">
                <RefreshCw className="w-3 h-3 text-purple-400 animate-spin" />
                <span className="text-[9px] text-gray-500">Loading TWAP...</span>
            </div>
        );
    }

    if (!summary || summary.activeCount === 0) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] rounded-lg border border-white/5">
                <Activity className="w-3 h-3 text-gray-600" />
                <span className="text-[9px] text-gray-600">No active TWAPs for {symbol}</span>
            </div>
        );
    }

    const total = summary.buyVolume + summary.sellVolume;
    const buyRatio = total > 0 ? (summary.buyVolume / total) * 100 : 50;

    return (
        <div
            onClick={onExpand}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${summary.sentiment === 'distributing'
                    ? 'bg-red-500/10 border-red-500/30 hover:border-red-500/50'
                    : summary.sentiment === 'accumulating'
                        ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
        >
            {/* Status Icon */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${summary.sentiment === 'distributing' ? 'bg-red-500/20' :
                    summary.sentiment === 'accumulating' ? 'bg-emerald-500/20' : 'bg-gray-500/20'
                }`}>
                {summary.sentiment === 'distributing' ? (
                    <ArrowDown className="w-4 h-4 text-red-400" />
                ) : summary.sentiment === 'accumulating' ? (
                    <ArrowUp className="w-4 h-4 text-emerald-400" />
                ) : (
                    <Activity className="w-4 h-4 text-gray-400" />
                )}
            </div>

            {/* Sentiment Label */}
            <div className="flex-1">
                <div className={`text-xs font-black uppercase ${summary.sentiment === 'distributing' ? 'text-red-400' :
                        summary.sentiment === 'accumulating' ? 'text-emerald-400' : 'text-gray-400'
                    }`}>
                    {summary.sentiment === 'distributing' ? '🐋 WHALES SELLING' :
                        summary.sentiment === 'accumulating' ? '🐋 WHALES BUYING' :
                            '⚖️ BALANCED'}
                </div>
                <div className="text-[9px] text-gray-500">
                    {summary.activeCount} TWAPs • {formatDollar(total)} volume
                </div>
            </div>

            {/* Net Delta */}
            <div className="text-right">
                <div className={`text-sm font-black font-mono ${summary.netDelta > 0 ? 'text-emerald-300' : summary.netDelta < 0 ? 'text-red-300' : 'text-gray-300'
                    }`}>
                    {summary.netDelta > 0 ? '+' : ''}{formatDollar(summary.netDelta)}
                </div>
                <div className="text-[8px] text-gray-600 uppercase">Net Flow</div>
            </div>

            {/* Flow Bar */}
            <div className="w-16 flex flex-col gap-0.5">
                <div className="flex gap-0.5 h-1.5">
                    <div
                        className="bg-emerald-500 rounded-l transition-all"
                        style={{ width: `${buyRatio}%` }}
                    />
                    <div
                        className="bg-red-500 rounded-r transition-all"
                        style={{ width: `${100 - buyRatio}%` }}
                    />
                </div>
                <div className="flex justify-between text-[7px] text-gray-600">
                    <span className="text-emerald-400">{summary.buyersCount}B</span>
                    <span className="text-red-400">{summary.sellersCount}S</span>
                </div>
            </div>
        </div>
    );
}
