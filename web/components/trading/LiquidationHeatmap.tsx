'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Target, AlertTriangle, ZoomIn, ZoomOut, Move, BarChart3, Flame } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface LiquidationHeatmapProps {
    currentPrice: number;
    symbol: string;
    openInterest: number;
    fundingRate: number;
    onPriceSelect?: (price: string) => void;
}

interface LiqLevel {
    price: number;
    volume: number;
    leverage: string;
    side: 'long' | 'short';
    intensity: number;
    description: string;
    riskLevel: 'low' | 'medium' | 'high' | 'extreme';
}

interface RecentLiquidation {
    coin: string;
    px: string;
    sz: string;
    side: 'long' | 'short';
    time: number;
    usdValue: number;
}

export default function LiquidationHeatmap({
    currentPrice,
    symbol,
    openInterest,
    fundingRate,
    onPriceSelect
}: LiquidationHeatmapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoveredLevel, setHoveredLevel] = useState<LiqLevel | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [zoomLevel, setZoomLevel] = useState(1);
    const [recentLiqs, setRecentLiqs] = useState<RecentLiquidation[]>([]);
    const [viewMode, setViewMode] = useState<'profile' | 'heatmap'>('profile');
    const [now, setNow] = useState(() => Date.now());

    // Fetch recent liquidations from backend
    useEffect(() => {
        const fetchLiqs = async () => {
            try {
                const res = await axios.get(`${API_URL}/market/liquidations?coin=${symbol}&limit=20`);
                if (res.data && Array.isArray(res.data)) {
                    setRecentLiqs(res.data.map((l: any) => ({
                        ...l,
                        usdValue: parseFloat(l.sz) * parseFloat(l.px)
                    })));
                }
            } catch (e) {
                console.error("Failed to fetch liquidations:", e);
                setRecentLiqs([]);
            }
        };
        fetchLiqs();
        const interval = setInterval(fetchLiqs, 10000);
        return () => clearInterval(interval);
    }, [symbol, currentPrice]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    // Enhanced liquidation model with more detail
    const liqLevels = useMemo(() => {
        if (!currentPrice || !openInterest) return [];

        const levels: LiqLevel[] = [];
        // openInterest is already in USD (notional) from the API/Parent. Default to 0 if missing.
        const totalOIUsd = openInterest || 0;

        // More granular leverage tiers
        const leverageTiers = [
            { mult: 100, label: '100x', share: 0.03, desc: 'Degen' },
            { mult: 75, label: '75x', share: 0.04, desc: 'High Risk' },
            { mult: 50, label: '50x', share: 0.08, desc: 'Aggressive' },
            { mult: 25, label: '25x', share: 0.15, desc: 'Standard' },
            { mult: 20, label: '20x', share: 0.12, desc: 'Moderate' },
            { mult: 10, label: '10x', share: 0.25, desc: 'Conservative' },
            { mult: 5, label: '5x', share: 0.15, desc: 'Safe' },
        ];

        const longBias = fundingRate > 0 ? 1.3 + Math.abs(fundingRate) * 50 : 0.7;
        const shortBias = fundingRate < 0 ? 1.3 + Math.abs(fundingRate) * 50 : 0.7;

        leverageTiers.forEach(tier => {
            // Long liquidations (below current price)
            const longLiqPrice = currentPrice * (1 - (1 / tier.mult) + 0.002);
            const longVolume = (totalOIUsd * tier.share * longBias) / 2;
            const longIntensity = Math.min((longVolume / (totalOIUsd * 0.08)), 1);

            levels.push({
                price: longLiqPrice,
                volume: longVolume,
                leverage: tier.label,
                side: 'long',
                intensity: longIntensity,
                description: `${tier.desc} Longs`,
                riskLevel: tier.mult >= 50 ? 'extreme' : tier.mult >= 25 ? 'high' : tier.mult >= 10 ? 'medium' : 'low'
            });

            // Short liquidations (above current price)
            const shortLiqPrice = currentPrice * (1 + (1 / tier.mult) - 0.002);
            const shortVolume = (totalOIUsd * tier.share * shortBias) / 2;
            const shortIntensity = Math.min((shortVolume / (totalOIUsd * 0.08)), 1);

            levels.push({
                price: shortLiqPrice,
                volume: shortVolume,
                leverage: tier.label,
                side: 'short',
                intensity: shortIntensity,
                description: `${tier.desc} Shorts`,
                riskLevel: tier.mult >= 50 ? 'extreme' : tier.mult >= 25 ? 'high' : tier.mult >= 10 ? 'medium' : 'low'
            });
        });

        return levels.sort((a, b) => b.price - a.price);
    }, [currentPrice, openInterest, fundingRate]);

    const formatK = (n: number) => {
        if (n >= 1000000000000) return `$${(n / 1000000000000).toFixed(1)}T`;
        if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)}B`;
        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
        return `$${n.toFixed(0)}`;
    };

    const formatPrice = (price: number) => {
        if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (price >= 1) return price.toFixed(4);
        return price.toFixed(6);
    };

    const formatTime = (ts: number) => {
        const diff = Math.floor((now - ts) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    };

    const maxVolume = Math.max(...liqLevels.map(l => l.volume), 1);
    const longLevels = liqLevels.filter(l => l.side === 'long');
    const shortLevels = liqLevels.filter(l => l.side === 'short');
    const totalLongVol = longLevels.reduce((s, l) => s + l.volume, 0);
    const totalShortVol = shortLevels.reduce((s, l) => s + l.volume, 0);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
    }, []);

    const handleLevelClick = (level: LiqLevel) => {
        if (onPriceSelect) {
            onPriceSelect(level.price.toFixed(level.price < 1 ? 6 : 2));
        }
    };

    const getRiskColor = (risk: string) => {
        switch (risk) {
            case 'extreme': return 'bg-[var(--color-bearish)] text-white';
            case 'high': return 'bg-[var(--color-accent-orange)] text-white';
            case 'medium': return 'bg-yellow-500 text-black';
            default: return 'bg-[var(--color-bullish)] text-white';
        }
    };

    return (
        <div
            ref={containerRef}
            className="flex flex-col h-full bg-gradient-to-b from-[#0a0a0a] to-[#050505] select-none font-sans overflow-hidden"
            onMouseMove={handleMouseMove}
        >
            {/* Header Controls */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-black/40">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-[var(--color-accent-orange)]" />
                        <span className="text-xs font-black text-white uppercase tracking-wider">Liquidation Map</span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-500">{symbol}</span>
                </div>

                <div className="flex items-center gap-2">
                    {/* View Mode Toggle */}
                    <div className="flex bg-gray-900 rounded-lg p-0.5 border border-white/5">
                        <button
                            onClick={() => setViewMode('profile')}
                            className={`px-3 py-1 text-[9px] font-black uppercase rounded transition-all flex items-center gap-1.5 ${viewMode === 'profile'
                                ? 'bg-orange-500 text-white shadow-[0_0_10px_rgba(249,115,22,0.4)]'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <BarChart3 className="w-3 h-3" />
                            Profile
                        </button>
                        <button
                            onClick={() => setViewMode('heatmap')}
                            className={`px-3 py-1 text-[9px] font-black uppercase rounded transition-all flex items-center gap-1.5 ${viewMode === 'heatmap'
                                ? 'bg-orange-500 text-white shadow-[0_0_10px_rgba(249,115,22,0.4)]'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <Flame className="w-3 h-3" />
                            Heatmap
                        </button>
                    </div>

                    {/* Zoom Controls */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))}
                            className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 transition-colors"
                        >
                            <ZoomOut className="w-3 h-3" />
                        </button>
                        <span className="text-[9px] font-mono text-gray-500 w-8 text-center">{(zoomLevel * 100).toFixed(0)}%</span>
                        <button
                            onClick={() => setZoomLevel(z => Math.min(2, z + 0.25))}
                            className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 transition-colors"
                        >
                            <ZoomIn className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Summary Stats */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--glass-border)]">
                <div className="flex items-center gap-2">
                    <TrendingDown className="w-3 h-3 text-[var(--color-bearish)]" />
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Longs at Risk</span>
                    <span className="text-xs font-mono font-bold text-[var(--color-bearish)]">{formatK(totalLongVol)}</span>
                </div>
                <div className="w-px h-4 bg-white/10" />
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-[var(--color-bullish)]" />
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Shorts at Risk</span>
                    <span className="text-xs font-mono font-bold text-[var(--color-bullish)]">{formatK(totalShortVol)}</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 uppercase font-bold">Bias:</span>
                    <span className={`text-[10px] font-bold ${totalLongVol > totalShortVol ? 'text-[var(--color-bearish)]' : 'text-[var(--color-bullish)]'}`}>
                        {totalLongVol > totalShortVol ? 'LONG HEAVY' : 'SHORT HEAVY'} ({((totalLongVol / (totalLongVol + totalShortVol)) * 100).toFixed(0)}%)
                    </span>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Main Chart Area */}
                <div className="flex-1 relative py-4 px-2 overflow-hidden">

                    {viewMode === 'heatmap' ? (
                        <>
                            <div className="relative w-full h-full border border-white/5 rounded-2xl overflow-hidden bg-black/40 shadow-inner group">
                                <HeatmapCanvas
                                    currentPrice={currentPrice}
                                    symbol={symbol}
                                    liqLevels={liqLevels}
                                    zoomLevel={zoomLevel}
                                    onPriceSelect={onPriceSelect}
                                />
                            </div>

                            {/* Stable Legend Overlay (Not Scaled) */}
                            <div className="absolute bottom-6 left-6 flex items-center gap-6 px-4 py-2.5 bg-black/60 backdrop-blur-md border border-white/5 rounded-xl z-40 pointer-events-none">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Sell Liquidity</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Buy Liquidity</span>
                                </div>
                                <div className="w-px h-3 bg-white/10" />
                                <div className="flex items-center gap-2">
                                    <Zap className="w-3 h-3 text-orange-400/50" />
                                    <span className="text-[8px] text-gray-600 font-black uppercase tracking-tighter">Scanning 256 Levels</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }} className="absolute inset-0">
                            {/* Current Price Line */}
                            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 z-20 flex items-center">
                                <div className="flex-1 h-[2px] bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent shadow-[0_0_20px_var(--color-primary-glow)]" />
                                <div className="bg-[var(--color-primary)] px-3 py-1 rounded-lg text-[11px] font-mono font-black text-black shadow-lg shadow-[var(--color-primary)]/30">
                                    ${formatPrice(currentPrice)}
                                </div>
                            </div>

                            {/* Shorts Section (Above) */}
                            <div className="absolute top-4 left-4 right-4 bottom-1/2 mb-4 flex flex-col justify-end gap-1.5 overflow-hidden">
                                {shortLevels.slice(0, 7).reverse().map((level, i) => {
                                    const barWidth = (level.volume / maxVolume) * 90;
                                    const distFromSpot = ((level.price - currentPrice) / currentPrice * 100).toFixed(1);

                                    return (
                                        <div
                                            key={`short-${i}`}
                                            className="relative flex items-center group cursor-pointer transition-all duration-200 hover:scale-[1.01]"
                                            onMouseEnter={() => setHoveredLevel(level)}
                                            onMouseLeave={() => setHoveredLevel(null)}
                                            onClick={() => handleLevelClick(level)}
                                        >
                                            {/* Glow Background */}
                                            <div
                                                className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-[var(--color-bullish)]/0 via-[var(--color-bullish)]/20 to-[var(--color-bullish)]/40 blur-md"
                                                style={{ width: `${barWidth}%` }}
                                            />

                                            {/* Main Bar */}
                                            <div
                                                className={`h-7 rounded-r-full relative flex items-center px-3 gap-2 transition-all duration-300 border-l-4 border-[var(--color-bullish)]
                                                    bg-gradient-to-r from-[var(--color-bullish)]/80 via-[var(--color-bullish)]/60 to-[var(--color-bullish)]/30
                                                    ${hoveredLevel === level ? 'shadow-[0_0_30px_var(--color-bullish)]/40 ring-1 ring-[var(--color-bullish)]' : ''}
                                                `}
                                                style={{ width: `${Math.max(barWidth, 20)}%`, opacity: 0.4 + level.intensity * 0.6 }}
                                            >
                                                <span className={`text-[8px] font-black px-1 py-0.5 rounded ${getRiskColor(level.riskLevel)}`}>
                                                    {level.leverage}
                                                </span>
                                                <span className="text-[10px] font-mono font-bold text-white">{formatK(level.volume)}</span>
                                                <span className="text-[9px] text-teal-200/70 ml-auto font-mono">+{distFromSpot}%</span>
                                            </div>

                                            {/* Price Label */}
                                            <div className="ml-2 text-[10px] font-mono text-[var(--color-bullish)]/80 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                                ${formatPrice(level.price)}
                                            </div>

                                            {/* Pulse for high intensity */}
                                            {level.intensity > 0.7 && (
                                                <div className="absolute left-1 w-2 h-2 rounded-full bg-[var(--color-bullish)] animate-ping" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Longs Section (Below) */}
                            <div className="absolute top-1/2 mt-4 left-4 right-4 bottom-4 flex flex-col justify-start gap-1.5 overflow-hidden">
                                {longLevels.slice(0, 7).map((level, i) => {
                                    const barWidth = (level.volume / maxVolume) * 90;
                                    const distFromSpot = ((currentPrice - level.price) / currentPrice * 100).toFixed(1);

                                    return (
                                        <div
                                            key={`long-${i}`}
                                            className="relative flex items-center group cursor-pointer transition-all duration-200 hover:scale-[1.01]"
                                            onMouseEnter={() => setHoveredLevel(level)}
                                            onMouseLeave={() => setHoveredLevel(null)}
                                            onClick={() => handleLevelClick(level)}
                                        >
                                            {/* Glow Background */}
                                            <div
                                                className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-[var(--color-bearish)]/0 via-[var(--color-bearish)]/20 to-[var(--color-bearish)]/40 blur-md"
                                                style={{ width: `${barWidth}%` }}
                                            />

                                            {/* Main Bar */}
                                            <div
                                                className={`h-7 rounded-r-full relative flex items-center px-3 gap-2 transition-all duration-300 border-l-4 border-[var(--color-bearish)]
                                                    bg-gradient-to-r from-[var(--color-bearish)]/80 via-[var(--color-bearish)]/60 to-[var(--color-bearish)]/30
                                                    ${hoveredLevel === level ? 'shadow-[0_0_30px_var(--color-bearish)]/40 ring-1 ring-[var(--color-bearish)]' : ''}
                                                `}
                                                style={{ width: `${Math.max(barWidth, 20)}%`, opacity: 0.4 + level.intensity * 0.6 }}
                                            >
                                                <span className={`text-[8px] font-black px-1 py-0.5 rounded ${getRiskColor(level.riskLevel)}`}>
                                                    {level.leverage}
                                                </span>
                                                <span className="text-[10px] font-mono font-bold text-white">{formatK(level.volume)}</span>
                                                <span className="text-[9px] text-red-200/70 ml-auto font-mono">-{distFromSpot}%</span>
                                            </div>

                                            {/* Price Label */}
                                            <div className="ml-2 text-[10px] font-mono text-[var(--color-bearish)]/80 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                                ${formatPrice(level.price)}
                                            </div>

                                            {/* Pulse for high intensity */}
                                            {level.intensity > 0.7 && (
                                                <div className="absolute left-1 w-2 h-2 rounded-full bg-[var(--color-bearish)] animate-ping" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Recent Liquidations Sidebar */}
                <div className="w-56 border-l border-[var(--glass-border)] flex flex-col bg-black/30">
                    <div className="px-3 py-2 border-b border-[var(--glass-border)] flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-[var(--color-accent-orange)]" />
                        <span className="text-[10px] font-black text-white uppercase tracking-wider">Recent Liquidations</span>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {recentLiqs.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-600 text-xs">
                                No recent liquidations
                            </div>
                        ) : (
                            recentLiqs.slice(0, 15).map((liq, i) => (
                                <div
                                    key={i}
                                    className={`px-3 py-2 border-b border-[var(--glass-border)] flex items-center gap-2 text-[10px] hover:bg-white/5 cursor-pointer transition-colors
                                        ${liq.usdValue > 100000 ? 'bg-white/[0.02]' : ''}
                                    `}
                                >
                                    <div className={`w-6 h-6 rounded flex items-center justify-center text-[8px] font-black
                                        ${liq.side === 'long' ? 'bg-[var(--color-bearish)]/20 text-[var(--color-bearish)]' : 'bg-[var(--color-bullish)]/20 text-[var(--color-bullish)]'}
                                    `}>
                                        {liq.side === 'long' ? '🔻' : '🔺'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono font-bold text-white">{formatK(liq.usdValue)}</span>
                                            <span className="text-gray-500">{formatTime(liq.time)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-500">
                                            <span>@${formatPrice(parseFloat(liq.px))}</span>
                                            <span className={liq.side === 'long' ? 'text-[var(--color-bearish)]' : 'text-[var(--color-bullish)]'}>
                                                {liq.side.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                    {liq.usdValue > 100000 && (
                                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-orange)] animate-pulse" />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Hover Tooltip */}
            {hoveredLevel && (
                <div
                    className="fixed z-50 px-3 py-2 bg-[#111] border border-white/10 rounded-lg shadow-2xl pointer-events-none"
                    style={{ left: mousePos.x + 20, top: mousePos.y - 30 }}
                >
                    <div className="text-[11px] font-bold text-white mb-1">{hoveredLevel.description}</div>
                    <div className="text-[10px] text-gray-400 space-y-0.5">
                        <div>Price: <span className="text-white font-mono">${hoveredLevel.price.toFixed(2)}</span></div>
                        <div>Volume: <span className="text-white font-mono">{formatK(hoveredLevel.volume)}</span></div>
                        <div>Risk: <span className={`font-bold ${hoveredLevel.riskLevel === 'extreme' ? 'text-red-400' : hoveredLevel.riskLevel === 'high' ? 'text-orange-400' : 'text-emerald-400'}`}>
                            {hoveredLevel.riskLevel.toUpperCase()}
                        </span></div>
                    </div>
                    <div className="mt-1.5 text-[9px] text-blue-400">Click to set limit price →</div>
                </div>
            )}

            {/* Footer Insight */}
            <div className="px-4 py-2 bg-black/60 border-t border-[var(--glass-border)] flex items-center gap-4">
                <Target className="w-4 h-4 text-[var(--color-primary)]" />
                <div className="flex-1">
                    <div className="text-[10px] text-gray-400">
                        {fundingRate > 0.0003
                            ? "⚠️ High funding rate indicates crowded longs. Potential cascade below if support breaks."
                            : fundingRate < -0.0003
                                ? "⚠️ Negative funding shows short bias. Watch for squeeze above current range."
                                : "✓ Market is balanced. Liquidity distributed evenly between bulls and bears."
                        }
                    </div>
                </div>
                <div className="text-[9px] font-mono text-gray-500">
                    Updated: <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>
                </div>
            </div>
        </div>
    );
}
/**
 * Advanced Heatmap Canvas Component
 * Renders a high-fidelity liquidity depth map using Canvas 2D.
 */
function HeatmapCanvas({ currentPrice, liqLevels, zoomLevel, onPriceSelect }: any) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current || !currentPrice) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        // Failsafe for zero dimensions
        const width = rect.width || 800;
        const height = rect.height || 600;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const w = width;
        const h = height;

        // Clear canvas with deep space gradient
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, w, h);

        // Draw Grid with higher visibility
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 0.5;

        // Vertical grid lines (Time axis)
        for (let x = 0; x <= w; x += w / 12) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Horizontal grid lines (Price axis)
        for (let y = 0; y <= h; y += h / 10) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // If no levels, show scanning status
        if (liqLevels.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.font = 'bold 12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('SCANNING FOR LIQUIDITY CLUSTERS...', w / 2, h / 2 - 20);
            return;
        }

        // Identify Top 3 Critical Clusters (Dominant Gravity Wells)
        const sortedClusters = [...liqLevels].sort((a, b) => b.intensity - a.intensity);
        const topClusters = sortedClusters.slice(0, 3);

        // Draw Heatmap Data
        liqLevels.forEach((level: any) => {
            const yOffset = ((level.price - currentPrice) / currentPrice) * h * 5;
            const y = h / 2 - yOffset;
            if (y < -100 || y > h + 100) return;

            const isKey = topClusters.some(c => c.price === level.price);
            const baseColor = level.side === 'short' ? '16, 185, 129' : '239, 68, 68';

            // Generate sharp "Gravity Clusters" instead of massive blobs
            for (let col = 0; col < 10; col++) {
                const x = (w * 0.08) + (col * (w * 0.09));
                // Tighter intensity scaling for surgical precision
                const intensityScale = isKey ? level.intensity * 1.1 : level.intensity * 0.8;
                const size = (12 + intensityScale * 25) * zoomLevel;
                const glowSize = size * 1.4;

                const op = (0.08 + intensityScale * 0.25) * (1 - (col / 12));

                const grad = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
                grad.addColorStop(0, `rgba(${baseColor}, ${op})`);
                grad.addColorStop(0.4, `rgba(${baseColor}, ${op * 0.2})`);
                grad.addColorStop(1, `rgba(${baseColor}, 0)`);

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, glowSize, 0, Math.PI * 2);
                ctx.fill();

                if (col === 0) {
                    // Refined Power Core
                    ctx.fillStyle = `rgba(${baseColor}, ${0.4 + intensityScale * 0.3})`;
                    ctx.beginPath();
                    ctx.arc(x, y, size / 8, 0, Math.PI * 2);
                    ctx.fill();

                    // Surgical UI for Major Clusters
                    if (isKey) {
                        ctx.strokeStyle = `rgba(${baseColor}, 0.4)`;
                        ctx.lineWidth = 0.5;
                        ctx.setLineDash([1, 3]);
                        ctx.beginPath();
                        ctx.moveTo(x + 25, y);
                        ctx.lineTo(w - 90, y);
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Subtitle Intelligence (More subtle)
                        ctx.fillStyle = `rgba(${baseColor}, 0.8)`;
                        ctx.font = '700 7px Inter';
                        ctx.textAlign = 'left';
                        ctx.fillText(`${level.side.toUpperCase()} CLUSTER`, x + 18, y - 6);
                        ctx.fillText(`${(level.intensity * 100).toFixed(0)}%`, x + 18, y + 12);
                    }
                }
            }
        });

        // Price Labels on right axis
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';

        const pricePoints = [1.05, 1.025, 1, 0.975, 0.95];
        pricePoints.forEach(p => {
            const px = currentPrice * p;
            const y = h / 2 - ((px - currentPrice) / currentPrice) * h * 5;
            if (y > 10 && y < h - 10) {
                ctx.fillText(`$${px.toLocaleString(undefined, { minimumFractionDigits: 1 })}`, w - 10, y + 4);

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.moveTo(w - 70, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
        });

        // Current Price Highlight Line
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w - 80, h / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label for current price
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(w - 85, h / 2 - 12, 85, 24, 4);
        } else {
            ctx.fillRect(w - 85, h / 2 - 12, 85, 24);
        }
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`$${currentPrice.toLocaleString()}`, w - 42, h / 2 + 4);

    }, [currentPrice, liqLevels, zoomLevel]);

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair transition-opacity duration-500"
            onClick={(e) => {
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const clickY = e.clientY - rect.top;
                const h = rect.height;
                // Reverse calculate price from Y
                // y = h/2 - ((p - currentPrice) / currentPrice) * h * 5
                const price = currentPrice * (1 + (h / 2 - clickY) / (h * 5));
                if (onPriceSelect) onPriceSelect(price.toFixed(2));
            }}
        />
    );
}
