"use client";
import React, { useEffect, useState } from 'react';
import { useAlphaStore } from '../../store/useAlphaStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useAlphaDiagnostics } from '../../hooks/useAlphaDiagnostics';

const ConvictionPanel = ({ symbol }: { symbol: string }) => {
    const conviction = useAlphaStore((s) => s.convictions[symbol]);
    const risk = useAlphaStore((s) => s.risks[symbol]);
    const execution = useAlphaStore((s) => s.executionPlans[symbol]);
    const governance = useAlphaStore((s) => s.governance[symbol]);
    const stream = useAlphaStore((s) => s.stream);
    const market = useMarketStore((s) => s.marketData[symbol]);
    const [now, setNow] = useState(() => Date.now());
    const { data: diag, error: diagError } = useAlphaDiagnostics(symbol, 2500);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    if (!conviction) {
        return (
            <div className="w-full h-full min-h-[360px] flex items-center justify-center border border-gray-800 bg-black px-4">
                <span className="text-gray-700 font-mono animate-pulse tracking-widest text-[10px] sm:text-xs uppercase text-center">
                    Connecting to intelligence stream...
                </span>
            </div>
        );
    }

    const getConvictionLabel = (score: number) => {
        if (score >= 70) {
            return {
                label: 'HIGH CONVICTION',
                detail: 'Significant edge detected',
                scoreClass: 'text-emerald-500',
                badgeClass: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400',
                glowClass: 'bg-emerald-500'
            };
        }
        if (score >= 60) {
            return {
                label: 'MODERATE EDGE',
                detail: 'Probabilistic advantage',
                scoreClass: 'text-blue-400',
                badgeClass: 'border-blue-500/60 bg-blue-500/10 text-blue-300',
                glowClass: 'bg-blue-500'
            };
        }
        if (score <= 40) {
            return {
                label: 'SHORT BIAS',
                detail: 'Distribution in progress',
                scoreClass: 'text-red-500',
                badgeClass: 'border-red-500/60 bg-red-500/10 text-red-400',
                glowClass: 'bg-red-500'
            };
        }
        return {
            label: 'NO EDGE',
            detail: 'Neutral environment',
            scoreClass: 'text-gray-400',
            badgeClass: 'border-gray-600 bg-gray-800/50 text-gray-300',
            glowClass: 'bg-gray-500'
        };
    };

    const getProbInference = (up: number, down: number) => {
        const diff = up - down;
        if (diff > 0.15) return { label: "UPSIDE ASYMMETRY", textClass: "text-emerald-500", fillClass: "bg-emerald-500" };
        if (diff < -0.15) return { label: "DOWNSIDE RISK", textClass: "text-red-500", fillClass: "bg-red-500" };
        return { label: "BALANCED", textClass: "text-gray-500", fillClass: "bg-gray-500" };
    };

    const getMoveInference = (move: number) => {
        const costThreshold = 0.05; // 5bps fee + slippage
        if (move < costThreshold) return { label: "EDGE BELOW COST", color: "text-red-400" };
        return { label: "TRADEABLE EDGE", color: "text-blue-400" };
    };

    const info = getConvictionLabel(conviction.score);
    const probInfo = getProbInference(conviction.prob_up_1pct, conviction.prob_down_1pct);
    const moveInfo = getMoveInference(conviction.expected_move);
    const rawScore = conviction.raw_score ?? conviction.score;
    const smoothingGap = Math.abs(rawScore - conviction.score);
    const calibrationPct = Math.max(50, Math.min(99, 100 - (conviction.realized_vol * 100)));
    const health = governance?.calibration_status || 'UNKNOWN';
    const updateTs = conviction.ui_updated_at ?? conviction.timestamp;
    const normalizedUpdateTs = updateTs < 1_000_000_000_000 ? updateTs * 1000 : updateTs;
    const ageSec = Math.max(0, Math.floor((now - normalizedUpdateTs) / 1000));
    const streamState = stream.connected ? stream.status.toUpperCase() : 'OFFLINE';
    const streamClass = stream.status === 'live'
        ? 'text-emerald-400'
        : stream.status === 'degraded'
            ? 'text-yellow-400'
            : stream.status === 'stale'
                ? 'text-red-500'
                : 'text-gray-500';
    const probUpPct = Math.max(0, Math.min(100, conviction.prob_up_1pct * 100));
    const diagBiasClass = diag?.collective_bias === 'LONG'
        ? 'text-emerald-400'
        : diag?.collective_bias === 'SHORT'
            ? 'text-red-400'
            : 'text-gray-300';
    const diagBar = diag ? Math.max(0, Math.min(100, (diag.collective_raw + 1) * 50)) : 50;
    const topComponents = diag
        ? Object.values(diag.components || {}).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3)
        : [];
    const diagReasons = (diag?.reasoning || []).slice(0, 3);

    return (
        <div className="relative w-full border border-gray-800 bg-black overflow-hidden flex flex-col min-h-[400px] sm:min-h-[450px] p-4 sm:p-6 lg:p-8 gap-5 sm:gap-7">

            <div className="flex justify-between items-start gap-4 z-10">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-white">{symbol}</h1>
                        <span className={`px-2 py-0.5 text-[10px] font-bold border uppercase rounded ${info.badgeClass}`}>
                            {info.label}
                        </span>
                    </div>
                    <div className="font-mono text-gray-400 text-base sm:text-lg">
                        {market?.price ? `$${market.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '--'}
                    </div>
                    <div className="text-[9px] uppercase tracking-widest text-gray-600">Updated {ageSec}s ago</div>
                </div>

                <div className="flex flex-col items-end shrink-0">
                    <div className={`text-5xl sm:text-7xl font-black ${info.scoreClass} tracking-tighter leading-none`}>
                        {conviction.score}
                    </div>
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.24em] sm:tracking-[0.3em] text-gray-600 mt-1.5 sm:mt-2 font-bold">
                        Conviction Score
                    </div>
                    {smoothingGap >= 1 && (
                        <div className="text-[9px] text-gray-600 mt-1 uppercase tracking-wider">
                            Live {rawScore.toFixed(1)}
                        </div>
                    )}
                </div>
            </div>

            <div className="z-10 bg-gray-950/80 border border-gray-800 p-4 sm:p-6 rounded-sm text-center">
                <div className="text-gray-500 text-[10px] uppercase tracking-widest mb-2 font-bold">System Directive</div>
                <div className="text-base sm:text-xl font-mono text-white leading-relaxed">
                    {conviction.score >= 60 ? (
                        <>High probability upside move. Allocate <span className="text-blue-400">{risk?.risk_percent_equity || '1.5'}%</span> equity with <span className="text-emerald-500">{execution?.strategy || 'Hybrid'}</span> execution.</>
                    ) : conviction.score <= 40 ? (
                        <>Downside pressure identified. System recommends <span className="text-red-500">Short Bias</span>. High urgency execution.</>
                    ) : (
                        <>{info.detail}. System recommends <span className="text-gray-500">waiting for asymmetry</span>.</>
                    )}
                </div>
            </div>

            <div className="z-10 bg-gray-950/70 border border-gray-800 p-4 rounded-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-gray-500 text-[10px] uppercase tracking-widest font-bold">Collective Score</div>
                        <div className="text-[11px] text-gray-600 mt-1 uppercase">
                            OI + CVD + Book + Walls + Funding
                        </div>
                    </div>
                    <div className="text-right">
                        <div className={`text-2xl font-black ${diagBiasClass}`}>{diag?.collective_score ?? '--'}</div>
                        <div className={`text-[10px] font-bold uppercase ${diagBiasClass}`}>{diag?.collective_bias || 'NEUTRAL'}</div>
                    </div>
                </div>
                <div className="mt-3 h-1.5 w-full bg-gray-900 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 ${diag?.collective_bias === 'LONG' ? 'bg-emerald-500' : diag?.collective_bias === 'SHORT' ? 'bg-red-500' : 'bg-gray-500'}`}
                        style={{ width: `${diagBar}%` }}
                    />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase text-gray-500">
                    <div>Spread <span className="text-gray-300 font-bold">{diag?.metrics?.spread_bps?.toFixed(2) ?? '--'} bps</span></div>
                    <div>Book <span className="text-gray-300 font-bold">{diag?.metrics?.orderbook_imbalance_signed?.toFixed(3) ?? '--'}</span></div>
                    <div>OI Source <span className="text-gray-300 font-bold">{diag?.metrics?.open_interest_source || '--'}</span></div>
                    <div>Walls <span className="text-gray-300 font-bold">{diag?.metrics?.wall_count ?? 0}</span></div>
                </div>

                {diagReasons.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                        {diagReasons.map((reason, idx) => (
                            <div key={`${reason}-${idx}`} className="text-[10px] text-gray-300">
                                {reason}
                            </div>
                        ))}
                    </div>
                )}

                {topComponents.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        {topComponents.map((component) => (
                            <div key={component.label} className="border border-gray-800 bg-black/50 p-2">
                                <div className="text-[9px] uppercase text-gray-600">{component.label}</div>
                                <div className={`text-xs font-bold ${component.contribution >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {(component.contribution >= 0 ? '+' : '')}{component.contribution.toFixed(3)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {diagError && (
                    <div className="mt-2 text-[9px] text-yellow-500 uppercase">Diagnostics delayed</div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 z-10">
                <div className="p-4 border-l-2 border-l-gray-800 bg-gray-950/40">
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Model Inference</div>
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-400">{probInfo.label}</span>
                        <span className={`text-xs font-bold ${probInfo.textClass}`}>{Math.round(probUpPct)}% Bull</span>
                    </div>
                    <div className="w-full h-1 bg-gray-900 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-1000 ${probInfo.fillClass}`}
                            style={{ width: `${probUpPct}%` }}
                        />
                    </div>
                </div>

                <div className="p-4 border-l-2 border-l-gray-800 bg-gray-950/40">
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Sizing Directive</div>
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400">Position Scale</span>
                        <span className="text-xs font-bold text-white">
                            {risk?.size_usd ? `$${(risk.size_usd / 1000).toFixed(1)}k` : 'NO POSITION RECOMMENDED'}
                        </span>
                    </div>
                    <div className="mt-2 text-[10px] text-gray-600 uppercase">
                        {risk?.size_usd ? `Kelly Optimal at 1x Leverage` : 'System waiting for tradeable edge'}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 border-t border-gray-900 pt-4 sm:pt-6 z-10 text-[10px] font-mono">
                <div>
                    <div className="text-gray-600 mb-1 uppercase tracking-tighter sm:tracking-widest">Expected Yield</div>
                    <div className={`font-bold ${moveInfo.color}`}>{conviction.expected_move.toFixed(2)}% | {moveInfo.label}</div>
                </div>
                <div>
                    <div className="text-gray-600 mb-1 uppercase tracking-widest">Macro Regime</div>
                    <div className="text-gray-300 font-bold">{conviction.regime.replace('_', ' ')}</div>
                </div>
                <div>
                    <div className="text-gray-600 mb-1 uppercase tracking-widest">Model Health</div>
                    <div className={health === 'OPTIMAL' ? 'text-emerald-500 font-bold' : 'text-yellow-500 font-bold'}>
                        {health} ({calibrationPct.toFixed(1)}%)
                    </div>
                </div>
                <div>
                    <div className="text-gray-600 mb-1 uppercase tracking-widest">Stream</div>
                    <div className={`${streamClass} font-bold`}>{streamState}</div>
                </div>
            </div>

            <div className={`absolute -bottom-24 -left-24 w-64 h-64 blur-[80px] opacity-20 rounded-full pointer-events-none ${info.glowClass}`} />
        </div>
    );
};

export default ConvictionPanel;
