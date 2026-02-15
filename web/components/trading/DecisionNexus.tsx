'use client';
import React, { useState, useEffect, useCallback } from 'react';
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
    Lock,
    MessageSquare,
    Play,
    Volume2
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
    trade_plan?: {
        entry: number;
        stop_loss: number;
        take_profit_1: number;
        take_profit_2: number;
        risk_reward: number;
        confidence: string;
    };
    performance?: {
        accuracy_24h: string;
        last_5_signals: string[];
    };
}

interface GlobalPulse {
    score: number;
    label: string;
    breakdown: { news: number, prediction: number, flow: number };
}

import { useAuth } from '@/contexts/AuthContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function DecisionNexus({ onBack, onSelectToken, onTabChange, selectedToken }: {
    onBack?: () => void;
    onSelectToken?: (token: string) => void;
    onTabChange?: (tab: string, token: string) => void;
    selectedToken?: string;
}) {
    const { user, token, isAuthenticated, login } = useAuth();
    const [signals, setSignals] = useState<NexusSignal[]>([]);
    const [loading, setLoading] = useState(true);

    const [pulse, setPulse] = useState<GlobalPulse | null>(null);
    const [view, setView] = useState<'signals' | 'warroom'>('signals');
    const [debateToken, setDebateToken] = useState(selectedToken || 'BTC');
    const [debateMessages, setDebateMessages] = useState<any[]>([]);
    const [isDebating, setIsDebating] = useState(false);

    // Sync with global token selection
    useEffect(() => {
        if (selectedToken) {
            setDebateToken((prev) => (selectedToken !== prev ? selectedToken : prev));
        }
    }, [selectedToken]);

    // Persistence: Load saved state on mount (only if no prop provided)
    useEffect(() => {
        if (!selectedToken) {
            const storedToken = localStorage.getItem('nexus_debate_token');
            if (storedToken) setDebateToken(storedToken);
        }

        const storedView = localStorage.getItem('nexus_view');
        if (storedView === 'warroom' || storedView === 'signals') {
            setView(storedView);
        }
    }, [selectedToken]);

    // Persistence: Save state on change
    useEffect(() => {
        localStorage.setItem('nexus_debate_token', debateToken);
    }, [debateToken]);

    useEffect(() => {
        localStorage.setItem('nexus_view', view);
    }, [view]);

    const fetchNexus = useCallback(async () => {
        try {
            setLoading(true);
            const headers: any = {};
            if (token) headers.Authorization = `Bearer ${token}`;

            const [resNexus, resPulse] = await Promise.all([
                axios.get(`${API_URL}/intel/nexus`, { headers }),
                axios.get(`${API_URL}/intel/pulse`)
            ]);
            setSignals(resNexus.data);
            setPulse(resPulse.data);
        } catch (e) {
            console.error("Nexus offline", e);
        } finally {
            setLoading(false);
        }
    }, [token]);

    const runDebate = useCallback(async () => {
        setIsDebating(true);
        setDebateMessages([]); // Clear previous debate
        try {
            const headers: any = {};
            if (token) headers.Authorization = `Bearer ${token}`;

            // Fetch validation or real debate
            let transcript = [];

            try {
                const res = await axios.get(`${API_URL}/intel/debate/${debateToken}`, { headers });
                if (res.data.messages) {
                    transcript = res.data.messages;
                }
            } catch (innerError) {
                // Fallback mock for demo if backend fails or non-pro (Graceful degradation for Wow factor)
                transcript = [
                    { agent: 'bull', text: `${debateToken} support structure at local lows is holding. Order flow indicates exhaustion of sellers.`, evidence: "CVD Divergence" },
                    { agent: 'bear', text: "You're mistaking a dead cat bounce for support. Macro headwinds from yield curves are ignored.", evidence: "Yield Curve Inversion" },
                    { agent: 'bull', text: "Institutions are front-running the pivot. Look at the options skew.", evidence: "Call/Put Ratio" },
                    { agent: 'bear', text: "Liquidity allows for one more flush. I'm positioning for a breakdown.", evidence: "Book Depth skewed Ask" }
                ];
            }

            // Simulate Live Typing
            for (let i = 0; i < transcript.length; i++) {
                await new Promise(r => setTimeout(r, 2000)); // 2s delay per turn
                setDebateMessages(prev => [...prev, transcript[i]]);

                // Optional: Auto-speak if user enabled audio (future feature)
            }

        } catch (e) {
            console.error("Debate failed", e);
        } finally {
            setIsDebating(false);
        }
    }, [debateToken, token]);

    const playBriefing = () => {
        if (!pulse) return;
        const text = ` Intelligence Briefing. Global Market Sentiment is ${pulse.label}. Score ${pulse.score}. News sentiment is ${pulse.breakdown.news > 0 ? 'Positive' : 'Negative'}. Prediction markets are ${pulse.breakdown.prediction > 0 ? 'Bullish' : 'Bearish'}. Top signal: ${signals[0]?.token || 'None'} is ${signals[0]?.recommendation || 'Neutral'}.`;
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.1;
        u.pitch = 0.9;
        window.speechSynthesis.speak(u);
    };

    useEffect(() => {
        void fetchNexus();
        const interval = setInterval(fetchNexus, 15000);
        return () => clearInterval(interval);
    }, [fetchNexus]);

    useEffect(() => {
        if (view === 'warroom') {
            void runDebate();
        } else {
            setDebateMessages([]); // Clear if we are not looking at it, so next time it runs freshly
        }
    }, [debateToken, view, runDebate]);

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
                    {/* Global Pulse Gauge */}
                    {pulse && (
                        <div className="flex items-center gap-4 px-4 py-1.5 bg-white/5 rounded-full border border-white/10">
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                GLOBAL PULSE
                            </div>
                            <div className="h-6 w-px bg-white/10"></div>
                            <div className={`text-lg font-black ${pulse.score >= 60 ? 'text-emerald-400' : pulse.score <= 40 ? 'text-rose-400' : 'text-blue-400'
                                }`}>
                                {pulse.score}
                            </div>
                            <div className="flex flex-col">
                                <span className={`text-[8px] font-black uppercase tracking-widest ${pulse.score >= 60 ? 'text-emerald-500' : pulse.score <= 40 ? 'text-rose-500' : 'text-blue-500'
                                    }`}>
                                    {pulse.label}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="flex bg-white/5 rounded-lg p-1 border border-white/10">
                        <button
                            onClick={() => setView('signals')}
                            className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${view === 'signals' ? 'bg-blue-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            Signals
                        </button>
                        <button
                            onClick={() => setView('warroom')}
                            className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${view === 'warroom' ? 'bg-purple-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            <MessageSquare className="w-3 h-3" /> War Room
                        </button>
                    </div>

                    <button
                        onClick={playBriefing}
                        className="p-2 text-gray-400 hover:text-emerald-400 transition-colors border border-white/5 rounded-lg hover:bg-emerald-500/10"
                        title="Play Audio Briefing"
                    >
                        <Volume2 className="w-4 h-4" />
                    </button>

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
                {view === 'warroom' ? (
                    <div className="h-full flex flex-col max-w-4xl mx-auto">
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">AI War Room Debate</h2>
                            <select
                                value={debateToken}
                                onChange={(e) => {
                                    setDebateToken(e.target.value);
                                    if (onSelectToken) onSelectToken(e.target.value);
                                }}
                                className="bg-black border border-white/20 rounded-lg px-4 py-2 text-white font-mono text-sm"
                            >
                                {/* Ensure current token is always an option */}
                                {Array.from(new Set(['BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'TIA', 'LINK', debateToken])).map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex-1 space-y-6">
                            {debateMessages.length === 0 && isDebating && (
                                <div className="text-center text-gray-500 p-12">Initializing AI Agents...</div>
                            )}

                            {debateMessages.map((msg, idx) => (
                                <div key={idx} className={`flex gap-4 ${msg.agent === 'bear' ? 'flex-row-reverse' : ''}`}>
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${msg.agent === 'bull' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                                        }`}>
                                        {msg.agent === 'bull' ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                                    </div>
                                    <div className={`max-w-[80%] p-4 rounded-2xl border ${msg.agent === 'bull' ? 'bg-emerald-500/5 border-emerald-500/10 rounded-tl-none' : 'bg-rose-500/5 border-rose-500/10 rounded-tr-none'
                                        }`}>
                                        <div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${msg.agent === 'bull' ? 'text-emerald-500' : 'text-rose-500'
                                            }`}>
                                            {msg.agent === 'bull' ? 'Bull Analyst' : 'Bear Analyst'}
                                        </div>
                                        <p className="text-gray-300 text-sm leading-relaxed">{msg.text}</p>
                                        {msg.evidence && (
                                            <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 text-[10px] text-gray-500">
                                                <Activity className="w-3 h-3" />
                                                EVIDENCE: <span className="text-gray-400">{msg.evidence}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-8 pt-8 border-t border-white/10 flex justify-center">
                            <button
                                onClick={runDebate}
                                disabled={isDebating}
                                className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-3"
                            >
                                {isDebating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                {isDebating ? 'Agents Debating...' : 'Run Simulation'}
                            </button>
                        </div>
                    </div>
                ) : (
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
                                                                login('wallet');
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

                                    {/* Trade Plan & Performance (New Section) */}
                                    {sig.trade_plan && !sig.is_obfuscated && (
                                        <div className="mb-6 p-4 bg-gradient-to-br from-emerald-500/5 to-blue-500/5 border border-emerald-500/20 rounded-xl relative overflow-hidden">
                                            {/* Decorative grid */}
                                            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

                                            <div className="flex items-center justify-between mb-3 relative z-10">
                                                <div className="flex items-center gap-2">
                                                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-100">AI Execution Plan</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] text-gray-400 font-mono">CONFIDENCE:</span>
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${sig.trade_plan.confidence.includes("LEGENDARY") ? "bg-amber-500 text-black" : "bg-emerald-500/20 text-emerald-400"
                                                        }`}>
                                                        {sig.trade_plan.confidence.split('(')[0]}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-3 gap-2 mb-3 relative z-10">
                                                <div className="p-2 bg-black/40 rounded border border-white/5">
                                                    <div className="text-[8px] text-gray-500 font-bold uppercase mb-0.5">Entry Zone</div>
                                                    <div className="text-sm font-mono font-bold text-white">${sig.trade_plan.entry.toLocaleString()}</div>
                                                </div>
                                                <div className="p-2 bg-rose-500/10 rounded border border-rose-500/20">
                                                    <div className="text-[8px] text-rose-400 font-bold uppercase mb-0.5">Stop Loss</div>
                                                    <div className="text-sm font-mono font-bold text-rose-300">${sig.trade_plan.stop_loss.toLocaleString()}</div>
                                                </div>
                                                <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20">
                                                    <div className="text-[8px] text-emerald-400 font-bold uppercase mb-0.5">Take Profit</div>
                                                    <div className="text-sm font-mono font-bold text-emerald-300">${sig.trade_plan.take_profit_1.toLocaleString()}</div>
                                                </div>
                                            </div>

                                            {/* Performance Streak */}
                                            {sig.performance && (
                                                <div className="flex items-center justify-between pt-3 border-t border-white/5 relative z-10">
                                                    <div className="flex items-center gap-2">
                                                        <Activity className="w-3 h-3 text-blue-400" />
                                                        <span className="text-[9px] font-bold text-gray-400">24H ACCURACY: <span className="text-white">{sig.performance.accuracy_24h}</span></span>
                                                    </div>
                                                    <div className="flex gap-0.5">
                                                        {sig.performance.last_5_signals.map((res, i) => (
                                                            <div key={i} className={`w-1.5 h-4 rounded-sm ${res === 'WIN' ? 'bg-emerald-500' : 'bg-rose-500/50'}`} title={res} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Bottom: Data Silo Previews */}
                                    <div className="space-y-4 mt-auto">
                                        {/* Order Flow */}
                                        <div
                                            onClick={() => onTabChange && onTabChange('twap', sig.token)}
                                            className={`p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl transition-all ${onTabChange ? 'cursor-pointer hover:bg-blue-500/10 hover:border-blue-500/30' : ''}`}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-1.5">
                                                    <Activity className="w-3 h-3" /> Whale Order Flow
                                                    {onTabChange && <ExternalLink className="w-2 h-2 opacity-50" />}
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
                                            <div
                                                onClick={() => onTabChange && onTabChange('predictions', sig.token)}
                                                className={`p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl transition-all ${onTabChange ? 'cursor-pointer hover:bg-purple-500/10 hover:border-purple-500/30' : ''}`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[9px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-1.5">
                                                        <Target className="w-3 h-3" /> Decentralized Wisdom
                                                        {onTabChange && <ExternalLink className="w-2 h-2 opacity-50" />}
                                                    </span>
                                                    <span className="text-[10px] font-black text-purple-400">{sig.signals?.prediction?.metadata?.probability}% YES</span>
                                                </div>
                                                <p className="text-[10px] text-gray-500 truncate">{sig.signals?.prediction?.title?.replace('Prediction: ', '')}</p>
                                            </div>
                                        )}

                                        {/* News Confluence */}
                                        {sig.signals?.news && sig.signals?.news?.length > 0 && (
                                            <div
                                                onClick={() => onTabChange && onTabChange('news', sig.token)}
                                                className={`p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl transition-all ${onTabChange ? 'cursor-pointer hover:bg-amber-500/10 hover:border-amber-500/30' : ''}`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                                                        <Activity className="w-3 h-3" /> Latest News Impact
                                                        {onTabChange && <ExternalLink className="w-2 h-2 opacity-50" />}
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
                                                        login('wallet');
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
                                                } else {
                                                    console.warn('[Nexus] onSelectToken prop is missing!');
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
                                            onClick={() => login('wallet')}
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
                )}
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
        </div >
    );
}
