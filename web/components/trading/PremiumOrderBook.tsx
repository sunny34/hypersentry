'use client';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useHyperliquidWS } from '../../hooks/useHyperliquidWS';
import { Activity, Zap, Shield, Target, ChevronDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface OrderBookLevel {
    px: string;
    sz: string;
    n: number;
}

interface Trade {
    px: string;
    sz: string;
    side: 'B' | 'A';
    time: number;
    coin: string;
}

interface PremiumOrderBookProps {
    coin: string;
    onSelectPrice?: (px: string) => void;
    onSelectSize?: (sz: string) => void;
    currentPrice?: number;
}

interface LiquidityWall {
    price: number;
    size: number;
    side: 'bid' | 'ask';
    strength: 'massive' | 'major' | 'significant';
}

export default function PremiumOrderBook({
    coin,
    onSelectPrice,
    onSelectSize,
    currentPrice = 0
}: PremiumOrderBookProps) {
    const { status, subscribe, addListener } = useHyperliquidWS();
    const [bids, setBids] = useState<OrderBookLevel[]>([]);
    const [asks, setAsks] = useState<OrderBookLevel[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [view, setView] = useState<'depth' | 'trades' | 'flow'>('depth');
    const [precision, setPrecision] = useState(2);
    const [showSettings, setShowSettings] = useState(false);
    const [cvd, setCvd] = useState(0); // Cumulative Volume Delta
    const [recentDelta, setRecentDelta] = useState(0);
    const [walls, setWalls] = useState<LiquidityWall[]>([]);
    const [cvdTimeframe, setCvdTimeframe] = useState<'1h' | '4h' | '24h' | 'session'>('session');
    const cvdStartTime = useRef(Date.now());

    const asksRef = useRef<HTMLDivElement>(null);
    const [isSticky, setIsSticky] = useState(true);
    const lastCvdUpdate = useRef(Date.now());

    // Subscribe to WebSocket channels
    useEffect(() => {
        if (status === 'connected') {
            subscribe({ type: 'l2Book', coin });
            subscribe({ type: 'trades', coin });
        }
    }, [status, coin, subscribe]);

    // Handle L2 book updates
    useEffect(() => {
        const removeL2 = addListener('l2Book', (data: any) => {
            if (data.coin === coin && data.levels?.length === 2) {
                const newBids = data.levels[0].slice(0, 25);
                const newAsks = data.levels[1].slice(0, 25);
                setBids(newBids);
                setAsks(newAsks);

                // Detect liquidity walls
                detectWalls(newBids, newAsks);
            }
        });

        const removeTrades = addListener('trades', (data: any) => {
            if (!Array.isArray(data)) return;
            const coinTrades = data.filter((t: any) => t.coin === coin);
            if (coinTrades.length > 0) {
                setTrades(prev => [...coinTrades, ...prev].slice(0, 100));

                // Update CVD
                const delta = coinTrades.reduce((acc: number, t: Trade) => {
                    const size = parseFloat(t.sz);
                    return acc + (t.side === 'B' ? size : -size);
                }, 0);

                setCvd(prev => prev + delta);
                setRecentDelta(delta);
                lastCvdUpdate.current = Date.now();
            }
        });

        return () => {
            removeL2?.();
            removeTrades?.();
        };
    }, [addListener, coin]);

    // Detect liquidity walls
    const detectWalls = useCallback((bids: OrderBookLevel[], asks: OrderBookLevel[]) => {
        const allLevels = [
            ...bids.map(b => ({ ...b, side: 'bid' as const })),
            ...asks.map(a => ({ ...a, side: 'ask' as const }))
        ];

        const avgSize = allLevels.reduce((sum, l) => sum + parseFloat(l.sz), 0) / allLevels.length;

        const detectedWalls: LiquidityWall[] = [];

        allLevels.forEach(level => {
            const size = parseFloat(level.sz);
            const price = parseFloat(level.px);

            if (size > avgSize * 10) {
                detectedWalls.push({
                    price,
                    size,
                    side: level.side,
                    strength: size > avgSize * 20 ? 'massive' : size > avgSize * 15 ? 'major' : 'significant'
                });
            }
        });

        setWalls(detectedWalls.slice(0, 3));
    }, []);

    // Auto-scroll asks to bottom
    useEffect(() => {
        if (asksRef.current && isSticky) {
            asksRef.current.scrollTop = asksRef.current.scrollHeight;
        }
    }, [asks, isSticky]);

    const handleAsksScroll = () => {
        if (!asksRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = asksRef.current;
        setIsSticky(scrollHeight - scrollTop - clientHeight < 20);
    };

    // Calculate metrics
    const { maxSize, totalBidSize, totalAskSize, imbalance, spread, spreadPercent } = useMemo(() => {
        const bidSizes = bids.map(b => parseFloat(b.sz));
        const askSizes = asks.map(a => parseFloat(a.sz));
        const maxBid = Math.max(...bidSizes, 0);
        const maxAsk = Math.max(...askSizes, 0);
        const totalBid = bidSizes.reduce((a, b) => a + b, 0);
        const totalAsk = askSizes.reduce((a, b) => a + b, 0);
        const total = totalBid + totalAsk;

        const bestBid = bids[0] ? parseFloat(bids[0].px) : 0;
        const bestAsk = asks[0] ? parseFloat(asks[0].px) : 0;
        const spreadVal = bestAsk - bestBid;
        const spreadPct = bestBid > 0 ? (spreadVal / bestBid) * 100 : 0;

        return {
            maxSize: Math.max(maxBid, maxAsk),
            totalBidSize: totalBid,
            totalAskSize: totalAsk,
            imbalance: total > 0 ? (totalBid / total) * 100 : 50,
            spread: spreadVal,
            spreadPercent: spreadPct
        };
    }, [bids, asks]);

    // Whale detection - $1M+ only
    const isWhale = (size: number, price: number) => {
        const usdValue = size * price;
        if (usdValue > 5_000_000) return 'mega';    // $5M+
        if (usdValue > 1_000_000) return 'whale';   // $1M+
        return null; // Ignore smaller trades
    };

    // Get size intensity for heat visualization
    const getSizeIntensity = (size: number) => {
        const ratio = size / maxSize;
        if (ratio > 0.8) return 'ultra';
        if (ratio > 0.5) return 'high';
        if (ratio > 0.25) return 'medium';
        return 'low';
    };

    const formatSize = (sz: string) => {
        const size = parseFloat(sz);
        if (size >= 1000) return `${(size / 1000).toFixed(1)}K`;
        if (size >= 1) return size.toFixed(2);
        return size.toFixed(4);
    };

    const midPrice = asks[0] ? parseFloat(asks[0].px) : currentPrice;

    return (
        <div className="flex flex-col h-full w-full bg-[#050505] text-[10px] select-none overflow-hidden">
            {/* Header with Metrics */}
            <div className="flex items-center justify-between px-3 py-2 bg-black/60 border-b border-white/5">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Order Book</span>
                    <div className="relative">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="text-gray-500 hover:text-white transition-colors"
                        >
                            <span className="text-[8px] font-mono bg-white/5 px-1.5 py-0.5 rounded">{precision}dp</span>
                        </button>
                        {showSettings && (
                            <div className="absolute top-full left-0 mt-1 bg-[#0a0a0a] border border-white/10 rounded-lg shadow-2xl z-50 py-1 min-w-[60px]">
                                {[2, 3, 4, 5].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => { setPrecision(p); setShowSettings(false); }}
                                        className={`block w-full text-left px-3 py-1.5 text-[9px] hover:bg-white/10 ${precision === p ? 'text-blue-400' : 'text-gray-400'}`}
                                    >
                                        {p} decimals
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* View Tabs */}
                <div className="flex bg-white/5 rounded-lg p-0.5">
                    {['depth', 'trades', 'flow'].map(v => (
                        <button
                            key={v}
                            onClick={() => setView(v as any)}
                            className={`px-2 py-1 text-[8px] font-black uppercase rounded-md transition-all ${view === v
                                ? 'bg-white/10 text-white'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {/* Imbalance & CVD Bar */}
            <div className="px-3 py-1.5 bg-black/40 border-b border-white/5">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[8px] text-gray-600 font-bold">PRESSURE</span>
                        <span className={`text-[9px] font-black ${imbalance > 55 ? 'text-emerald-400' : imbalance < 45 ? 'text-red-400' : 'text-gray-400'}`}>
                            {imbalance > 55 ? 'BUYERS' : imbalance < 45 ? 'SELLERS' : 'BALANCED'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[8px] text-gray-600 font-bold">CVD</span>
                        <select
                            value={cvdTimeframe}
                            onChange={(e) => {
                                setCvdTimeframe(e.target.value as any);
                                setCvd(0); // Reset CVD on timeframe change
                                cvdStartTime.current = Date.now();
                            }}
                            className="text-[8px] bg-white/5 border border-white/10 rounded px-1 py-0.5 text-gray-400 cursor-pointer hover:bg-white/10"
                        >
                            <option value="session">Session</option>
                            <option value="1h">1H</option>
                            <option value="4h">4H</option>
                            <option value="24h">24H</option>
                        </select>
                        <span className={`text-[9px] font-mono font-bold ${cvd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {cvd >= 0 ? '+' : ''}{cvd.toFixed(2)}
                        </span>
                        {recentDelta !== 0 && (
                            <span className={`text-[8px] font-mono animate-pulse ${recentDelta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {recentDelta > 0 ? '↑' : '↓'}
                            </span>
                        )}
                    </div>
                </div>
                <div className="h-1.5 flex rounded-full overflow-hidden bg-white/5">
                    <div
                        className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300"
                        style={{ width: `${imbalance}%` }}
                    />
                    <div
                        className="h-full bg-gradient-to-l from-red-600 to-red-400 transition-all duration-300"
                        style={{ width: `${100 - imbalance}%` }}
                    />
                </div>
            </div>

            {/* Liquidity Walls Alert */}
            {walls.length > 0 && (
                <div className="px-3 py-1.5 bg-gradient-to-r from-amber-500/10 to-transparent border-b border-amber-500/20">
                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                        <Shield className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        <span className="text-[8px] text-amber-400 font-black uppercase tracking-wider flex-shrink-0">WALLS</span>
                        {walls.map((wall, i) => (
                            <button
                                key={i}
                                onClick={() => onSelectPrice?.(wall.price.toFixed(precision))}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-mono cursor-pointer transition-all hover:scale-105 flex-shrink-0 ${wall.side === 'bid'
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    } ${wall.strength === 'massive' ? 'animate-pulse' : ''}`}
                            >
                                <span>${wall.price.toLocaleString()}</span>
                                <span className="opacity-60">{formatSize(wall.size.toString())}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {view === 'depth' ? (
                    <div className="flex flex-col h-full">
                        {/* Column Headers */}
                        <div className="flex px-3 py-1.5 border-b border-white/5 text-[7px] font-black uppercase text-gray-600 tracking-widest bg-black/40 shrink-0">
                            <span className="w-[45%]">Price</span>
                            <span className="w-[30%] text-right">Size</span>
                            <span className="w-[25%] text-right">Total</span>
                        </div>

                        {/* Asks (Sells) */}
                        <div
                            ref={asksRef}
                            onScroll={handleAsksScroll}
                            className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 flex flex-col min-h-0"
                        >
                            <div className="flex-1" />
                            {[...asks].reverse().map((ask, idx) => {
                                const size = parseFloat(ask.sz);
                                const price = parseFloat(ask.px);
                                const pct = (size / maxSize) * 100;
                                const intensity = getSizeIntensity(size);
                                const whaleType = isWhale(size, price);
                                const cumulative = asks.slice(0, asks.length - idx).reduce((s, a) => s + parseFloat(a.sz), 0);

                                return (
                                    <div
                                        key={ask.px}
                                        className={`relative flex px-3 h-[22px] shrink-0 items-center group cursor-pointer transition-all hover:bg-white/10 ${whaleType ? 'bg-red-500/5' : ''
                                            }`}
                                        onClick={() => onSelectPrice?.(ask.px)}
                                    >
                                        {/* Depth bar */}
                                        <div
                                            className={`absolute inset-y-0 right-0 transition-all duration-200 ${intensity === 'ultra' ? 'bg-red-500/40' :
                                                intensity === 'high' ? 'bg-red-500/30' :
                                                    intensity === 'medium' ? 'bg-red-500/20' : 'bg-red-500/10'
                                                }`}
                                            style={{ width: `${Math.max(pct, 2)}%` }}
                                        />

                                        {/* Price */}
                                        <span className="w-[45%] text-red-400 font-mono font-bold z-10 text-[10px] group-hover:text-white transition-colors">
                                            {price.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                        </span>

                                        {/* Size */}
                                        <div className="w-[30%] flex items-center justify-end gap-1 z-10">
                                            {whaleType && (
                                                <span className={`text-[7px] font-black px-1 rounded ${whaleType === 'mega' ? 'bg-red-500 text-white animate-pulse' :
                                                    whaleType === 'whale' ? 'bg-red-500/40 text-red-300' :
                                                        'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {whaleType === 'mega' ? '🐋' : whaleType === 'whale' ? 'WHALE' : 'SHARK'}
                                                </span>
                                            )}
                                            <span
                                                onClick={(e) => { e.stopPropagation(); onSelectSize?.(ask.sz); }}
                                                className={`font-mono text-[10px] cursor-pointer hover:text-white ${intensity === 'ultra' || intensity === 'high' ? 'text-white font-bold' : 'text-gray-400'
                                                    }`}
                                            >
                                                {formatSize(ask.sz)}
                                            </span>
                                        </div>

                                        {/* Cumulative */}
                                        <span className="w-[25%] text-right text-gray-600 font-mono text-[9px] z-10">
                                            {formatSize(cumulative.toString())}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Spread / Mid Price */}
                        <div className="py-2.5 px-3 bg-gradient-to-r from-black via-[#0a0a0a] to-black border-y border-white/10 shrink-0 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl font-black font-mono text-white tracking-tight">
                                        {midPrice.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                    </span>
                                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${cvd >= 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
                                        }`}>
                                        {cvd >= 0 ? (
                                            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                                        ) : (
                                            <ArrowDownRight className="w-3 h-3 text-red-400" />
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-[9px]">
                                    <div className="flex flex-col items-end">
                                        <span className="text-gray-600 text-[7px] font-bold uppercase">Spread</span>
                                        <span className="text-blue-400 font-mono font-bold">
                                            {spread.toFixed(precision)} ({spreadPercent.toFixed(3)}%)
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Bids (Buys) */}
                        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 flex flex-col min-h-0">
                            {bids.map((bid, idx) => {
                                const size = parseFloat(bid.sz);
                                const price = parseFloat(bid.px);
                                const pct = (size / maxSize) * 100;
                                const intensity = getSizeIntensity(size);
                                const whaleType = isWhale(size, price);
                                const cumulative = bids.slice(0, idx + 1).reduce((s, b) => s + parseFloat(b.sz), 0);

                                return (
                                    <div
                                        key={bid.px}
                                        className={`relative flex px-3 h-[22px] shrink-0 items-center group cursor-pointer transition-all hover:bg-white/10 ${whaleType ? 'bg-emerald-500/5' : ''
                                            }`}
                                        onClick={() => onSelectPrice?.(bid.px)}
                                    >
                                        <div
                                            className={`absolute inset-y-0 right-0 transition-all duration-200 ${intensity === 'ultra' ? 'bg-emerald-500/40' :
                                                intensity === 'high' ? 'bg-emerald-500/30' :
                                                    intensity === 'medium' ? 'bg-emerald-500/20' : 'bg-emerald-500/10'
                                                }`}
                                            style={{ width: `${Math.max(pct, 2)}%` }}
                                        />

                                        <span className="w-[45%] text-emerald-400 font-mono font-bold z-10 text-[10px] group-hover:text-white transition-colors">
                                            {price.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                        </span>

                                        <div className="w-[30%] flex items-center justify-end gap-1 z-10">
                                            {whaleType && (
                                                <span className={`text-[7px] font-black px-1 rounded ${whaleType === 'mega' ? 'bg-emerald-500 text-black animate-pulse' :
                                                    whaleType === 'whale' ? 'bg-emerald-500/40 text-emerald-300' :
                                                        'bg-emerald-500/20 text-emerald-400'
                                                    }`}>
                                                    {whaleType === 'mega' ? '🐋' : whaleType === 'whale' ? 'WHALE' : 'SHARK'}
                                                </span>
                                            )}
                                            <span
                                                onClick={(e) => { e.stopPropagation(); onSelectSize?.(bid.sz); }}
                                                className={`font-mono text-[10px] cursor-pointer hover:text-white ${intensity === 'ultra' || intensity === 'high' ? 'text-white font-bold' : 'text-gray-400'
                                                    }`}
                                            >
                                                {formatSize(bid.sz)}
                                            </span>
                                        </div>

                                        <span className="w-[25%] text-right text-gray-600 font-mono text-[9px] z-10">
                                            {formatSize(cumulative.toString())}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : view === 'trades' ? (
                    <div className="flex flex-col h-full">
                        <div className="grid grid-cols-[40%_25%_20%_15%] px-3 py-1.5 border-b border-white/5 text-[7px] font-black uppercase text-gray-600 tracking-widest bg-black/40 shrink-0">
                            <span>Price</span>
                            <span className="text-right">Size</span>
                            <span className="text-right">Delta</span>
                            <span className="text-right">Time</span>
                        </div>
                        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                            {trades.slice(0, 50).map((trade, i) => {
                                const size = parseFloat(trade.sz);
                                const price = parseFloat(trade.px);
                                const isBuy = trade.side === 'B';
                                const whaleType = isWhale(size, price);

                                return (
                                    <div
                                        key={`${trade.time}-${i}`}
                                        className={`grid grid-cols-[40%_25%_20%_15%] px-3 py-1 items-center hover:bg-white/5 transition-colors ${whaleType ? (isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10') : ''
                                            }`}
                                    >
                                        <span className={`font-mono text-[10px] font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {price.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}
                                        </span>
                                        <div className="flex items-center justify-end gap-1">
                                            {whaleType && (
                                                <span className="text-[7px]">
                                                    {whaleType === 'mega' ? '🐋' : whaleType === 'whale' ? '🦈' : '🦭'}
                                                </span>
                                            )}
                                            <span className={`font-mono text-[10px] text-right ${whaleType ? 'font-bold text-white' : 'text-gray-300'}`}>
                                                {formatSize(trade.sz)}
                                            </span>
                                        </div>
                                        <span className={`font-mono text-[9px] text-right ${isBuy ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {isBuy ? '+' : '-'}{formatSize(trade.sz)}
                                        </span>
                                        <span className="font-mono text-[8px] text-gray-600 text-right">
                                            {new Date(trade.time).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    /* Flow Analysis View */
                    <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                        {/* CVD Chart */}
                        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-black uppercase text-gray-500">Cumulative Volume Delta</span>
                                <span className={`text-sm font-mono font-bold ${cvd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {cvd >= 0 ? '+' : ''}{cvd.toFixed(2)}
                                </span>
                            </div>
                            <div className="h-16 rounded-lg bg-black/30 relative overflow-hidden">
                                <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                                <div
                                    className={`absolute inset-y-0 left-0 transition-all duration-500 ${cvd >= 0 ? 'bg-emerald-500/30' : 'bg-red-500/30'}`}
                                    style={{
                                        width: `${Math.min(Math.abs(cvd) * 2, 100)}%`,
                                        [cvd >= 0 ? 'bottom' : 'top']: '50%',
                                        height: '50%'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Order Flow Summary */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                                    <span className="text-[9px] font-black uppercase text-emerald-400">Buy Pressure</span>
                                </div>
                                <div className="text-lg font-black text-emerald-300 font-mono">
                                    {formatSize(totalBidSize.toString())}
                                </div>
                                <div className="text-[9px] text-emerald-500/60 font-mono">
                                    {imbalance.toFixed(1)}% of book
                                </div>
                            </div>
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                                    <span className="text-[9px] font-black uppercase text-red-400">Sell Pressure</span>
                                </div>
                                <div className="text-lg font-black text-red-300 font-mono">
                                    {formatSize(totalAskSize.toString())}
                                </div>
                                <div className="text-[9px] text-red-500/60 font-mono">
                                    {(100 - imbalance).toFixed(1)}% of book
                                </div>
                            </div>
                        </div>

                        {/* Whale Activity */}
                        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-[9px] font-black uppercase text-gray-500">Whale Activity</span>
                            </div>
                            <div className="space-y-1.5">
                                {trades.filter(t => isWhale(parseFloat(t.sz), parseFloat(t.px))).slice(0, 5).map((trade, i) => (
                                    <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded-lg ${trade.side === 'B' ? 'bg-emerald-500/10' : 'bg-red-500/10'
                                        }`}>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px]">{isWhale(parseFloat(trade.sz), parseFloat(trade.px)) === 'mega' ? '🐋' : '🦈'}</span>
                                            <span className={`font-mono text-[10px] font-bold ${trade.side === 'B' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {trade.side === 'B' ? 'BUY' : 'SELL'}
                                            </span>
                                        </div>
                                        <span className="font-mono text-[10px] text-white font-bold">
                                            {formatSize(trade.sz)} @ {parseFloat(trade.px).toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                                {trades.filter(t => isWhale(parseFloat(t.sz), parseFloat(t.px))).length === 0 && (
                                    <div className="text-center py-4 text-gray-600 text-[9px]">
                                        No whale trades detected
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
