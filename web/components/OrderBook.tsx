'use client';
import { useEffect, useState, useMemo } from 'react';
import { useHyperliquidWS } from '../hooks/useHyperliquidWS';

interface OrderBookLevel {
    px: string; // Price
    sz: string; // Size
    n: number;  // Number of orders
}

interface OrderBookProps {
    coin: string;
    onSelectPrice?: (px: string) => void;
    onSelectSize?: (sz: string) => void;
}

export default function OrderBook({ coin, onSelectPrice, onSelectSize }: OrderBookProps) {
    const { status, subscribe, addListener } = useHyperliquidWS();
    const [bids, setBids] = useState<OrderBookLevel[]>([]);
    const [asks, setAsks] = useState<OrderBookLevel[]>([]);
    const [view, setView] = useState<'book' | 'trades'>('book');
    const [trades, setTrades] = useState<any[]>([]);

    useEffect(() => {
        if (status === 'connected') {
            subscribe({ type: 'l2Book', coin: coin });
            subscribe({ type: 'trades', coin: coin });
        }
    }, [status, coin, subscribe]);

    useEffect(() => {
        const removeL2 = addListener('l2Book', (data: any) => {
            if (data.coin === coin && data.levels?.length === 2) {
                setBids(data.levels[0].slice(0, 50));
                setAsks(data.levels[1].slice(0, 50));
            }
        });
        const removeTrades = addListener('trades', (data: any) => {
            if (!Array.isArray(data)) return;
            const newTrades = data.filter((t: any) => t.coin === coin);
            if (newTrades.length > 0) {
                setTrades(prev => [...newTrades, ...prev].slice(0, 50));
            }
        });
        return () => {
            if (removeL2) removeL2();
            if (removeTrades) removeTrades();
        };
    }, [addListener, coin]);

    // Calculate imbalance
    const imbalance = useMemo(() => {
        const totalBid = bids.reduce((acc, b) => acc + parseFloat(b.sz), 0);
        const totalAsk = asks.reduce((acc, a) => acc + parseFloat(a.sz), 0);
        const total = totalBid + totalAsk;
        return total > 0 ? (totalBid / total) * 100 : 50;
    }, [bids, asks]);

    const maxSize = useMemo(() => {
        const bMax = Math.max(...bids.map(b => parseFloat(b.sz)), 0);
        const aMax = Math.max(...asks.map(a => parseFloat(a.sz)), 0);
        return Math.max(bMax, aMax);
    }, [bids, asks]);

    return (
        <div className="flex flex-col h-full bg-black/20 text-[10px] select-none">
            {/* Imbalance Meter */}
            <div className="h-1 flex w-full bg-gray-800 overflow-hidden shrink-0">
                <div
                    className="h-full bg-emerald-500 transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    style={{ width: `${imbalance}%` }}
                />
                <div
                    className="h-full bg-red-500 transition-all duration-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                    style={{ width: `${100 - imbalance}%` }}
                />
            </div>

            {/* Header Tabs */}
            <div className="flex bg-gray-950/80 border-b border-gray-800/50 shrink-0">
                <button
                    onClick={() => setView('book')}
                    className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${view === 'book' ? 'text-white border-b border-blue-500 bg-blue-500/5' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    Order Book
                </button>
                <button
                    onClick={() => setView('trades')}
                    className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${view === 'trades' ? 'text-white border-b border-purple-500 bg-purple-500/5' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    Recent Trades
                </button>
            </div>

            <div className="flex-1 min-h-0 relative">
                {view === 'book' ? (
                    <div className="flex flex-col h-full">
                        {/* Asks (Sell) */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide relative flex flex-col min-h-0">
                            {[...asks].reverse().map((ask) => {
                                const size = parseFloat(ask.sz);
                                const percentage = (size / maxSize) * 100;
                                const isWall = percentage > 75;
                                return (
                                    <div key={ask.px} className="relative flex justify-between px-3 h-[20px] shrink-0 items-center group hover:bg-white/10 cursor-crosshair overflow-hidden">
                                        <div
                                            className={`absolute inset-y-0 right-0 transition-opacity duration-300 ${isWall ? 'bg-red-500/20' : 'bg-red-500/5'}`}
                                            style={{ width: `${percentage}%` }}
                                        />
                                        <span
                                            onClick={() => onSelectPrice?.(ask.px)}
                                            className="text-[#ff4141] font-mono font-bold z-10 hover:text-white transition-colors cursor-pointer text-[12px] leading-none"
                                        >
                                            {parseFloat(ask.px).toFixed(2)}
                                        </span>
                                        <div className="flex items-center gap-2 z-10">
                                            {isWall && <span className="text-[8px] text-red-500 font-bold tracking-tighter animate-pulse">WALL</span>}
                                            <span
                                                onClick={() => onSelectSize?.(ask.sz)}
                                                className={`font-mono text-[11px] hover:text-white z-10 transition-colors cursor-pointer ${isWall ? 'text-white font-bold' : 'text-gray-300'}`}
                                            >
                                                {size.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Mid Price / Spread */}
                        <div className="py-2 bg-black border-y border-white/10 flex flex-col items-center shrink-0 shadow-2xl z-20">
                            <span className="text-2xl font-black font-mono tracking-tighter text-white">
                                {asks.length > 0 ? parseFloat(asks[0].px).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                            </span>
                            <div className="flex items-center gap-4 mt-1">
                                <div className="flex flex-col items-center">
                                    <span className="text-[7px] text-gray-500 font-black uppercase tracking-widest">Tightness</span>
                                    <div className="w-20 h-1 bg-gray-800 rounded-full mt-0.5 overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-1000"
                                            style={{
                                                width: `${Math.max(10, 100 - (asks.length > 0 && bids.length > 0 ? (parseFloat(asks[0].px) - parseFloat(bids[0].px)) / parseFloat(asks[0].px) * 100000 : 0))}%`
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="w-px h-6 bg-white/10" />
                                <div className="flex flex-col items-center">
                                    <span className="text-[7px] text-gray-500 font-black uppercase tracking-widest">Spread</span>
                                    <span className="text-[11px] text-blue-400 font-mono font-bold">
                                        {asks.length > 0 && bids.length > 0
                                            ? (parseFloat(asks[0].px) - parseFloat(bids[0].px)).toFixed(2)
                                            : '0.00'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Bids (Buy) */}
                        <div className="flex-1 overflow-y-auto scrollbar-hide relative flex flex-col min-h-0">
                            {bids.map((bid) => {
                                const size = parseFloat(bid.sz);
                                const percentage = (size / maxSize) * 100;
                                const isWall = percentage > 75;
                                return (
                                    <div key={bid.px} className="relative flex justify-between px-3 h-[20px] shrink-0 items-center group hover:bg-white/10 cursor-crosshair overflow-hidden">
                                        <div
                                            className={`absolute inset-y-0 right-0 transition-opacity duration-300 ${isWall ? 'bg-emerald-500/20' : 'bg-emerald-500/10'}`}
                                            style={{ width: `${percentage}%` }}
                                        />
                                        <span
                                            onClick={() => onSelectPrice?.(bid.px)}
                                            className="text-[#00ff9d] font-mono font-bold z-10 hover:text-white transition-colors cursor-pointer text-[12px] leading-none"
                                        >
                                            {parseFloat(bid.px).toFixed(2)}
                                        </span>
                                        <div className="flex items-center gap-2 z-10">
                                            {isWall && <span className="text-[8px] text-emerald-500 font-bold tracking-tighter animate-pulse">WALL</span>}
                                            <span
                                                onClick={() => onSelectSize?.(bid.sz)}
                                                className={`font-mono text-[11px] hover:text-white z-10 transition-colors cursor-pointer ${isWall ? 'text-white font-bold' : 'text-gray-300'}`}
                                            >
                                                {size.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col">
                        <div className="grid grid-cols-4 px-3 py-1.5 border-b border-gray-800/50 text-[8px] font-black uppercase text-gray-600 tracking-widest bg-black/40 z-20 shrink-0">
                            <span>Price</span>
                            <span className="text-right">Size</span>
                            <span className="text-right text-amber-500">CVD</span>
                            <span className="text-right">Time</span>
                        </div>
                        <div className="flex-1 overflow-y-auto scrollbar-hide">
                            {(() => {
                                let cvdAccumulator = 0;
                                // We want to show the CVD as it builds up in the list
                                // Actually, constant CVD for the window is better.
                                const totalCvd = trades.reduce((acc, t) => acc + (t.side === 'B' ? parseFloat(t.sz) : -parseFloat(t.sz)), 0);

                                return trades.map((trade, i) => {
                                    const tradeDelta = trade.side === 'B' ? parseFloat(trade.sz) : -parseFloat(trade.sz);
                                    const sizeVal = Math.abs(tradeDelta);
                                    const isWhale = sizeVal > 10; // Mock threshold for "Whale" trades

                                    return (
                                        <div key={i} className={`grid grid-cols-4 px-3 py-1 transition-colors hover:bg-white/5 items-center relative ${trade.side === 'B' ? 'text-emerald-400' : 'text-red-400'} ${isWhale ? 'bg-white/5 font-black' : ''}`}>
                                            {isWhale && <div className={`absolute inset-y-0 left-0 w-1 ${trade.side === 'B' ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'}`} />}
                                            <span className="font-mono text-[11px] font-bold">{parseFloat(trade.px).toFixed(4)}</span>
                                            <span className={`text-right font-mono text-[11px] ${isWhale ? 'text-white scale-110' : 'text-gray-300'}`}>
                                                {parseFloat(trade.sz).toFixed(2)}
                                            </span>
                                            <span className={`text-right font-mono text-[11px] font-black ${tradeDelta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {tradeDelta > 0 ? '▲' : '▼'}{isWhale ? ' WHALE' : ''}
                                            </span>
                                            <span className="text-right font-mono text-gray-500 text-[10px]">
                                                {new Date(trade.time).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                                            </span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
