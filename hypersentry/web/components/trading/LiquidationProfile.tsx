'use client';

import { useMemo } from 'react';

interface LiquidationProfileProps {
    currentPrice: number;
    symbol: string;
    openInterest: number;
    fundingRate: number;
    height: number; // Height of the chart container
    maxPrice: number; // Max price currently visible
    minPrice: number; // Min price currently visible
    mode?: 'overlay' | 'full';
}

interface LiqLevel {
    price: number;
    volume: number;
    leverage: string;
    side: 'long' | 'short';
    intensity: number;
}

export default function LiquidationProfile({
    currentPrice,
    openInterest,
    fundingRate,
    height,
    maxPrice,
    minPrice,
    mode = 'overlay'
}: LiquidationProfileProps) {
    const liqLevels = useMemo(() => {
        // Fallback for OI if data is still loading/missing
        const effectiveOI = openInterest || 2500000; // 2.5M fallback for visual presence


        if (!currentPrice || currentPrice <= 0) {
            console.warn('[LiqProfile] No current price');
            return [];
        }

        const levels: LiqLevel[] = [];

        const leverageTiers = [
            { mult: 100, label: '100x', share: 0.10 },
            { mult: 50, label: '50x', share: 0.15 },
            { mult: 25, label: '25x', share: 0.20 },
            { mult: 10, label: '10x', share: 0.30 },
        ];

        // Funding rate affects the "imbalance" of liquidations
        const longBias = fundingRate > 0 ? 1.3 : 0.7;
        const shortBias = fundingRate < 0 ? 1.3 : 0.7;

        leverageTiers.forEach(tier => {
            // Predicted liquidation clusters (price * (1 - 1/leverage + buffer))
            const longPx = currentPrice * (1 - (1 / tier.mult) + 0.001);
            const shortPx = currentPrice * (1 + (1 / tier.mult) - 0.001);

            levels.push({
                price: longPx,
                volume: effectiveOI * tier.share * longBias,
                leverage: tier.label,
                side: 'long',
                intensity: tier.share
            });

            levels.push({
                price: shortPx,
                volume: effectiveOI * tier.share * shortBias,
                leverage: tier.label,
                side: 'short',
                intensity: tier.share
            });
        });

        return levels;
    }, [currentPrice, openInterest, fundingRate]);

    const formatCompact = (n: number) => {
        if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
        if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
        if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
        return n.toFixed(0);
    };

    const maxVol = Math.max(...liqLevels.map(l => l.volume), 1);

    return (
        <div className={`absolute inset-0 pointer-events-none flex flex-col ${mode === 'overlay' ? 'right-[60px] w-[500px] overflow-visible' : 'w-full'} pt-10 pb-10`}>
            {liqLevels.map((level, i) => {
                const range = maxPrice - minPrice;
                if (range <= 0) return null;

                const yPos = ((maxPrice - level.price) / range) * height;
                if (yPos < -20 || yPos > height + 20) return null;

                const barWidth = (level.volume / maxVol) * 100;
                const isShort = level.side === 'short';

                // FULL MODE DESIGN
                if (mode === 'full') {
                    // Full width zones
                    const bgStyle = isShort
                        ? `linear-gradient(90deg, transparent 0%, var(--color-bullish) 50%, var(--color-bullish) 100%)`
                        : `linear-gradient(90deg, transparent 0%, var(--color-bearish) 50%, var(--color-bearish) 100%)`;

                    return (
                        <div
                            key={i}
                            className="absolute left-0 right-0 flex items-center justify-end"
                            style={{ top: `${yPos}px`, transform: 'translateY(-50%)' }}
                        >
                            <div
                                className="w-full h-[24px] border-b border-white/5 opacity-20"
                                style={{
                                    background: bgStyle,
                                    height: `${20 + (level.intensity * 40)}px`, // Variable height based on intensity
                                }}
                            />
                            {/* Label floating on Right */}
                            <div className="absolute right-16 flex items-center gap-2 opacity-80">
                                <span className={`text-[10px] font-bold ${isShort ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>{level.leverage}</span>
                                <span className="text-[10px] text-gray-500 font-mono">${formatCompact(level.volume)}</span>
                            </div>
                        </div>
                    );
                }

                // OVERLAY PILL DESIGN (Legacy / Toggleable)
                const barColor = isShort
                    ? 'bg-gradient-to-l from-[var(--color-bullish)] to-[var(--color-bullish)]/70 border-[var(--color-bullish)]/30'
                    : 'bg-gradient-to-l from-[var(--color-bearish)] to-[var(--color-bearish)]/70 border-[var(--color-bearish)]/30';

                const textColor = 'text-white';
                const badgeColor = isShort ? 'bg-black/40 text-[var(--color-bullish)]' : 'bg-black/40 text-[var(--color-bearish)]';

                return (
                    <div
                        key={i}
                        className="absolute right-0 flex items-center justify-end group pointer-events-auto transition-all duration-500 ease-out"
                        style={{ top: `${yPos}px`, width: '100%', transform: 'translateY(-50%)' }}
                    >
                        {/* The Bar Container */}
                        <div
                            className={`relative h-6 ${barColor} flex items-center justify-between px-2 rounded-l-full border-l border-t border-b shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-sm transition-all duration-500`}
                            style={{
                                width: `${Math.max(barWidth * 0.9, 15)}%`, // increased width scaling
                                minWidth: '140px',
                                opacity: 0.85 + (level.intensity * 0.15)
                            }}
                        >
                            {/* Left Side: Leverage Badge */}
                            <div className={`${badgeColor} px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase shadow-inner`}>
                                {level.leverage}
                            </div>

                            {/* Right Side: Volume Text */}
                            <div className={`text-[10px] font-bold font-mono ${textColor} drop-shadow-md`}>
                                ${formatCompact(level.volume)}
                            </div>

                            {/* Glow Effect */}
                            <div className={`absolute inset-0 rounded-l-full bg-gradient-to-r ${isShort ? 'from-[var(--color-bullish)]/20' : 'from-[var(--color-bearish)]/20'} to-transparent blur-md -z-10`} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}


