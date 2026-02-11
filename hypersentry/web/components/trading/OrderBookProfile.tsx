'use client';

import { useMemo } from 'react';

interface OrderBookProfileProps {
    currentPrice: number;
    symbol: string;
    height: number;
    maxPrice: number;
    minPrice: number;
    levels: { bids: any[], asks: any[] };
}

export default function OrderBookProfile({
    currentPrice,
    height,
    maxPrice,
    minPrice,
    levels
}: OrderBookProfileProps) {
    const wallLevels = useMemo(() => {
        if (!currentPrice || !levels.bids || !levels.asks) return [];

        const allLevels: any[] = [];

        // Process Bids
        const topBids = levels.bids.slice(0, 20);
        const avgBidSz = topBids.reduce((acc, b) => acc + parseFloat(b.sz), 0) / topBids.length;

        topBids.forEach(bid => {
            const sz = parseFloat(bid.sz);
            if (sz > avgBidSz * 3.0) {
                allLevels.push({
                    price: parseFloat(bid.px),
                    size: sz,
                    side: 'buy',
                    intensity: Math.min(sz / (avgBidSz * 10), 1)
                });
            }
        });

        // Process Asks
        const topAsks = levels.asks.slice(0, 20);
        const avgAskSz = topAsks.reduce((acc, a) => acc + parseFloat(a.sz), 0) / topAsks.length;

        topAsks.forEach(ask => {
            const sz = parseFloat(ask.sz);
            if (sz > avgAskSz * 3.0) {
                allLevels.push({
                    price: parseFloat(ask.px),
                    size: sz,
                    side: 'sell',
                    intensity: Math.min(sz / (avgAskSz * 10), 1)
                });
            }
        });

        return allLevels;
    }, [currentPrice, levels]);

    if (wallLevels.length === 0) return null;

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {wallLevels.map((wall, i) => {
                const range = maxPrice - minPrice;
                if (range <= 0) return null;

                const yPos = ((maxPrice - wall.price) / range) * height;
                if (yPos < 0 || yPos > height) return null;

                const isBuy = wall.side === 'buy';
                const ratio = wall.intensity; // normalized 0-1

                // Color based on intensity (Yellow/Amber palette)
                const opacity = 0.3 + (ratio * 0.5);
                const color = `rgba(251, 191, 36, ${opacity})`;
                const borderColor = `rgba(252, 211, 77, ${opacity + 0.1})`;

                const label = ratio > 0.8 ? 'MASSIVE' : ratio > 0.4 ? 'MAJOR' : 'LEVEL';

                return (
                    <div
                        key={i}
                        className="absolute left-0 flex items-center transition-all duration-300"
                        style={{ top: `${yPos}px`, transform: 'translateY(-50%)', width: '300px' }}
                    >
                        {/* Wall Bar */}
                        <div
                            className={`h-6 flex items-center px-2 rounded-r-lg border-r-2 shadow-2xl backdrop-blur-[4px] ${ratio > 0.8 ? 'animate-pulse' : ''}`}
                            style={{
                                width: `${60 + (ratio * 180)}px`,
                                background: `linear-gradient(90deg, ${color} 0%, transparent 100%)`,
                                borderColor: borderColor
                            }}
                        >
                            <div className="flex flex-col leading-none">
                                <span className="text-[7px] font-black text-white/50 tracking-tighter uppercase">{label} {wall.side}</span>
                                <span className="text-[10px] font-black text-white whitespace-nowrap drop-shadow-md tracking-tighter">
                                    {wall.size >= 1000 ? `${(wall.size / 1000).toFixed(1)}K` : wall.size.toFixed(0)}
                                </span>
                            </div>
                        </div>

                        {/* Connecting Line to price axis */}
                        <div className="flex-1 border-t border-dashed opacity-10" style={{ borderColor: borderColor }} />
                    </div>
                );
            })}
        </div>
    );
}
