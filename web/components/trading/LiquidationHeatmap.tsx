'use client';

import { useMemo } from 'react';

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
    // 1. High Funding (>0) = Market is Long Heavy => Higher Risk of Long Cascades (Downside).
    // 2. Low Funding (<0) = Market is Short Heavy => Higher Risk of Short Squeezes (Upside).
    // 3. We distribute the Total Open Interest across these theoretical liquidation bands.

    const liqLevels = useMemo(() => {
        if (!currentPrice || !openInterest) return [];

        const levels: LiqLevel[] = [];

        // Fix: OI is usually in Base Asset units (e.g., BTC). Convert to USD Notional.
        const totalOIUsd = openInterest * currentPrice;

        // Define standard leverage tiers and their estimated market share
        // Using a heuristic: Higher leverage has less capital but effectively controls large position size initially.
        // However, standard "OI" is not leverage-adjusted, it's notional. 
        // We assume ~15% of OI is highly levered (degen), ~35% mid, ~50% low/hedged.

        const leverageTiers = [
            { mult: 100, label: '100x', share: 0.05, riskMargin: 0.005 }, // 0.5% move wipes them
            { mult: 50, label: '50x', share: 0.10, riskMargin: 0.015 },  // 1.5% move (with fees)
            { mult: 25, label: '25x', share: 0.20, riskMargin: 0.035 },  // 3.5% move
            { mult: 10, label: '10x', share: 0.30, riskMargin: 0.095 },  // 9.5% move
        ];

        // Funding Rate Weighting
        // If Funding is Positive (+), Longs pay Shorts. Market is Bullish/Long.
        // We skew the "Volume" estimation: More volume is attributed to Longs.
        const longBias = fundingRate > 0 ? 1.5 : 0.8;
        const shortBias = fundingRate < 0 ? 1.5 : 0.8;

        // --- Generate Long Liquidation Clusters (Prices BELOW Current) ---
        // These are Longs who entered AT current price ("Late Longs").
        leverageTiers.forEach(tier => {
            const liqPrice = currentPrice * (1 - (1 / tier.mult) + 0.002); // Buffer for fees
            const estVolume = (totalOIUsd * tier.share * longBias) / 2; // Split OI roughly

            // Intensity based on volume relative to total OI (max plausible per band)
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

        // --- Generate Short Liquidation Clusters (Prices ABOVE Current) ---
        // These are Shorts who entered AT current price ("Aggressive Shorts").
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

        // Sort by price: Highest price (Short Liqs) -> Lowest price (Long Liqs)
        return levels.sort((a, b) => b.price - a.price);
    }, [currentPrice, openInterest, fundingRate]);

    // Format helpers
    const formatK = (n: number) => {
        if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)}B`; // Added Billions support
        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
        return `$${n.toFixed(0)}`;
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-64 select-none">
            {/* Header */}
            <div className="p-3 border-b border-gray-800">
                <div className="flex justify-between items-center mb-1">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        🔥 Liq. Map
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                            Model v1.1
                        </span>
                    </h3>
                    <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500" title="Short Squeeze Zone" />
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" title="Long Cascade Zone" />
                    </div>
                </div>
                <div className="text-[10px] text-gray-600 leading-tight">
                    Est. liquidation levels based on Total OI ({formatK(openInterest * currentPrice)}) & Funding ({fundingRate ? (fundingRate * 100).toFixed(4) : '0'}%).
                </div>
            </div>

            {/* Heatmap Visualization */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 relative scrollbar-thin scrollbar-thumb-gray-800">
                {/* Mid Label (Current Price Anchor) */}
                <div className="sticky top-1/2 left-0 right-0 flex items-center justify-center pointer-events-none opacity-20 py-2 z-10">
                    <span className="bg-gray-800 text-white text-[9px] px-2 py-0.5 rounded-full">Current Price</span>
                </div>

                {liqLevels.map((level, i) => (
                    <div key={i} className="group relative flex items-center gap-2 text-[10px] hover:bg-gray-800/30 rounded p-0.5 transition-colors">
                        {/* Price */}
                        <span className={`w-14 font-mono text-right ${level.side === 'short' ? 'text-orange-400' : 'text-emerald-400'}`}>
                            {level.price.toFixed(level.price < 1 ? 4 : 2)}
                        </span>

                        {/* Bar */}
                        <div className="flex-1 h-4 bg-gray-800/50 rounded-sm relative overflow-hidden">
                            {/* Background Bar (Intensity) */}
                            <div
                                className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ${level.side === 'short' ? 'bg-orange-500' : 'bg-red-500'}`}
                                style={{
                                    width: `${Math.max(level.intensity * 100, 5)}%`,
                                    opacity: level.intensity * 0.8 + 0.2
                                }}
                            />
                            {/* Label Overlay */}
                            <div className="absolute inset-0 flex items-center justify-between px-1.5 text-white/90 text-[9px] font-medium z-10">
                                <span>{level.leverage}</span>
                                <span className="opacity-80">{formatK(level.volume)}</span>
                            </div>
                        </div>
                    </div>
                ))}

                {liqLevels.length === 0 && (
                    <div className="text-center text-gray-600 mt-10 text-xs">
                        Syncing Market Data...
                    </div>
                )}
            </div>

            {/* Risk Insight Footnote */}
            <div className="p-2 border-t border-gray-800 text-[9px] text-center font-mono">
                {fundingRate > 0.005
                    ? <span className="text-red-400">High Funding: Long Cascade Risk</span>
                    : fundingRate < -0.005
                        ? <span className="text-orange-400">Neg Funding: Short Squeeze Risk</span>
                        : <span className="text-gray-500">Market Balanced</span>
                }
            </div>
        </div>
    );
}
