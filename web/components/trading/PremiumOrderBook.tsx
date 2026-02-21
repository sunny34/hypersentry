'use client';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useMarketStore, OrderBookLevel, Trade, LiquidityWall } from '@/store/useMarketStore';
import { Activity, Zap, Shield, Target, ChevronDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { VirtualOrderBook } from './VirtualOrderBook';
import { API_URL } from '@/lib/constants';
import { formatCompact } from '@/lib/formatters';

const snapshotFetchState: Record<
    string,
    { inFlight: Promise<void> | null; lastFetchMs: number; nextAllowedMs: number; failures: number }
> = {};
const SNAPSHOT_FETCH_COOLDOWN_MS = 10_000;
const SNAPSHOT_FETCH_MAX_BACKOFF_MS = 60_000;
const ORDERBOOK_STALE_MS = 2000; // Tighter stale detection (was 4s)
const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';

/**
 * Direct Hyperliquid L2 WebSocket hook for sub-ms order book latency.
 * Bypasses the backend aggregator entirely for the active coin.
 */
function useDirectL2(coin: string, updateFromAggregator: (data: Record<string, unknown>) => void) {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!coin) return;
        const symbol = coin.toUpperCase();
        let cancelled = false;

        const connect = () => {
            if (cancelled) return;
            try {
                const ws = new WebSocket(HL_WS_URL);
                wsRef.current = ws;

                ws.onopen = () => {
                    ws.send(JSON.stringify({
                        method: 'subscribe',
                        subscription: { type: 'l2Book', coin: symbol }
                    }));
                };

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.channel === 'l2Book' && msg.data?.coin === symbol) {
                            const levels = msg.data.levels;
                            if (Array.isArray(levels) && levels.length >= 2) {
                                updateFromAggregator({
                                    [symbol]: {
                                        book: levels,
                                        book_ts: Date.now(),
                                        updated_at: Date.now(),
                                    }
                                });
                            }
                        }
                    } catch { /* best-effort parse */ }
                };

                ws.onclose = () => {
                    if (!cancelled) {
                        reconnectTimerRef.current = setTimeout(connect, 1000);
                    }
                };

                ws.onerror = () => {
                    ws.close();
                };
            } catch {
                if (!cancelled) {
                    reconnectTimerRef.current = setTimeout(connect, 2000);
                }
            }
        };

        connect();

        return () => {
            cancelled = true;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (wsRef.current) {
                try {
                    wsRef.current.send(JSON.stringify({
                        method: 'unsubscribe',
                        subscription: { type: 'l2Book', coin: symbol }
                    }));
                } catch { /* ignore */ }
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [coin, updateFromAggregator]);
}

interface PremiumOrderBookProps {
    coin: string;
    onSelectPrice?: (px: string) => void;
    onSelectSize?: (sz: string) => void;
    currentPrice?: number;
}

