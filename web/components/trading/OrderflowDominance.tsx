import React, { useMemo } from 'react';
import { useMarketStore } from '../../store/useMarketStore';
import { Activity, TrendingDown, TrendingUp } from 'lucide-react';

interface OrderflowDominanceProps {
    symbol: string;
}

export const OrderflowDominance: React.FC<OrderflowDominanceProps> = ({ symbol }) => {
    const tokenData = useMarketStore(s => s.marketData[symbol]);

    const metrics = useMemo(() => {
        if (!tokenData || !tokenData.trades || tokenData.trades.length === 0) return null;

        let buyVol = 0;
        let sellVol = 0;
        let largeBuys = 0;
        let largeSells = 0;
        let count = 0;

        const trades = tokenData.trades; // Already trimmed to recent history in store

        trades.forEach(t => {
            const sz = parseFloat(t.sz);
            const usdVal = sz * parseFloat(t.px);

            if (t.side === 'B') {
                buyVol += usdVal;
                if (usdVal > 10000) largeBuys++;
            } else {
                sellVol += usdVal;
                if (usdVal > 10000) largeSells++;
            }
            count++;
        });

        const totalVol = buyVol + sellVol;
        const netDelta = buyVol - sellVol;

        // Avoid division by zero
        const buyDominancePct = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;

        return {
            buyVol,
            sellVol,
            totalVol,
            netDelta,
            buyDominancePct,
            largeBuys,
            largeSells,
            count
        };
    }, [tokenData?.trades]);

    const formatUSD = (val: number) => {
        const absVal = Math.abs(val);
        if (absVal > 1000000) return `${val < 0 ? '-' : ''}$${(absVal / 1000000).toFixed(2)}M`;
        if (absVal > 1000) return `${val < 0 ? '-' : ''}$${(absVal / 1000).toFixed(1)}K`;
        return `${val < 0 ? '-' : ''}$${absVal.toFixed(0)}`;
    };

    if (!metrics) {
        return (
            <div className="w-full h-full flex items-center justify-center font-mono text-xs text-gray-500">
                Aggregating Tick Data...
            </div>
        );
    }

    const domColor = metrics.netDelta > 0 ? 'text-emerald-400' : metrics.netDelta < 0 ? 'text-red-400' : 'text-gray-400';
    const DomIcon = metrics.netDelta > 0 ? TrendingUp : metrics.netDelta < 0 ? TrendingDown : Activity;

    return (
        <div className="flex flex-col h-full bg-[#050505] font-mono p-4">
            <div className="flex items-center gap-2 mb-6">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Real-time Orderflow Dominance</h3>
            </div>

            <div className="flex flex-col gap-8">
                {/* Headline Metric */}
                <div className="flex flex-col items-center justify-center py-4 bg-white/5 rounded-xl border border-white/10">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Net Tick Delta (Recent)</span>
                    <div className={`flex items-center gap-2 text-3xl font-black tracking-tighter ${domColor}`}>
                        <DomIcon className="w-6 h-6" />
                        {formatUSD(metrics.netDelta)}
                    </div>
                    <span className="text-[9px] text-gray-500 mt-2">from {metrics.count} grouped ticks</span>
                </div>

                {/* Tug of War Bar */}
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-xs font-bold">
                        <span className="text-emerald-400">Buyers ({metrics.buyDominancePct.toFixed(1)}%)</span>
                        <span className="text-red-400">Sellers ({(100 - metrics.buyDominancePct).toFixed(1)}%)</span>
                    </div>

                    <div className="h-4 w-full bg-red-500/20 rounded-full overflow-hidden flex shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] border border-white/5 relative">
                        {/* Center Line marker */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/30 z-10" />
                        <div
                            className="bg-emerald-500 h-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                            style={{ width: `${metrics.buyDominancePct}%` }}
                        />
                        <div
                            className="bg-red-500 h-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                            style={{ width: `${100 - metrics.buyDominancePct}%` }}
                        />
                    </div>

                    <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                        <span>{formatUSD(metrics.buyVol)} Vol</span>
                        <span>{formatUSD(metrics.sellVol)} Vol</span>
                    </div>
                </div>

                {/* Whale Order Flow Stats */}
                <div className="grid grid-cols-2 gap-4 mt-2">
                    <div className="flex flex-col p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                        <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-1">Large Buys (&gt;$10k)</span>
                        <span className="text-xl font-bold text-emerald-400">{metrics.largeBuys}</span>
                    </div>
                    <div className="flex flex-col p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
                        <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-1">Large Sells (&gt;$10k)</span>
                        <span className="text-xl font-bold text-red-400">{metrics.largeSells}</span>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default OrderflowDominance;
