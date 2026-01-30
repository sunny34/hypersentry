import { useEffect, useState, useMemo } from 'react';
import { useHyperliquidWS } from '../hooks/useHyperliquidWS';

interface OrderBookLevel {
    px: string; // Price
    sz: string; // Size
    n: number;  // Number of orders
}

interface OrderBookProps {
    coin: string;
}

export default function OrderBook({ coin }: OrderBookProps) {
    const { status, subscribe, addListener } = useHyperliquidWS();
    const [bids, setBids] = useState<OrderBookLevel[]>([]);
    const [asks, setAsks] = useState<OrderBookLevel[]>([]);

    useEffect(() => {
        if (status === 'connected') {
            subscribe({ type: 'l2Book', coin: coin });
        }
    }, [status, coin, subscribe]);

    useEffect(() => {
        const removeListener = addListener('l2Book', (data: any) => {
            if (data.coin === coin) {
                // Hyperliquid sends levels as [[bids], [asks]]
                // bids: array of {px, sz, n}
                // asks: array of {px, sz, n}
                // Check if data.levels exists and has the right structure
                if (data.levels && data.levels.length === 2) {
                    setBids(data.levels[0].slice(0, 15)); // Top 15
                    setAsks(data.levels[1].slice(0, 15)); // Top 15
                }
            }
        });
        return () => removeListener();
    }, [addListener, coin]);

    // Calculate max size for depth visualization
    const maxSize = useMemo(() => {
        const maxBid = Math.max(...bids.map(b => parseFloat(b.sz)), 0);
        const maxAsk = Math.max(...asks.map(a => parseFloat(a.sz)), 0);
        return Math.max(maxBid, maxAsk);
    }, [bids, asks]);

    return (
        <div className="flex flex-col h-full bg-gray-950/50 border border-gray-800 rounded-xl overflow-hidden text-xs">
            {/* Header */}
            <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex justify-between items-center">
                <span className="font-bold text-gray-400">Order Book</span>
                <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800">
                {/* Asks (Sell Orders) - Red - Listed top to bottom (highest price first? usually Lowest Sell is closest to spread)
                    In standard order books: 
                    Asks are at top, sorted DESCENDING (highest price at top) or ASCENDING (lowest price at bottom closer to spread).
                    Usually Asks on top (High -> Low), Spread, Bids on bottom (High -> Low).
                */}
                <div className="flex flex-col-reverse"> {/* Reverse to have lowest Ask at bottom */}
                    {asks.map((ask, i) => {
                        const size = parseFloat(ask.sz);
                        const percentage = (size / maxSize) * 100;
                        return (
                            <div key={ask.px} className="relative flex justify-between px-3 py-0.5 hover:bg-gray-800/50">
                                <div
                                    className="absolute top-0 right-0 bottom-0 bg-red-500/10 transition-all duration-300"
                                    style={{ width: `${percentage}%` }}
                                />
                                <span className="text-red-400 z-10 font-mono">{parseFloat(ask.px).toFixed(4)}</span>
                                <span className="text-gray-400 z-10 font-mono">{parseFloat(ask.sz).toFixed(2)}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Spread */}
                <div className="py-1 bg-gray-900/50 text-center border-y border-gray-800/50 my-1">
                    {asks.length > 0 && bids.length > 0 && (
                        <span className="font-mono text-gray-300">
                            {(parseFloat(asks[0].px) - parseFloat(bids[0].px)).toFixed(4)}
                        </span>
                    )}
                </div>

                {/* Bids (Buy Orders) - Green - Highest Buy at top */}
                <div className="flex flex-col">
                    {bids.map((bid, i) => {
                        const size = parseFloat(bid.sz);
                        const percentage = (size / maxSize) * 100;
                        return (
                            <div key={bid.px} className="relative flex justify-between px-3 py-0.5 hover:bg-gray-800/50">
                                <div
                                    className="absolute top-0 right-0 bottom-0 bg-emerald-500/10 transition-all duration-300"
                                    style={{ width: `${percentage}%` }}
                                />
                                <span className="text-emerald-400 z-10 font-mono">{parseFloat(bid.px).toFixed(4)}</span>
                                <span className="text-gray-400 z-10 font-mono">{parseFloat(bid.sz).toFixed(2)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
