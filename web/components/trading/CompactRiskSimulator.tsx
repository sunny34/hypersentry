'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Activity, Play, Skull } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface CompactRiskSimulatorProps {
    symbol?: string;
    initialCapital?: number;
}

interface RiskMetrics {
    ruinChance: number;
    var95: number;
    expectedReturn: number;
}

type SeedSource = 'live' | 'fallback';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toFinite = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeSymbol = (symbol?: string) => String(symbol || 'BTC').trim().split(/[/-]/)[0].toUpperCase();

const runMonteCarlo = ({
    initialCapital,
    winRate,
    riskPerTradePct,
    rewardRatio,
    numSimulations,
    numTrades,
}: {
    initialCapital: number;
    winRate: number;
    riskPerTradePct: number;
    rewardRatio: number;
    numSimulations: number;
    numTrades: number;
}): RiskMetrics => {
    const finals: number[] = [];
    let ruinCount = 0;

    for (let sim = 0; sim < numSimulations; sim++) {
        let equity = initialCapital;
        let ruined = false;

        for (let trade = 0; trade < numTrades; trade++) {
            const riskAmount = equity * (riskPerTradePct / 100);
            const isWin = Math.random() * 100 < winRate;

            if (isWin) {
                equity += riskAmount * rewardRatio;
            } else {
                equity -= riskAmount;
            }

            if (equity <= initialCapital * 0.1) {
                ruined = true;
                equity = 0;
                break;
            }
        }

        if (ruined) ruinCount += 1;
        finals.push(Math.max(0, equity));
    }

    finals.sort((a, b) => a - b);
    const meanFinal = finals.reduce((acc, n) => acc + n, 0) / Math.max(1, finals.length);
    const tailIdx = Math.max(0, Math.floor(finals.length * 0.05) - 1);
    const var95 = Math.max(0, initialCapital - (finals[tailIdx] || 0));
    const ruinChance = (ruinCount / Math.max(1, numSimulations)) * 100;
    const expectedReturn = ((meanFinal - initialCapital) / initialCapital) * 100;

    return {
        ruinChance,
        var95,
        expectedReturn,
    };
};

export default function CompactRiskSimulator({
    symbol = 'BTC',
    initialCapital = 10_000,
}: CompactRiskSimulatorProps) {
    const [loading, setLoading] = useState(false);
    const [seedSource, setSeedSource] = useState<SeedSource>('fallback');
    const [lastRunAt, setLastRunAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [metrics, setMetrics] = useState<RiskMetrics>({
        ruinChance: 1.2,
        var95: 420,
        expectedReturn: 14.5,
    });

    const simulate = useCallback(async () => {
        const normalizedSymbol = normalizeSymbol(symbol);
        setLoading(true);
        setError(null);

        let winRate = 52;
        let riskPerTradePct = 1.0;
        let rewardRatio = 2.0;
        let source: SeedSource = 'fallback';

        try {
            const response = await axios.get(`${API_URL}/alpha/risk/${normalizedSymbol}`, { timeout: 9000 });
            const risk = response.data || {};
            const breakdown = risk.breakdown || {};

            const direction = String(risk.direction || 'NEUTRAL').toUpperCase();
            const edgeComponent = toFinite(breakdown.edge_component, 0);
            const kellyFraction = toFinite(breakdown.kelly_fraction, 0.2);

            const riskPctRaw = toFinite(risk.risk_percent_equity, 1.0);
            const normalizedRiskPct = riskPctRaw <= 1 ? riskPctRaw * 100 : riskPctRaw;
            riskPerTradePct = clamp(normalizedRiskPct, 0.1, 5.0);
            rewardRatio = clamp(1.2 + Math.abs(edgeComponent) * 1.8 + kellyFraction * 0.8, 1.2, 3.8);

            const directionalBonus = direction === 'LONG' || direction === 'SHORT' ? 4 : -3;
            winRate = clamp(50 + edgeComponent * 30 + (kellyFraction - 0.2) * 20 + directionalBonus, 35, 78);
            source = 'live';
        } catch (e: any) {
            source = 'fallback';
            const status = e?.response?.status;
            if (status === 404 || status === 409) {
                setError('Live alpha risk seed unavailable; fallback model used.');
            } else {
                setError('Risk seed fetch failed; fallback model used.');
            }
        }

        const sim = runMonteCarlo({
            initialCapital,
            winRate,
            riskPerTradePct,
            rewardRatio,
            numSimulations: 1200,
            numTrades: 100,
        });

        setMetrics(sim);
        setSeedSource(source);
        setLastRunAt(Date.now());
        setLoading(false);
    }, [initialCapital, symbol]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void simulate();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [simulate]);

    return (
        <div className="flex h-full flex-col select-none overflow-hidden font-mono">
            <div className="flex items-center justify-between border-b border-white/5 bg-black/40 p-3">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Risk Monte Carlo</h3>
                </div>
                <button
                    type="button"
                    onClick={() => { void simulate(); }}
                    disabled={loading}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-black uppercase tracking-widest transition-all ${loading
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                        : 'border-white/10 bg-white/5 text-gray-300 hover:border-emerald-500/40 hover:text-emerald-300'
                        }`}
                >
                    {loading ? <Activity className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {loading ? 'Running' : 'Run'}
                </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 scrollbar-hide">
                <div className="relative overflow-hidden rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                    <div className="absolute -bottom-2 -right-2 opacity-10">
                        <Skull className="h-12 w-12 text-red-500" />
                    </div>
                    <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-red-500/70">Risk of Ruin</div>
                    <div className="text-xl font-black text-red-400">{metrics.ruinChance.toFixed(1)}%</div>
                    <div className="mt-1 text-[8px] font-bold uppercase tracking-tighter text-gray-600">Prob. of Portfolio {'<'} 10%</div>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-amber-500/70">Value at Risk (VaR 95%)</div>
                    <div className="text-xl font-black text-amber-400">-${Math.max(0, Math.round(metrics.var95)).toLocaleString()}</div>
                    <div className="mt-1 text-[8px] font-bold uppercase tracking-tighter text-gray-600">Worst expected loss (95% conf.)</div>
                </div>

                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-emerald-500/70">Expected Edge</div>
                    <div className={`text-xl font-black ${metrics.expectedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {metrics.expectedReturn >= 0 ? '+' : ''}{metrics.expectedReturn.toFixed(1)}%
                    </div>
                    <div className="mt-1 text-[8px] font-bold uppercase tracking-tighter text-gray-600">Projected return per 100 trades</div>
                </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/5 bg-red-500/5 p-2">
                <span className="text-[8px] font-black uppercase tracking-tighter text-red-400/80">
                    Seed: {seedSource === 'live' ? `Alpha / ${normalizeSymbol(symbol)}` : 'Fallback Model'}
                </span>
                <span className="text-[7px] font-bold text-gray-500">
                    {lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : 'Not run yet'}
                </span>
            </div>

            {error && (
                <div className="border-t border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[8px] font-bold uppercase tracking-wider text-amber-300">
                    {error}
                </div>
            )}
        </div>
    );
}
