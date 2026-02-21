'use client';
import Link from 'next/link';
import { useEffect, useRef, memo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, Maximize2, Eye, EyeOff, Shield, Filter, Settings, Minimize2, ShieldAlert, Activity, BarChart3, Binary, Target, Zap, BrainCircuit } from 'lucide-react';
import { ColorType, CrosshairMode, LineStyle, createChart, IChartApi, ISeriesApi, Time, UTCTimestamp, SeriesMarker } from 'lightweight-charts';
import { useHyperliquidWS } from '@/contexts/HyperliquidWSContext';
import { useMarketStore, LiquidityWall } from '../../store/useMarketStore';
import { Indicators } from '../../utils/indicators';
import LiquidationProfile from './LiquidationProfile';
import LiquidationHeatmap from './LiquidationHeatmap';
import OrderBookProfile from './OrderBookProfile';
import { getApiUrl } from '@/lib/constants';

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
    onToggleIndicator?: (indicator: string) => void;
    isHudMinimized?: boolean;
    onNavigate?: (tab: string) => void;
}

const API_URL = getApiUrl();

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

const DEFAULT_ACTIVE_INDICATORS = new Set(['EMA 50', 'EMA 200', 'Supertrend', 'Volume']);
const DEFAULT_PRICE_PRECISION = 6;
const MAX_PRICE_PRECISION = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const countDecimals = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    const normalized = value.toFixed(10).replace(/0+$/, '');
    const dotIndex = normalized.indexOf('.');
    return dotIndex === -1 ? 0 : normalized.length - dotIndex - 1;
};

