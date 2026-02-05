'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Target, AlertTriangle, ZoomIn, ZoomOut, Move } from 'lucide-react';
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
                // Use mock data if API unavailable
                const mockLiqs: RecentLiquidation[] = Array(10).fill(0).map((_, i) => ({
                    coin: symbol,
                    px: (currentPrice * (1 + (Math.random() - 0.5) * 0.1)).toFixed(2),
                    sz: (Math.random() * 10).toFixed(4),
                    side: Math.random() > 0.5 ? 'long' : 'short',
                    time: Date.now() - i * 30000,
                    usdValue: Math.random() * 500000 + 10000
                }));
                setRecentLiqs(mockLiqs);
            }
        };
        fetchLiqs();
        const interval = setInterval(fetchLiqs, 10000);
        return () => clearInterval(interval);
    }, [symbol, currentPrice]);

    // Enhanced liquidation model with more detail
    const liqLevels = useMemo(() => {
        if (!currentPrice || !openInterest) return [];

        const levels: LiqLevel[] = [];
        const totalOIUsd = openInterest * currentPrice;

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
        if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)}B`;
        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
        return `$${n.toFixed(0)}`;
    };

    const formatTime = (ts: number) => {
        const diff = Math.floor((Date.now() - ts) / 1000);
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
            case 'extreme': return 'bg-red-500 text-white';
            case 'high': return 'bg-orange-500 text-white';
            case 'medium': return 'bg-yellow-500 text-black';
            default: return 'bg-green-500 text-white';
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
                        <Zap className="w-4 h-4 text-orange-400" />
                        <span className="text-xs font-black text-white uppercase tracking-wider">Liquidation Map</span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-500">{symbol}</span>
                </div>

                <div className="flex items-center gap-2">
                    {/* View Mode Toggle */}
                    <div className="flex bg-gray-900 rounded-lg p-0.5 border border-white/5">
                        <button
                            onClick={() => setViewMode('profile')}
                            className={`px-2 py-1 text-[9px] font-bold uppercase rounded transition-all ${viewMode === 'profile' ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            Profile
                        </button>
                        <button
                            onClick={() => setViewMode('heatmap')}
                            className={`px-2 py-1 text-[9px] font-bold uppercase rounded transition-all ${viewMode === 'heatmap' ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
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
            <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                    <TrendingDown className="w-3 h-3 text-red-400" />
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Longs at Risk</span>
                    <span className="text-xs font-mono font-bold text-red-400">{formatK(totalLongVol)}</span>
                </div>
                <div className="w-px h-4 bg-white/10" />
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-teal-400" />
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Shorts at Risk</span>
                    <span className="text-xs font-mono font-bold text-teal-400">{formatK(totalShortVol)}</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 uppercase font-bold">Bias:</span>
                    <span className={`text-[10px] font-bold ${totalLongVol > totalShortVol ? 'text-red-400' : 'text-teal-400'}`}>
                        {totalLongVol > totalShortVol ? 'LONG HEAVY' : 'SHORT HEAVY'} ({((totalLongVol / (totalLongVol + totalShortVol)) * 100).toFixed(0)}%)
                    </span>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Main Chart Area */}
                <div className="flex-1 relative py-4 px-2" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}>
                    {/* Current Price Line */}
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 z-20 flex items-center">
                        <div className="flex-1 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent shadow-[0_0_20px_rgba(59,130,246,0.6)]" />
                        <div className="bg-blue-500 px-3 py-1 rounded-lg text-[11px] font-mono font-black text-white shadow-lg shadow-blue-500/30">
                            ${currentPrice.toFixed(currentPrice < 1 ? 4 : 2)}
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
                                        className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-teal-500/0 via-teal-500/20 to-teal-500/40 blur-md"
                                        style={{ width: `${barWidth}%` }}
                                    />

                                    {/* Main Bar */}
                                    <div
                                        className={`h-7 rounded-r-full relative flex items-center px-3 gap-2 transition-all duration-300 border-l-4 border-teal-400
                                            bg-gradient-to-r from-teal-600/80 via-teal-500/60 to-teal-400/30
                                            ${hoveredLevel === level ? 'shadow-[0_0_30px_rgba(20,184,166,0.4)] ring-1 ring-teal-400' : ''}
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
                                    <div className="ml-2 text-[10px] font-mono text-teal-400/80 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                        ${level.price.toFixed(2)}
                                    </div>

                                    {/* Pulse for high intensity */}
                                    {level.intensity > 0.7 && (
                                        <div className="absolute left-1 w-2 h-2 rounded-full bg-teal-400 animate-ping" />
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
                                        className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-red-500/0 via-red-500/20 to-red-500/40 blur-md"
                                        style={{ width: `${barWidth}%` }}
                                    />

                                    {/* Main Bar */}
                                    <div
                                        className={`h-7 rounded-r-full relative flex items-center px-3 gap-2 transition-all duration-300 border-l-4 border-red-400
                                            bg-gradient-to-r from-red-600/80 via-red-500/60 to-red-400/30
                                            ${hoveredLevel === level ? 'shadow-[0_0_30px_rgba(239,68,68,0.4)] ring-1 ring-red-400' : ''}
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
                                    <div className="ml-2 text-[10px] font-mono text-red-400/80 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                        ${level.price.toFixed(2)}
                                    </div>

                                    {/* Pulse for high intensity */}
                                    {level.intensity > 0.7 && (
                                        <div className="absolute left-1 w-2 h-2 rounded-full bg-red-400 animate-ping" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Recent Liquidations Sidebar */}
                <div className="w-56 border-l border-white/5 flex flex-col bg-black/30">
                    <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-orange-400" />
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
                                    className={`px-3 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] hover:bg-white/5 cursor-pointer transition-colors
                                        ${liq.usdValue > 100000 ? 'bg-white/[0.02]' : ''}
                                    `}
                                >
                                    <div className={`w-6 h-6 rounded flex items-center justify-center text-[8px] font-black
                                        ${liq.side === 'long' ? 'bg-red-500/20 text-red-400' : 'bg-teal-500/20 text-teal-400'}
                                    `}>
                                        {liq.side === 'long' ? '🔻' : '🔺'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono font-bold text-white">{formatK(liq.usdValue)}</span>
                                            <span className="text-gray-500">{formatTime(liq.time)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-500">
                                            <span>@${parseFloat(liq.px).toFixed(2)}</span>
                                            <span className={liq.side === 'long' ? 'text-red-400' : 'text-teal-400'}>
                                                {liq.side.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                    {liq.usdValue > 100000 && (
                                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
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
                        <div>Risk: <span className={`font-bold ${hoveredLevel.riskLevel === 'extreme' ? 'text-red-400' : hoveredLevel.riskLevel === 'high' ? 'text-orange-400' : 'text-green-400'}`}>
                            {hoveredLevel.riskLevel.toUpperCase()}
                        </span></div>
                    </div>
                    <div className="mt-1.5 text-[9px] text-blue-400">Click to set limit price →</div>
                </div>
            )}

            {/* Footer Insight */}
            <div className="px-4 py-2 bg-black/60 border-t border-white/5 flex items-center gap-4">
                <Target className="w-4 h-4 text-blue-400" />
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
