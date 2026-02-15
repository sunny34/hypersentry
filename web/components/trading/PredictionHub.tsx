'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Target, Zap, Globe, Shield, ExternalLink, RefreshCw, ChevronLeft, Lock } from 'lucide-react';
import axios from 'axios';

interface Prediction {
    id: string;
    title: string;
    content: string;
    url: string;
    timestamp: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    is_high_impact?: boolean;
    metadata: {
        probability: number;
        event_id: string;
        market_id: string;
        type: string;
        category?: string;
        volume?: number;
        is_locked?: boolean;
    }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

import { useAuth } from '@/contexts/AuthContext';

export default function PredictionHub({ onBack }: { onBack?: () => void }) {
    const { token, isAuthenticated, login } = useAuth();
    const [markets, setMarkets] = useState<Prediction[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchMarkets = useCallback(async () => {
        try {
            setLoading(true);
            const headers: any = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
            const res = await axios.get(`${API_URL}/intel/predictions`, { headers });
            setMarkets(res.data);
        } catch (e) {
            console.error("Failed to fetch predictions", e);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        void fetchMarkets();
        const interval = setInterval(fetchMarkets, 30000);
        return () => clearInterval(interval);
    }, [fetchMarkets]);

    return (
        <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors border border-white/5"
                            title="Back to Terminal"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                    )}
                    <div className="flex items-center gap-3 pl-1">
                        <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/30">
                            <Target className="w-4 h-4 text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-widest text-white">Macro Intelligence Brief</h2>
                            <p className="text-[10px] text-gray-500 font-medium">Global Volatility Signals & Prediction Market Odds</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Live Odds</span>
                    </div>
                    <button
                        onClick={fetchMarkets}
                        disabled={loading}
                        className="p-2 text-gray-500 hover:text-white transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {markets.map((market) => (
                        <div
                            key={market.id}
                            className={`group relative bg-[#0a0a0a] border rounded-2xl overflow-hidden transition-all duration-500 flex flex-col ${market.is_high_impact ? 'border-amber-500/40 bg-amber-500/[0.02] shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'border-white/5 hover:border-purple-500/30'}`}
                        >
                            {/* Accent Glow */}
                            <div className={`absolute top-0 left-0 w-full h-1 ${market.is_high_impact ? 'bg-amber-500' : market.sentiment === 'bullish' ? 'bg-emerald-500/50' : 'bg-rose-500/50'}`} />

                            <div className="p-5 flex flex-col h-full">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-2">
                                        <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border ${market.metadata.category === 'Geo-Political' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                            market.metadata.category === 'Economics' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                            }`}>
                                            {market.metadata.category || 'Macro'}
                                        </div>
                                        {market.is_high_impact && (
                                            <div className="px-2 py-0.5 rounded bg-amber-500 text-black text-[8px] font-black uppercase tracking-widest animate-pulse">
                                                Suspicious Activity
                                            </div>
                                        )}
                                    </div>
                                    <a href={market.url} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-white transition-colors">
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                </div>

                                <h3 className={`text-xs font-black leading-tight mb-2 transition-colors ${market.is_high_impact ? 'text-amber-200' : 'text-white group-hover:text-purple-400'}`}>
                                    {market.title.replace('Prediction: ', '')}
                                </h3>

                                <p className="text-[10px] text-gray-500 line-clamp-2 mb-4">
                                    {market.content.includes(']. ') ? market.content.split(']. ')[1] : market.content}
                                </p>

                                <div className="mt-auto pt-4 border-t border-white/5">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Market Probability</span>
                                        <span className={`text-xs font-mono font-black ${market.metadata.is_locked ? 'text-gray-700 blur-[3px]' :
                                            market.metadata.probability > 80 || market.metadata.probability < 20 ? 'text-amber-400 underline decoration-amber-500/50 underline-offset-4' :
                                                market.metadata.probability > 50 ? 'text-emerald-400' : 'text-rose-400'
                                            }`}>
                                            {market.metadata.is_locked ? '88.8%' : `${market.metadata.probability.toFixed(1)}%`}
                                        </span>
                                    </div>

                                    {/* Probability Bar */}
                                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${market.is_high_impact ? 'bg-amber-500' : market.sentiment === 'bullish' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                            style={{ width: `${market.metadata.probability}%` }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between mt-4 text-[9px]">
                                        <div className="flex items-center gap-1.5 text-gray-500">
                                            <Shield className={`w-3 h-3 ${market.is_high_impact ? 'text-amber-400' : ''}`} />
                                            <span className="font-mono uppercase tracking-tighter">
                                                {market.is_high_impact ? 'High Threat Level' : 'System Verified'}
                                            </span>
                                        </div>
                                        <div className={`flex items-center gap-1.5 font-black uppercase tracking-widest ${market.metadata.is_locked ? 'text-gray-700' : market.is_high_impact ? 'text-amber-400 font-black italic' : market.sentiment === 'bullish' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {market.metadata.is_locked ? 'LOCKED' : market.is_high_impact ? 'Suspicious' : market.sentiment === 'bullish' ? 'Bullish' : 'Bearish'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {markets.length === 0 && !loading && (
                        <div className="col-span-full h-80 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-3xl bg-black/20">
                            {!isAuthenticated ? (
                                <>
                                    <Shield className="w-12 h-12 text-purple-500/20 mb-4" />
                                    <h3 className="text-xs font-black uppercase text-white tracking-[0.2em] mb-4">Identity Unverified</h3>
                                    <button
                                        onClick={() => login('wallet')}
                                        className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-widest rounded-xl border border-white/10 transition-all flex items-center gap-3 group"
                                    >
                                        <Lock className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                                        Sign in to Access Global Intel
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Shield className="w-8 h-8 text-gray-600 mb-2" />
                                    <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">No Active Macro Targets Scanned</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Banner */}
            <div className="px-6 py-4 bg-purple-500/5 border-t border-purple-500/10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="w-6 h-6 rounded-full border-2 border-[#050505] bg-gray-800" />
                        ))}
                    </div>
                    <span className="text-[10px] font-medium text-purple-300">
                        <span className="font-black">1.2k+</span> traders monitoring these odds
                    </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-purple-400">
                    <Globe className="w-3.5 h-3.5" />
                    Global Prediction Network Active
                </div>
            </div>
        </div>
    );
}
