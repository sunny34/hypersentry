import React, { useMemo } from 'react';
import { useMarketStore } from '../../store/useMarketStore';
import { Anchor, ArrowDown, ArrowUp } from 'lucide-react';

interface LiquidityWallsProps {
    symbol: string;
}

interface Wall {
    price: number;
    sizeUSD: number;
    sizeToken: number;
    distancePct: number;
    type: 'BID' | 'ASK';
}

export const LiquidityWalls: React.FC<LiquidityWallsProps> = ({ symbol }) => {
    const tokenData = useMarketStore(s => s.marketData[symbol]);

    const walls = useMemo(() => {
        if (!tokenData || !tokenData.book || tokenData.book.length < 2 || !tokenData.price) return { bids: [], asks: [] };

        const currentPrice = tokenData.price;
        const rawBids = tokenData.book[0];
        const rawAsks = tokenData.book[1];

        // Determine bucket size based on current price to group into meaningful zones
        // e.g. BTC (68000) -> 100, ETH (3000) -> 10, SOL (150) -> 1, MEME (0.005) -> 0.0001
        const getBucketSize = (price: number) => {
            if (price > 10000) return 50;
            if (price > 1000) return 10;
            if (price > 100) return 1;
            if (price > 10) return 0.1;
            if (price > 1) return 0.01;
            return price * 0.01; // fallback to 1%
        };
        const bucketSize = getBucketSize(currentPrice);

        const processZones = (sideData: any[], type: 'BID' | 'ASK'): Wall[] => {
            // Aggregate into price buckets
            const map = new Map<number, { sizeToken: number, count: number }>();

            for (const item of sideData) {
                const px = parseFloat(item.px);
                const sz = parseFloat(item.sz);
                // Round to nearest bucket
                const bucketPx = type === 'BID'
                    ? Math.floor(px / bucketSize) * bucketSize
                    : Math.ceil(px / bucketSize) * bucketSize;

                const existing = map.get(bucketPx) || { sizeToken: 0, count: 0 };
                existing.sizeToken += sz;
                existing.count += 1;
                map.set(bucketPx, existing);
            }

            const zones: Wall[] = [];
            for (const [px, data] of map.entries()) {
                const distancePct = Math.abs((px - currentPrice) / currentPrice) * 100;
                // Only consider zones that have significant weight and are outside the immediate micro-spread
                if (distancePct >= 0.05 && distancePct <= 5.0) {
                    zones.push({
                        price: px,
                        sizeUSD: px * data.sizeToken,
                        sizeToken: data.sizeToken,
                        distancePct,
                        type,
                    });
                }
            }

            return zones
                .filter(w => w.sizeUSD > 50000) // Filter small noise
                .sort((a, b) => b.sizeUSD - a.sizeUSD) // Sort by largest structural size
                .slice(0, 4); // Top 4 structural nodes
        };

        return {
            bids: processZones(rawBids, 'BID').sort((a, b) => b.price - a.price), // Sort bids descending by price
            asks: processZones(rawAsks, 'ASK').sort((a, b) => a.price - b.price), // Sort asks ascending by price
        };
    }, [tokenData?.book, tokenData?.price]);

    const formatUSD = (val: number) => {
        if (val > 1000000) return `$${(val / 1000000).toFixed(2)}M`;
        if (val > 1000) return `$${(val / 1000).toFixed(1)}K`;
        return `$${val.toFixed(0)}`;
    };

    if (!tokenData || !tokenData.book) {
        return (
            <div className="w-full h-full flex items-center justify-center font-mono text-xs text-gray-500">
                Scanning Orderbook...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#050505] font-mono p-4">
            <div className="flex items-center gap-2 mb-4">
                <Anchor className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Structural Liquidity Pools</h3>
            </div>

            <div className="flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
                {/* Asks (Sell Walls) */}
                <div>
                    <div className="text-[10px] text-gray-500 font-bold mb-2 uppercase tracking-wider flex items-center gap-2">
                        <ArrowUp className="w-3 h-3 text-red-500" /> Ask Resistance (Sell Walls)
                    </div>
                    {walls.asks.length === 0 ? (
                        <div className="text-[10px] text-gray-600 italic px-2">No significant resistance within 5%.</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {walls.asks.map((w, i) => (
                                <div key={`ask-${i}`} className="flex justify-between items-center bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 p-2 rounded relative overflow-hidden group">
                                    {/* Visual intensity bar behind text */}
                                    <div
                                        className="absolute left-0 top-0 bottom-0 bg-red-500/10 transition-all"
                                        style={{ width: `${Math.min(100, (w.sizeUSD / (walls.asks[0]?.sizeUSD || 1)) * 100)}%` }}
                                    />
                                    <div className="flex flex-col z-10">
                                        <span className="text-red-400 font-bold text-sm">~${w.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                        <span className="text-gray-500 text-[9px] uppercase">+{w.distancePct.toFixed(2)}% Zone</span>
                                    </div>
                                    <div className="flex flex-col items-end z-10">
                                        <span className="text-white font-bold text-sm">{formatUSD(w.sizeUSD)}</span>
                                        <span className="text-gray-500 text-[9px]">{w.sizeToken.toFixed(0)} {symbol}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Bids (Buy Walls) */}
                <div>
                    <div className="text-[10px] text-gray-500 font-bold mb-2 uppercase tracking-wider flex items-center gap-2">
                        <ArrowDown className="w-3 h-3 text-emerald-500" /> Bid Support (Buy Walls)
                    </div>
                    {walls.bids.length === 0 ? (
                        <div className="text-[10px] text-gray-600 italic px-2">No significant support within 5%.</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {walls.bids.map((w, i) => (
                                <div key={`bid-${i}`} className="flex justify-between items-center bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/10 p-2 rounded relative overflow-hidden group">
                                    <div
                                        className="absolute left-0 top-0 bottom-0 bg-emerald-500/10 transition-all"
                                        style={{ width: `${Math.min(100, (w.sizeUSD / (walls.bids[0]?.sizeUSD || 1)) * 100)}%` }}
                                    />
                                    <div className="flex flex-col z-10">
                                        <span className="text-emerald-400 font-bold text-sm">~${w.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                                        <span className="text-gray-500 text-[9px] uppercase">-{w.distancePct.toFixed(2)}% Zone</span>
                                    </div>
                                    <div className="flex flex-col items-end z-10">
                                        <span className="text-white font-bold text-sm">{formatUSD(w.sizeUSD)}</span>
                                        <span className="text-gray-500 text-[9px]">{w.sizeToken.toFixed(0)} {symbol}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.1);
                    border-radius: 4px;
                }
            `}</style>
        </div>
    );
};

export default LiquidityWalls;
