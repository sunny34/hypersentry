'use client';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw, Sparkles, BarChart2, UserCheck, Zap, Clock } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface AIAnalysisProps {
    symbol: string;
    interval?: string;
    positionContext?: any; // Position details
    onClosePosition?: (pos: any) => void;
    onAnalysisUpdate?: (analysis: Analysis) => void;
}

/**
 * Interface representing the structured AI analysis response.
 */
interface Analysis {
    /** Recommended directional bias */
    direction: 'long' | 'short' | 'neutral' | 'close';
    /** AI Confidence score (0-100) */
    confidence: number;
    /** Human-readable rationale for the recommended action */
    reasoning: string;
    /** Standard technical indicator readings used in the model */
    indicators: {
        rsi: number;
        macd_signal: 'bullish' | 'bearish' | 'neutral';
        trend: 'up' | 'down' | 'sideways';
    };
    /** Dynamic Insider Signals from Order Book */
    insider_signals?: {
        spoofing: string;
        whale_bias: string;
    };
    /** Unix timestamp of the analysis generation */
    timestamp: number;
}

/**
 * AIAnalysis Component
 * 
 * Fetches and displays institutional-grade market analysis powered by Gemini 2.0.
 * Dynamically adjusts recommendations based on current market data and user's open positions.
 */
