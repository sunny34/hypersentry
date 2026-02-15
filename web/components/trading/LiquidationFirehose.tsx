'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useHyperliquidWS } from '@/hooks/useHyperliquidWS';
import { Skull, TrendingDown, TrendingUp, Zap, Activity, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Liquidation {
    coin: string;
    side: 'B' | 'S';
    sz: string;
    px: string;
    time: number;
    id?: string;
}

export default function LiquidationFirehose() {
    const { liquidations, status, subscribe } = useHyperliquidWS();
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        subscribe({ type: 'liquidations' });
    }, [subscribe]);

    // Aggregate stats
    const stats = useMemo(() => {
        let longLiqs = 0, shortLiqs = 0, totalValue = 0;
        const coins = new Set<string>();

        liquidations.forEach((liq) => {
            const val = parseFloat(liq.sz) * parseFloat(liq.px);
            totalValue += val;
            coins.add(liq.coin);
            if (liq.side === 'S') longLiqs++;
            else shortLiqs++;
        });

        // Market stress = liquidations per minute (approx)
        const stressLevel = liquidations.length > 10 ? 'HIGH' : liquidations.length > 5 ? 'MODERATE' : 'LOW';

        return {
            longLiqs,
            shortLiqs,
            totalValue,
            coinsAffected: coins.size,
            stressLevel
        };
    }, [liquidations]);

    const formatValue = (liq: Liquidation) => {
        const val = parseFloat(liq.sz) * parseFloat(liq.px);
        if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
        return val.toFixed(0);
    };

    const formatDollar = (val: number) => {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
        if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
        return `$${val.toFixed(0)}`;
    };

    return (
        <div className="flex flex-col h-full bg-[var(--glass-bg)] rounded-2xl overflow-hidden border border-[var(--glass-border)] backdrop-blur-md">
            <div className="px-4 py-3 border-b border-[var(--glass-border)] bg-gradient-to-r from-[var(--color-bearish)]/10 to-transparent flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Skull className="w-5 h-5 text-[var(--color-bearish)]" />
                        <div className="absolute inset-0 bg-[var(--color-bearish)] blur-lg opacity-20 animate-pulse" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/80">Global Liquidation Feed</span>
                        <span className="text-[8px] text-gray-500 font-mono">All Markets • Real-time</span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--background)]/40 border border-[var(--glass-border)]">
                        <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-[var(--color-bullish)] shadow-[0_0_8px_var(--color-bullish)] animate-pulse' : 'bg-[var(--color-bearish)] shadow-[0_0_8px_var(--color-bearish)]'}`} />
                        <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                            {status === 'connected' ? 'Live' : 'Syncing'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Aggregate Stats Bar */}
            <div className="px-3 py-2 bg-black/40 border-b border-[var(--glass-border)] grid grid-cols-4 gap-2">
                <div className="flex flex-col items-center">
                    <span className="text-[8px] text-gray-500 font-bold uppercase">Session Total</span>
                    <span className="text-[11px] font-black text-white font-mono">{formatDollar(stats.totalValue)}</span>
                </div>
                <div className="flex flex-col items-center border-l border-white/5">
                    <span className="text-[8px] text-gray-500 font-bold uppercase">Long REKT</span>
                    <span className="text-[11px] font-black text-[var(--color-bearish)] font-mono">{stats.longLiqs}</span>
                </div>
                <div className="flex flex-col items-center border-l border-white/5">
                    <span className="text-[8px] text-gray-500 font-bold uppercase">Short REKT</span>
                    <span className="text-[11px] font-black text-[var(--color-bullish)] font-mono">{stats.shortLiqs}</span>
                </div>
                <div className="flex flex-col items-center border-l border-white/5">
                    <span className="text-[8px] text-gray-500 font-bold uppercase">Stress</span>
                    <span className={`text-[10px] font-black uppercase ${stats.stressLevel === 'HIGH' ? 'text-[var(--color-bearish)] animate-pulse' :
                            stats.stressLevel === 'MODERATE' ? 'text-[var(--color-accent-orange)]' : 'text-gray-400'
                        }`}>{stats.stressLevel}</span>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto scrollbar-hide p-3 space-y-2"
            >
                <AnimatePresence initial={false}>
                    {liquidations.length === 0 ? (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="h-full flex flex-col items-center justify-center space-y-3"
                        >
                            <div className="relative">
                                <Zap className="w-12 h-12 text-gray-800" />
                                <div className="absolute inset-0 bg-[var(--color-accent-orange)]/5 blur-2xl rounded-full" />
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-[10px] uppercase font-black tracking-[0.3em] text-gray-600">Awaiting Volatility</span>
                                <span className="text-[8px] uppercase font-bold text-gray-700 mt-1 italic tracking-widest">Monitoring 100+ Perps</span>
                            </div>
                        </motion.div>
                    ) : (
                        liquidations.map((liq) => {
                            const isLong = liq.side === 'S';
                            const val = parseFloat(liq.sz) * parseFloat(liq.px);
                            const isWhale = val >= 1000000;

                            return (
                                <motion.a
                                    key={liq.id || `${liq.coin}-${liq.time}-${Math.random()}`}
                                    initial={{ opacity: 0, x: 20, filter: 'blur(10px)' }}
                                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                    href={`https://app.hyperliquid.xyz/explorer/history/${liq.coin}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`group relative p-3 rounded-xl border transition-all duration-500 block cursor-pointer
                                        ${isLong
                                            ? 'bg-gradient-to-r from-[var(--color-bearish)]/10 to-transparent border-[var(--color-bearish)]/10 hover:border-[var(--color-bearish)]/30'
                                            : 'bg-gradient-to-r from-[var(--color-bullish)]/10 to-transparent border-[var(--color-bullish)]/10 hover:border-[var(--color-bullish)]/30'}
                                        ${isWhale ? 'ring-1 ring-[var(--color-accent-orange)]/20 shadow-[0_0_20px_var(--color-accent-orange)]/5' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${isLong ? 'bg-[var(--color-bearish)]/20 text-[var(--color-bearish)] shadow-[0_0_10px_var(--color-bearish)]/20' : 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)] shadow-[0_0_10px_var(--color-bullish)]/20'}`}>
                                                {isLong ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[13px] font-black text-white tracking-tight">{liq.coin}</span>
                                                    {isWhale && <span className="text-[7px] bg-[var(--color-accent-orange)] text-black px-1 rounded-sm font-black uppercase tracking-tighter">Whale</span>}
                                                </div>
                                                <span className={`text-[8px] font-black uppercase tracking-widest ${isLong ? 'text-[var(--color-bearish)]/70' : 'text-[var(--color-bullish)]/70'}`}>
                                                    {isLong ? 'Long REKT' : 'Short REKT'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right flex flex-col items-end">
                                            <div className="flex items-center gap-1">
                                                <span className={`text-[13px] font-mono font-black ${isLong ? 'text-[var(--color-bearish)]' : 'text-[var(--color-bullish)]'}`}>
                                                    ${formatValue(liq)}
                                                </span>
                                            </div>
                                            <span className="text-[9px] text-gray-500 font-mono font-medium tracking-tighter uppercase">
                                                @ {parseFloat(liq.px).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Progress background bar for size intensity */}
                                    <div
                                        className={`absolute bottom-0 left-0 h-[1px] transition-all duration-1000 ${isLong ? 'bg-[var(--color-bearish)]/40' : 'bg-[var(--color-bullish)]/40'}`}
                                        style={{ width: `${Math.min((val / 100000) * 100, 100)}%` }}
                                    />
                                </motion.a>
                            );
                        })
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