export default function PremiumOrderBook({
    coin,
    onSelectPrice,
    onSelectSize,
    currentPrice = 0
}: PremiumOrderBookProps) {
    // Consume high-fidelity data from Unified Market Store
    const marketData = useMarketStore((state: any) => state.marketData[coin]);
    const updateFromAggregator = useMarketStore((state: any) => state.updateFromAggregator);

    // Direct Hyperliquid L2 WS — sub-ms latency, bypasses backend relay
    useDirectL2(coin, updateFromAggregator);

    const bids = useMemo(() => marketData?.book[0] || [], [marketData?.book]);
    const asks = useMemo(() => marketData?.book[1] || [], [marketData?.book]);
    const trades = useMemo(() => marketData?.trades || [], [marketData?.trades]);
    const walls = useMemo(() => marketData?.walls || [], [marketData?.walls]);
    const cvd = marketData?.cvd || 0;
    const [clockMs, setClockMs] = useState(() => Date.now());
    const hasDepth = bids.length > 0 && asks.length > 0;
    const bookTsMs = Number((marketData as any)?.book_ts || 0);
    const bookAgeMs = bookTsMs > 0 ? Math.max(0, clockMs - bookTsMs) : Number.POSITIVE_INFINITY;
    const isBookStale = hasDepth && (bookTsMs <= 0 || bookAgeMs > ORDERBOOK_STALE_MS);
    const staleAgeSec = Number.isFinite(bookAgeMs) ? Math.floor(bookAgeMs / 1000) : null;
    const displayBids = bids;
    const displayAsks = asks;

    const [view, setView] = useState<'depth' | 'trades' | 'flow'>('depth');
    const [precision, setPrecision] = useState(4);
    const [showSettings, setShowSettings] = useState(false);
    const [cvdTimeframe, setCvdTimeframe] = useState<'1h' | '4h' | '24h' | 'session'>('session');

    useEffect(() => {
        const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    // Auto-calculate ideal precision based on price
    const hasValidPrice = currentPrice > 0;
    useEffect(() => {
        if (!hasValidPrice) return;

        let ideal = 2;
        if (currentPrice < 0.001) ideal = 8;
        else if (currentPrice < 0.01) ideal = 6;
        else if (currentPrice < 0.1) ideal = 5;
        else if (currentPrice < 1) ideal = 4;
        else if (currentPrice < 100) ideal = 3;
        else ideal = 2;

        const timer = window.setTimeout(() => setPrecision(ideal), 0);
        return () => window.clearTimeout(timer);
    }, [coin, hasValidPrice, currentPrice]);

    const asksRef = useRef<HTMLDivElement>(null);
    const [isSticky, setIsSticky] = useState(true);
    const [recentDelta, setRecentDelta] = useState(0);

    // Track delta for visual pulses
    useEffect(() => {
        if (cvd === 0) return;

        const showTimer = window.setTimeout(() => setRecentDelta(cvd), 0);
        const hideTimer = window.setTimeout(() => setRecentDelta(0), 1000);

        return () => {
            window.clearTimeout(showTimer);
            window.clearTimeout(hideTimer);
        };
    }, [cvd]);

    // Auto-scroll asks
    useEffect(() => {
        if (view === 'depth' && asksRef.current && isSticky) {
            asksRef.current.scrollTop = asksRef.current.scrollHeight;
        }
    }, [displayAsks, isSticky, view]);

    const handleAsksScroll = () => {
        if (!asksRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = asksRef.current;
        setIsSticky(scrollHeight - scrollTop - clientHeight < 20);
    };

    // Calculate metrics
    const { maxSize, totalBidSize, totalAskSize, imbalance, spread, spreadPercent } = useMemo(() => {
        const bidSizes = displayBids.map((b: OrderBookLevel) => parseFloat(b.sz));
        const askSizes = displayAsks.map((a: OrderBookLevel) => parseFloat(a.sz));
        const maxBid = Math.max(...bidSizes, 0);
        const maxAsk = Math.max(...askSizes, 0);
        const totalBid = bidSizes.reduce((a: number, b: number) => a + b, 0);
        const totalAsk = askSizes.reduce((a: number, b: number) => a + b, 0);
        const total = totalBid + totalAsk;

        const bestBid = displayBids[0] ? parseFloat(displayBids[0].px) : 0;
        const bestAsk = displayAsks[0] ? parseFloat(displayAsks[0].px) : 0;
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
    }, [displayBids, displayAsks]);

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
        return formatCompact(sz);
    };

    // Fallback hydration path: if WS depth is missing/stale, fetch a snapshot from backend.
    useEffect(() => {
        if (!coin) return;

        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const hydrateFromSnapshot = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

            const symbol = coin.toUpperCase();
            const latest = useMarketStore.getState().marketData[symbol];
            const latestBook = latest?.book;
            const hasLocalDepth = Array.isArray(latestBook)
                && latestBook.length === 2
                && Array.isArray(latestBook[0])
                && Array.isArray(latestBook[1])
                && latestBook[0].length > 0
                && latestBook[1].length > 0;
            const latestBookTsMs = Number((latest as any)?.book_ts || 0);
            const localBookAgeMs = latestBookTsMs > 0 ? (Date.now() - latestBookTsMs) : Number.POSITIVE_INFINITY;
            const needsHydration = !hasLocalDepth || localBookAgeMs > ORDERBOOK_STALE_MS;
            if (!needsHydration) {
                return;
            }

            const state = snapshotFetchState[symbol] || {
                inFlight: null,
                lastFetchMs: 0,
                nextAllowedMs: 0,
                failures: 0,
            };
            snapshotFetchState[symbol] = state;
            const nowMs = Date.now();

            if (state.inFlight) {
                return;
            }
            if (nowMs < state.nextAllowedMs) {
                return;
            }
            if ((nowMs - state.lastFetchMs) < SNAPSHOT_FETCH_COOLDOWN_MS) {
                return;
            }

            state.lastFetchMs = nowMs;
            state.inFlight = (async () => {
                try {
                    const res = await fetch(`${API_URL}/trading/orderbook?coin=${encodeURIComponent(coin)}&depth=40`);
                    if (!res.ok) return;
                    const payload = await res.json();
                    if (cancelled) return;

                    const book = payload?.book;
                    const hasBook = Array.isArray(book)
                        && book.length === 2
                        && Array.isArray(book[0])
                        && Array.isArray(book[1])
                        && (book[0].length > 0 || book[1].length > 0);

                    if (!hasBook) return;

                    const patch: Record<string, unknown> = { book };
                    if (typeof payload?.price === 'number' && payload.price > 0) {
                        patch.price = payload.price;
                    }
                    if (typeof payload?.book_ts === 'number' && payload.book_ts > 0) {
                        patch.book_ts = payload.book_ts;
                    } else {
                        patch.book_ts = Date.now();
                    }
                    patch.updated_at = Date.now();
                    updateFromAggregator({ [symbol]: patch });
                    state.failures = 0;
                    state.nextAllowedMs = Date.now() + SNAPSHOT_FETCH_COOLDOWN_MS;
                } catch {
                    // Best-effort fallback only.
                    state.failures = Math.min(state.failures + 1, 6);
                    const backoff = Math.min(
                        SNAPSHOT_FETCH_MAX_BACKOFF_MS,
                        SNAPSHOT_FETCH_COOLDOWN_MS * (2 ** state.failures),
                    );
                    state.nextAllowedMs = Date.now() + backoff;
                } finally {
                    state.inFlight = null;
                }
            })();

            try {
                await state.inFlight;
            } finally {
                state.inFlight = null;
            }
        };

        void hydrateFromSnapshot();
        timer = setInterval(() => {
            void hydrateFromSnapshot();
        }, SNAPSHOT_FETCH_COOLDOWN_MS);

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
        };
    }, [coin, updateFromAggregator]);

    return (
        <div className="flex flex-col h-full w-full bg-[var(--background)] text-[var(--foreground)] text-[10px] select-none overflow-hidden">
            {/* Header with Metrics */}
            {isBookStale && (
                <div className="absolute inset-x-0 top-0 h-1 bg-red-500/50 flex animate-pulse z-[100]">
                    <div className="w-full bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.5)_10px,rgba(0,0,0,0.5)_20px)]" />
                </div>
            )}
            <div className={`flex items-center justify-between px-3 py-2 bg-[var(--background)]/60 border-b border-[var(--glass-border)] ${isBookStale ? 'border-red-500/50 bg-red-500/5 transition-colors' : ''}`}>
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-black uppercase tracking-tight text-white leading-none">Order Book</span>
                    {isBookStale && (
                        <span className="text-[8px] font-black uppercase tracking-wider text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded animate-pulse">
                            STALE DATA {staleAgeSec !== null ? `(${staleAgeSec}s)` : ''}
                        </span>
                    )}
                    <div className="relative">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="flex items-center gap-0.5 text-gray-500 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-1.5 py-1 rounded border border-white/5 active:scale-95 transition-all h-6"
                        >
                            <span className="text-[8px] font-mono leading-none">{precision}dp</span>
                            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showSettings ? 'rotate-180' : ''}`} />
                        </button>
                        {showSettings && (
                            <div className="absolute top-full left-0 mt-1 bg-[#0f0f0f] border border-white/10 rounded-lg shadow-2xl z-[100] py-1 min-w-[80px] backdrop-blur-xl">
                                {[2, 3, 4, 5, 6, 7, 8].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => { setPrecision(p); setShowSettings(false); }}
                                        className={`block w-full text-left px-3 py-1.5 text-[9px] font-mono hover:bg-white/5 transition-colors ${precision === p ? 'text-emerald-400 bg-emerald-500/5' : 'text-gray-400'}`}
                                    >
                                        {p} Decimals
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* View Tabs */}
                <div className="flex bg-white/5 rounded-lg p-0.5">
                    {[
                        { id: 'depth', label: 'Depth', title: 'Order Book Depth' },
                        { id: 'trades', label: 'Trades', title: 'Recent Trades' },
                        { id: 'flow', label: 'Flow (Pro)', title: 'Order Flow & CVD (Pro)' }
                    ].map(v => (
                        <button
                            key={v.id}
                            onClick={() => setView(v.id as any)}
                            title={v.title}
                            className={`px-2 py-1 text-[8px] font-black uppercase rounded-md transition-all ${view === v.id
                                ? 'bg-white/10 text-white'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Imbalance & CVD Bar */}
            <div className="px-3 py-1.5 bg-black/20 border-b border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[7.5px] text-gray-500 font-bold uppercase tracking-tighter">Pressure</span>
                        <span className={`text-[9px] font-black tracking-tight ${imbalance > 55 ? 'text-emerald-400' : imbalance < 45 ? 'text-rose-400' : 'text-gray-400'}`}>
                            {imbalance > 55 ? 'BUYERS' : imbalance < 45 ? 'SELLERS' : 'BALANCED'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[7.5px] text-gray-500 font-bold uppercase tracking-tighter">CVD</span>
                        <select
                            value={cvdTimeframe}
                            onChange={(e) => setCvdTimeframe(e.target.value as any)}
                            className="text-[8px] bg-white/5 border border-white/10 rounded px-1 py-0.5 text-gray-300 cursor-pointer hover:bg-white/10 outline-none h-4"
                        >
                            <option value="session">Session</option>
                            <option value="1h">1H</option>
                            <option value="4h">4H</option>
                            <option value="24h">24H</option>
                        </select>
                        <span className={`text-[9px] font-mono font-bold ${cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCompact(cvd)}
                        </span>
                        {recentDelta !== 0 && (
                            <span className={`text-[8px] font-mono animate-pulse ${recentDelta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {recentDelta > 0 ? '▲' : '▼'}
                            </span>
                        )}
                    </div>
                </div>
                <div className="h-1.5 flex rounded-full overflow-hidden bg-white/5">
                    <div
                        className="h-full bg-gradient-to-r from-[var(--color-bullish)] to-[var(--color-bullish)]/70 transition-all duration-300"
                        style={{ width: `${imbalance}%` }}
                    />
                    <div
                        className="h-full bg-gradient-to-l from-[var(--color-bearish)] to-[var(--color-bearish)]/70 transition-all duration-300"
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
                        {walls.map((wall: LiquidityWall, i: number) => (
                            <button
                                key={i}
                                onClick={() => onSelectPrice?.(parseFloat(wall.px).toFixed(precision))}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-mono cursor-pointer transition-all hover:scale-105 flex-shrink-0 ${wall.side === 'bid'
                                    ? 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)] border border-[var(--color-bullish)]/30'
                                    : 'bg-[var(--color-bearish)]/20 text-[var(--color-bearish)] border border-[var(--color-bearish)]/30'
                                    } ${wall.strength === 'massive' ? 'animate-pulse' : ''}`}
                            >
                                <span>${parseFloat(wall.px).toLocaleString()}</span>
                                <span className="opacity-60">{formatSize(wall.sz)}</span>
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
                        <div className="flex px-3 py-1.5 border-b border-white/5 text-[8px] font-bold uppercase text-gray-500 bg-black/20 shrink-0">
                            <span className="w-[45%] text-left">Price</span>
                            <span className="w-[30%] text-right">Size</span>
                            <span className="w-[25%] text-right">Total</span>
                        </div>

                        <div className="flex-1 min-h-0 bg-[var(--background)] relative">
                            <VirtualOrderBook
                                bids={displayBids}
                                asks={displayAsks}
                                precision={precision}
                                midPrice={marketData?.price || currentPrice}
                                onSelectPrice={onSelectPrice}
                            />
                        </div>
                    </div>
                ) : view === 'trades' ? (
                    <div className="flex flex-col h-full">
                        <div className="grid grid-cols-[40%_25%_20%_15%] px-3 py-1.5 border-b border-[var(--glass-border)] text-[7px] font-black uppercase text-gray-600 tracking-widest bg-[var(--background)]/40 shrink-0">
                            <span>Price</span>
                            <span className="text-right">Size</span>
                            <span className="text-right">Delta</span>
                            <span className="text-right">Time</span>
                        </div>
                        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                            {trades.slice(0, 50).map((trade: Trade, i: number) => {
                                const size = parseFloat(trade.sz);
                                const price = parseFloat(trade.px);
                                const isBuy = trade.side === 'B';
                                const whaleType = isWhale(size, price);

                                return (
                                    <div
                                        key={`${trade.time}-${i}`}
                                        className={`grid grid-cols-[40%_25%_20%_15%] px-3 py-1 items-center hover:bg-white/5 transition-colors ${whaleType ? (isBuy ? 'bg-[var(--color-bullish)]/10' : 'bg-[var(--color-bearish)]/10') : ''
                                            }`}
                                    >
                                        <span className={`font-mono text-[10px] font-bold ${isBuy ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
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
                                        <span className={`font-mono text-[9px] text-right ${isBuy ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
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
                        <div className="bg-white/5 rounded-xl p-3 border border-[var(--glass-border)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-black uppercase text-gray-500">Cumulative Volume Delta</span>
                                <span className={`text-sm font-mono font-bold ${cvd >= 0 ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
                                    {formatCompact(cvd)}
                                </span>
                            </div>
                            <div className="h-16 rounded-lg bg-[var(--background)]/30 relative overflow-hidden">
                                <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
                                <div
                                    className={`absolute inset-y-0 left-0 transition-all duration-500 ${cvd >= 0 ? 'bg-[var(--color-bullish)]/30' : 'bg-[var(--color-bearish)]/30'}`}
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
                            <div className="bg-[var(--color-bullish)]/10 border border-[var(--color-bullish)]/20 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <ArrowUpRight className="w-3.5 h-3.5 text-[var(--color-bullish)]" />
                                    <span className="text-[9px] font-black uppercase text-[var(--color-bullish)]">Buy Pressure</span>
                                </div>
                                <div className="text-lg font-black text-[var(--color-bullish)]/80 font-mono">
                                    {formatSize(totalBidSize.toString())}
                                </div>
                                <div className="text-[9px] text-[var(--color-bullish)]/60 font-mono">
                                    {imbalance.toFixed(1)}% of book
                                </div>
                            </div>
                            <div className="bg-[var(--color-bearish)]/10 border border-[var(--color-bearish)]/20 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <ArrowDownRight className="w-3.5 h-3.5 text-[var(--color-bearish)]" />
                                    <span className="text-[9px] font-black uppercase text-[var(--color-bearish)]">Sell Pressure</span>
                                </div>
                                <div className="text-lg font-black text-[var(--color-bearish)]/80 font-mono">
                                    {formatSize(totalAskSize.toString())}
                                </div>
                                <div className="text-[9px] text-[var(--color-bearish)]/60 font-mono">
                                    {(100 - imbalance).toFixed(1)}% of book
                                </div>
                            </div>
                        </div>

                        {/* Whale Activity */}
                        <div className="bg-white/5 rounded-xl p-3 border border-[var(--glass-border)]">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-[9px] font-black uppercase text-gray-500">Whale Activity</span>
                            </div>
                            <div className="space-y-1.5">
                                {trades.filter((t: Trade) => isWhale(parseFloat(t.sz), parseFloat(t.px))).slice(0, 5).map((trade: Trade, i: number) => (
                                    <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded-lg ${trade.side === 'B' ? 'bg-[var(--color-bullish)]/10' : 'bg-[var(--color-bearish)]/10'
                                        }`}>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px]">{isWhale(parseFloat(trade.sz), parseFloat(trade.px)) === 'mega' ? '🐋' : '🦈'}</span>
                                            <span className={`font-mono text-[10px] font-bold ${trade.side === 'B' ? 'text-[var(--color-bullish)]' : 'text-[var(--color-bearish)]'}`}>
                                                {trade.side === 'B' ? 'BUY' : 'SELL'}
                                            </span>
                                        </div>
                                        <span className="font-mono text-[10px] text-white font-bold">
                                            {formatSize(trade.sz)} @ {parseFloat(trade.px).toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                                {trades.filter((t: Trade) => isWhale(parseFloat(t.sz), parseFloat(t.px))).length === 0 && (
                                    <div className="text-center py-4 text-gray-600 text-[9px]">
                                        No whale trades detected
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Fee Disclosure Footer */}
            <div className="px-4 py-2 border-t border-white/5 bg-black/40 flex items-center justify-between text-[8px] font-bold uppercase tracking-widest text-gray-600">
                <div className="flex items-center gap-2">
                    <span className="text-gray-700">Taker: <span className="text-gray-400">0.035%</span></span>
                    <div className="w-1 h-1 rounded-full bg-gray-800" />
                    <span className="text-gray-700">Maker: <span className="text-gray-400">0.010%</span></span>
                </div>
                <div className="flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5 text-purple-500/50" />
                    <span>Sentry Insured Hub</span>
                </div>
            </div>
        </div>
    );
}