const derivePricePrecision = (candles: Array<{ open: number; high: number; low: number; close: number }>): number => {
    let precision = 2;
    for (const candle of candles) {
        for (const px of [candle.open, candle.high, candle.low, candle.close]) {
            if (!Number.isFinite(px) || px <= 0) continue;
            precision = Math.max(precision, countDecimals(px));
        }
    }
    return clamp(precision, 2, MAX_PRICE_PRECISION);
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
    activeIndicators = DEFAULT_ACTIVE_INDICATORS,
    onToggleIndicator,
    isHudMinimized,
    onNavigate,
    positions = [],
    openOrders = []
}: AdvancedChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);

    // Indicators Refs
    const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const supertrendRef = useRef<ISeriesApi<"Line"> | null>(null);
    const elliotWaveRef = useRef<ISeriesApi<"Line"> | null>(null);
    const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
    const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
    const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
    const sarRef = useRef<ISeriesApi<"Line"> | null>(null);
    const wallSeriesRef = useRef<any[]>([]); // Array of PriceLines for detected walls



    // Trading Markers Refs
    const positionLinesRef = useRef<any[]>([]);
    const orderLinesRef = useRef<any[]>([]);
    const liquidationLinesRef = useRef<any[]>([]);

    const [candlesticks, setCandlesticks] = useState<any[]>([]);
    const [visibleRange, setVisibleRange] = useState<{ min: number; max: number } | null>(null);
    const [chartHeight, setChartHeight] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [liquidationMarkers, setLiquidationMarkers] = useState<SeriesMarker<Time>[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showWalls, setShowWalls] = useState(true);
    const [hoveredDepth, setHoveredDepth] = useState<{ bids: number, asks: number } | null>(null);

    const [signals, setSignals] = useState<any[]>([]);
    const [externalWalls, setExternalWalls] = useState<any>({ walls: [], intelligence: {} });
    const [macroAlpha, setMacroAlpha] = useState<any[]>([]);

    // Context & Store
    const { status: wsStatus, subscribe, addListener } = useHyperliquidWS();
    const marketData = useMarketStore(state => state.marketData[symbol]);

    const lastCandleRef = useRef<any>(null);
    const pricePrecisionRef = useRef(DEFAULT_PRICE_PRECISION);
    const wallAgeRef = useRef<Map<string, number>>(new Map()); // ex-side-px -> firstSeenTimestamp
    const [persistenceScore, setPersistenceScore] = useState(0);

    const applyPricePrecision = useCallback((precision: number) => {
        const safePrecision = clamp(precision, 2, MAX_PRICE_PRECISION);
        const minMove = Number((1 / Math.pow(10, safePrecision)).toFixed(safePrecision));
        const priceFormat = { type: 'price' as const, precision: safePrecision, minMove };

        pricePrecisionRef.current = safePrecision;
        candlestickSeriesRef.current?.applyOptions({ priceFormat });

        [
            ema50Ref.current,
            ema200Ref.current,
            supertrendRef.current,
            elliotWaveRef.current,
            bbUpperRef.current,
            bbLowerRef.current,
            vwapRef.current,
            sarRef.current,
        ].forEach((series) => {
            series?.applyOptions({ priceFormat });
        });
    }, []);



    // ... (Liquidation fetch effect remains same)

    // 7. Render Positions & Orders & Walls on Chart
    useEffect(() => {
        if (!candlestickSeriesRef.current) return;

        // Clear existing lines
        [...positionLinesRef.current, ...orderLinesRef.current, ...wallSeriesRef.current].forEach(line => {
            // Safe removal check
            try { candlestickSeriesRef.current?.removePriceLine(line); } catch (e) { }
        });
        positionLinesRef.current = [];
        orderLinesRef.current = [];
        wallSeriesRef.current = [];

        // A. Render Open Positions
        if (positions && positions.length > 0) {
            positions.forEach(pos => {
                if (pos.coin === symbol) {
                    const size = parseFloat(pos.size || pos.szi);
                    const entryPrice = parseFloat(pos.entryPx || pos.entryPrice);
                    if (size !== 0) {
                        const isLong = size > 0;
                        const line = candlestickSeriesRef.current?.createPriceLine({
                            price: entryPrice,
                            color: isLong ? COLORS.bullish : COLORS.bearish,
                            lineWidth: 2,
                            lineStyle: LineStyle.Solid,
                            axisLabelVisible: true,
                            title: `${isLong ? 'LONG' : 'SHORT'} ${Math.abs(size)}`,
                        });
                        if (line) positionLinesRef.current.push(line);
                    }
                }
            });
        }

        // B. Render Open Orders
        if (openOrders && openOrders.length > 0) {
            openOrders.forEach(order => {
                if (order.coin === symbol) {
                    const price = parseFloat(order.limitPx || order.price);
                    const size = parseFloat(order.sz || order.size);
                    const isBuy = order.side === 'B' || order.side === 'buy';

                    const line = candlestickSeriesRef.current?.createPriceLine({
                        price: price,
                        color: isBuy ? '#3b82f6' : '#f59e0b', // Blue for Buy, Amber for Sell
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        axisLabelVisible: true,
                        title: `${isBuy ? 'BID' : 'OFFER'} ${size}`,
                    });
                    if (line) orderLinesRef.current.push(line);
                }
            });
        }

        // C. Render Liquidity Walls - REMOVED PER USER REQUEST
        /* 
        if (showWalls && marketData?.walls) {
            marketData.walls.forEach(wall => {
                const px = parseFloat(wall.px);
                const sz = parseFloat(wall.sz);
                const isBid = wall.side === 'bid';

                const line = candlestickSeriesRef.current?.createPriceLine({
                    price: px,
                    color: isBid ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
                    lineWidth: wall.strength === 'massive' ? 2 : 1,
                    lineStyle: LineStyle.Dotted,
                    axisLabelVisible: false,
                    title: `Wall: ${Number(sz).toFixed(0)}`,
                });
                if (line) wallSeriesRef.current.push(line);
            });
        }
        */

    }, [positions, openOrders, marketData?.walls, showWalls, symbol]);

    // ... (Nexus Signals effect remains same)

    // ... (Render Walls effect remains same)

    // 6. Render CVD and Premium



    // Crosshair Depth Intelligence
    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current) return;

        const handleCrosshair = (param: any) => {
            if (!param.point || !marketData?.book) {
                setHoveredDepth(null);
                return;
            }
            const p = candlestickSeriesRef.current?.coordinateToPrice(param.point.y);
            if (p) {
                const range = p * 0.001;
                const bDepth = (marketData.book[0] || []).filter((b: any) => Math.abs(parseFloat(b.px) - p) < range)
                    .reduce((acc: number, b: any) => acc + parseFloat(b.sz) * parseFloat(b.px), 0);
                const aDepth = (marketData.book[1] || []).filter((a: any) => Math.abs(parseFloat(a.px) - p) < range)
                    .reduce((acc: number, a: any) => acc + parseFloat(a.sz) * parseFloat(a.px), 0);
                setHoveredDepth({ bids: bDepth, asks: aDepth });
            }
        };

        chartRef.current.subscribeCrosshairMove(handleCrosshair);
        return () => chartRef.current?.unsubscribeCrosshairMove(handleCrosshair);
    }, [marketData?.book]);

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
                background: { type: ColorType.VerticalGradient, topColor: '#1a1a1a', bottomColor: '#000000' }, // Cyberpunk depth
                textColor: COLORS.textBright,
                fontSize: 11,
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.03)', style: LineStyle.Dotted }, // Subtle dotted grid
                horzLines: { color: 'rgba(255, 255, 255, 0.03)', style: LineStyle.Dotted },
            },
            watermark: {
                color: 'rgba(255, 255, 255, 0.03)',
                visible: true,
                text: 'HYPERSENTRY',
                fontSize: 96,
                horzAlign: 'center',
                vertAlign: 'center',
                fontFamily: "'JetBrains Mono', monospace",
                fontStyle: 'italic',
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
                secondsVisible: true,
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
            visible: true,
        });


        // Initialize indicator series
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

        // RSI Series
        rsiSeriesRef.current = chart.addLineSeries({
            color: '#a855f7', // Purple
            lineWidth: 1,
            priceScaleId: 'rsi',
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
            title: 'RSI(14)'
        });
        chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            borderVisible: false,
            visible: false // Hidden by default, toggled later
        });




        // Candlestick Series LAST
        // Candlestick Series LAST
        const candlestickSeries = chart.addCandlestickSeries({
            upColor: COLORS.bullish,
            downColor: COLORS.bearish,
            borderVisible: false,
            wickUpColor: COLORS.bullish,
            wickDownColor: COLORS.bearish,
            priceLineVisible: true,
            priceLineWidth: 1,
            priceLineColor: COLORS.bullish, // Match last candle
            priceLineStyle: LineStyle.Dotted,
            priceFormat: {
                type: 'price',
                precision: DEFAULT_PRICE_PRECISION,
                minMove: 0.000001,
            },
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        // Configure scales for layout
        // Configure scales for layout
        // Configure scales for layout
        // Main Chart: Top 80%
        chart.priceScale('right').applyOptions({
            scaleMargins: { top: 0.05, bottom: 0.15 },
            autoScale: true,
        });

        // Volume: Bottom 15%
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
            autoScale: true,
        });

        // Resize
        // Resize Observer for Container
        const resizeObserver = new ResizeObserver(() => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
                updateRange();
            }
        });

        if (chartContainerRef.current) {
            resizeObserver.observe(chartContainerRef.current);
        }

        chart.timeScale().subscribeVisibleLogicalRangeChange(() => setTimeout(updateRange, 100));

        // Click to select price
        chart.subscribeClick((param) => {
            if (param.point && onPriceSelect && candlestickSeriesRef.current) {
                const price = candlestickSeriesRef.current.coordinateToPrice(param.point.y);
                if (price) onPriceSelect(price.toFixed(pricePrecisionRef.current));
            }
        });

        return () => {
            resizeObserver.disconnect();
            try {
                chart.remove();
            } catch {
                // Silent cleanup
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
            rsiSeriesRef.current = null;
            lastCandleRef.current = null;
        };
    }, [symbol, updateRange, onPriceSelect]);

    // 2. Fetch Data (Candles)
    useEffect(() => {
        let isActive = true;
        // lastCandleRef.current = null; 

        const fetchData = async () => {
            // Debug log

            setIsLoading(true);
            setError(null);

            try {
                // ... fetch logic ...
                let hlInterval = '15m'; // Default
                if (interval === '1') hlInterval = '1m';
                else if (interval === '3') hlInterval = '3m';
                else if (interval === '5') hlInterval = '5m';
                else if (interval === '15') hlInterval = '15m';
                else if (interval === '30') hlInterval = '30m';
                else if (interval === '60') hlInterval = '1h';
                else if (interval === '120') hlInterval = '2h';
                else if (interval === '240') hlInterval = '4h';
                else if (interval === '480') hlInterval = '8h';
                else if (interval === '720') hlInterval = '12h';
                else if (interval === 'D') hlInterval = '1d';

                // Fetch exactly 200 candles
                const intervalMs = (interval === 'D' ? 1440 : parseInt(interval) || 15) * 60 * 1000;
                const startTime = Date.now() - (200 * intervalMs);

                // Use the API_URL constant
                const url = `${API_URL}/trading/candles`;

                const res = await axios.post(url, {
                    token: symbol,
                    interval: hlInterval,
                    start_time: Math.floor(startTime),
                    end_time: Math.floor(Date.now())
                });


                if (!isActive) return;

                if (isActive && Array.isArray(res.data) && res.data.length > 0) {
                    const formatted = res.data.map((c: any) => ({
                        time: ((c.t || c.time || c.timestamp) / 1000) as UTCTimestamp,
                        open: parseFloat(c.o || c.open),
                        high: parseFloat(c.h || c.high),
                        low: parseFloat(c.l || c.low),
                        close: parseFloat(c.c || c.close),
                        volume: parseFloat(c.v || c.volume || c.vol)
                    }))
                        .filter((c: any) => !isNaN(c.open) && !isNaN(c.close) && !isNaN(c.time)) // Filter bad data
                        .sort((a: any, b: any) => (a.time as number) - (b.time as number));

                    if (formatted.length > 0) {
                        applyPricePrecision(derivePricePrecision(formatted));
                        setCandlesticks(formatted);
                        lastCandleRef.current = formatted[formatted.length - 1];

                        // ISOLATION TEST: Clear all other series to rule out scale interference
                        ema50Ref.current?.setData([]);
                        ema200Ref.current?.setData([]);
                        supertrendRef.current?.setData([]);
                        elliotWaveRef.current?.setData([]);
                        bbUpperRef.current?.setData([]);
                        bbLowerRef.current?.setData([]);
                        vwapRef.current?.setData([]);
                        vwapRef.current?.setData([]);
                        sarRef.current?.setData([]);
                        rsiSeriesRef.current?.setData([]);

                        // Retry loop to ensure Series ref is ready
                        // DEBUG: AREA SERIES
                        // candlestickSeriesRef.current?.setData([]); 

                        // Restore Candlesticks
                        if (candlestickSeriesRef.current) {
                            // Enforce premium style on update
                            candlestickSeriesRef.current.applyOptions({
                                upColor: COLORS.bullish,
                                downColor: COLORS.bearish,
                                borderVisible: false,
                                wickUpColor: COLORS.bullish, // Match body
                                wickDownColor: COLORS.bearish, // Match body
                            });
                            candlestickSeriesRef.current.setData(formatted);
                            // lastCandleRef already set
                        }

                        // Disable candlestick setData to avoid conflict
                        /*
                        if (candlestickSeriesRef.current) {
                            // ...
                        }
                        */

                        // Volume data
                        // Volume data
                        if (volumeSeriesRef.current) {
                            const volumeData = formatted.map((c: any) => ({
                                time: c.time,
                                value: c.volume,
                                color: c.close >= c.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)'
                            }));
                            volumeSeriesRef.current.setData(volumeData);
                        }

                        // Force fit content nicely
                        requestAnimationFrame(() => {
                            if (isActive && chartRef.current) {
                                chartRef.current.timeScale().fitContent();
                                // Reset margins to default for test
                                chartRef.current.priceScale('right').applyOptions({
                                    autoScale: true,
                                    scaleMargins: { top: 0.1, bottom: 0.1 }
                                });
                                updateRange();
                            }
                        });
                    } else {
                        console.warn("Parsed 0 valid candles");
                        setError(`No data for ${symbol} (Parsed 0)`);
                    }
                } else {
                    console.warn("Empty response from API", res.data);
                    setError(`No data for ${symbol} ${hlInterval} (Raw: ${JSON.stringify(res.data).slice(0, 50)})`);
                }
            } catch (e: any) {
                console.error(e);
                setError(`Connection failed: ${e.message}`);
            } finally {
                if (isActive) setIsLoading(false);
            }
        };

        fetchData();
        const intervalId = setInterval(fetchData, 60000);
        return () => {
            isActive = false;
            clearInterval(intervalId);
        };
    }, [symbol, interval, updateRange, applyPricePrecision]);

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
    // Volume visibility
    useEffect(() => {
        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.applyOptions({ visible: activeIndicators.has('Volume') });
        }
    }, [activeIndicators]);

    // Force update range when candlesticks or price updates
    useEffect(() => {
        updateRange();
    }, [candlesticks, currentPrice, updateRange]);

    // 3. Indicator Calculation
    useEffect(() => {
        // return; // DISABLED FOR DEBUG: Isolate candles - RE-ENABLED
        if (candlesticks.length === 0) return;

        // Apply visibility
        ema50Ref.current?.applyOptions({ visible: activeIndicators.has('EMA 50') });
        ema200Ref.current?.applyOptions({ visible: activeIndicators.has('EMA 200') });
        supertrendRef.current?.applyOptions({ visible: activeIndicators.has('Supertrend') });
        elliotWaveRef.current?.applyOptions({ visible: activeIndicators.has('Elliott Wave A-B-C') || activeIndicators.has('Elliot Wave') });
        bbUpperRef.current?.applyOptions({ visible: activeIndicators.has('Bollinger Bands') });
        bbLowerRef.current?.applyOptions({ visible: activeIndicators.has('Bollinger Bands') });
        vwapRef.current?.applyOptions({ visible: activeIndicators.has('VWAP') });
        sarRef.current?.applyOptions({ visible: activeIndicators.has('Parabolic SAR') });

        // RSI Visibility
        const showRSI = activeIndicators.has('RSI');
        if (chartRef.current) {
            chartRef.current.priceScale('rsi').applyOptions({ visible: showRSI });
            // Adjust main chart to make room if RSI is present
            chartRef.current.priceScale('right').applyOptions({
                scaleMargins: { top: 0.05, bottom: showRSI ? 0.25 : 0.05 }
            });
            chartRef.current.priceScale('volume').applyOptions({
                scaleMargins: { top: showRSI ? 0.8 : 0.85, bottom: 0 }
            });
        }
        rsiSeriesRef.current?.applyOptions({ visible: showRSI });

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
        if (activeIndicators.has('Elliott Wave A-B-C') || activeIndicators.has('Elliot Wave')) {
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
        if (activeIndicators.has('RSI')) {
            const rsi = Indicators.calculateRSI(candlesticks, 14);
            // Safety check for data integrity
            const validRsi = rsi.filter(d => !isNaN(d.value)).map(d => ({ time: d.time as UTCTimestamp, value: d.value }));
            rsiSeriesRef.current?.setData(validRsi);
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
        return; // DISABLED: Transparency breaks chart rendering
        /*
        if (!chartRef.current) return;
        const color = bias === 'bullish' ? 'rgba(16, 185, 129, 0.03)' :
            bias === 'bearish' ? 'rgba(239, 68, 68, 0.03)' : 'transparent';
        chartRef.current.applyOptions({
            layout: { background: { type: ColorType.Solid, color: color } }
        });
        */
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

            {/* Liquidity Walls (Order Book Profile) - REMOVED PER USER REQUEST */}
            {/* 
            {!showHeatmap && showWalls && currentPrice > 0 && visibleRange && (
                <div className="absolute inset-0 z-10 pointer-events-none">
                    <OrderBookProfile
                        currentPrice={currentPrice}
                        symbol={symbol}
                        height={chartHeight}
                        maxPrice={visibleRange.max}
                        minPrice={visibleRange.min}
                        levels={{ bids: marketData?.book?.[0] || [], asks: marketData?.book?.[1] || [] }}
                    />
                </div>
            )}
            */}

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

            {/* Active Indicators Legend - Balanced Visibility */}
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 pointer-events-none text-left opacity-70 group-hover:opacity-100 transition-opacity duration-500">
                {Array.from(activeIndicators || []).map(ind => (
                    <div key={ind} className="flex items-center gap-2 px-1 py-0.5 text-[9px] font-mono text-gray-300">
                        <span className={`w-1.5 h-1.5 rounded-full ${ind === 'EMA 50' ? 'bg-indigo-400' :
                            ind === 'EMA 200' ? 'bg-purple-400' :
                                ind === 'Supertrend' ? 'bg-emerald-400' :
                                    ind === 'VWAP' ? 'bg-blue-500' :
                                        ind === 'Bollinger Bands' ? 'bg-blue-400/50' :
                                            'bg-yellow-500'
                            }`} />
                        <span className="tracking-tight uppercase shadow-black drop-shadow-md">{ind}</span>
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

            {/* Institutional Depth Crosshair HUD */}
            {hoveredDepth && (
                <div className="absolute left-[80px] top-[120px] pointer-events-none z-[60] flex flex-col gap-1 p-2 bg-black/60 border border-white/10 rounded-md backdrop-blur-md animate-in fade-in zoom-in duration-200 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">Agg. Liquidity Zone</span>
                        <div className="flex gap-2">
                            <span className="text-[10px] font-mono text-emerald-400">+${(hoveredDepth.bids / 1000).toFixed(1)}k</span>
                            <span className="text-[10px] font-mono text-rose-400">-${(hoveredDepth.asks / 1000).toFixed(1)}k</span>
                        </div>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                        <div
                            className="h-full bg-emerald-500/50"
                            style={{ width: `${(hoveredDepth.bids / (hoveredDepth.bids + hoveredDepth.asks + 0.1)) * 100}%` }}
                        />
                        <div
                            className="h-full bg-rose-500/50"
                            style={{ width: `${(hoveredDepth.asks / (hoveredDepth.bids + hoveredDepth.asks + 0.1)) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Overwatch Signal Center (Enhanced with Smart Interpretation) */}
            <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[60] pointer-events-none w-[320px]">
                {signals.map((sig, idx) => (
                    <Link
                        key={sig.id || idx}
                        href="/intel/microstructure"
                        className={`p-4 rounded-xl border-2 shadow-[0_0_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl animate-bounce-subtle flex flex-col gap-2 transition-all duration-700 pointer-events-auto group cursor-help no-underline ${sig.type === 'BEARISH' || sig.strength === 'CRITICAL' ? 'bg-rose-500/10 border-rose-500/40' : 'bg-emerald-500/10 border-emerald-500/40'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg shadow-lg ${sig.type === 'BEARISH' || sig.strength === 'CRITICAL' ? 'bg-rose-500' : 'bg-emerald-500 shadow-emerald-500/50'}`}>
                                {sig.strength === 'CRITICAL' ? <ShieldAlert className="w-5 h-5 text-white" /> : <Zap className="w-5 h-5 text-white" />}
                            </div>
                            <div className="flex flex-col text-left">
                                <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${sig.type === 'BEARISH' || sig.strength === 'CRITICAL' ? 'text-rose-400' : 'text-emerald-400'}`}>
                                    NEXUS {sig.type}
                                </span>
                                <span className="text-[13px] font-black text-white leading-tight">
                                    {sig.msg}
                                </span>
                            </div>
                        </div>
                        {sig.desc && (
                            <div className="mt-1 p-2 bg-white/5 rounded-lg border border-white/10 group-hover:bg-white/10 transition-colors">
                                <div className="flex items-start gap-2">
                                    <Binary className="w-3 h-3 text-gray-500 mt-0.5 shrink-0" />
                                    <span className="text-[11px] text-gray-300 font-medium leading-relaxed italic text-left">
                                        &quot;{sig.desc}&quot;
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 bg-white/10 flex-1 rounded-full overflow-hidden">
                                <div className={`h-full animate-pulse ${sig.type === 'BEARISH' ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: '100%' }} />
                            </div>
                            <span className="text-[8px] font-mono text-gray-500 uppercase">Live Intel</span>
                        </div>
                    </Link>
                ))}
            </div>

            {/* Smart Nexus Intel Pill - Cycling News & Prediction Snippets */}
            <IntelTicker onNavigate={onNavigate} />

            {/* Chart Controls */}
            <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 p-1 transition-all duration-300 ${isToolbarCollapsed ? 'bg-black/40 backdrop-blur-sm border border-white/5 rounded-full px-2' : 'bg-black/70 border border-white/10 rounded-xl backdrop-blur-md shadow-2xl'}`}>
                {!isToolbarCollapsed && (
                    <>
                        <button onClick={handleScrollLeft} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Scroll Left">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button onClick={handleZoomOut} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Zoom Out">
                            <ZoomOut className="w-4 h-4" />
                        </button>
                        <button onClick={handleReset} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Reset">
                            <RotateCcw className="w-4 h-4" />
                        </button>
                        <button onClick={handleZoomIn} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Zoom In">
                            <ZoomIn className="w-4 h-4" />
                        </button>
                        <button onClick={handleScrollRight} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Scroll Right">
                            <ChevronRight className="w-4 h-4" />
                        </button>

                        <div className="w-px h-4 bg-white/10 mx-1" />

                        <button
                            onClick={() => setShowWalls(!showWalls)}
                            className={`p-2 rounded-lg transition-colors ${showWalls ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-gray-400'}`}
                            title="Toggle Liquidity Walls"
                        >
                            <Target className="w-4 h-4" />
                        </button>



                        <div className="w-px h-4 bg-white/10 mx-1" />

                        {/* Wall Gravity Intelligence */}
                        {showWalls && externalWalls.intelligence && (
                            <div className="px-3 py-1 bg-black/40 rounded-lg flex flex-col">
                                <span className="text-[7px] text-gray-500 uppercase font-bold tracking-widest">Wall Gravity</span>
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-mono font-bold ${externalWalls.intelligence.bid_gravity > externalWalls.intelligence.ask_gravity ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {externalWalls.intelligence.bid_gravity?.toFixed(1) || 0} / {externalWalls.intelligence.ask_gravity?.toFixed(1) || 0}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Persistence Score */}
                        {persistenceScore > 0 && (
                            <div className="px-3 py-1 bg-black/40 rounded-lg flex flex-col">
                                <span className="text-[7px] text-gray-500 uppercase font-bold tracking-widest">Confidence</span>
                                <span className={`text-[10px] font-mono font-bold ${persistenceScore > 80 ? 'text-emerald-400' : persistenceScore > 40 ? 'text-yellow-400' : 'text-rose-400'}`}>
                                    {persistenceScore}%
                                </span>
                            </div>
                        )}

                        {/* Macro Alpha Bypass Overlay */}
                        {showWalls && macroAlpha.length > 0 && (
                            <div
                                onClick={() => {
                                    const targetUrl = macroAlpha[0].url || 'https://polymarket.com';
                                    const proxyUrl = `${API_URL}/intel/proxy?url=${encodeURIComponent(targetUrl)}`;
                                    window.open(proxyUrl, '_blank');
                                }}
                                className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-lg mx-1 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.1)] cursor-help group"
                                title="Click to verify source via Institutional Proxy Tunnel"
                            >
                                <div className="flex flex-col text-left">
                                    <span className="text-[7px] text-red-500 uppercase font-black tracking-widest flex items-center gap-1">
                                        Macro Risk Pulse
                                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[6px] text-red-400 bg-red-500/10 px-1 rounded">VERIFY SOURCE</span>
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-black text-white whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]">
                                            {macroAlpha[0].title.replace('Prediction: ', '')}
                                        </span>
                                        <span className="text-[11px] font-mono text-red-400 font-bold">
                                            {macroAlpha[0].metadata?.probability.toFixed(1)}% YES
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                            title="Fullscreen"
                        >
                            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>

                        <div className="w-px h-4 bg-white/10 mx-1" />

                        <Link
                            href="/intel/microstructure"
                            className="p-2 rounded-lg hover:bg-emerald-500/20 text-emerald-400 transition-colors flex items-center gap-1.5"
                            title="Open Institutional Microstructure Dashboard"
                        >
                            <Binary className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-tighter">Micro-IQ</span>
                        </Link>

                        <div className="w-px h-4 bg-white/10 mx-1" />
                    </>
                )}

                {/* Collapse/Expand Logic */}
                <button
                    onClick={() => setIsToolbarCollapsed(!isToolbarCollapsed)}
                    className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    title={isToolbarCollapsed ? "Show Controls" : "Hide Controls"}
                >
                    {isToolbarCollapsed ? <Settings className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
            </div>

            {/* Liquidation Marker Legend */}
            {liquidationMarkers.length > 0 && (
                <div className="absolute bottom-4 right-4 z-30 flex items-center gap-3 px-3 py-1.5 bg-black/60 border border-white/10 rounded-lg text-[9px]">
                    <div className="flex items-center gap-1.5">
                        <span className="text-red-400">💀</span>
                        <span className="text-gray-400 text-left">Long Liquidation</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-teal-400">💀</span>
                        <span className="text-gray-400 text-left">Short Liquidation</span>
                    </div>
                </div>
            )}
        </div>
    );
}

function IntelTicker({ onNavigate }: { onNavigate?: (tab: string) => void }) {
    const [index, setIndex] = useState(0);
    const [items, setItems] = useState<any[]>([]);

    useEffect(() => {
        const fetchTicker = async () => {
            try {
                const res = await axios.get(`${API_URL}/intel/ticker`);
                if (Array.isArray(res.data) && res.data.length > 0) {
                    setItems(res.data);
                }
            } catch (e) {
                // Silent fail for ticker
            }
        };

        fetchTicker();
        const poll = setInterval(fetchTicker, 30000);
        return () => clearInterval(poll);
    }, []);

    useEffect(() => {
        if (items.length <= 1) return;
        const interval = setInterval(() => {
            setIndex((prev) => (prev + 1) % items.length);
        }, 5000); // Cycle every 5 seconds
        return () => clearInterval(interval);
    }, [items.length]);

    if (items.length === 0) return null;

    const item = items[index % items.length];

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40">
            <button
                onClick={() => onNavigate && onNavigate(item.type === 'news' ? 'news' : 'predictions')}
                className="flex items-center gap-3 px-4 py-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-full hover:bg-white/5 hover:border-white/20 transition-all group shadow-xl"
            >
                <div className={`p-1 rounded-full ${item.type === 'news' ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
                    {item.type === 'news' ? (
                        <Zap className={`w-3 h-3 ${item.type === 'news' ? 'text-blue-400' : 'text-purple-400'}`} />
                    ) : (
                        <Target className="w-3 h-3 text-purple-400" />
                    )}
                </div>
                <div className="flex flex-col items-start min-w-[200px]">
                    <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-2">
                        {item.type === 'news' ? '' : 'Polymarket Pulse'}
                        <span className={`w-1 h-1 rounded-full ${item.sentiment === 'bullish' ? 'bg-emerald-500' : item.sentiment === 'bearish' ? 'bg-red-500' : 'bg-gray-500'}`} />
                    </span>
                    <span className="text-[11px] text-gray-200 font-medium truncate max-w-[250px]">
                        {item.text}
                    </span>
                </div>
                <div className="w-px h-6 bg-white/10 mx-1" />
                <ChevronRight className="w-3 h-3 text-gray-600 group-hover:text-white transition-colors" />
            </button>
        </div>
    );
}

export default dynamic(() => Promise.resolve(memo(AdvancedChart)), { ssr: false });
