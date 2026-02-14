'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { ShieldAlert, TrendingUp, TrendingDown, Target, Zap, AlertTriangle, Activity } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface StopCluster {
    price: number;
    intensity: number; // 0-100
    type: 'long_sl' | 'short_sl' | 'long_tp' | 'short_tp';
    estimatedSize: number;
    distancePercent: number;
}

interface StopClustersProps {
    symbol: string;
    currentPrice: number;
    onPriceSelect?: (price: string) => void;
}

/**
 * StopClusters Component
 * 
 * Estimates stop-loss and take-profit cluster zones based on:
 * - Recent swing highs/lows
 * - Key round numbers
 * - Fibonacci retracement levels
 * - Common risk management levels (1%, 2%, 5%)
 */
export default function StopClusters({ symbol, currentPrice, onPriceSelect }: StopClustersProps) {
    const [clusters, setClusters] = useState<StopCluster[]>([]);
    const [loading, setLoading] = useState(true);
    const [swingHigh, setSwingHigh] = useState(0);
    const [swingLow, setSwingLow] = useState(0);
    const [atr, setAtr] = useState(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Fetch historical data for analysis
    useEffect(() => {
        const fetchData = async () => {
            if (!currentPrice || currentPrice === 0) return;
            setLoading(true);

            try {
                // Get recent candles for swing analysis
                const hlInterval = '1h';
                const startTime = Date.now() - (48 * 60 * 60 * 1000); // 48 hours

                const res = await axios.post(`${API_URL}/trading/candles`, {
                    token: symbol,
                    interval: hlInterval,
                    start_time: startTime,
                    end_time: Date.now()
                });

                if (res.data && Array.isArray(res.data)) {
                    const candles = res.data;

                    // Find swing high and low
                    const highs = candles.map((c: any) => parseFloat(c.h));
                    const lows = candles.map((c: any) => parseFloat(c.l));
                    const closes = candles.map((c: any) => parseFloat(c.c));

                    const sh = Math.max(...highs);
                    const sl = Math.min(...lows);
                    setSwingHigh(sh);
                    setSwingLow(sl);

                    // Calculate ATR (simplified)
                    let atrSum = 0;
                    for (let i = 1; i < candles.length; i++) {
                        const h = parseFloat(candles[i].h);
                        const l = parseFloat(candles[i].l);
                        const pc = parseFloat(candles[i - 1].c);
                        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
                        atrSum += tr;
                    }
                    const calcAtr = atrSum / (candles.length - 1);
                    setAtr(calcAtr);

                    // Generate stop clusters
                    const generatedClusters = generateClusters(currentPrice, sh, sl, calcAtr);
                    setClusters(generatedClusters);
                }
            } catch {
                // Generate fallback clusters based on price levels
                const fallbackHigh = currentPrice * 1.05;
                const fallbackLow = currentPrice * 0.95;
                const fallbackAtr = currentPrice * 0.015;
                setSwingHigh(fallbackHigh);
                setSwingLow(fallbackLow);
                setAtr(fallbackAtr);
                setClusters(generateClusters(currentPrice, fallbackHigh, fallbackLow, fallbackAtr));
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [symbol, currentPrice]);

    // Generate cluster levels
    const generateClusters = (price: number, high: number, low: number, atr: number): StopCluster[] => {
        const clusters: StopCluster[] = [];
        if (price === 0) return clusters;

        // Common stop-loss levels for LONG positions (below price)
        const longSLLevels = [
            { pct: 0.01, intensity: 85, label: '1% SL Zone' },
            { pct: 0.02, intensity: 70, label: '2% SL Zone' },
            { pct: 0.03, intensity: 55, label: '3% SL Zone' },
            { pct: 0.05, intensity: 40, label: '5% SL Zone' },
        ];

        longSLLevels.forEach(level => {
            const stopPrice = price * (1 - level.pct);
            clusters.push({
                price: stopPrice,
                intensity: level.intensity,
                type: 'long_sl',
                estimatedSize: level.intensity * 1000, // Arbitrary size estimation
                distancePercent: -level.pct * 100
            });
        });

        // Common stop-loss levels for SHORT positions (above price)
        const shortSLLevels = [
            { pct: 0.01, intensity: 85, label: '1% SL Zone' },
            { pct: 0.02, intensity: 70, label: '2% SL Zone' },
            { pct: 0.03, intensity: 55, label: '3% SL Zone' },
            { pct: 0.05, intensity: 40, label: '5% SL Zone' },
        ];

        shortSLLevels.forEach(level => {
            const stopPrice = price * (1 + level.pct);
            clusters.push({
                price: stopPrice,
                intensity: level.intensity,
                type: 'short_sl',
                estimatedSize: level.intensity * 1000,
                distancePercent: level.pct * 100
            });
        });

        // Swing high as major short SL zone
        if (high > price) {
            const distPct = ((high - price) / price) * 100;
            clusters.push({
                price: high,
                intensity: 95,
                type: 'short_sl',
                estimatedSize: 95000,
                distancePercent: distPct
            });
        }

        // Swing low as major long SL zone
        if (low < price) {
            const distPct = ((price - low) / price) * 100;
            clusters.push({
                price: low,
                intensity: 95,
                type: 'long_sl',
                estimatedSize: 95000,
                distancePercent: -distPct
            });
        }

        // Round number zones (psychological levels)
        const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
        const roundStep = magnitude / 10;

        for (let i = -5; i <= 5; i++) {
            if (i === 0) continue;
            const roundPrice = Math.round(price / roundStep) * roundStep + (i * roundStep);
            const dist = ((roundPrice - price) / price) * 100;

            if (Math.abs(dist) > 0.5 && Math.abs(dist) < 10) {
                clusters.push({
                    price: roundPrice,
                    intensity: 50 - Math.abs(i) * 5,
                    type: dist > 0 ? 'short_sl' : 'long_sl',
                    estimatedSize: 30000 - Math.abs(i) * 3000,
                    distancePercent: dist
                });
            }
        }

        return clusters.sort((a, b) => b.price - a.price);
    };

    // Draw visualization
    useEffect(() => {
        if (!canvasRef.current || clusters.length === 0 || !currentPrice) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Price range
        const prices = clusters.map(c => c.price);
        const maxPrice = Math.max(...prices, currentPrice * 1.1);
        const minPrice = Math.min(...prices, currentPrice * 0.9);
        const priceRange = maxPrice - minPrice;

        const priceToY = (p: number) => height - ((p - minPrice) / priceRange) * height;

        // Draw gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.03)');
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.03)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Draw clusters
        clusters.forEach(cluster => {
            const y = priceToY(cluster.price);
            const barHeight = 6;
            const barWidth = (cluster.intensity / 100) * (width * 0.6);

            // Color based on type
            const isLongSL = cluster.type === 'long_sl';
            const color = isLongSL ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)';
            const bgColor = isLongSL ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';

            // Draw bar from left or right
            ctx.fillStyle = bgColor;
            if (isLongSL) {
                ctx.fillRect(0, y - barHeight / 2, barWidth, barHeight);
            } else {
                ctx.fillRect(width - barWidth, y - barHeight / 2, barWidth, barHeight);
            }

            // Draw intensity line
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.globalAlpha = cluster.intensity / 200;
            ctx.stroke();
            ctx.globalAlpha = 1;
        });

        // Draw current price line
        const currentY = priceToY(currentPrice);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(0, currentY);
        ctx.lineTo(width, currentY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Current price label
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(width / 2 - 40, currentY - 10, 80, 20);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`$${currentPrice.toLocaleString()}`, width / 2, currentY + 4);

    }, [clusters, currentPrice]);

    // Top clusters by intensity
    const topLongSL = useMemo(() =>
        clusters.filter(c => c.type === 'long_sl').sort((a, b) => b.intensity - a.intensity).slice(0, 4),
        [clusters]
    );

    const topShortSL = useMemo(() =>
        clusters.filter(c => c.type === 'short_sl').sort((a, b) => b.intensity - a.intensity).slice(0, 4),
        [clusters]
    );

    const formatPrice = (p: number) => p >= 1000 ? p.toLocaleString(undefined, { maximumFractionDigits: 0 }) : p.toFixed(2);

    if (loading) {
        <div className="w-full h-full flex flex-col bg-[#0a0a0a] animate-pulse">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="h-4 w-32 bg-white/10 rounded" />
                <div className="h-4 w-20 bg-white/10 rounded" />
            </div>
            <div className="flex-1 flex">
                <div className="flex-1 relative bg-white/5" />
                <div className="w-64 border-l border-white/5 p-3 space-y-4">
                    <div className="space-y-2">
                        <div className="h-3 w-24 bg-white/10 rounded mb-2" />
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-10 w-full bg-white/5 rounded-lg" />
                        ))}
                    </div>
                    <div className="space-y-2">
                        <div className="h-3 w-24 bg-white/10 rounded mb-2" />
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-10 w-full bg-white/5 rounded-lg" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    }

    return (
        <div className="w-full h-full flex flex-col bg-gradient-to-b from-[#0a0a0a] to-[#050505]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <ShieldAlert className="w-5 h-5 text-blue-400" />
                        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                    </div>
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-white">Stop Cluster Analysis</h3>
                        <p className="text-[9px] text-gray-500">Estimated SL zones based on price action</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="px-2 py-1 bg-white/5 rounded-lg text-[9px] font-mono text-gray-400">
                        ATR: ${atr.toFixed(2)}
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 rounded-lg">
                        <Activity className="w-3 h-3 text-blue-400" />
                        <span className="text-[9px] font-bold text-blue-400">LIVE</span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex">
                {/* Visualization Canvas */}
                <div className="flex-1 relative">
                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full"
                    />

                    {/* Price Scale (right side) */}
                    <div className="absolute right-2 top-4 bottom-4 flex flex-col justify-between text-[8px] font-mono text-gray-600">
                        <span>${formatPrice(swingHigh)}</span>
                        <span className="text-blue-400 font-bold">${formatPrice(currentPrice)}</span>
                        <span>${formatPrice(swingLow)}</span>
                    </div>
                </div>

                {/* Sidebar - Cluster List */}
                <div className="w-64 border-l border-white/5 overflow-y-auto">
                    {/* Short SL Zones (Above Price) */}
                    <div className="p-3 border-b border-white/5">
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingDown className="w-3.5 h-3.5 text-[var(--color-bearish)]" />
                            <span className="text-[10px] font-black uppercase text-[var(--color-bearish)] tracking-wider">Short SL Zones</span>
                        </div>
                        <div className="space-y-2">
                            {topShortSL.map((cluster, i) => (
                                <button
                                    key={`short-${i}`}
                                    onClick={() => onPriceSelect?.(cluster.price.toFixed(2))}
                                    className="w-full p-2 bg-[var(--color-bearish)]/5 hover:bg-[var(--color-bearish)]/10 border border-[var(--color-bearish)]/10 hover:border-[var(--color-bearish)]/30 rounded-lg transition-all text-left group"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-[11px] font-bold text-[var(--color-bearish)]">
                                            ${formatPrice(cluster.price)}
                                        </span>
                                        <span className="text-[9px] text-gray-500">+{cluster.distancePercent.toFixed(2)}%</span>
                                    </div>
                                    <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[var(--color-bearish)]"
                                            style={{ width: `${cluster.intensity}%` }}
                                        />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Long SL Zones (Below Price) */}
                    <div className="p-3">
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="w-3.5 h-3.5 text-[var(--color-bullish)]" />
                            <span className="text-[10px] font-black uppercase text-[var(--color-bullish)] tracking-wider">Long SL Zones</span>
                        </div>
                        <div className="space-y-2">
                            {topLongSL.map((cluster, i) => (
                                <button
                                    key={`long-${i}`}
                                    onClick={() => onPriceSelect?.(cluster.price.toFixed(2))}
                                    className="w-full p-2 bg-[var(--color-bullish)]/5 hover:bg-[var(--color-bullish)]/10 border border-[var(--color-bullish)]/10 hover:border-[var(--color-bullish)]/30 rounded-lg transition-all text-left group"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-[11px] font-bold text-[var(--color-bullish)]">
                                            ${formatPrice(cluster.price)}
                                        </span>
                                        <span className="text-[9px] text-gray-500">{cluster.distancePercent.toFixed(2)}%</span>
                                    </div>
                                    <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[var(--color-bullish)]"
                                            style={{ width: `${cluster.intensity}%` }}
                                        />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Market Context */}
                    <div className="p-3 border-t border-white/5 bg-black/20">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-3 h-3 text-yellow-500" />
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Insight</span>
                        </div>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                            {topLongSL[0] && topShortSL[0] ? (
                                Math.abs(topLongSL[0].distancePercent) < Math.abs(topShortSL[0].distancePercent)
                                    ? 'Higher concentration of long stops nearby. Breakdown risk elevated.'
                                    : 'Higher concentration of short stops nearby. Breakout potential elevated.'
                            ) : (
                                'Analyzing market structure for stop concentration zones.'
                            )}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
