'use client';

import { useMemo } from 'react';
import { Zap } from 'lucide-react';

interface LiquidationHeatmapProps {
    currentPrice: number;
    symbol: string;
    openInterest: number; // Avg $ amount active
    fundingRate: number; // Hourly funding rate
}

interface LiqLevel {
    price: number;
    volume: number; // Estimated $ amount at risk
    leverage: string; // '100x', '50x', '20x'
    side: 'long' | 'short';
    intensity: number; // 0-1 opacity
    description: string; // "Late Longs", "Aggressive Shorts"
}

export default function LiquidationHeatmap({ currentPrice, symbol, openInterest, fundingRate }: LiquidationHeatmapProps) {
    // Deterministic Liquidation Model
    // We estimate where the "Pain Points" are based on standard leverage usage.
    const liqLevels = useMemo(() => {
        if (!currentPrice || !openInterest) return [];

        const levels: LiqLevel[] = [];
        const totalOIUsd = openInterest * currentPrice;

        const leverageTiers = [
            { mult: 100, label: '100x', share: 0.05, riskMargin: 0.005 },
            { mult: 50, label: '50x', share: 0.10, riskMargin: 0.015 },
            { mult: 25, label: '25x', share: 0.20, riskMargin: 0.035 },
            { mult: 10, label: '10x', share: 0.30, riskMargin: 0.095 },
        ];

        const longBias = fundingRate > 0 ? 1.5 : 0.8;
        const shortBias = fundingRate < 0 ? 1.5 : 0.8;

        leverageTiers.forEach(tier => {
            const liqPrice = currentPrice * (1 - (1 / tier.mult) + 0.002);
            const estVolume = (totalOIUsd * tier.share * longBias) / 2;
            const intensity = Math.min((estVolume / (totalOIUsd * 0.1)), 1);

            levels.push({
                price: liqPrice,
                volume: estVolume,
                leverage: tier.label,
                side: 'long',
                intensity: intensity,
                description: `Late ${tier.label} Longs`
            });
        });

        leverageTiers.forEach(tier => {
            const liqPrice = currentPrice * (1 + (1 / tier.mult) - 0.002);
            const estVolume = (totalOIUsd * tier.share * shortBias) / 2;
            const intensity = Math.min((estVolume / (totalOIUsd * 0.1)), 1);

            levels.push({
                price: liqPrice,
                volume: estVolume,
                leverage: tier.label,
                side: 'short',
                intensity: intensity,
                description: `Over-lev ${tier.label} Shorts`
            });
        });

        return levels.sort((a, b) => b.price - a.price);
    }, [currentPrice, openInterest, fundingRate]);

    const formatK = (n: number) => {
        if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)}B`;
        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
        return `$${n.toFixed(0)}`;
    };

    const maxVolume = Math.max(...liqLevels.map(l => l.volume), 1);

    return (
        <div className="flex flex-col h-full bg-black/40 select-none font-sans overflow-hidden">
            {/* Main Visualizer: Profile View */}
            <div className="flex-1 overflow-hidden relative pt-4 px-6 flex gap-6">
                {/* Price Axis (Left) */}
                <div className="flex flex-col justify-between py-2 text-[10px] font-mono text-gray-500 w-12 border-r border-gray-800/30">
                    {liqLevels.filter((_, i) => i === 0 || i === liqLevels.length - 1 || Math.random() > 0.7).map((l, i) => (
                        <div key={i}>{l.price.toFixed(l.price < 1 ? 4 : 2)}</div>
                    ))}
                </div>

                {/* Bars Container */}
                <div className="flex-1 relative flex flex-col justify-center gap-1 py-10">
                    {/* Current Price Reference Line (Center) */}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.5)] z-20 flex items-center">
                        <span className="ml-auto bg-blue-500 text-[9px] text-white px-1.5 py-0.5 rounded-l font-bold uppercase tracking-widest">
                            Spot: {currentPrice.toFixed(currentPrice < 1 ? 4 : 2)}
                        </span>
                    </div>

                    {/* Background Grid */}
                    <div className="absolute inset-0 grid grid-cols-4 pointer-events-none opacity-20">
                        <div className="border-r border-gray-800" />
                        <div className="border-r border-gray-800" />
                        <div className="border-r border-gray-800" />
                        <div className="border-r border-gray-800" />
                    </div>

                    {/* Levels Mapping */}
                    <div className="flex-1 flex flex-col items-center justify-between py-4">
                        {liqLevels.map((level, i) => {
                            const barWidth = (level.volume / maxVolume) * 100;
                            const isHighIntensity = level.intensity > 0.7;

                            return (
                                <div
                                    key={i}
                                    className="w-full h-8 group relative flex items-center transition-all duration-300 hover:scale-[1.02]"
                                >
                                    <div
                                        className={`absolute inset-y-1 rounded-full blur-[8px] transition-opacity duration-500 ${level.side === 'short' ? 'bg-orange-500/30' : 'bg-red-500/30'}`}
                                        style={{ width: `${barWidth}%`, opacity: level.intensity * 0.5 }}
                                    />

                                    <div
                                        className={`h-4 rounded-full relative transition-all duration-700 flex items-center px-3 gap-2 overflow-hidden border border-white/5 ${level.side === 'short'
                                            ? 'bg-gradient-to-r from-orange-400 to-orange-600 shadow-[0_0_15px_rgba(251,146,60,0.2)]'
                                            : 'bg-gradient-to-r from-red-400 to-red-600 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                                            }`}
                                        style={{ width: `${Math.max(barWidth, 15)}%`, opacity: level.intensity * 0.4 + 0.6 }}
                                    >
                                        <span className="text-[9px] font-black text-black/80">{level.leverage}</span>
                                        <span className="text-[9px] font-bold text-white ml-auto">{formatK(level.volume)}</span>
                                        <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 skew-x-12" />
                                    </div>

                                    <div className={`ml-3 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap`}>
                                        <span className={`text-[10px] font-bold ${level.side === 'short' ? 'text-orange-400' : 'text-red-400'}`}>
                                            ${level.price.toFixed(level.price < 1 ? 4 : 2)}
                                        </span>
                                        <span className="text-[9px] text-gray-500 ml-2 italic">{level.description}</span>
                                    </div>

                                    {isHighIntensity && (
                                        <div className="absolute -left-1 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white] animate-ping" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Opportunity Radar Footnote */}
            <div className="p-4 bg-black/40 border-t border-gray-800/50">
                <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-900/50 rounded-xl p-3 border border-gray-800/50">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] uppercase font-black text-gray-500">Market Opportunity</span>
                            <span className="text-[9px] font-mono text-blue-400">DELTA: {((fundingRate) * 1000).toFixed(2)} pts</span>
                        </div>
                        <p className="text-xs text-white leading-relaxed font-medium">
                            {fundingRate > 0.005
                                ? "Large Long cluster identified below spot. High risk of a cascade if current range breaks."
                                : fundingRate < -0.005
                                    ? "Over-leveraged Shorts identified above. Major squeeze potential if momentum shifts bullish."
                                    : "Market liquidity is neutral. Levels are balanced between bulls and bears."
                            }
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
