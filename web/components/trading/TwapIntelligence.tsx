'use client';
import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Activity, TrendingUp, TrendingDown, Clock, RefreshCw, ExternalLink, Users, ArrowDown, ArrowUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface TwapOrder {
    address: string;
    size: number;
    side: 'buy' | 'sell';
    duration: number;
    started: number;
    progress: number;
    hash?: string;
}

interface TwapSummary {
    buyVolume: number;
    sellVolume: number;
    netDelta: number;
    activeCount: number;
    sentiment: 'accumulating' | 'distributing' | 'neutral';
}

interface TwapIntelligenceProps {
    symbol: string;
    compact?: boolean;
}

export default function TwapIntelligence({ symbol, compact = false }: TwapIntelligenceProps) {
    const { token, isAuthenticated } = useAuth();
    const [orders, setOrders] = useState<TwapOrder[]>([]);
    const [summary, setSummary] = useState<TwapSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    const calculateProgress = (started: number, duration: number) => {
        if (!started || !duration) return 0;
        const elapsed = (Date.now() - started) / 60000;
        return Math.min((elapsed / duration) * 100, 100);
    };

    useEffect(() => {
        const fetchTwaps = async () => {
            try {
                const publicRes = await axios.get(`${API_URL}/twap/public/${symbol}`).catch(() => null);

                if (publicRes?.data) {
                    const data = publicRes.data;

                    const buyers = (data.buyers || []).map((b: any) => ({
                        ...b,
                        side: 'buy' as const,
                        progress: calculateProgress(b.started, b.duration)
                    }));

                    const sellers = (data.sellers || []).map((s: any) => ({
                        ...s,
                        side: 'sell' as const,
                        progress: calculateProgress(s.started, s.duration)
                    }));

                    const allOrders = [...buyers, ...sellers].sort((a, b) => b.size - a.size);
                    setOrders(allOrders);

                    if (data.summary) {
                        setSummary({
                            buyVolume: data.summary.buy_volume || 0,
                            sellVolume: data.summary.sell_volume || 0,
                            netDelta: data.summary.net_delta || 0,
                            activeCount: data.summary.active_count || 0,
                            sentiment: data.summary.sentiment || 'neutral'
                        });
                    }
                    setLastUpdate(new Date());
                }
            } catch {
                // Silently handle - TWAP fetch failed
            } finally {
                setLoading(false);
            }
        };

        fetchTwaps();
        const interval = setInterval(fetchTwaps, 15000);
        return () => clearInterval(interval);
    }, [symbol, token, isAuthenticated]);

    const formatDollar = (value: any) => {
        const num = Number(value);
        if (isNaN(num)) return '$0';
        if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
        if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
        return `$${num.toFixed(0)}`;
    };

    const formatAddress = (addr: any) => {
        if (!addr || typeof addr !== 'string') return '0x000...0000';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    };

    const formatTimeRemaining = (started: number, duration: number) => {
        const elapsed = (Date.now() - started) / 60000;
        const remaining = Math.max(duration - elapsed, 0);
        if (remaining < 1) return '<1m';
        if (remaining < 60) return `${Math.floor(remaining)}m`;
        return `${Math.floor(remaining / 60)}h ${Math.floor(remaining % 60)}m`;
    };

    const metrics = useMemo(() => {
        if (!summary) return null;
        const buyVolume = summary.buyVolume || 0;
        const sellVolume = summary.sellVolume || 0;
        const total = buyVolume + sellVolume;
        const buyRatio = total > 0 ? (buyVolume / total) * 100 : 50;
        return {
            ...summary,
            buyVolume,
            sellVolume,
            buyRatio,
            sellRatio: 100 - buyRatio,
            totalVolume: total
        };
    }, [summary]);

    const buyOrders = orders.filter(o => o.side === 'buy');
    const sellOrders = orders.filter(o => o.side === 'sell');

    if (loading) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-[#050505]">
                <RefreshCw className="w-5 h-5 text-[#3b82f6] animate-spin" />
                <span className="text-[10px] text-gray-500 mt-2">Scanning TWAPs...</span>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
            {/* Compact Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#050505]/60 border-b border-[rgba(255,255,255,0.05)] shrink-0">
                <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-[#3b82f6]" />
                    <span className="text-[9px] font-black uppercase text-gray-400">TWAP Intel</span>
                    <span className="text-[8px] text-gray-600">• {symbol}</span>
                </div>
                {lastUpdate && (
                    <span className="text-[8px] text-gray-600 font-mono">
                        {lastUpdate.toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                    </span>
                )}
            </div>

            {/* Quick Summary Bar */}
            {metrics && metrics.activeCount > 0 && (
                <div className={`px-3 py-2 border-b flex items-center justify-between ${metrics.sentiment === 'distributing'
                    ? 'bg-[#ef4444]/10 border-[#ef4444]/20'
                    : metrics.sentiment === 'accumulating'
                        ? 'bg-[#10b981]/10 border-[#10b981]/20'
                        : 'bg-white/5 border-[rgba(255,255,255,0.05)]'
                    }`}>
                    <div className="flex items-center gap-2">
                        {metrics.sentiment === 'distributing' ? (
                            <ArrowDown className="w-4 h-4 text-[#ef4444]" />
                        ) : metrics.sentiment === 'accumulating' ? (
                            <ArrowUp className="w-4 h-4 text-[#10b981]" />
                        ) : (
                            <Activity className="w-4 h-4 text-gray-400" />
                        )}
                        <span className={`text-xs font-bold uppercase ${metrics.sentiment === 'distributing' ? 'text-[#ef4444]' :
                            metrics.sentiment === 'accumulating' ? 'text-[#10b981]' : 'text-gray-400'
                            }`}>
                            {metrics.sentiment === 'distributing' ? 'SELLING' :
                                metrics.sentiment === 'accumulating' ? 'BUYING' : 'BALANCED'}
                        </span>
                        <span className="text-[9px] text-gray-500">
                            {metrics.activeCount} active
                        </span>
                    </div>
                    <div className={`text-sm font-black font-mono ${metrics.netDelta > 0 ? 'text-[#10b981]' : metrics.netDelta < 0 ? 'text-[#ef4444]' : 'text-gray-300'
                        }`}>
                        {metrics.netDelta > 0 ? '+' : ''}{formatDollar(metrics.netDelta)}
                    </div>
                </div>
            )}

            {/* Two Column Whale List */}
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
                {orders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                        <Activity className="w-6 h-6 mb-2 opacity-30" />
                        <span className="text-[10px]">No active TWAPs for {symbol}</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-px bg-[rgba(255,255,255,0.05)]/20">
                        {/* BUYERS Column */}
                        <div className="bg-[#050505]">
                            <div className="sticky top-0 bg-[#10b981]/10 px-2 py-1.5 border-b border-[#10b981]/20 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <TrendingUp className="w-3 h-3 text-[#10b981]" />
                                    <span className="text-[9px] font-black text-[#10b981]">BUYERS</span>
                                </div>
                                <span className="text-[8px] text-[#10b981]/60 font-mono">
                                    {buyOrders.length} • {formatDollar(metrics?.buyVolume || 0)}
                                </span>
                            </div>
                            <div className="p-1.5 space-y-1">
                                {buyOrders.length === 0 ? (
                                    <div className="text-[9px] text-gray-600 text-center py-4">No buyers</div>
                                ) : (
                                    buyOrders.map((order, i) => (
                                        <div
                                            key={order.hash || i}
                                            className="bg-[#10b981]/5 border border-[#10b981]/10 rounded px-2 py-1.5 hover:border-[#10b981]/30 transition-all"
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <code className="text-[8px] text-gray-500 font-mono">
                                                    {formatAddress(order.address)}
                                                </code>
                                                {order.hash && (
                                                    <a
                                                        href={`https://hypurrscan.io/tx/${order.hash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-gray-600 hover:text-white"
                                                    >
                                                        <ExternalLink className="w-2.5 h-2.5" />
                                                    </a>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-[#10b981] font-mono">
                                                    {formatDollar(order.size)}
                                                </span>
                                                <div className="flex items-center gap-1 text-[8px] text-gray-500">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    {formatTimeRemaining(order.started, order.duration)}
                                                </div>
                                            </div>
                                            {/* Progress bar */}
                                            <div className="mt-1 h-1 bg-black/30 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-[#10b981]/50"
                                                    style={{ width: `${order.progress}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* SELLERS Column */}
                        <div className="bg-[#050505]">
                            <div className="sticky top-0 bg-[#ef4444]/10 px-2 py-1.5 border-b border-[#ef4444]/20 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <TrendingDown className="w-3 h-3 text-[#ef4444]" />
                                    <span className="text-[9px] font-black text-[#ef4444]">SELLERS</span>
                                </div>
                                <span className="text-[8px] text-[#ef4444]/60 font-mono">
                                    {sellOrders.length} • {formatDollar(metrics?.sellVolume || 0)}
                                </span>
                            </div>
                            <div className="p-1.5 space-y-1">
                                {sellOrders.length === 0 ? (
                                    <div className="text-[9px] text-gray-600 text-center py-4">No sellers</div>
                                ) : (
                                    sellOrders.map((order, i) => (
                                        <div
                                            key={order.hash || i}
                                            className="bg-[#ef4444]/5 border border-[#ef4444]/10 rounded px-2 py-1.5 hover:border-[#ef4444]/30 transition-all"
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <code className="text-[8px] text-gray-500 font-mono">
                                                    {formatAddress(order.address)}
                                                </code>
                                                {order.hash && (
                                                    <a
                                                        href={`https://hypurrscan.io/tx/${order.hash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-gray-600 hover:text-white"
                                                    >
                                                        <ExternalLink className="w-2.5 h-2.5" />
                                                    </a>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-[#ef4444] font-mono">
                                                    {formatDollar(order.size)}
                                                </span>
                                                <div className="flex items-center gap-1 text-[8px] text-gray-500">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    {formatTimeRemaining(order.started, order.duration)}
                                                </div>
                                            </div>
                                            {/* Progress bar */}
                                            <div className="mt-1 h-1 bg-black/30 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-[#ef4444]/50"
                                                    style={{ width: `${order.progress}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Data Source Footer */}
            <div className="px-3 py-1.5 border-t border-[rgba(255,255,255,0.05)] bg-[#050505]/40 flex items-center justify-between shrink-0">
                <span className="text-[8px] text-gray-600">Source: HypurrScan</span>
                <span className="text-[8px] text-gray-600">
                    Total: {formatDollar((metrics?.buyVolume || 0) + (metrics?.sellVolume || 0))}
                </span>
            </div>
        </div>
    );
}
