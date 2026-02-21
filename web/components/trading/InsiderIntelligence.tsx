'use client';
import { useState, useEffect, useRef } from 'react';
import { useHyperliquidWS } from '@/contexts/HyperliquidWSContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Sparkles, UserCheck } from 'lucide-react';

/**
 * Interface representing a real-time market alert (Whale, Liquidation, or Order Book wall).
 */
interface Alert {
    id: string;
    type: 'whale' | 'wall' | 'liq' | 'insider' | 'ai';
    title: string;
    message: string;
    timestamp: number;
    side?: 'buy' | 'sell';
}

/**
 * InsiderIntelligence Component
 * 
 * Monitors Hyperliquid WebSocket streams for high-conviction market events.
 * Detects "Whale" trades, massive liquidations, and significant order book walls.
 * Provides visual overlays to the terminal for low-latency awareness.
 */
export default function InsiderIntelligence({ coin }: { coin: string }) {
    const { addListener } = useHyperliquidWS();
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    /**
     * Injects a new alert into the feed with a strictly managed lifecycle.
     */
    const addAlert = (alert: Omit<Alert, 'id' | 'timestamp'>) => {
        const newAlert: Alert = {
            ...alert,
            id: Math.random().toString(36).substring(2, 11),
            timestamp: Date.now()
        };

        setAlerts((prev: Alert[]) => [newAlert, ...prev].slice(0, 3)); // Keep only latest 3 alerts

        // Dispatch Global Event for Chart Markers
        window.dispatchEvent(new CustomEvent('intel-marker', {
            detail: {
                type: alert.type,
                side: alert.side,
                label: alert.title.split(' ')[0] // Short label
            }
        }));

        // Auto-cleanup alert after visibility duration
        setTimeout(() => {
            setAlerts((prev: Alert[]) => prev.filter((a: Alert) => a.id !== newAlert.id));
        }, 6500);
    };

    useEffect(() => {
        // Intelligence Module: Whale Watcher
        const removeTrades = addListener('trades', (data: any) => {
            if (!Array.isArray(data)) return;
            data.forEach(t => {
                if (t.coin === coin) {
                    const usdSize = parseFloat(t.px) * parseFloat(t.sz);
                    // Institutional Threshold: $1M+ USD (High Conviction Only)
                    if (usdSize >= 1000000) {
                        addAlert({
                            type: 'whale',
                            title: usdSize >= 5000000 ? '🐋 KRAKEN SPOTTED 🐋' : '🚨 INSTITUTIONAL MOVE 🚨',
                            message: `${t.side === 'B' ? 'AGGRESSIVE BUY' : 'AGGRESSIVE SELL'} of $${(usdSize / 1000000).toFixed(2)}M at $${parseFloat(t.px).toLocaleString()}`,
                            side: t.side === 'B' ? 'buy' : 'sell'
                        });
                    }
                }
            });
        });

        // Intelligence Module: Rekt Detector
        const removeLiqs = addListener('liquidations', (data: any) => {
            const updates = Array.isArray(data) ? data : (data?.liquidations || [data]);

            updates.forEach((item: any) => {
                const liq = item.liq || item;
                if (liq && liq.coin === coin) {
                    const usdSize = parseFloat(liq.px) * parseFloat(liq.sz);
                    if (usdSize > 1000) { // $1k+ Liquidation (Ultra-sensitive)
                        const isLong = liq.side === 'S';
                        addAlert({
                            type: 'liq',
                            title: usdSize > 25000 ? '🔥 MASSIVE REKT 🔥' : 'LIQUIDATION DETECTED',
                            message: `${isLong ? 'Long' : 'Short'} position liquidated for $${(usdSize / 1000).toFixed(1)}k at $${parseFloat(liq.px).toFixed(2)}`,
                            side: isLong ? 'sell' : 'buy' // Long liq = forced sell
                        });
                    }
                }
            });
        });

        // Intelligence Module: Order Flow Walls
        const removeL2 = addListener('l2Book', (data: any) => {
            if (data.coin === coin && data.levels?.length === 2) {
                const bids = data.levels[0];
                const asks = data.levels[1];

                const findWalls = (levels: any[], side: 'buy' | 'sell') => {
                    levels.slice(0, 10).forEach(l => {
                        const sizeUsd = parseFloat(l.px) * parseFloat(l.sz);
                        if (sizeUsd > 1000000) { // $1M+ wall
                            addAlert({
                                type: 'wall',
                                title: 'TERMINAL LIQUIDITY WALL',
                                message: `$${(sizeUsd / 1000000).toFixed(1)}M ${side === 'buy' ? 'Support' : 'Resistance'} detected at $${parseFloat(l.px).toFixed(2)}`,
                                side: side
                            });
                        }
                    });
                };

                // Probabilistic throttling for L2 wall detection
                if (Math.random() > 0.98) {
                    findWalls(bids, 'buy');
                    findWalls(asks, 'sell');
                }
            }
        });

        return () => {
            if (removeTrades) removeTrades();
            if (removeLiqs) removeLiqs();
            if (removeL2) removeL2();
        };
    }, [addListener, coin]);

    return (
        <div className="fixed bottom-24 right-8 z-[100] flex flex-col gap-3 pointer-events-none w-80">
            <AnimatePresence>
                {alerts.map((alert) => (
                    <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, x: 50, scale: 0.9, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, x: 20, scale: 0.95, filter: 'blur(5px)' }}
                        className="pointer-events-auto"
                    >
                        <div className={`relative overflow-hidden rounded-2xl border-2 backdrop-blur-3xl transition-all shadow-2xl animate-pulse ${alert.side === 'buy'
                            ? 'bg-[var(--background)]/80 border-[var(--color-bullish)]/50 shadow-[var(--color-bullish)]/20'
                            : 'bg-[var(--background)]/80 border-[var(--color-bearish)]/50 shadow-[var(--color-bearish)]/20'
                            }`}>
                            {/* Neural Glow */}
                            <div className={`absolute -inset-1 opacity-20 blur-2xl ${alert.side === 'buy' ? 'bg-[var(--color-bullish)]' : 'bg-[var(--color-bearish)]'
                                }`} />

                            <div className="p-4 relative">
                                <div className="flex items-start gap-3">
                                    <div className={`p-2 rounded-xl transition-all ${alert.side === 'buy' ? 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)]' : 'bg-[var(--color-bearish)]/20 text-[var(--color-bearish)]'
                                        }`}>
                                        {alert.type === 'whale' ? <Sparkles className="w-5 h-5" /> : <Zap className="w-5 h-5 shadow-inner" />}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-1">
                                            <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-white/90">
                                                {alert.title}
                                            </h4>
                                            <span className="text-[8px] text-gray-500 font-black uppercase">Live</span>
                                        </div>
                                        <p className="text-[11px] text-gray-300 font-bold leading-relaxed tracking-tight">
                                            {alert.message}
                                        </p>
                                    </div>
                                </div>

                                {/* Intelligent Lifecycle Bar */}
                                <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <UserCheck className="w-3 h-3 text-[var(--color-bullish)]" />
                                        <span className="text-[9px] text-[var(--color-bullish)] font-extrabold uppercase tracking-tighter">Terminal Intel</span>
                                    </div>
                                    <span className="text-[9px] text-gray-500 font-black italic tracking-tighter uppercase opacity-60">
                                        {alert.side === 'buy' ? 'Impulse: Bullish' : 'Impulse: Bearish'}
                                    </span>
                                </div>
                            </div>

                            <motion.div
                                initial={{ width: '100%' }}
                                animate={{ width: '0%' }}
                                transition={{ duration: 6.5, ease: 'linear' }}
                                className={`h-0.5 absolute bottom-0 left-0 ${alert.side === 'buy' ? 'bg-[var(--color-bullish)]' : 'bg-[var(--color-bearish)]'
                                    }`}
                            />
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
