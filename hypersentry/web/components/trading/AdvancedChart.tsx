'use client';
import { useEffect, useRef, memo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, Maximize2, Eye, EyeOff } from 'lucide-react';
import { ColorType, CrosshairMode, LineStyle, createChart, IChartApi, ISeriesApi, Time, UTCTimestamp, SeriesMarker } from 'lightweight-charts';
import { useHyperliquidWS } from '../../contexts/HyperliquidWSContext';
import { Indicators } from '../../utils/indicators';
import LiquidationProfile from './LiquidationProfile';
import LiquidationHeatmap from './LiquidationHeatmap';

interface AdvancedChartProps {
    symbol: string;
    interval: string;
    positions?: any[];
    openOrders?: any[];
    bias?: 'bullish' | 'bearish' | 'neutral';
    onPriceSelect?: (price: string) => void;
    showHeatmap?: boolean;
    currentPrice?: number;
    openInterest?: number;
    fundingRate?: number;
    activeIndicators?: Set<string>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Premium color palette
const COLORS = {
    bullish: '#00ff88',
    bearish: '#ff3366',
    bullishWick: '#00cc6a',
    bearishWick: '#cc2952',
    background: '#0a0a0a',
    grid: 'rgba(255, 255, 255, 0.02)',
    gridBold: 'rgba(255, 255, 255, 0.04)',
    crosshair: '#3b82f6',
    text: '#6b7280',
    textBright: '#9ca3af'
};

function AdvancedChart({
    symbol,
    interval,
    onPriceSelect,
    showHeatmap = false,
    currentPrice = 0,
    openInterest = 0,
    fundingRate = 0,
    bias = 'neutral',
    activeIndicators = new Set(['EMA 50', 'EMA 200', 'Supertrend'])
}: AdvancedChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

    // Indicators Refs
    const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const supertrendRef = useRef<ISeriesApi<"Line"> | null>(null);
    const elliotWaveRef = useRef<ISeriesApi<"Line"> | null>(null);
    const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
    const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
    const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
    const sarRef = useRef<ISeriesApi<"Line"> | null>(null);

    const [candlesticks, setCandlesticks] = useState<any[]>([]);
    const [visibleRange, setVisibleRange] = useState<{ min: number; max: number } | null>(null);
    const [chartHeight, setChartHeight] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showVolume, setShowVolume] = useState(true);
    const [liquidationMarkers, setLiquidationMarkers] = useState<SeriesMarker<Time>[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const { subscribe, addListener } = useHyperliquidWS();
    const lastCandleRef = useRef<any>(null);

    // Fetch liquidation events for markers
    useEffect(() => {
        const fetchLiquidations = async () => {
            try {
                const res = await axios.get(`${API_URL}/market/liquidations?coin=${symbol}&limit=50`);
                if (res.data && Array.isArray(res.data)) {
                    const markers: SeriesMarker<Time>[] = res.data
                        .filter((l: any) => parseFloat(l.sz) * parseFloat(l.px) > 50000) // Only big liqs
                        .map((l: any) => {
                            const ts = Math.floor(l.time / 1000) as UTCTimestamp;
                            const isBigLiq = parseFloat(l.sz) * parseFloat(l.px) > 100000;
                            return {
                                time: ts,
                                position: l.side === 'long' ? 'belowBar' : 'aboveBar',
                                color: l.side === 'long' ? '#ef4444' : '#14b8a6',
                                shape: isBigLiq ? 'circle' : 'arrowDown',
                                text: isBigLiq ? `💀 $${(parseFloat(l.sz) * parseFloat(l.px) / 1000).toFixed(0)}K` : '',
                                size: isBigLiq ? 2 : 1
                            } as SeriesMarker<Time>;
                        });
                    setLiquidationMarkers(markers);
                }
            } catch (e) {
                // Silent fail - markers are optional
            }
        };
        fetchLiquidations();
    }, [symbol]);

    // Range Update logic
    const updateRange = useCallback(() => {
        if (!chartRef.current || !candlestickSeriesRef.current || !chartContainerRef.current) return;
        try {
            const h = chartContainerRef.current.clientHeight;
            if (h > 0) setChartHeight(h);

            const priceScale = candlestickSeriesRef.current.priceScale();
            const range = (priceScale as any).getVisiblePriceRange?.();

            if (range && range.from !== null && range.to !== null) {
                setVisibleRange({
                    min: Math.min(range.from, range.to),
                    max: Math.max(range.from, range.to)
                });
            }
        } catch (e) {
            console.warn("Range update failed", e);
        }
    }, []);

    // Chart Controls Handlers
    const handleZoomIn = () => {
        if (!chartRef.current) return;
        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
            const range = logicalRange.to - logicalRange.from;
            const newRange = range * 0.7;
            const center = (logicalRange.from + logicalRange.to) / 2;
            timeScale.setVisibleLogicalRange({ from: center - newRange / 2, to: center + newRange / 2 });
        }
    };

