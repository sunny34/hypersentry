'use client';
import { useState, useEffect, useMemo } from 'react';
import { Shield, Zap, Target, TrendingUp, TrendingDown, AlertTriangle, ChevronRight } from 'lucide-react';
import { useHyperliquidWS } from '../../hooks/useHyperliquidWS';

interface LiquidityLevel {
    price: number;
    size: number;
    usdValue: number;
    side: 'support' | 'resistance';
    strength: 'critical' | 'major' | 'significant' | 'minor';
    percentFromPrice: number;
}

interface TerminalLiquidityWallProps {
    coin: string;
    currentPrice: number;
    onPriceClick?: (price: number) => void;
}

export default function TerminalLiquidityWall({
    coin,
    currentPrice,
    onPriceClick
}: TerminalLiquidityWallProps) {
    const { status, subscribe, addListener } = useHyperliquidWS();
    const [supports, setSupports] = useState<LiquidityLevel[]>([]);
    const [resistances, setResistances] = useState<LiquidityLevel[]>([]);
    const [marketBias, setMarketBias] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
    const [impulse, setImpulse] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    useEffect(() => {
        if (status === 'connected') {
            subscribe({ type: 'l2Book', coin });
        }
    }, [status, coin, subscribe]);

    useEffect(() => {
        const removeL2 = addListener('l2Book', (data: any) => {
            if (data.coin !== coin || !data.levels || data.levels.length < 2) return;

            const bids = data.levels[0].slice(0, 50);
            const asks = data.levels[1].slice(0, 50);

            // Calculate average size for significance threshold
            const allSizes = [...bids, ...asks].map((l: any) => parseFloat(l.sz));
            const avgSize = allSizes.reduce((a: number, b: number) => a + b, 0) / allSizes.length;
            const significantThreshold = avgSize * 5;
            const majorThreshold = avgSize * 10;
            const criticalThreshold = avgSize * 20;

            // Find significant support levels (bids)
            const supportLevels: LiquidityLevel[] = bids
                .filter((b: any) => parseFloat(b.sz) >= significantThreshold)
                .map((b: any) => {
                    const price = parseFloat(b.px);
                    const size = parseFloat(b.sz);
                    const usdValue = size * price;
                    const percentFromPrice = ((currentPrice - price) / currentPrice) * 100;

                    return {
                        price,
                        size,
                        usdValue,
                        side: 'support' as const,
                        strength: size >= criticalThreshold ? 'critical' :
                            size >= majorThreshold ? 'major' :
                                size >= significantThreshold ? 'significant' : 'minor',
                        percentFromPrice
                    };
                })
                .sort((a: LiquidityLevel, b: LiquidityLevel) => b.usdValue - a.usdValue)
                .slice(0, 3);

            // Find significant resistance levels (asks)
            const resistanceLevels: LiquidityLevel[] = asks
                .filter((a: any) => parseFloat(a.sz) >= significantThreshold)
                .map((a: any) => {
                    const price = parseFloat(a.px);
                    const size = parseFloat(a.sz);
                    const usdValue = size * price;
                    const percentFromPrice = ((price - currentPrice) / currentPrice) * 100;

                    return {
                        price,
                        size,
                        usdValue,
                        side: 'resistance' as const,
                        strength: size >= criticalThreshold ? 'critical' :
                            size >= majorThreshold ? 'major' :
                                size >= significantThreshold ? 'significant' : 'minor',
                        percentFromPrice
                    };
                })
                .sort((a: LiquidityLevel, b: LiquidityLevel) => b.usdValue - a.usdValue)
                .slice(0, 3);

            setSupports(supportLevels);
            setResistances(resistanceLevels);

            // Calculate market bias
            const totalBidSize = bids.reduce((sum: number, b: any) => sum + parseFloat(b.sz), 0);
            const totalAskSize = asks.reduce((sum: number, a: any) => sum + parseFloat(a.sz), 0);
            const ratio = totalBidSize / (totalBidSize + totalAskSize);

            if (ratio > 0.55) {
                setMarketBias('bullish');
            } else if (ratio < 0.45) {
                setMarketBias('bearish');
            } else {
                setMarketBias('neutral');
            }

            // Determine impulse direction based on wall positions
            const nearestResistance = resistanceLevels[0];
            const nearestSupport = supportLevels[0];

            if (nearestResistance && nearestSupport) {
                if (nearestResistance.percentFromPrice < nearestSupport.percentFromPrice * 0.5) {
                    setImpulse('bearish'); // Resistance is much closer
                } else if (nearestSupport.percentFromPrice < nearestResistance.percentFromPrice * 0.5) {
                    setImpulse('bullish'); // Support is much closer
                } else {
                    setImpulse('neutral');
                }
            }

            setLastUpdate(new Date());
        });

        return () => removeL2?.();
    }, [addListener, coin, currentPrice]);

    const formatDollar = (value: number) => {
        if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
        if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
        return `$${value.toFixed(0)}`;
    };

    const primaryWall = useMemo(() => {
        const allWalls = [...supports, ...resistances];
        return allWalls.sort((a, b) => b.usdValue - a.usdValue)[0];
    }, [supports, resistances]);

    const hasWalls = supports.length > 0 || resistances.length > 0;

    return (
        <div className="h-full bg-gradient-to-b from-[var(--background)] to-[var(--background)] border border-[var(--glass-border)] rounded-xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-2.5 bg-gradient-to-r ${impulse === 'bullish' ? 'from-[var(--color-bullish)]/10' : impulse === 'bearish' ? 'from-[var(--color-bearish)]/10' : 'from-white/5'} to-transparent border-b border-[var(--glass-border)]`}>
                <div className="flex items-center gap-2">
                    <div className="relative group">
                        <Shield className={`w-4 h-4 ${primaryWall?.side === 'support' ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`} />
                        {primaryWall && primaryWall.strength === 'critical' && (
                            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[var(--color-bearish)] rounded-full animate-pulse" />
                        )}
                        {/* Tooltip */}
                        <div className="absolute left-0 top-full mt-2 w-64 p-2 bg-[var(--background)] border border-[var(--glass-border)] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                            <div className="text-[9px] text-gray-300 leading-relaxed">
                                <strong className="text-white">What is Liquidity Wall?</strong>
                                <br /><br />
                                Large order clusters in the order book that act as <span className="text-[var(--color-bullish)]">support</span> (buy walls) or <span className="text-[var(--color-bearish)]">resistance</span> (sell walls).
                                <br /><br />
                                Price often bounces off these levels because many orders need to be filled before price can move through.
                            </div>
                        </div>
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-white flex items-center gap-1">
                            Terminal Liquidity Wall
                            <span className={`text-[7px] px-1.5 rounded font-mono ${status === 'connected' ? 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)]' : 'bg-gray-500/20 text-gray-400'}`}>LIVE</span>
                        </span>
                    </div>
                </div>
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${impulse === 'bullish' ? 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)]' :
                    impulse === 'bearish' ? 'bg-[var(--color-bearish)]/20 text-[var(--color-bearish)]' :
                        'bg-white/10 text-gray-400'
                    }`}>
                    <span>IMPULSE:</span>
                    <span className="uppercase">{impulse}</span>
                </div>
            </div>

            {/* Primary Wall Highlight */}
            {primaryWall && (
                <div
                    className={`mx-3 mt-3 p-3 rounded-lg border cursor-pointer transition-all hover:scale-[1.01] ${primaryWall.side === 'support'
                        ? 'bg-[var(--color-bullish)]/10 border-[var(--color-bullish)]/30 hover:border-[var(--color-bullish)]/50'
                        : 'bg-[var(--color-bearish)]/10 border-[var(--color-bearish)]/30 hover:border-[var(--color-bearish)]/50'
                        }`}
                    onClick={() => onPriceClick?.(primaryWall.price)}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            {primaryWall.side === 'support' ? (
                                <TrendingUp className="w-4 h-4 text-[var(--color-bullish)]" />
                            ) : (
                                <TrendingDown className="w-4 h-4 text-[var(--color-bearish)]" />
                            )}
                            <span className={`text-[9px] font-black uppercase ${primaryWall.side === 'support' ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'
                                }`}>
                                {primaryWall.strength.toUpperCase()} {primaryWall.side.toUpperCase()}
                            </span>
                        </div>
                        <span className="text-lg font-black text-white font-mono">
                            {formatDollar(primaryWall.usdValue)}
                        </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                        <span className={`font-mono font-bold ${primaryWall.side === 'support' ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'
                            }`}>
                            {primaryWall.side === 'support' ? 'Support' : 'Resistance'} detected at ${primaryWall.price.toLocaleString()}
                        </span>
                        <span className="text-gray-500">
                            {primaryWall.percentFromPrice.toFixed(2)}% away
                        </span>
                    </div>
                </div>
            )}

            {/* Levels Grid */}
            {hasWalls ? (
                <div className="flex-1 p-3 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                    <div className="grid grid-cols-2 gap-2">
                        {/* Resistance Column */}
                        <div>
                            <div className="flex items-center gap-1.5 mb-2 px-1">
                                <TrendingDown className="w-3 h-3 text-[var(--color-bearish)]" />
                                <span className="text-[8px] font-black uppercase text-[var(--color-bearish)] tracking-wider">Resistance</span>
                            </div>
                            <div className="space-y-1.5">
                                {resistances.length > 0 ? resistances.map((level, i) => (
                                    <div
                                        key={level.price}
                                        className="bg-[var(--color-bearish)]/5 border border-[var(--color-bearish)]/10 hover:border-[var(--color-bearish)]/30 rounded-lg p-2 cursor-pointer transition-all"
                                        onClick={() => onPriceClick?.(level.price)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-[10px] text-[var(--color-bearish)] font-bold">
                                                ${level.price.toLocaleString()}
                                            </span>
                                            <span className={`text-[7px] font-black uppercase px-1 rounded ${level.strength === 'critical' ? 'bg-[var(--color-bearish)] text-white animate-pulse' :
                                                level.strength === 'major' ? 'bg-[var(--color-bearish)]/30 text-[var(--color-bearish)]' :
                                                    'bg-[var(--color-bearish)]/10 text-[var(--color-bearish)]'
                                                }`}>
                                                {level.strength}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1 text-[9px]">
                                            <span className="text-gray-500">{formatDollar(level.usdValue)}</span>
                                            <span className="text-gray-600">+{level.percentFromPrice.toFixed(2)}%</span>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-[9px] text-gray-600 text-center py-4">
                                        No significant resistance
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Support Column */}
                        <div>
                            <div className="flex items-center gap-1.5 mb-2 px-1">
                                <TrendingUp className="w-3 h-3 text-[var(--color-bullish)]" />
                                <span className="text-[8px] font-black uppercase text-[var(--color-bullish)] tracking-wider">Support</span>
                            </div>
                            <div className="space-y-1.5">
                                {supports.length > 0 ? supports.map((level, i) => (
                                    <div
                                        key={level.price}
                                        className="bg-[var(--color-bullish)]/5 border border-[var(--color-bullish)]/10 hover:border-[var(--color-bullish)]/30 rounded-lg p-2 cursor-pointer transition-all"
                                        onClick={() => onPriceClick?.(level.price)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-[10px] text-[var(--color-bullish)] font-bold">
                                                ${level.price.toLocaleString()}
                                            </span>
                                            <span className={`text-[7px] font-black uppercase px-1 rounded ${level.strength === 'critical' ? 'bg-[var(--color-bullish)] text-black animate-pulse' :
                                                level.strength === 'major' ? 'bg-[var(--color-bullish)]/30 text-[var(--color-bullish)]' :
                                                    'bg-[var(--color-bullish)]/10 text-[var(--color-bullish)]'
                                                }`}>
                                                {level.strength}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1 text-[9px]">
                                            <span className="text-gray-500">{formatDollar(level.usdValue)}</span>
                                            <span className="text-gray-600">-{level.percentFromPrice.toFixed(2)}%</span>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-[9px] text-gray-600 text-center py-4">
                                        No significant support
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
                    <Shield className="w-8 h-8 mb-2 opacity-20" />
                    <span className="text-[10px]">Scanning for liquidity walls...</span>
                    <span className="text-[9px] text-gray-700 mt-1">Significant levels will appear here</span>
                </div>
            )}

            {/* Footer Bias */}
            <div className="px-3 py-2 border-t border-[var(--glass-border)] bg-[var(--background)]/40 flex items-center justify-between">
                <span className="text-[8px] text-gray-600">Market Bias:</span>
                <span className={`text-[9px] font-black uppercase ${marketBias === 'bullish' ? 'text-[var(--color-bullish)]' :
                    marketBias === 'bearish' ? 'text-[var(--color-bearish)]' :
                        'text-gray-400'
                    }`}>
                    {marketBias}
                </span>
            </div>
        </div>
    );
}
