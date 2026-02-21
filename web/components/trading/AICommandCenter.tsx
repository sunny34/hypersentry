'use client';
import React, { useState, useEffect, useCallback, Suspense, lazy, memo } from 'react';
import {
    Brain, TrendingUp, TrendingDown, Activity, Target,
    Users, Shield, ChevronLeft, RefreshCw, Loader2,
    Zap, AlertTriangle, BarChart3, Crosshair
} from 'lucide-react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { useAlphaStore } from '@/store/useAlphaStore';
import { useMarketStore } from '@/store/useMarketStore';

const MicrostructureAI = lazy(() => import('./MicrostructureAI'));
const OrderflowDominance = lazy(() => import('./OrderflowDominance'));
const BullBearDebate = lazy(() => import('./BullBearDebate'));
const CompactRiskSimulator = lazy(() => import('./CompactRiskSimulator'));
const InstitutionalDescription = lazy(() => import('./InstitutionalDescription'));

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

const Loader = memo(() => (
    <div className="flex items-center justify-center p-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
    </div>
));
Loader.displayName = 'Loader';

// ─── Section Wrapper ─────────────────────────────────────────
const Section = memo(({ title, icon: Icon, color, children, className = '' }: {
    title: string;
    icon: React.ElementType;
    color: string;
    children: React.ReactNode;
    className?: string;
}) => (
    <div className={`bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden relative group ${className}`}>
        <div className={`absolute top-0 left-0 w-1 h-full ${color}`} />
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 ${color.replace('bg-', 'text-').replace('/50', '')}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{title}</span>
        </div>
        <div className="p-4">{children}</div>
    </div>
));
Section.displayName = 'Section';

// ─── Types ───────────────────────────────────────────────────
interface NexusSignal {
    id: string;
    token: string;
    alpha_score: number;
    recommendation: string;
    confluence_factors: string[];
    sentiment: string;
    is_obfuscated?: boolean;
    bias?: string;
    trade_plan?: {
        entry: number;
        stop_loss: number;
        take_profit_1: number;
        risk_reward: number;
        confidence: string;
    };
}

interface AICommandCenterProps {
    selectedToken: string;
    onBack?: () => void;
    onSelectToken?: (token: string) => void;
}

