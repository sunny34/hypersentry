'use client';
import { useState, useEffect } from 'react';
import { Activity, Wifi, WifiOff, Zap, Clock, TrendingUp, TrendingDown, Command, Thermometer } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface StatusBarProps {
    isWsConnected: boolean;
    tokens: Array<{ symbol: string; price: number; change24h: number }>;
    isAgentActive: boolean;
    onOpenCommandPalette: () => void;
}

export default function StatusBar({ isWsConnected, tokens, isAgentActive, onOpenCommandPalette }: StatusBarProps) {
    const [time, setTime] = useState<string>('');
    const [latency, setLatency] = useState<number>(0);
    const [pulse, setPulse] = useState<{ score: number; label: string } | null>(null);

    // Update time every second
    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            setTime(now.toLocaleTimeString('en-US', {
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

    // Fetch Global Pulse
    useEffect(() => {
        const fetchPulse = async () => {
            try {
                const res = await axios.get(`${API_URL}/intel/pulse`);
                if (res.data) setPulse(res.data);
            } catch { }
        };
        fetchPulse();
        const interval = setInterval(fetchPulse, 10000); // Check pulse every 10s
        return () => clearInterval(interval);
    }, []);

    // Simulate latency measurement
    useEffect(() => {
        const measureLatency = () => {
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
        if (!price) return '0.00';
        if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        if (price >= 1) return price.toFixed(2);
        return price.toFixed(4);
    };

    const getPulseColor = (score: number) => {
        if (score >= 70) return 'text-emerald-400'; // Extreme Greed
        if (score >= 60) return 'text-green-400';
        if (score <= 30) return 'text-red-400'; // Extreme Fear
        if (score <= 40) return 'text-orange-400';
        return 'text-gray-400'; // Neutral
    };

    return (
        <footer className="h-7 bg-[#050505] border-t border-white/5 flex items-center justify-between px-3 select-none z-50 relative">
            {/* Left: Connection Status & Pulse */}
            <div className="flex items-center gap-4">
                {/* Connection Indicator */}
                <div className="flex items-center gap-1.5">
                    {isWsConnected ? (
                        <>
                            <Wifi className="w-3 h-3 text-emerald-400" />
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider hidden sm:inline">Connected</span>
                        </>
                    ) : (
                        <WifiOff className="w-3 h-3 text-red-400" />
                    )}
                </div>

                {/* Global Pulse (New) */}
                {pulse && (
                    <div className="flex items-center gap-2 pl-3 border-l border-white/10">
                        <Thermometer className={`w-3 h-3 ${getPulseColor(pulse.score)}`} />
                        <span className={`text-[9px] font-black uppercase tracking-wider ${getPulseColor(pulse.score)}`}>
                            MARKET {pulse.label.toUpperCase()} ({pulse.score})
                        </span>
                    </div>
                )}

                {/* Agent Status */}
                <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/5 border border-white/5 ml-2">
                    <Zap className={`w-3 h-3 ${isAgentActive ? 'text-emerald-400' : 'text-amber-500'}`} />
                    <span className={`text-[9px] font-black uppercase tracking-wider ${isAgentActive ? 'text-emerald-400' : 'text-amber-500'}`}>
                        {isAgentActive ? '1-Click Active' : '1-Click Off'}
                    </span>
                </div>
            </div>

            {/* Center: Live Prices */}
            <div className="flex items-center gap-4">
                {btc && (
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-gray-500">BTC</span>
                        <span className="text-[10px] font-mono font-bold text-gray-300">${formatPrice(btc.price)}</span>
                        <span className={`text-[9px] font-mono font-bold hidden sm:flex items-center ${btc.change24h >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {btc.change24h >= 0 ? '+' : ''}{btc.change24h.toFixed(2)}%
                        </span>
                    </div>
                )}

                <div className="hidden sm:block w-px h-3 bg-white/10" />

                {eth && (
                    <div className="hidden sm:flex items-center gap-2">
                        <span className="text-[9px] font-black text-gray-500">ETH</span>
                        <span className="text-[10px] font-mono font-bold text-gray-300">${formatPrice(eth.price)}</span>
                        <span className={`text-[9px] font-mono font-bold flex items-center ${eth.change24h >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {eth.change24h >= 0 ? '+' : ''}{eth.change24h.toFixed(2)}%
                        </span>
                    </div>
                )}

                {sol && (
                    <>
                        <div className="hidden md:block w-px h-3 bg-white/10" />
                        <div className="hidden md:flex items-center gap-2">
                            <span className="text-[9px] font-black text-gray-500">SOL</span>
                            <span className="text-[10px] font-mono font-bold text-gray-300">${formatPrice(sol.price)}</span>
                            <span className={`text-[9px] font-mono font-bold flex items-center ${sol.change24h >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {sol.change24h >= 0 ? '+' : ''}{sol.change24h.toFixed(2)}%
                            </span>
                        </div>
                    </>
                )}
            </div>

            {/* Right: Quick Actions & Time */}
            <div className="flex items-center gap-4">
                {/* Latency */}
                <div className="hidden lg:flex items-center gap-1 text-[9px]">
                    <span className={`font-mono font-bold ${latency < 20 ? 'text-emerald-500' : 'text-yellow-500'}`}>
                        {latency}ms
                    </span>
                </div>

                {/* Command Palette Shortcut */}
                <button
                    onClick={onOpenCommandPalette}
                    className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                >
                    <Command className="w-3 h-3 text-gray-500" />
                </button>

                {/* Time */}
                <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-gray-600" />
                    <span className="text-[9px] font-mono font-bold text-gray-400">{time}</span>
                </div>
            </div>
        </footer>
    );
}
