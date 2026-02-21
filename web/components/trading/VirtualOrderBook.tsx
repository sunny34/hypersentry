import { memo } from 'react';
import { formatCompact } from '@/lib/formatters';

// Utility: Format numbers (e.g., 20000 -> 20k)
const formatNumber = (num: any) => {
    return formatCompact(num);
};

interface OrderBookRowProps {
    price: string;
    size: string;
    total: number;
    maxSize: number;
    side: 'bid' | 'ask';
    precision: number;
    onSelect?: (px: string) => void;
}

const OrderBookRow = memo(({ price, size, total, maxSize, side, precision, onSelect }: OrderBookRowProps) => {
    const sz = parseFloat(size);
    const px = parseFloat(price);
    const width = Math.min(100, (sz / maxSize) * 100);

    return (
        <div
            onClick={() => onSelect?.(px.toFixed(precision))}
            className="flex w-full text-[10px] font-mono items-center hover:bg-white/5 py-[1px] relative cursor-pointer group"
        >
            <div
                className={`absolute inset-y-0 right-0 ${side === 'bid' ? 'bg-emerald-500/10' : 'bg-red-500/10'} transition-all duration-300 pointer-events-none`}
                style={{ width: `${width}%` }}
            />

            <span className={`z-10 font-bold w-[45%] pl-3 ${side === 'bid' ? 'text-emerald-400' : 'text-red-400'}`}>
                {px.toFixed(precision)}
            </span>

            <span className="text-gray-300 z-10 w-[30%] text-right group-hover:text-white transition-colors">
                {formatNumber(sz)}
            </span>

            <span className="text-gray-500 z-10 w-[25%] pr-3 text-right group-hover:text-gray-300 transition-colors">
                {formatNumber(total)}
            </span>
        </div>
    );
});

OrderBookRow.displayName = 'OrderBookRow';

export const VirtualOrderBook = ({
    bids = [],
    asks = [],
    precision = 2,
    midPrice = 0,
    onSelectPrice
}: {
    bids?: any[],
    asks?: any[],
    precision?: number,
    midPrice?: number,
    onSelectPrice?: (px: string) => void
}) => {
    const safeBids = Array.isArray(bids) ? bids.slice(0, 15) : [];
    const safeAsks = Array.isArray(asks) ? asks.slice(0, 15) : [];

    const maxSize = Math.max(
        ...safeBids.map(b => parseFloat(b.sz)),
        ...safeAsks.map(a => parseFloat(a.sz)),
        1
    );

    if (safeBids.length === 0 && safeAsks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 text-[10px] font-mono gap-2">
                <div className="animate-pulse">Awaiting Depth Stream...</div>
            </div>
        );
    }

    // Calculate cumulative totals without mutable render-local counters.
    const bidsWithTotal = safeBids.map((bid, idx) => {
        const total = safeBids
            .slice(0, idx + 1)
            .reduce((sum, level) => sum + parseFloat(level.sz), 0);
        return { ...bid, total };
    });

    const asksWithTotal = safeAsks.map((ask, idx) => {
        const total = safeAsks
            .slice(0, idx + 1)
            .reduce((sum, level) => sum + parseFloat(level.sz), 0);
        return { ...ask, total };
    });

    return (
        <div className="absolute inset-0 grid grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden bg-black/40">
            {/* Asks (Sells) - Top part */}
            <div className="flex flex-col justify-end overflow-y-auto scrollbar-hide border-b border-white/5 min-h-0 bg-red-500/[0.02]">
                {[...asksWithTotal].reverse().map((ask, i) => (
                    <OrderBookRow
                        key={`ask-${ask.px}-${i}`}
                        price={ask.px}
                        size={ask.sz}
                        total={ask.total}
                        maxSize={maxSize}
                        side="ask"
                        precision={precision}
                        onSelect={onSelectPrice}
                    />
                ))}
            </div>

            {/* Mid Price Spread Bar */}
            <div className="py-2 bg-black border-y border-white/10 flex flex-col items-center justify-center shrink-0 z-10 shadow-lg">
                <span className="text-sm font-black text-white leading-none tracking-tighter">
                    {midPrice > 0 ? midPrice.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision }) : '-'}
                </span>
                {safeAsks.length > 0 && safeBids.length > 0 && (
                    <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest mt-1 opacity-70">
                        Spread: {(parseFloat(safeAsks[0].px) - parseFloat(safeBids[0].px)).toFixed(precision)}
                    </span>
                )}
            </div>

            {/* Bids (Buys) - Bottom part */}
            <div className="overflow-y-auto scrollbar-hide border-t border-transparent min-h-0 bg-emerald-500/[0.02]">
                {bidsWithTotal.map((bid, i) => (
                    <OrderBookRow
                        key={`bid-${bid.px}-${i}`}
                        price={bid.px}
                        size={bid.sz}
                        total={bid.total}
                        maxSize={maxSize}
                        side="bid"
                        precision={precision}
                        onSelect={onSelectPrice}
                    />
                ))}
            </div>
        </div>
    );
};