    const handleZoomOut = () => {
        if (!chartRef.current) return;
        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
            const range = logicalRange.to - logicalRange.from;
            const newRange = range * 1.4;
            const center = (logicalRange.from + logicalRange.to) / 2;
            timeScale.setVisibleLogicalRange({ from: center - newRange / 2, to: center + newRange / 2 });
        }
    };

    const handleScrollLeft = () => {
        if (!chartRef.current) return;
        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
            const range = logicalRange.to - logicalRange.from;
            const shift = range * 0.25;
            timeScale.setVisibleLogicalRange({ from: logicalRange.from - shift, to: logicalRange.to - shift });
        }
    };

    const handleScrollRight = () => {
        if (!chartRef.current) return;
        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
            const range = logicalRange.to - logicalRange.from;
            const shift = range * 0.25;
            timeScale.setVisibleLogicalRange({ from: logicalRange.from + shift, to: logicalRange.to + shift });
        }
    };

    const handleReset = () => {
        if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }
    };

    const toggleFullscreen = () => {
        if (chartContainerRef.current) {
            if (!document.fullscreenElement) {
                chartContainerRef.current.requestFullscreen();
                setIsFullscreen(true);
            } else {
                document.exitFullscreen();
                setIsFullscreen(false);
            }
        }
    };

    // 1. Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        chartContainerRef.current.innerHTML = '';

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: COLORS.textBright,
                fontSize: 11,
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            },
            grid: {
                vertLines: { color: COLORS.grid, style: LineStyle.Solid },
                horzLines: { color: COLORS.grid, style: LineStyle.Solid },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: COLORS.crosshair,
                    width: 1,
                    style: LineStyle.Dashed,
                    labelBackgroundColor: COLORS.crosshair
                },
                horzLine: {
                    color: COLORS.crosshair,
                    width: 1,
                    style: LineStyle.Dashed,
                    labelBackgroundColor: COLORS.crosshair
                },
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.06)',
                borderVisible: false,
                scaleMargins: { top: 0.1, bottom: 0.2 },
                autoScale: true,
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.06)',
                borderVisible: false,
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 8,
                minBarSpacing: 4,
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true },
            handleScale: { mouseWheel: true, pinch: true },
        });

        // Volume Series (bottom)
        volumeSeriesRef.current = chart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
            borderVisible: false,
        });

        // Initialize indicator series BEFORE candlesticks
        ema50Ref.current = chart.addLineSeries({
            color: 'rgba(99, 102, 241, 0.6)',
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        ema200Ref.current = chart.addLineSeries({
            color: 'rgba(168, 85, 247, 0.5)',
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        supertrendRef.current = chart.addLineSeries({
            color: '#10b981',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
        });

        elliotWaveRef.current = chart.addLineSeries({
            color: '#fbbf24',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        bbUpperRef.current = chart.addLineSeries({
            color: 'rgba(59, 130, 246, 0.3)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        bbLowerRef.current = chart.addLineSeries({
            color: 'rgba(59, 130, 246, 0.3)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        vwapRef.current = chart.addLineSeries({
            color: '#3b82f6',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
        });
        sarRef.current = chart.addLineSeries({
            color: 'rgba(255, 255, 255, 0.4)',
            lineWidth: 1,
            pointMarkersVisible: true,
            pointMarkersRadius: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        // Candlestick Series LAST
        const candlestickSeries = chart.addCandlestickSeries({
            upColor: COLORS.bullish,
            downColor: COLORS.bearish,
            borderVisible: false,
            wickUpColor: COLORS.bullishWick,
            wickDownColor: COLORS.bearishWick,
            priceLineVisible: true,
            priceLineWidth: 1,
            priceLineColor: '#3b82f6',
            priceLineStyle: LineStyle.Dashed,
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        // Resize
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
                updateRange();
            }
        };

        window.addEventListener('resize', handleResize);
        chart.timeScale().subscribeVisibleLogicalRangeChange(() => setTimeout(updateRange, 100));

        // Click to select price
        chart.subscribeClick((param) => {
            if (param.point && onPriceSelect && candlestickSeriesRef.current) {
                const price = candlestickSeriesRef.current.coordinateToPrice(param.point.y);
                if (price) onPriceSelect(price.toFixed(4));
            }
        });

        return () => {
            window.removeEventListener('resize', handleResize);
            try {
                chart.remove();
            } catch {
                // Silent cleanup - chart removal may fail if already destroyed
            }
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            volumeSeriesRef.current = null;
            ema50Ref.current = null;
            ema200Ref.current = null;
            supertrendRef.current = null;
            elliotWaveRef.current = null;
            bbUpperRef.current = null;
            bbLowerRef.current = null;
            vwapRef.current = null;
            sarRef.current = null;
            lastCandleRef.current = null;
        };
    }, [symbol]);

    // 2. Fetch Data
    useEffect(() => {
        let isActive = true;
        lastCandleRef.current = null;

        const fetchData = async () => {
            if (!candlestickSeriesRef.current || !chartRef.current) return;
            setIsLoading(true);
            setError(null);

            // Clear all series
            candlestickSeriesRef.current.setData([]);
            volumeSeriesRef.current?.setData([]);
            ema50Ref.current?.setData([]);
            ema200Ref.current?.setData([]);
            supertrendRef.current?.setData([]);
            elliotWaveRef.current?.setData([]);
            bbUpperRef.current?.setData([]);
            bbLowerRef.current?.setData([]);
            vwapRef.current?.setData([]);
            sarRef.current?.setData([]);
            setCandlesticks([]);

            chartRef.current.priceScale('right').applyOptions({
                autoScale: true,
                scaleMargins: { top: 0.1, bottom: 0.2 }
            });

            try {
                const hlInterval = interval === '60' ? '1h' : interval === '240' ? '4h' : interval === 'D' ? '1d' : '15m';
                const candleCount = 400;
                const startTime = Date.now() - (candleCount * (parseInt(interval) || 15) * 60 * 1000);

                const res = await axios.post(`${API_URL}/trading/candles`, {
                    token: symbol,
                    interval: hlInterval,
                    start_time: Math.floor(startTime),
                    end_time: Math.floor(Date.now())
                });

                if (isActive && Array.isArray(res.data)) {
                    const formatted = res.data.map((c: any) => ({
                        time: (c.t / 1000) as UTCTimestamp,
                        open: parseFloat(c.o),
                        high: parseFloat(c.h),
                        low: parseFloat(c.l),
                        close: parseFloat(c.c),
                        volume: parseFloat(c.v)
                    })).sort((a, b) => (a.time as number) - (b.time as number));

                    if (formatted.length > 0) {
                        setCandlesticks(formatted);
                        lastCandleRef.current = formatted[formatted.length - 1];
                        candlestickSeriesRef.current?.setData(formatted);

                        // Volume data
                        if (volumeSeriesRef.current) {
                            const volumeData = formatted.map((c: any) => ({
                                time: c.time,
                                value: c.volume,
                                color: c.close >= c.open ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 51, 102, 0.3)'
                            }));
                            volumeSeriesRef.current.setData(volumeData);
                        }

                        requestAnimationFrame(() => {
                            if (isActive && chartRef.current) {
                                chartRef.current.timeScale().fitContent();
                                chartRef.current.priceScale('right').applyOptions({ autoScale: true });
                                updateRange();
                            }
                        });
                    }
                }
            } catch {
                // Silently handle - data unavailable
                setError("Data unavailable");
            } finally {
                if (isActive) setIsLoading(false);
            }
        };

        fetchData();
        const poll = setInterval(fetchData, 60000);
        return () => {
            isActive = false;
            clearInterval(poll);
            lastCandleRef.current = null;
        };
    }, [symbol, interval, updateRange]);

    // Apply liquidation markers
    useEffect(() => {
        if (candlestickSeriesRef.current && liquidationMarkers.length > 0 && candlesticks.length > 0) {
            try {
                candlestickSeriesRef.current.setMarkers(liquidationMarkers);
            } catch (e) {
                // Markers might fail if times don't align
            }
        }
    }, [liquidationMarkers, candlesticks]);

    // Volume visibility
    useEffect(() => {
        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.applyOptions({ visible: showVolume });
        }
    }, [showVolume]);

    // Force update range when candlesticks or price updates
    useEffect(() => {
        updateRange();
    }, [candlesticks, currentPrice, updateRange]);

    // 3. Indicator Calculation
    useEffect(() => {
        if (candlesticks.length === 0) return;

        // Apply visibility
        ema50Ref.current?.applyOptions({ visible: activeIndicators.has('EMA 50') });
        ema200Ref.current?.applyOptions({ visible: activeIndicators.has('EMA 200') });
        supertrendRef.current?.applyOptions({ visible: activeIndicators.has('Supertrend') });
        elliotWaveRef.current?.applyOptions({ visible: activeIndicators.has('Elliot Wave') });
        bbUpperRef.current?.applyOptions({ visible: activeIndicators.has('Bollinger Bands') });
        bbLowerRef.current?.applyOptions({ visible: activeIndicators.has('Bollinger Bands') });
        vwapRef.current?.applyOptions({ visible: activeIndicators.has('VWAP') });
        sarRef.current?.applyOptions({ visible: activeIndicators.has('Parabolic SAR') });

        // Calculate and set data
        if (activeIndicators.has('EMA 50')) {
            const data = Indicators.calculateEMA(candlesticks, 50);
            ema50Ref.current?.setData(data.map(d => ({ ...d, time: d.time as UTCTimestamp })));
        }
        if (activeIndicators.has('EMA 200')) {
            const data = Indicators.calculateEMA(candlesticks, 200);
            ema200Ref.current?.setData(data.map(d => ({ ...d, time: d.time as UTCTimestamp })));
        }
        if (activeIndicators.has('Supertrend')) {
            const st = Indicators.calculateSupertrend(candlesticks, 10, 3);
            supertrendRef.current?.setData(st.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));

            const lastST = st[st.length - 1];
            if (lastST) {
                supertrendRef.current?.applyOptions({
                    color: lastST.direction === 1 ? '#10b981' : '#ef4444'
                });
            }
        }
        if (activeIndicators.has('Elliot Wave')) {
            const zigzag = Indicators.calculateZigZag(candlesticks, 2);
            elliotWaveRef.current?.setData(zigzag.map(z => ({ time: z.time as UTCTimestamp, value: z.value })));
        }
        if (activeIndicators.has('Bollinger Bands')) {
            const bb = Indicators.calculateBollingerBands(candlesticks, 20, 2);
            bbUpperRef.current?.setData(bb.map(d => ({ time: d.time as UTCTimestamp, value: d.upper })));
            bbLowerRef.current?.setData(bb.map(d => ({ time: d.time as UTCTimestamp, value: d.lower })));
        }
        if (activeIndicators.has('VWAP')) {
            const vwap = Indicators.calculateVWAP(candlesticks);
            vwapRef.current?.setData(vwap.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
        }
        if (activeIndicators.has('Parabolic SAR')) {
            const sar = Indicators.calculateParabolicSAR(candlesticks);
            sarRef.current?.setData(sar.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
        }

    }, [candlesticks, activeIndicators]);

    // 4. Real-time WS
    useEffect(() => {
        if (!subscribe) return;
        subscribe({ type: 'trades', coin: symbol });

        const removeListener = addListener('trades', (data: any) => {
            if (Array.isArray(data) && data.length > 0 && candlestickSeriesRef.current && lastCandleRef.current) {
                const relevant = data.filter((d: any) => d.coin === symbol);
                if (relevant.length === 0) return;

                const lastTrade = relevant[relevant.length - 1];
                const tradePrice = parseFloat(lastTrade.px);
                const current = lastCandleRef.current;

                const updated = {
                    ...current,
                    close: tradePrice,
                    high: Math.max(current.high, tradePrice),
                    low: Math.min(current.low, tradePrice),
                };

                candlestickSeriesRef.current.update(updated);
                lastCandleRef.current = updated;
            }
        });

        return () => {
            if (removeListener) removeListener();
        };
    }, [symbol, subscribe, addListener]);

    // 5. Background Shading based on bias
    useEffect(() => {
        if (!chartRef.current) return;
        const color = bias === 'bullish' ? 'rgba(16, 185, 129, 0.03)' :
            bias === 'bearish' ? 'rgba(239, 68, 68, 0.03)' : 'transparent';
        chartRef.current.applyOptions({
            layout: { background: { type: ColorType.Solid, color: color } }
        });
    }, [bias]);

    return (
        <div className="w-full h-full relative" style={{ minHeight: '300px', background: `linear-gradient(180deg, ${COLORS.background} 0%, #050505 100%)` }}>
            {isLoading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                        <span className="text-xs text-gray-500 font-medium">Loading {symbol} data...</span>
                    </div>
                </div>
            )}

            {error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
                    <div className="text-red-400 text-sm">{error}</div>
                </div>
            )}

            <div ref={chartContainerRef} className="w-full h-full" />

            {/* Liquidity Walls (Liquidation Overlay) */}
            {!showHeatmap && currentPrice > 0 && visibleRange && (
                <div className="absolute inset-0 z-10 pointer-events-none">
                    <LiquidationProfile
                        currentPrice={currentPrice}
                        symbol={symbol}
                        openInterest={openInterest}
                        fundingRate={fundingRate}
                        height={chartHeight}
                        maxPrice={visibleRange.max}
                        minPrice={visibleRange.min}
                        mode="overlay"
                    />
                </div>
            )}

            {/* Heatmap Overlay */}
            {showHeatmap && (
                <div className="absolute inset-0 z-[50] bg-[#0b0b0b]">
                    <LiquidationHeatmap
                        currentPrice={currentPrice}
                        symbol={symbol}
                        openInterest={openInterest}
                        fundingRate={fundingRate}
                        onPriceSelect={onPriceSelect}
                    />
                </div>
            )}

            {/* Active Indicators Legend */}
            <div className="absolute top-3 left-3 z-40 flex flex-col gap-1 pointer-events-none">
                {Array.from(activeIndicators || []).map(ind => (
                    <div key={ind} className="flex items-center gap-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm border border-white/5 rounded text-[9px] font-mono text-gray-400">
                        <span className={`w-2 h-2 rounded-full ${ind === 'EMA 50' ? 'bg-indigo-400' :
                            ind === 'EMA 200' ? 'bg-purple-400' :
                                ind === 'Supertrend' ? 'bg-emerald-400' :
                                    ind === 'VWAP' ? 'bg-blue-500' :
                                        ind === 'Bollinger Bands' ? 'bg-blue-400/50' :
                                            'bg-yellow-500'
                            }`} />
                        <span>{ind}</span>
                    </div>
                ))}
            </div>

            {/* Price Watermark */}
            {currentPrice > 0 && (
                <div className="absolute top-3 right-16 z-30 text-right pointer-events-none">
                    <div className="text-2xl font-mono font-black text-white/10">
                        ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: currentPrice < 1 ? 6 : 2 })}
                    </div>
                    <div className="text-xs font-bold text-white/5 uppercase tracking-widest">{symbol}/USD</div>
                </div>
            )}

            {/* Chart Controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 p-1 bg-black/70 border border-white/10 rounded-xl backdrop-blur-md shadow-2xl">
                <button onClick={handleScrollLeft} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Scroll Left">
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={handleZoomOut} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Zoom Out">
                    <ZoomOut className="w-4 h-4" />
                </button>
                <button onClick={handleReset} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Reset View">
                    <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleZoomIn} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Zoom In">
                    <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={handleScrollRight} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Scroll Right">
                    <ChevronRight className="w-4 h-4" />
                </button>

                <div className="w-px h-5 bg-white/10 mx-1" />

                <button
                    onClick={() => setShowVolume(!showVolume)}
                    className={`p-2 rounded-lg transition-colors ${showVolume ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                    title="Toggle Volume"
                >
                    {showVolume ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>

                <button
                    onClick={toggleFullscreen}
                    className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    title="Fullscreen"
                >
                    <Maximize2 className="w-4 h-4" />
                </button>
            </div>

            {/* Liquidation Marker Legend */}
            {liquidationMarkers.length > 0 && (
                <div className="absolute bottom-4 right-4 z-30 flex items-center gap-3 px-3 py-1.5 bg-black/60 border border-white/10 rounded-lg text-[9px]">
                    <div className="flex items-center gap-1.5">
                        <span className="text-red-400">💀</span>
                        <span className="text-gray-400">Long Liquidation</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-teal-400">💀</span>
                        <span className="text-gray-400">Short Liquidation</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default dynamic(() => Promise.resolve(memo(AdvancedChart)), { ssr: false });
