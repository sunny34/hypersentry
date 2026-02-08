'use client';
import React, { useState, useEffect } from 'react';
import {
    Zap,
    Shield,
    Target,
    TrendingUp,
    TrendingDown,
    Activity,
    CheckCircle2,
    AlertTriangle,
    ChevronLeft,
    RefreshCw,
    ExternalLink,
    Brain,
    Lock
} from 'lucide-react';
import axios from 'axios';

interface NexusSignal {
    token: string;
    alpha_score: number;
    twap_delta: number;
    confluence_factors: string[];
    sentiment: 'accumulating' | 'distributing' | 'neutral';
    threat_level: 'low' | 'medium' | 'high';
    recommendation: string;
    is_obfuscated?: boolean;
    signals: {
        twap: any;
        prediction?: any;
        news?: any[];
    };
}

import { useAuth } from '@/contexts/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function DecisionNexus({ onBack, onSelectToken }: { onBack?: () => void; onSelectToken?: (token: string) => void }) {
    const { user, token, isAuthenticated, login } = useAuth();
    const [signals, setSignals] = useState<NexusSignal[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchNexus = async () => {
        try {
            setLoading(true);
            const headers: any = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const res = await axios.get(`${API_URL}/intel/nexus`, { headers });
            setSignals(res.data);
        } catch (e) {
            console.error("Nexus offline", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchNexus();
        const interval = setInterval(fetchNexus, 15000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
            {/* Header: War Room Command */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors border border-white/5"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                    )}
                    <div className="flex items-center gap-3 pl-1">
                        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                            <Brain className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-black uppercase tracking-widest text-white">Decision Nexus</h2>
                                <span className="text-[8px] bg-emerald-500 text-black px-1 rounded font-black">PRO</span>
                            </div>
                            <p className="text-[10px] text-gray-500 font-medium">Multi-Silo Confluence & Alpha Correlation Engine</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="hidden md:flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-gray-500 border-x border-white/5 px-6">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            NEWS
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                            PREDICTIONS
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            ORDER FLOW
                        </div>
                    </div>
                    <button
                        onClick={fetchNexus}
                        disabled={loading}
                        className="p-2 text-gray-500 hover:text-white transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Main Command Display */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {signals.map((sig) => (
                        <div key={sig.token} className="relative group">
                            {/* Alpha Glow */}
                            <div className={`absolute -inset-[1px] bg-gradient-to-r ${sig.alpha_score >= 5 ? 'from-emerald-500/20 to-blue-500/20' :
                                sig.alpha_score <= -5 ? 'from-rose-500/20 to-orange-500/20' :
                                    'from-white/5 to-white/5'
                                } rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 no-pointer-events`} />

                            <div className="relative bg-[#0a0a0a] border border-white/5 rounded-2xl overflow-hidden p-6 flex flex-col h-full hover:border-white/10 transition-colors">
                                {/* Top: Identity & Score */}
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 font-black text-white text-lg group-hover:bg-white/10 transition-colors relative overflow-hidden">
                                            {sig.is_obfuscated ? (
                                                <div className="absolute inset-0 flex items-center justify-center blur-[2px] opacity-40">?</div>
                                            ) : sig.token[0]}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <h3 className="text-sm font-black text-white tracking-widest uppercase">
                                                    {sig.token}
                                                </h3>
                                                {sig.is_obfuscated ? (
                                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-white/5 text-gray-500 border border-white/10">
                                                        LOCKED
                                                    </span>
                                                ) : (
                                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${sig.threat_level === 'high' ? 'bg-rose-500/20 text-rose-400' :
                                                        sig.threat_level === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                                                            'bg-emerald-500/20 text-emerald-400'
                                                        }`}>
                                                        {sig.recommendation}
                                                    </span>
                                                )}
                                            </div>
                                            {sig.is_obfuscated ? (
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (!isAuthenticated) {
                                                            login('google');
                                                            return;
                                                        }
                                                        try {
                                                            const res = await axios.post(`${API_URL}/intel/deobfuscate`,
                                                                { token_obfuscated: sig.token },
                                                                { headers: { Authorization: `Bearer ${token}` } }
                                                            );
                                                            setSignals(res.data);
                                                        } catch (err: any) {
                                                            alert(err.response?.data?.detail || "Reveal failed");
                                                        }
                                                    }}
                                                    className="text-[9px] font-black text-emerald-400 uppercase tracking-widest hover:text-emerald-300 transition-colors flex items-center gap-1 group/reveal"
                                                >
                                                    <Shield className="w-2.5 h-2.5 group-hover/reveal:animate-pulse" />
                                                    {!isAuthenticated ? 'Sign in to Reveal' : `De-obfuscate Signal (${user?.trial_credits || 0} Credits Left)`}
                                                </button>
                                            ) : (
                                                <p className="text-[10px] text-gray-500 font-mono">NET DELTA: {sig.twap_delta > 0 ? '+' : ''}${sig.twap_delta.toLocaleString()}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[9px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-1">PRO ALPHA</div>
                                        <div className={`text-2xl font-black italic tracking-tighter ${sig.is_obfuscated ? 'text-gray-700 blur-[4px]' :
                                            sig.alpha_score >= 5 ? 'text-emerald-400' :
                                                sig.alpha_score <= -5 ? 'text-rose-400' :
                                                    'text-blue-400'
                                            }`}>
                                            {sig.is_obfuscated ? '??' : (sig.alpha_score >= 0 ? '+' : '') + sig.alpha_score}
                                        </div>
                                    </div>
                                </div>

                                {/* Center: Confluence Factors */}
                                <div className="grid grid-cols-2 gap-3 mb-6">
                                    {sig.confluence_factors.map((factor, idx) => (
                                        <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] border border-white/5 rounded-lg">
                                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                            <span className="text-[10px] font-bold text-gray-300 truncate">{factor}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Bottom: Data Silo Previews */}
                                <div className="space-y-4 mt-auto">
                                    {/* Order Flow */}
                                    <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-1.5">
                                                <Activity className="w-3 h-3" /> Whale Order Flow
                                            </span>
                                            <span className="text-[10px] text-gray-400">{sig.signals?.twap?.active_count || 0} Active TWAPs</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 transition-all duration-1000"
                                                style={{ width: `${Math.min(100, ((sig.signals?.twap?.buy_volume || 0) / ((sig.signals?.twap?.buy_volume || 0) + (sig.signals?.twap?.sell_volume || 0) + 1)) * 100)}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Predictions */}
                                    {sig.signals?.prediction && (
                                        <div className="p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[9px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-1.5">
                                                    <Target className="w-3 h-3" /> Decentralized Wisdom
                                                </span>
                                                <span className="text-[10px] font-black text-purple-400">{sig.signals?.prediction?.metadata?.probability}% YES</span>
                                            </div>
                                            <p className="text-[10px] text-gray-500 truncate">{sig.signals?.prediction?.title?.replace('Prediction: ', '')}</p>
                                        </div>
                                    )}

                                    {/* News Confluence */}
                                    {sig.signals?.news && sig.signals?.news?.length > 0 && (
                                        <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                                                    <Activity className="w-3 h-3" /> Latest News Impact
                                                </span>
                                                {sig.signals?.news[0]?.is_high_impact && (
                                                    <span className="text-[8px] bg-rose-500 text-black px-1 rounded animate-pulse font-black uppercase tracking-tighter">VOLATILITY ALERT</span>
                                                )}
                                            </div>
                                            <p className="text-[10px] text-gray-500 truncate">{sig.signals?.news[0]?.title}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Hotlinks */}
                                <div className="mt-6 flex gap-2">
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            if (sig.is_obfuscated) {
                                                if (!isAuthenticated) {
                                                    login('google');
                                                } else {
                                                    // Trigger de-obfuscation
                                                    try {
                                                        const res = await axios.post(`${API_URL}/intel/deobfuscate`,
                                                            { token_obfuscated: sig.token },
                                                            { headers: { Authorization: `Bearer ${token}` } }
                                                        );
                                                        setSignals(res.data);
                                                    } catch (err: any) {
                                                        alert(err.response?.data?.detail || "Reveal failed");
                                                    }
                                                }
                                                return;
                                            }
                                            if (onSelectToken) {
                                                onSelectToken(sig.token);
                                            }
                                        }}
                                        className="flex-1 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors flex items-center justify-center gap-2 group/btn"
                                    >
                                        <Zap className="w-3 h-3 group-hover/btn:animate-pulse" />
                                        {sig.is_obfuscated ? (isAuthenticated ? 'Unlock to Trade' : 'Sign in to Trade') : 'Instant Position'}
                                    </button>
                                    <button className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 rounded-lg transition-colors">
                                        <Shield className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}

                    {signals.length === 0 && !loading && (
                        <div className="col-span-full h-80 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-3xl bg-black/20">
                            {!isAuthenticated ? (
                                <>
                                    <Shield className="w-12 h-12 text-emerald-500/20 mb-4" />
                                    <h3 className="text-xs font-black uppercase text-white tracking-[0.2em] mb-4">Identity Unverified</h3>
                                    <button
                                        onClick={() => login('google')}
                                        className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-widest rounded-xl border border-white/10 transition-all flex items-center gap-3 group"
                                    >
                                        <Lock className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                                        Sign in to Access Alpha
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Zap className="w-12 h-12 text-gray-700 mb-4 animate-pulse" />
                                    <h3 className="text-xs font-black uppercase text-gray-500 tracking-[0.2em] mb-2">Awaiting Alpha Confluence</h3>
                                    <p className="text-[10px] text-gray-600 font-medium">Scanning order flow, news, and predictions across the network...</p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Status: Global Heartbeat */}
            <div className="px-6 py-4 bg-emerald-500/5 border-t border-emerald-500/10 flex items-center justify-between">
                <div className="flex items-center gap-4 text-[10px]">
                    <div className="flex items-center gap-2 text-gray-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        NEXUS CORE ACTIVE
                    </div>
                    <span className="text-gray-600 font-mono">LATENCY: 142ms</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/60">
                    <Shield className="w-3.5 h-3.5" />
                    SENTRY OVERWATCH SYSTEM
                </div>
            </div>
        </div>
    );
}
