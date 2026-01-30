'use client';
import { useEffect, useRef, memo } from 'react';

interface ChartWidgetProps {
    symbol: string;
    interval?: string;
}

// Map internal symbols to TradingView symbols
const SYMBOL_MAP: Record<string, string> = {
    'BTC': 'BINANCE:BTCUSDT',
    'ETH': 'BINANCE:ETHUSDT',
    'SOL': 'BINANCE:SOLUSDT',
    'HYPE': 'PYTH:HYPEUSD', // Fallback or find a valid source
    'PURR': 'BINANCE:BTCUSDT', // Fallback for unknown
};

function ChartWidget({ symbol, interval = "60" }: ChartWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const tvScriptLoadingPromise = useRef<Promise<void> | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const tvSymbol = SYMBOL_MAP[symbol] || `BINANCE:${symbol}USDT`;

        const loadScript = () => {
            if (!tvScriptLoadingPromise.current) {
                tvScriptLoadingPromise.current = new Promise((resolve) => {
                    const script = document.createElement('script');
                    script.id = 'tradingview-widget-loading-script';
                    script.src = 'https://s3.tradingview.com/tv.js';
                    script.type = 'text/javascript';
                    script.onload = () => resolve();
                    document.head.appendChild(script);
                });
            }
            return tvScriptLoadingPromise.current;
        };

        const createWidget = () => {
            if (containerRef.current && 'TradingView' in window) {
                const widgetOptions: any = {
                    autosize: true,
                    symbol: tvSymbol,
                    interval: interval,
                    timezone: "Etc/UTC",
                    theme: "dark",
                    style: "1",
                    locale: "en",
                    toolbar_bg: "#f1f3f6", // Ignored in dark mode usually
                    enable_publishing: false,
                    allow_symbol_change: true,
                    // valid container_id can be passed, but the library also accepts the element itself if supported,
                    // OR we must ensure we pass the ID. The standard copy-paste uses an ID.
                    container_id: containerRef.current.id,
                    hide_side_toolbar: false,
                    disabled_features: [
                        "header_symbol_search",
                        "header_resolutions",
                        "header_compare",
                    ],
                    studies: [
                        "RSI@tv-basicstudies",
                        "MACD@tv-basicstudies"
                    ]
                };

                new (window as any).TradingView.widget(widgetOptions);
            }
        };

        if (document.getElementById('tradingview-widget-loading-script')) {
            // Script already exists or loading, just wait or check global
            if ('TradingView' in window) {
                createWidget();
            } else {
                // Retry slightly later if script tag exists but object doesn't
                const intervalId = setInterval(() => {
                    if ('TradingView' in window) {
                        clearInterval(intervalId);
                        createWidget();
                    }
                }, 100);
            }
        } else {
            loadScript().then(createWidget);
        }

    }, [symbol, interval]);

    return (
        <div className='tradingview-widget-container w-full h-full rounded-2xl overflow-hidden'>
            <div id={`tradingview_widget_${symbol}`} ref={containerRef} className="w-full h-full" />
        </div>
    );
}

export default memo(ChartWidget);