export default function AIAnalysis({ symbol, interval = "60", positionContext, onClosePosition, onAnalysisUpdate }: AIAnalysisProps) {
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Re-fetch the AI analysis based on the current symbol and context.
     */
    const fetchAnalysis = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const res = await axios.post(`${API_URL}/trading/analyze`, {
                token: symbol,
                interval: interval,
                position: positionContext
            });
            setAnalysis(res.data);
            if (onAnalysisUpdate) onAnalysisUpdate(res.data);
        } catch {
            // Silently handle - set error state for UI
            setError('Intelligence Node Offline');
        } finally {
            setIsLoading(false);
        }
    }, [symbol, interval, positionContext, onAnalysisUpdate]);

    // Auto-trigger analysis when critical context shifts
    useEffect(() => {
        void fetchAnalysis();
    }, [fetchAnalysis]);

    const getDirectionColor = (dir: string) => {
        switch (dir) {
            case 'long': return 'text-emerald-400';
            case 'short': return 'text-red-400';
            case 'close': return 'text-amber-400';
            default: return 'text-gray-400';
        }
    };

    const getDirectionIcon = (dir: string) => {
        switch (dir) {
            case 'long': return <TrendingUp className="w-8 h-8" />;
            case 'short': return <TrendingDown className="w-8 h-8" />;
            case 'close': return <Minus className="w-8 h-8 rotate-90" />;
            default: return <Minus className="w-8 h-8" />;
        }
    };

    return (
        <div className="space-y-4">
            {/* Intel Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg transition-all ${isLoading ? 'bg-purple-500/20 animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.4)]' : 'bg-purple-500/10'}`}>
                        <Brain className={`w-5 h-5 ${isLoading ? 'text-purple-300' : 'text-purple-400'}`} />
                    </div>
                    <div className="flex flex-col">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-white/90">{isLoading ? 'Synthesizing Market...' : 'AI Intelligence'}</h3>
                        <span className="text-[7px] text-gray-500 font-bold uppercase tracking-tighter">Engine: Gemini 2.0 Flash</span>
                    </div>
                </div>
                <button
                    onClick={fetchAnalysis}
                    disabled={isLoading}
                    title="Refresh Intelligence"
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition disabled:opacity-50 group"
                >
                    <RefreshCw className={`w-4 h-4 text-gray-400 group-hover:text-white ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="text-[10px] font-black uppercase tracking-widest text-amber-500 bg-amber-500/5 px-3 py-2 rounded-lg border border-amber-500/20 flex items-center gap-2 animate-in fade-in transition-all">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    {error}
                </div>
            )}

            {analysis && (
                <>
                    {/* Confidence Visualizer */}
                    <div className="relative p-5 rounded-2xl bg-black/40 border border-white/5 overflow-hidden group shadow-2xl">
                        <div className={`absolute inset-0 opacity-10 blur-3xl transition-colors duration-1000 ${getDirectionColor(analysis.direction).replace('text-', 'bg-')}`} />

                        <div className="relative flex flex-col items-center gap-3">
                            <div className={`p-4 rounded-full bg-white/5 border border-white/10 ${getDirectionColor(analysis.direction)} shadow-[0_0_30px_rgba(255,255,255,0.05)] transition-all duration-700`}>
                                {getDirectionIcon(analysis.direction)}
                            </div>

                            <div className="text-center">
                                <span className={`text-3xl font-black uppercase tracking-tighter ${getDirectionColor(analysis.direction)}`}>
                                    {analysis.direction}
                                </span>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] mt-1 opacity-60">Consensus Suggestion</p>
                            </div>

                            {/* Conviction Gauge */}
                            <div className="w-full mt-2 h-1 bg-gray-800 rounded-full overflow-hidden border border-white/5">
                                <div
                                    className={`h-full transition-all duration-1000 ease-out shadow-[0_0_10px_currentColor] ${getDirectionColor(analysis.direction).replace('text-', 'bg-')}`}
                                    style={{ width: `${analysis.confidence}%` }}
                                />
                            </div>
                            <div className="flex justify-between w-full px-1">
                                <span className="text-[8px] text-gray-600 font-black uppercase tracking-widest">Confidence</span>
                                <span className="text-[10px] text-white font-mono font-black">{analysis.confidence}%</span>
                            </div>
                        </div>
                    </div>

                    {/* Logic Overlay */}
                    <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl relative overflow-hidden group hover:bg-white/[0.05] transition-colors">
                        <div className={`absolute top-0 left-0 w-1 h-full transition-colors duration-1000 ${getDirectionColor(analysis.direction).replace('text-', 'bg-')}`} />
                        <p className="text-[11px] text-gray-300 leading-relaxed font-bold italic tracking-tight">
                            &quot;{analysis.reasoning}&quot;
                        </p>
                    </div>

                    {/* Intelligent Liquidation CTA */}
                    {analysis.direction === 'close' && positionContext && onClosePosition && (
                        <button
                            onClick={() => onClosePosition({ position: positionContext })}
                            className="w-full py-4 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-[0.3em] rounded-2xl transition-all shadow-[0_0_40px_rgba(220,38,38,0.4)] flex items-center justify-center gap-3 active:scale-[0.98] animate-pulse"
                        >
                            <Zap className="w-3.5 h-3.5 fill-current" />
                            Terminate Position Now
                        </button>
                    )}

                    {/* Insider Intel Hub */}
                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden relative">
                        <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Insider Context</span>
                            </div>
                            <span className="text-[8px] font-bold text-gray-600 uppercase">Proprietary Flow</span>
                        </div>

                        <div className="space-y-2.5">
                            <div className="flex items-start gap-3 p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                                <UserCheck className="w-4 h-4 text-blue-400 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-[10px] text-gray-400 leading-snug">
                                        <span className="text-white font-black uppercase tracking-tighter">Wall Detect:</span> {analysis.insider_signals?.spoofing || "Scanning L2 Order Book..."}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3 p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                                <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-[10px] text-gray-400 leading-snug">
                                        <span className="text-white font-black uppercase tracking-tighter">Whale Bias:</span> {analysis.insider_signals?.whale_bias || "Calculating Taker Flow..."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Real-Time Metrics */}
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { label: 'RSI', val: analysis.indicators.rsi.toFixed(1), col: analysis.indicators.rsi > 70 ? 'text-red-400' : analysis.indicators.rsi < 30 ? 'text-emerald-400' : 'text-gray-300' },
                            { label: 'MACD', val: analysis.indicators.macd_signal, col: analysis.indicators.macd_signal === 'bullish' ? 'text-emerald-400' : analysis.indicators.macd_signal === 'bearish' ? 'text-red-400' : 'text-gray-300' },
                            { label: 'Trend', val: analysis.indicators.trend, col: analysis.indicators.trend === 'up' ? 'text-emerald-400' : analysis.indicators.trend === 'down' ? 'text-red-400' : 'text-gray-300' }
                        ].map((m, i) => (
                            <div key={i} className="p-2.5 bg-white/[0.02] border border-white/5 rounded-xl text-center group hover:bg-white/[0.04] transition-colors">
                                <div className="text-[8px] text-gray-600 font-black uppercase tracking-widest mb-1">{m.label}</div>
                                <div className={`text-[10px] font-black uppercase transition-colors ${m.col}`}>
                                    {m.val}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Sync Status */}
                    <div className="flex items-center justify-center gap-1.5 opacity-40">
                        <Clock className="w-2.5 h-2.5 text-gray-500" />
                        <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest">
                            Intelligence Synced {new Date(analysis.timestamp).toLocaleTimeString()}
                        </span>
                    </div>
                </>
            )}

            {isLoading && !analysis && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <RefreshCw className="w-6 h-6 animate-spin text-purple-500/20" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-600">Syncing Intelligence...</span>
                </div>
            )}
        </div>
    );
}
