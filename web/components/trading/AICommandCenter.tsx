'use client';

import React, { useState, useEffect, useCallback, Suspense, lazy, memo, useMemo, useRef } from 'react';
import {
    Brain,
    TrendingUp,
    TrendingDown,
    Activity,
    Target,
    Shield,
    ChevronLeft,
    RefreshCw,
    Loader2,
    Zap,
    AlertTriangle,
    BarChart3,
    Crosshair,
    Scale,
    Radar,
    Bot,
} from 'lucide-react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { useAlphaStore } from '@/store/useAlphaStore';
import { useMarketStore } from '@/store/useMarketStore';

const MicrostructureAI = lazy(() => import('./MicrostructureAI'));
const OrderflowDominance = lazy(() => import('./OrderflowDominance'));
const CompactRiskSimulator = lazy(() => import('./CompactRiskSimulator'));

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

const Loader = memo(() => (
    <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
    </div>
));
Loader.displayName = 'Loader';

const Section = memo(({
    title,
    icon: Icon,
    color,
    children,
    className = '',
}: {
    title: string;
    icon: React.ElementType;
    color: string;
    children: React.ReactNode;
    className?: string;
}) => (
    <div className={`group relative overflow-hidden rounded-xl border border-white/5 bg-[#0a0a0a] ${className}`}>
        <div className={`absolute left-0 top-0 h-full w-1 ${color}`} />
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
            <Icon className={`h-3.5 w-3.5 ${color.replace('bg-', 'text-').replace('/50', '')}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{title}</span>
        </div>
        <div className="p-4">{children}</div>
    </div>
));
Section.displayName = 'Section';

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
        entry?: number;
        stop_loss?: number;
        take_profit_1?: number;
        risk_reward?: number;
        confidence?: string;
    };
    performance?: {
        accuracy_24h?: string;
        last_5_signals?: string[];
    };
}

interface WhaleSummary {
    longNotional: number;
    shortNotional: number;
    longCount: number;
    shortCount: number;
    totalNotional: number;
    bias: number;
    biasLabel: string;
    topPositions?: Array<{
        addressShort: string;
        side: string;
        notionalUsd: number;
    }>;
}

interface AIBrief {
    symbol: string;
    source: 'gemini' | 'heuristic';
    action: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidence: number;
    thesis: string;
    counter_thesis: string;
    catalysts: string[];
    risk_flags: string[];
    checklist: string[];
    levels: {
        entry?: number | null;
        invalidation?: number | null;
        take_profit?: number | null;
    };
    generated_at: string;
}

interface AICommandCenterProps {
    selectedToken: string;
    onBack?: () => void;
    onSelectToken?: (token: string) => void;
}

const normalizeSymbol = (symbol: string) => String(symbol || 'BTC').trim().split(/[/-]/)[0].toUpperCase();

const toFinite = (value: unknown, fallback = 0): number => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const formatUsd = (value?: number | null, digits = 2): string => {
    const num = toFinite(value, NaN);
    if (!Number.isFinite(num) || num <= 0) return '—';
    return `$${num.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
};

const formatCompactUsd = (value?: number | null): string => {
    const num = toFinite(value, NaN);
    if (!Number.isFinite(num)) return '—';
    return `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num)}`;
};

const formatSigned = (value: number, digits = 1): string => {
    const num = toFinite(value, 0);
    const sign = num > 0 ? '+' : '';
    return `${sign}${num.toFixed(digits)}`;
};

export default function AICommandCenter({ selectedToken, onBack, onSelectToken }: AICommandCenterProps) {
    const selectedSymbol = useMemo(() => normalizeSymbol(selectedToken), [selectedToken]);
    const { token: authToken } = useAuth();
    const convictionData = useAlphaStore((state) => state.convictions[selectedSymbol]);
    const tokenData = useMarketStore((state) => state.marketData[selectedSymbol]);

    const [signals, setSignals] = useState<NexusSignal[]>([]);
    const [whaleData, setWhaleData] = useState<WhaleSummary | null>(null);
    const [brief, setBrief] = useState<AIBrief | null>(null);
    const [loadingInitial, setLoadingInitial] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestSeqRef = useRef(0);

    const fetchData = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
        const requestId = ++requestSeqRef.current;

        if (!background) {
            setRefreshing(true);
        }

        try {
            const headers: Record<string, string> = {};
            if (authToken) headers.Authorization = `Bearer ${authToken}`;

            const [resNexus, resWhales, resBrief] = await Promise.allSettled([
                axios.get(`${API_URL}/intel/nexus`, { headers, timeout: 12000 }),
                axios.get(`${API_URL}/trading/whales/summary?coin=${selectedSymbol}`, { timeout: 10000 }),
                axios.get(`${API_URL}/intel/ai-brief?symbol=${selectedSymbol}`, { headers, timeout: 15000 }),
            ]);

            if (requestId !== requestSeqRef.current) return;

            let anySuccess = false;

            if (resNexus.status === 'fulfilled' && Array.isArray(resNexus.value.data)) {
                anySuccess = true;
                setSignals(resNexus.value.data as NexusSignal[]);
            }

            if (resWhales.status === 'fulfilled' && resWhales.value.data && typeof resWhales.value.data === 'object') {
                anySuccess = true;
                setWhaleData(resWhales.value.data as WhaleSummary);
            }

            if (resBrief.status === 'fulfilled' && resBrief.value.data && typeof resBrief.value.data === 'object') {
                anySuccess = true;
                setBrief(resBrief.value.data as AIBrief);
            }

            if (anySuccess) {
                setError(null);
            } else {
                setError('Live intelligence feeds are temporarily unavailable.');
            }
        } catch (e) {
            console.error('AI Command Center fetch error', e);
            if (requestId === requestSeqRef.current) {
                setError('Failed to refresh AI Command Center.');
            }
        } finally {
            if (requestId === requestSeqRef.current) {
                setLoadingInitial(false);
                setRefreshing(false);
            }
        }
    }, [authToken, selectedSymbol]);

    useEffect(() => {
        let active = true;

        const runFetch = async (background: boolean) => {
            if (!active) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && background) return;
            await fetchData({ background });
        };

        void runFetch(false);

        const interval = window.setInterval(() => {
            void runFetch(true);
        }, 20000);

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                void runFetch(true);
            }
        };

        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            active = false;
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [fetchData]);

    const score = convictionData?.conviction_score ?? 0;
    const convictionPct = Math.round(Math.abs(score) * 100);
    const convictionDirection = score > 0.05 ? 'BUY' : score < -0.05 ? 'SELL' : 'NEUTRAL';

    const currentSignal = useMemo(
        () => signals.find((s) => normalizeSymbol(s.token) === selectedSymbol),
        [signals, selectedSymbol],
    );

    const visibleSignals = useMemo(
        () => signals.filter((s) => !s.is_obfuscated),
        [signals],
    );

    const briefAction = brief?.action || (convictionDirection === 'BUY' ? 'LONG' : convictionDirection === 'SELL' ? 'SHORT' : 'NEUTRAL');
    const actionColor = briefAction === 'LONG' ? 'text-emerald-400' : briefAction === 'SHORT' ? 'text-red-400' : 'text-gray-400';
    const actionBg = briefAction === 'LONG'
        ? 'border-emerald-500/25 bg-emerald-500/10'
        : briefAction === 'SHORT'
            ? 'border-red-500/25 bg-red-500/10'
            : 'border-gray-500/20 bg-gray-500/10';

    const briefEntry = brief?.levels?.entry ?? currentSignal?.trade_plan?.entry;
    const briefInvalidation = brief?.levels?.invalidation ?? currentSignal?.trade_plan?.stop_loss;
    const briefTarget = brief?.levels?.take_profit ?? currentSignal?.trade_plan?.take_profit_1;

    const rr = useMemo(() => {
        const e = toFinite(briefEntry, 0);
        const s = toFinite(briefInvalidation, 0);
        const t = toFinite(briefTarget, 0);
        if (e <= 0 || s <= 0 || t <= 0 || e === s) return null;
        const risk = Math.abs(e - s);
        const reward = Math.abs(t - e);
        if (risk <= 0) return null;
        return reward / risk;
    }, [briefEntry, briefInvalidation, briefTarget]);

    const whaleBias = toFinite(whaleData?.bias, 0);
    const whaleBar = Math.max(5, Math.min(95, 50 + whaleBias / 2));
    const livePrice = toFinite(tokenData?.price, 0);
    const liveOi = toFinite(tokenData?.external_oi?.open_interest || tokenData?.oi, 0);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#050505]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-black/40 px-6 py-3">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="rounded-lg border border-white/5 p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                    )}
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5">
                            <Brain className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-xs font-black uppercase tracking-widest text-white">AI Command Center</h2>
                            <p className="text-[9px] text-gray-500">Decision Briefing Engine • {selectedSymbol}</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${actionBg}`}>
                        {briefAction === 'LONG' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> :
                            briefAction === 'SHORT' ? <TrendingDown className="h-3.5 w-3.5 text-red-400" /> :
                                <Activity className="h-3.5 w-3.5 text-gray-400" />}
                        <span className={`text-xs font-black uppercase ${actionColor}`}>{briefAction}</span>
                        <span className={`text-lg font-black italic ${actionColor}`}>{brief?.confidence ?? convictionPct}%</span>
                    </div>

                    <button
                        onClick={() => { void fetchData({ background: false }); }}
                        className="rounded-lg border border-white/5 p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/10">
                {error && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        <span className="text-[10px] text-amber-300">{error}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <Section title="AI Brief" icon={Bot} color="bg-emerald-500/50" className="xl:col-span-8">
                        {loadingInitial && !brief ? <Loader /> : (
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${actionBg} ${actionColor}`}>
                                        {briefAction}
                                    </span>
                                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-black uppercase text-gray-400">
                                        Source: {brief?.source === 'gemini' ? 'Gemini' : 'Heuristic'}
                                    </span>
                                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-black uppercase text-gray-500">
                                        Updated: {brief?.generated_at ? new Date(brief.generated_at).toLocaleTimeString() : '—'}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                        <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">Thesis</div>
                                        <p className="text-[11px] leading-relaxed text-gray-200">{brief?.thesis || 'Waiting for thesis generation.'}</p>
                                    </div>
                                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                                        <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-red-300">Counter Thesis</div>
                                        <p className="text-[11px] leading-relaxed text-gray-200">{brief?.counter_thesis || 'Waiting for counter-thesis generation.'}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                        <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-400">Catalysts</div>
                                        {brief?.catalysts?.length ? (
                                            <div className="space-y-1">
                                                {brief.catalysts.map((item, i) => (
                                                    <div key={`${item}-${i}`} className="flex items-start gap-1.5 text-[10px] text-gray-300">
                                                        <Zap className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-400" />
                                                        <span>{item}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-gray-600">No catalysts detected yet.</div>
                                        )}
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                        <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-400">Execution Checklist</div>
                                        {brief?.checklist?.length ? (
                                            <div className="space-y-1">
                                                {brief.checklist.map((item, i) => (
                                                    <div key={`${item}-${i}`} className="flex items-start gap-1.5 text-[10px] text-gray-300">
                                                        <Target className="mt-0.5 h-2.5 w-2.5 shrink-0 text-cyan-400" />
                                                        <span>{item}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-gray-600">Checklist unavailable.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </Section>

                    <Section title="Live Context" icon={Radar} color="bg-blue-500/50" className="xl:col-span-4">
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-white/5 bg-white/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Spot Price</div>
                                    <div className="text-sm font-black text-white">{formatUsd(livePrice)}</div>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-white/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Open Interest</div>
                                    <div className="text-sm font-black text-white">{formatCompactUsd(liveOi)}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-white/5 bg-white/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Conviction</div>
                                    <div className={`text-sm font-black ${convictionDirection === 'BUY' ? 'text-emerald-400' : convictionDirection === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>
                                        {convictionDirection} {convictionPct}%
                                    </div>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-white/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Nexus Score</div>
                                    <div className={`text-sm font-black ${toFinite(currentSignal?.alpha_score, 0) > 0 ? 'text-emerald-400' : toFinite(currentSignal?.alpha_score, 0) < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                        {formatSigned(toFinite(currentSignal?.alpha_score, 0), 1)}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <div className="mb-1 flex items-center justify-between text-[8px] uppercase text-gray-500">
                                    <span>Whale Bias</span>
                                    <span className={`${whaleBias > 20 ? 'text-emerald-400' : whaleBias < -20 ? 'text-red-400' : 'text-gray-400'}`}>
                                        {whaleData?.biasLabel || 'BALANCED'} ({formatSigned(whaleBias, 1)}%)
                                    </span>
                                </div>
                                <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
                                    <div className="h-full bg-emerald-500/70 transition-all" style={{ width: `${whaleBar}%` }} />
                                    <div className="h-full flex-1 bg-red-500/70" />
                                </div>
                                <div className="mt-1 flex justify-between text-[8px] text-gray-500">
                                    <span>Long {formatCompactUsd(whaleData?.longNotional)}</span>
                                    <span>Short {formatCompactUsd(whaleData?.shortNotional)}</span>
                                </div>
                            </div>
                        </div>
                    </Section>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <Section title="Confluence Radar" icon={Scale} color="bg-blue-500/50" className="xl:col-span-4">
                        {loadingInitial && signals.length === 0 ? <Loader /> : (
                            <div className="max-h-[340px] space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                                {visibleSignals.slice(0, 12).map((sig) => {
                                    const token = normalizeSymbol(sig.token);
                                    const isActive = token === selectedSymbol;
                                    const isBull = toFinite(sig.alpha_score, 0) > 0;
                                    const isBear = toFinite(sig.alpha_score, 0) < 0;

                                    return (
                                        <button
                                            key={sig.id || token}
                                            onClick={() => onSelectToken?.(token)}
                                            className={`w-full rounded-lg border p-2 text-left transition-all ${isActive ? 'border-emerald-500/25 bg-white/5' : 'border-white/5 hover:bg-white/5'}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-black text-white">{token}</span>
                                                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${sig.recommendation?.includes('BUY') ? 'bg-emerald-500/10 text-emerald-400' : sig.recommendation?.includes('SELL') ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10 text-gray-400'}`}>
                                                        {sig.recommendation?.includes('BUY') ? 'BUY' : sig.recommendation?.includes('SELL') ? 'SELL' : 'NEUTRAL'}
                                                    </span>
                                                </div>
                                                <span className={`text-sm font-black italic ${isBull ? 'text-emerald-400' : isBear ? 'text-red-400' : 'text-gray-400'}`}>
                                                    {formatSigned(toFinite(sig.alpha_score, 0), 1)}
                                                </span>
                                            </div>
                                            {sig.confluence_factors?.length > 0 && (
                                                <div className="mt-1 truncate text-[9px] text-gray-500">
                                                    {sig.confluence_factors.slice(0, 2).join(' • ')}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}

                                {visibleSignals.length === 0 && (
                                    <div className="py-8 text-center text-[10px] text-gray-600">No confluence signals available.</div>
                                )}
                            </div>
                        )}
                    </Section>

                    <Section title={`Execution Plan · ${selectedSymbol}`} icon={Crosshair} color="bg-cyan-500/50" className="xl:col-span-4">
                        <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg border border-white/5 bg-white/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Entry</div>
                                    <div className="text-sm font-mono font-bold text-white">{formatUsd(briefEntry)}</div>
                                </div>
                                <div className="rounded-lg border border-red-500/10 bg-red-500/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Invalidation</div>
                                    <div className="text-sm font-mono font-bold text-red-400">{formatUsd(briefInvalidation)}</div>
                                </div>
                                <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2">
                                    <div className="text-[8px] uppercase text-gray-500">Take Profit</div>
                                    <div className="text-sm font-mono font-bold text-emerald-400">{formatUsd(briefTarget)}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-gray-500">R:R</span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                                    <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.min(100, Math.max(0, (toFinite(rr, 0) || 0) * 25))}%` }} />
                                </div>
                                <span className="text-xs font-bold text-emerald-400">{rr ? `${rr.toFixed(1)}:1` : '—'}</span>
                            </div>

                            {!!currentSignal?.trade_plan?.confidence && (
                                <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-gray-300">
                                    Confidence Label: <span className="font-black text-amber-300">{currentSignal.trade_plan.confidence}</span>
                                </div>
                            )}
                        </div>
                    </Section>

                    <Section title="Risk Flags" icon={AlertTriangle} color="bg-red-500/50" className="xl:col-span-4">
                        {brief?.risk_flags?.length ? (
                            <div className="space-y-2">
                                {brief.risk_flags.map((flag, idx) => (
                                    <div key={`${flag}-${idx}`} className="rounded-lg border border-red-500/15 bg-red-500/5 p-2 text-[10px] text-red-200">
                                        {flag}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-[10px] text-gray-500">
                                No active risk flags.
                            </div>
                        )}
                    </Section>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <Section title="Orderflow Dominance" icon={BarChart3} color="bg-purple-500/50">
                        <Suspense fallback={<Loader />}>
                            <OrderflowDominance symbol={selectedSymbol} />
                        </Suspense>
                    </Section>

                    <Section title="Microstructure AI" icon={Activity} color="bg-blue-500/50">
                        <Suspense fallback={<Loader />}>
                            <MicrostructureAI symbol={selectedSymbol} />
                        </Suspense>
                    </Section>
                </div>

                <Section title="Risk Simulator · Portfolio Health" icon={Shield} color="bg-red-500/50">
                    <div className="flex flex-col gap-4 xl:flex-row">
                        <div className="flex-1">
                            <Suspense fallback={<Loader />}>
                                <CompactRiskSimulator symbol={selectedSymbol} />
                            </Suspense>
                        </div>
                        <div className="w-full rounded-lg border border-white/5 bg-white/5 p-3 xl:w-72">
                            <h4 className="mb-2 text-[10px] font-black uppercase text-gray-400">Simulation Engine</h4>
                            <p className="text-[10px] italic leading-relaxed text-gray-500">
                                Monte Carlo portfolio stress testing from live conviction inputs and microstructure risk.
                            </p>
                            {!!whaleData?.topPositions?.length && (
                                <div className="mt-3 space-y-1.5">
                                    <div className="text-[8px] font-black uppercase text-gray-500">Top Whale Exposure</div>
                                    {whaleData.topPositions.slice(0, 3).map((p, i) => (
                                        <div key={`${p.addressShort}-${i}`} className="flex items-center justify-between text-[9px]">
                                            <span className="font-mono text-gray-500">{p.addressShort}</span>
                                            <span className={`${p.side === 'long' ? 'text-emerald-400' : 'text-red-400'} font-bold uppercase`}>{p.side}</span>
                                            <span className="text-gray-300">{formatCompactUsd(p.notionalUsd)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </Section>
            </div>
        </div>
    );
}
