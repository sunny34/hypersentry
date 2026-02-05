'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
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
    const [precision, setPrecision] = useState(2);
    const [showPrecision, setShowPrecision] = useState(false);

    const precisionOptions = [
        { label: '0.01', value: 2 },
        { label: '0.001', value: 3 },
        { label: '0.0001', value: 4 },
        { label: '0.00001', value: 5 },
        { label: '0.000001', value: 6 }
    ];

    // Scroll Management (Asks - Sell Side)
    const asksRef = useRef<HTMLDivElement>(null);
    const [isSticky, setIsSticky] = useState(true);

    const handleAsksScroll = () => {
        if (!asksRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = asksRef.current;
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        if (distanceToBottom > 20) {
            setIsSticky(false);
        } else {
            setIsSticky(true);
        }
    };

    useEffect(() => {
        if (asksRef.current && isSticky) {
            asksRef.current.scrollTop = asksRef.current.scrollHeight;
        }
    }, [asks, isSticky]);

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

    const maxTradeSize = useMemo(() => {
        if (trades.length === 0) return 0;
        return Math.max(...trades.map(t => parseFloat(t.sz)), 0);
    }, [trades]);

    return (
        <div className="flex flex-col h-full w-full bg-black/20 text-[10px] select-none">
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
            <div className="flex bg-gray-950/80 border-b border-gray-800/50 shrink-0 relative items-center">
                <button
                    onClick={() => setView('book')}
                    className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${view === 'book' ? 'text-white border-b border-blue-500 bg-blue-500/5' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    Order Book
                </button>
                <div className="relative">
                    <button
                        onClick={() => setShowPrecision(!showPrecision)}
                        className="px-2 py-1 text-[9px] font-mono text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                    >
                        {precisionOptions.find(o => o.value === precision)?.label}
                        <svg className={`w-2 h-2 transition-transform ${showPrecision ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {showPrecision && (
                        <div className="absolute top-full right-0 mt-1 bg-gray-900 border border-gray-800 rounded shadow-2xl z-50 py-1 min-w-[80px]">
                            {precisionOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => {
                                        setPrecision(opt.value);
                                        setShowPrecision(false);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-[9px] font-mono hover:bg-white/10 transition-colors ${precision === opt.value ? 'text-blue-400 font-bold' : 'text-gray-400'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <button
                    onClick={() => setView('trades')}
                    className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${view === 'trades' ? 'text-white border-b border-purple-500 bg-purple-500/5' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    Recent Trades
                </button>
            </div>

            <div className="flex-1 min-h-0 relative">
                {view === 'book' ? (
                    <div className="flex flex-col h-full">
                        <div className="flex px-3 py-1 border-b border-white/5 text-[7px] font-black uppercase text-gray-600 tracking-widest bg-black/40 z-20 shrink-0">
                            <span className="w-[55%]">Price</span>
                            <span className="w-[45%] text-right pr-1">Size</span>
                        </div>
                        {/* Asks (Sell) */}
                        <div
                            ref={asksRef}
                            onScroll={handleAsksScroll}
                            className="flex-1 overflow-y-auto scrollbar-hide relative flex flex-col min-h-0"
                        >
                            <div className="flex-1" />
                            {[...asks].reverse().map((ask) => {
                                const size = parseFloat(ask.sz);
                                const percentage = (size / maxSize) * 100;
                                const isWall = percentage > 75;
                                return (
                                    <div key={ask.px} className="relative flex px-3 h-[18px] shrink-0 items-center group hover:bg-white/10 cursor-crosshair overflow-hidden">
                                        <div
                                            className={`absolute inset-y-0 right-0 transition-opacity duration-300 ${isWall ? 'opacity-50' : 'opacity-25'} bg-gradient-to-l from-red-500/50 to-transparent`}
                                            style={{ width: `${Math.max(percentage, size > 1 ? 5 : 0)}%` }} // Ensure min visibility for non-zero sizes
                                        />
                                        <span
                                            onClick={() => onSelectPrice?.(ask.px)}
                                            className="w-[55%] text-[#ff4141] font-mono font-bold z-10 hover:text-white transition-colors cursor-pointer text-[10px] leading-none"
                                        >
                                            {parseFloat(ask.px).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                        </span>
                                        <div className="w-[45%] flex items-center justify-end gap-2 z-10 overflow-hidden pr-1">
                                            {isWhale(size, parseFloat(ask.px)) && <span className="text-[7px] text-red-500 font-black animate-pulse bg-red-500/20 px-1 rounded shrink-0">WHALE</span>}
                                            <span
                                                onClick={() => onSelectSize?.(ask.sz)}
                                                className={`font-mono text-[10px] hover:text-white z-10 transition-colors cursor-pointer shrink-0 ${isWall ? 'text-white font-bold' : 'text-gray-400'}`}
                                            >
                                                {size.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Mid Price / Spread */}
                        <div className="py-2 bg-black/80 backdrop-blur-md border-y border-white/10 flex flex-col items-center shrink-0 shadow-2xl z-20">
                            <span className="text-xl font-black font-mono tracking-tighter text-white leading-none">
                                {asks.length > 0 ? parseFloat(asks[0].px).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision }) : '-'}
                            </span>
                            <div className="flex items-center gap-3 mt-1.5">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[7px] text-gray-500 font-bold uppercase tracking-widest">Spread</span>
                                    <span className="text-[10px] text-blue-400 font-mono font-bold">
                                        {asks.length > 0 && bids.length > 0
                                            ? (parseFloat(asks[0].px) - parseFloat(bids[0].px)).toFixed(precision)
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
                                    <div key={bid.px} className="relative flex px-3 h-[18px] shrink-0 items-center group hover:bg-white/10 cursor-crosshair overflow-hidden">
                                        <div
                                            className={`absolute inset-y-0 right-0 transition-opacity duration-300 ${isWall ? 'opacity-50' : 'opacity-25'} bg-gradient-to-l from-emerald-500/50 to-transparent`}
                                            style={{ width: `${Math.max(percentage, size > 1 ? 5 : 0)}%` }} // Ensure min visibility for non-zero sizes
                                        />
                                        <span
                                            onClick={() => onSelectPrice?.(bid.px)}
                                            className="w-[55%] text-[#00ff9d] font-mono font-bold z-10 hover:text-white transition-colors cursor-pointer text-[10px] leading-none"
                                        >
                                            {parseFloat(bid.px).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                        </span>
                                        <div className="w-[45%] flex items-center justify-end gap-2 z-10 overflow-hidden pr-1">
                                            {isWhale(size, parseFloat(bid.px)) && <span className="text-[7px] text-emerald-500 font-black animate-pulse bg-emerald-500/20 px-1 rounded shrink-0">WHALE</span>}
                                            <span
                                                onClick={() => onSelectSize?.(bid.sz)}
                                                className={`font-mono text-[10px] hover:text-white z-10 transition-colors cursor-pointer shrink-0 ${isWall ? 'text-white font-bold' : 'text-gray-400'}`}
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
                        <div className="grid grid-cols-[38%_25%_22%_15%] px-3 py-1.5 border-b border-gray-800/50 text-[7px] font-black uppercase text-gray-500 tracking-widest bg-black/40 z-20 shrink-0">
                            <span>Price</span>
                            <span className="text-right pr-2">Size</span>
                            <span className="text-right pr-2 text-amber-500">CVD (Acc)</span>
                            <span className="text-right">Time</span>
                        </div>
                        <div className="flex-1 overflow-y-auto scrollbar-hide">
                            {(() => {
                                let runningCvd = 0;
                                const sortedTrades = [...trades].reverse();
                                const tradesWithCvd = sortedTrades.map(t => {
                                    const delta = t.side === 'B' ? parseFloat(t.sz) : -parseFloat(t.sz);
                                    runningCvd += delta;
                                    return { ...t, cvd: runningCvd, delta };
                                }).reverse();

                                return tradesWithCvd.map((trade, i) => {
                                    const sizeVal = parseFloat(trade.sz);
                                    const sizePercentage = (sizeVal / maxTradeSize) * 100;
                                    const whale = isWhale(sizeVal, parseFloat(trade.px));

                                    let formattedSize = sizeVal.toFixed(2);
                                    if (sizeVal > 0 && parseFloat(formattedSize) === 0) {
                                        formattedSize = sizeVal.toFixed(6).replace(/\.?0+$/, "");
                                    }

                                    return (
                                        <div key={i} className={`grid grid-cols-[38%_25%_22%_15%] px-3 py-0.5 transition-colors hover:bg-white/5 items-center relative min-h-[22px] ${trade.side === 'B' ? 'text-emerald-400' : 'text-red-400'}`}>
                                            <div
                                                className={`absolute inset-y-0 right-0 opacity-10 ${trade.side === 'B' ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                style={{ width: `${sizePercentage}%` }}
                                            />
                                            <span className={`font-mono text-[10px] font-bold z-10 ${whale ? 'text-white' : ''}`}>
                                                {parseFloat(trade.px).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                            </span>
                                            <span className={`text-right pr-2 font-mono text-[10px] z-10 ${whale ? 'font-black scale-110' : 'text-gray-300'}`}>
                                                {formattedSize}
                                            </span>
                                            <span className={`text-right pr-2 font-mono text-[10px] font-bold z-10 ${trade.side === 'B' ? 'text-emerald-500' : 'text-red-500'} ${Math.abs(trade.cvd) > 10 ? 'underline decoration-1' : ''}`}>
                                                {trade.cvd.toFixed(2)}
                                            </span>
                                            <span className="text-right font-mono text-gray-500 text-[9px] z-10">
                                                {new Date(trade.time).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                                            </span>
                                            {whale && (
                                                <div className={`absolute inset-y-0 left-0 w-[2px] ${trade.side === 'B' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`} />
                                            )}
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

const isWhale = (size: number, price: number) => (size * price) > 10000;