// ─── Main Component ──────────────────────────────────────────
export default function AICommandCenter({ selectedToken, onBack, onSelectToken }: AICommandCenterProps) {
    const { token: authToken } = useAuth();
    const convictionData = useAlphaStore(state => state.convictions[selectedToken?.toUpperCase()]);
    const tokenData = useMarketStore(state => state.marketData[selectedToken?.toUpperCase()]);

    const [signals, setSignals] = useState<NexusSignal[]>([]);
    const [whaleData, setWhaleData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const headers: Record<string, string> = {};
            if (authToken) headers.Authorization = `Bearer ${authToken}`;

            const [resNexus, resWhales] = await Promise.allSettled([
                axios.get(`${API_URL}/intel/nexus`, { headers }),
                axios.get(`${API_URL}/whales/summary?coin=${selectedToken}`),
            ]);

            if (resNexus.status === 'fulfilled') setSignals(resNexus.value.data);
            if (resWhales.status === 'fulfilled') setWhaleData(resWhales.value.data);
        } catch (e) {
            console.error('AI Command Center fetch error', e);
        } finally {
            setLoading(false);
        }
    }, [authToken, selectedToken]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(fetchData, 20000);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Derive conviction display
    const score = convictionData?.conviction_score ?? 0;
    const pct = Math.round(Math.abs(score) * 100);
    const direction = score > 0.05 ? 'BUY' : score < -0.05 ? 'SELL' : 'NEUTRAL';
    const dirColor = direction === 'BUY' ? 'text-emerald-400' : direction === 'SELL' ? 'text-red-400' : 'text-gray-400';
    const dirBg = direction === 'BUY' ? 'bg-emerald-500/10 border-emerald-500/20' : direction === 'SELL' ? 'bg-red-500/10 border-red-500/20' : 'bg-gray-500/10 border-gray-500/20';

    // Find the signal for the currently selected token
    const currentSignal = signals.find(s => s.token?.toUpperCase() === selectedToken?.toUpperCase());

    return (
        <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-3 border-b border-white/5 flex items-center justify-between bg-black/40 shrink-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button onClick={onBack} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors border border-white/5">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                    )}
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                            <Brain className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-xs font-black uppercase tracking-widest text-white">AI Command Center</h2>
                            <p className="text-[9px] text-gray-500">Unified Intelligence • {selectedToken}</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Conviction Badge */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${dirBg}`}>
                        {direction === 'BUY' ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> :
                            direction === 'SELL' ? <TrendingDown className="w-3.5 h-3.5 text-red-400" /> :
                                <Activity className="w-3.5 h-3.5 text-gray-400" />}
                        <span className={`text-xs font-black uppercase ${dirColor}`}>{direction}</span>
                        <span className={`text-lg font-black italic ${dirColor}`}>{pct}%</span>
                    </div>
                    <button onClick={fetchData} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors border border-white/5">
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 p-4 space-y-4">

                {/* ═══ ROW 1: Conviction Engine + Signal Summary ═══ */}
                <div className="grid grid-cols-[1fr_1fr] gap-4">
                    {/* Conviction Engine — Single Source of Truth */}
                    <Section title="Conviction Engine" icon={Target} color="bg-emerald-500/50">
                        <div className="flex items-center gap-6 mb-4">
                            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${dirBg}`}>
                                {direction === 'BUY' ? <TrendingUp className="w-6 h-6 text-emerald-400" /> :
                                    direction === 'SELL' ? <TrendingDown className="w-6 h-6 text-red-400" /> :
                                        <Activity className="w-6 h-6 text-gray-400" />}
                                <div>
                                    <div className={`text-2xl font-black italic ${dirColor}`}>{direction}</div>
                                    <div className="text-[9px] text-gray-500 uppercase tracking-widest">{selectedToken}</div>
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className={`text-4xl font-black italic tracking-tighter ${dirColor}`}>{pct}%</div>
                                <div className="text-[9px] text-gray-500 uppercase tracking-widest">Conviction</div>
                            </div>
                        </div>

                        {/* Reasoning */}
                        {convictionData?.reasoning && (
                            <div className="p-3 bg-white/5 rounded-lg border border-white/5 mb-3">
                                <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Reasoning</div>
                                <p className="text-[10px] text-gray-300 leading-relaxed">{convictionData.reasoning}</p>
                            </div>
                        )}

                        {/* Component Scores */}
                        {convictionData?.components && (
                            <div className="grid grid-cols-3 gap-2">
                                {Object.entries(convictionData.components).map(([key, val]) => (
                                    <div key={key} className="p-2 bg-white/5 rounded-lg text-center">
                                        <div className="text-[8px] font-bold text-gray-500 uppercase truncate">{key}</div>
                                        <div className={`text-sm font-black ${Number(val) > 0 ? 'text-emerald-400' : Number(val) < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                            {Number(val) > 0 ? '+' : ''}{Number(val).toFixed(2)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>

                    {/* All Signals — Supporting Context */}
                    <Section title="Signal Confluence" icon={Zap} color="bg-blue-500/50">
                        {loading ? <Loader /> : (
                            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                                {signals.filter(s => !s.is_obfuscated).slice(0, 8).map(sig => (
                                    <button
                                        key={sig.id}
                                        onClick={() => onSelectToken?.(sig.token)}
                                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-all hover:bg-white/5 ${sig.token === selectedToken ? 'bg-white/5 border-white/10' : 'border-white/5'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-white">{sig.token}</span>
                                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${sig.recommendation?.includes('BUY') ? 'bg-emerald-500/10 text-emerald-400' :
                                                    sig.recommendation?.includes('SELL') ? 'bg-red-500/10 text-red-400' :
                                                        'bg-gray-500/10 text-gray-400'
                                                }`}>
                                                {sig.recommendation || 'NEUTRAL'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {sig.confluence_factors?.slice(0, 2).map((f, i) => (
                                                <span key={i} className="text-[8px] text-gray-500 bg-white/5 px-1 py-0.5 rounded">{f}</span>
                                            ))}
                                            <span className={`text-sm font-black italic ${sig.alpha_score > 0 ? 'text-emerald-400' : sig.alpha_score < 0 ? 'text-red-400' : 'text-gray-400'
                                                }`}>
                                                {sig.alpha_score > 0 ? '+' : ''}{sig.alpha_score}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                                {signals.length === 0 && !loading && (
                                    <div className="text-center py-8 text-gray-600 text-[10px]">No signals available</div>
                                )}
                            </div>
                        )}
                    </Section>
                </div>

                {/* ═══ ROW 2: Smart Money + Trade Plan ═══ */}
                <div className="grid grid-cols-[1fr_1fr] gap-4">
                    {/* Smart Money Flow */}
                    <Section title="Smart Money Flow" icon={Users} color="bg-amber-500/50">
                        {whaleData ? (
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <span className={`text-sm font-black uppercase ${whaleData.bias > 20 ? 'text-emerald-400' :
                                            whaleData.bias < -20 ? 'text-red-400' : 'text-gray-400'
                                        }`}>{whaleData.biasLabel}</span>
                                    <span className="text-[10px] text-gray-500">
                                        {whaleData.longCount + whaleData.shortCount} positions tracked
                                    </span>
                                </div>

                                {/* Bias Bar */}
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden flex mb-3">
                                    <div className="bg-emerald-500/60 h-full transition-all" style={{ width: `${Math.max(5, 50 + whaleData.bias / 2)}%` }} />
                                    <div className="bg-red-500/60 h-full transition-all flex-1" />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                                        <div className="text-[8px] font-bold text-gray-500 uppercase">Long</div>
                                        <div className="text-sm font-black text-emerald-400">${(whaleData.longNotional / 1e6).toFixed(1)}M</div>
                                    </div>
                                    <div className="p-2 bg-red-500/5 border border-red-500/10 rounded-lg">
                                        <div className="text-[8px] font-bold text-gray-500 uppercase">Short</div>
                                        <div className="text-sm font-black text-red-400">${(whaleData.shortNotional / 1e6).toFixed(1)}M</div>
                                    </div>
                                </div>

                                {/* Top Positions */}
                                {whaleData.topPositions?.slice(0, 5).map((p: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 mt-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-gray-500 font-mono">{p.addressShort}</span>
                                            <span className={`text-[9px] font-bold uppercase ${p.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side}</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-gray-300">${(p.notionalUsd / 1000).toFixed(0)}K</span>
                                    </div>
                                ))}
                            </div>
                        ) : <Loader />}
                    </Section>

                    {/* Trade Plan for Selected Token */}
                    <Section title={`Execution Plan · ${selectedToken}`} icon={Crosshair} color="bg-cyan-500/50">
                        {currentSignal?.trade_plan ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`text-xs font-black uppercase px-2 py-1 rounded-lg border ${currentSignal.bias === 'LONG' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                                            currentSignal.bias === 'SHORT' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                                'bg-gray-500/10 border-gray-500/20 text-gray-400'
                                        }`}>{currentSignal.bias || 'NEUTRAL'}</span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${currentSignal.trade_plan.confidence === 'LEGENDARY' ? 'bg-amber-500/10 text-amber-400' :
                                            'bg-white/5 text-gray-400'
                                        }`}>{currentSignal.trade_plan.confidence}</span>
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                    <div className="p-2 bg-white/5 rounded-lg">
                                        <div className="text-[8px] text-gray-500 uppercase">Entry</div>
                                        <div className="text-sm font-mono font-bold text-white">${currentSignal.trade_plan.entry?.toLocaleString()}</div>
                                    </div>
                                    <div className="p-2 bg-red-500/5 rounded-lg border border-red-500/10">
                                        <div className="text-[8px] text-gray-500 uppercase">Stop Loss</div>
                                        <div className="text-sm font-mono font-bold text-red-400">${currentSignal.trade_plan.stop_loss?.toLocaleString()}</div>
                                    </div>
                                    <div className="p-2 bg-emerald-500/5 rounded-lg border border-emerald-500/10">
                                        <div className="text-[8px] text-gray-500 uppercase">Target</div>
                                        <div className="text-sm font-mono font-bold text-emerald-400">${currentSignal.trade_plan.take_profit_1?.toLocaleString()}</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] text-gray-500">R:R</span>
                                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${Math.min(100, (currentSignal.trade_plan.risk_reward || 0) * 25)}%` }} />
                                    </div>
                                    <span className="text-xs font-bold text-emerald-400">{currentSignal.trade_plan.risk_reward?.toFixed(1)}:1</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-6 text-gray-600">
                                <AlertTriangle className="w-6 h-6 mx-auto mb-2 opacity-30" />
                                <p className="text-[10px]">No execution plan for {selectedToken}</p>
                            </div>
                        )}
                    </Section>
                </div>

                {/* ═══ ROW 3: Deep Intel ═══ */}
                <div className="grid grid-cols-[1fr_1fr] gap-4">
                    <Section title="Orderflow Dominance" icon={BarChart3} color="bg-purple-500/50">
                        <Suspense fallback={<Loader />}>
                            <OrderflowDominance symbol={selectedToken} />
                        </Suspense>
                    </Section>

                    <Section title="Microstructure AI" icon={Activity} color="bg-blue-500/50">
                        <Suspense fallback={<Loader />}>
                            <MicrostructureAI symbol={selectedToken} />
                        </Suspense>
                    </Section>
                </div>

                {/* ═══ ROW 4: AI Debate + Risk ═══ */}
                <div className="grid grid-cols-[1fr_1fr] gap-4">
                    <Section title="AI Intel Debate" icon={Brain} color="bg-orange-500/50">
                        <Suspense fallback={<Loader />}>
                            <BullBearDebate symbol={selectedToken} />
                        </Suspense>
                    </Section>

                    <Section title="Risk Simulator" icon={Shield} color="bg-red-500/50">
                        <Suspense fallback={<Loader />}>
                            <CompactRiskSimulator />
                        </Suspense>
                    </Section>
                </div>

                {/* ═══ ROW 5: Asset Profile ═══ */}
                <Section title={`Terminal Asset Profile · ${selectedToken}`} icon={Target} color="bg-teal-500/50">
                    <Suspense fallback={<Loader />}>
                        <InstitutionalDescription symbol={selectedToken} />
                    </Suspense>
                </Section>
            </div>
        </div>
    );
}
