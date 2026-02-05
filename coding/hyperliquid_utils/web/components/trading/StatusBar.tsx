'use client';
import { useState, useEffect } from 'react';
import { Activity, Wifi, WifiOff, Zap, Clock, TrendingUp, TrendingDown, Command } from 'lucide-react';

interface StatusBarProps {
    isWsConnected: boolean;
    tokens: Array<{ symbol: string; price: number; change24h: number }>;
    onOpenCommandPalette: () => void;
}

/**
 * StatusBar Component
 * 
 * Inspired by Hyperdash's slim footer status bar.
 * Shows live BTC/ETH prices, connection status, and quick actions.
 */
export default function StatusBar({ isWsConnected, tokens, onOpenCommandPalette }: StatusBarProps) {
    const [time, setTime] = useState<string>('');
    const [latency, setLatency] = useState<number>(0);

    // Update time every second
    useEffect(() => {
        const updateTime = () => {
            setTime(new Date().toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }));
        };
        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, []);

    // Simulate latency measurement
    useEffect(() => {
        const measureLatency = () => {
            const start = performance.now();
            // Simulate network check
            setTimeout(() => {
                setLatency(Math.floor(Math.random() * 30) + 5);
            }, 100);
        };
        measureLatency();
        const interval = setInterval(measureLatency, 10000);
        return () => clearInterval(interval);
    }, []);

    const btc = tokens.find(t => t.symbol === 'BTC');
    const eth = tokens.find(t => t.symbol === 'ETH');
    const sol = tokens.find(t => t.symbol === 'SOL');

    const formatPrice = (price: number) => {
        if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        if (price >= 1) return price.toFixed(2);
        return price.toFixed(4);
    };

    return (
        <footer className="h-7 bg-[#050505] border-t border-white/5 flex items-center justify-between px-3 select-none">
            {/* Left: Connection Status */}
            <div className="flex items-center gap-4">
                {/* Connection Indicator */}
                <div className="flex items-center gap-1.5">
                    {isWsConnected ? (
                        <>
                            <Wifi className="w-3 h-3 text-emerald-400" />
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Connected</span>
                        </>
                    ) : (
                        <>
                            <WifiOff className="w-3 h-3 text-red-400" />
                            <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">Disconnected</span>
                        </>
                    )}
                </div>

                {/* Latency */}
                <div className="flex items-center gap-1 text-[9px]">
                    <Zap className={`w-3 h-3 ${latency < 20 ? 'text-emerald-400' : latency < 50 ? 'text-yellow-400' : 'text-red-400'}`} />
                    <span className={`font-mono font-bold ${latency < 20 ? 'text-emerald-400' : latency < 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {latency}ms
                    </span>
                </div>

                {/* Node Status */}
                <div className="hidden sm:flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_6px_#60a5fa]" />
                    <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">L1 Synced</span>
                </div>
            </div>

            {/* Center: Live Prices */}
            <div className="flex items-center gap-4">
                {btc && (
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-gray-400">BTC</span>
                        <span className="text-[10px] font-mono font-bold text-white">${formatPrice(btc.price)}</span>
                        <span className={`text-[9px] font-mono font-bold flex items-center ${btc.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {btc.change24h >= 0 ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                            {btc.change24h >= 0 ? '+' : ''}{btc.change24h.toFixed(2)}%
                        </span>
                    </div>
                )}

                <div className="w-px h-3 bg-white/10" />

                {eth && (
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-gray-400">ETH</span>
                        <span className="text-[10px] font-mono font-bold text-white">${formatPrice(eth.price)}</span>
                        <span className={`text-[9px] font-mono font-bold flex items-center ${eth.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {eth.change24h >= 0 ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                            {eth.change24h >= 0 ? '+' : ''}{eth.change24h.toFixed(2)}%
                        </span>
                    </div>
                )}

                {sol && (
                    <>
                        <div className="w-px h-3 bg-white/10" />
                        <div className="hidden md:flex items-center gap-2">
                            <span className="text-[9px] font-black text-gray-400">SOL</span>
                            <span className="text-[10px] font-mono font-bold text-white">${formatPrice(sol.price)}</span>
                            <span className={`text-[9px] font-mono font-bold flex items-center ${sol.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {sol.change24h >= 0 ? '+' : ''}{sol.change24h.toFixed(2)}%
                            </span>
                        </div>
                    </>
                )}
            </div>

            {/* Right: Quick Actions & Time */}
            <div className="flex items-center gap-4">
                {/* Command Palette Shortcut */}
                <button
                    onClick={onOpenCommandPalette}
                    className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                >
                    <Command className="w-3 h-3 text-gray-500" />
                    <span className="text-[9px] font-bold text-gray-500">K</span>
                </button>

                {/* Time */}
                <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-gray-600" />
                    <span className="text-[9px] font-mono font-bold text-gray-400">{time}</span>
                    <span className="text-[8px] text-gray-600 uppercase">UTC</span>
                </div>

                {/* Engine Status */}
                <div className="hidden lg:flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-purple-400 animate-pulse" />
                    <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">AI Engine</span>
                </div>
            </div>
        </footer>
    );
}
