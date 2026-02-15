"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useAlphaStore } from '../../store/useAlphaStore';
import ModeSwitcher from './ModeSwitcher';

const GlobalStatusBar = () => {
    const { governance, risks, executionPlans, convictions, executionLogs, activeSymbol, stream } = useAlphaStore();
    const [now, setNow] = useState(() => Date.now());

    // Get live data if meaningful
    const activeGov = activeSymbol ? governance[activeSymbol] : null;
    const regime = activeGov?.active_regime || 'NORMAL_MARKET';
    const health = activeGov?.calibration_status || 'OPTIMAL';
    const riskEntries = Object.values(risks);
    const totalRiskPct = riskEntries.reduce((sum, item) => {
        const raw = Number(item.risk_percent_equity);
        if (!Number.isFinite(raw)) return sum;
        return sum + (raw <= 1 ? raw * 100 : raw);
    }, 0);
    const planExposureUsd = Object.values(executionPlans).reduce((sum, plan) => sum + (plan?.total_size_usd || 0), 0);
    const executedRecently = executionLogs.some((log) => log.type === 'EXEC' && /^Executed\s/i.test(log.message));
    const inferredRiskPct = executedRecently && planExposureUsd > 0 ? Math.min(100, (planExposureUsd / 100000) * 100) : 0;
    const deployedPct = executedRecently ? (totalRiskPct > 0 ? totalRiskPct : inferredRiskPct) : 0;
    const convictionValues = Object.values(convictions);
    const avgConviction = convictionValues.length
        ? convictionValues.reduce((sum, item) => sum + item.score, 0) / convictionValues.length
        : 50;
    const dailyPnlProxy = ((avgConviction - 50) / 50) * (deployedPct / 100) * 2;
    const pnlColor = dailyPnlProxy > 0 ? 'text-green-400' : dailyPnlProxy < 0 ? 'text-red-400' : 'text-gray-400';
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const streamLagMs = stream.lastMessageAt ? Math.max(0, now - stream.lastMessageAt) : null;
    const derivedStreamStatus = useMemo(() => {
        if (!stream.connected) return 'disconnected';
        if (streamLagMs === null) return 'connecting';
        if (streamLagMs > 10_000) return 'stale';
        if (streamLagMs > 4_000) return 'degraded';
        return 'live';
    }, [stream.connected, streamLagMs]);

    const streamColor =
        derivedStreamStatus === 'live' ? 'text-green-400' :
            derivedStreamStatus === 'degraded' ? 'text-yellow-400' :
                derivedStreamStatus === 'stale' ? 'text-red-500' :
                    'text-gray-500';

    const getRegimeColor = (r: string) => {
        if (r === 'SQUEEZE_ENVIRONMENT') return 'text-cyan-400';
        if (r === 'TRENDING_HIGH_VOL') return 'text-green-400';
        if (r === 'CRISIS_MODE') return 'text-red-500 animate-pulse';
        return 'text-gray-400';
    };

    return (
        <div className="w-full bg-black border-b border-gray-800 px-3 sm:px-6 py-2 sm:py-2.5 text-[10px] sm:text-xs font-mono uppercase tracking-wide sm:tracking-widest">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2">
                <div className="flex items-center gap-3 sm:gap-6 overflow-x-auto whitespace-nowrap pb-1 xl:pb-0 no-scrollbar">
                    <Link
                        href="/terminal"
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 transition-colors group shrink-0"
                    >
                        <ChevronLeft className="w-3 h-3 text-gray-500 group-hover:text-white transition-colors" />
                        <span className="text-[10px] font-bold text-gray-400 group-hover:text-white transition-colors">TERMINAL</span>
                    </Link>

                    <div className="hidden sm:block h-4 w-[1px] bg-gray-800 shrink-0" />

                    <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
                        <span className="text-gray-600">System Ops:</span>
                        <ModeSwitcher />
                    </div>

                    <div className="hidden sm:block h-4 w-[1px] bg-gray-800 shrink-0" />

                    <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-gray-500">Regime:</span>
                        <span className={`font-bold ${getRegimeColor(regime)}`}>{regime}</span>
                    </div>

                    <div className="hidden sm:block h-4 w-[1px] bg-gray-800 shrink-0" />

                    <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-gray-500">Health:</span>
                        <span className={`font-bold ${health === 'OPTIMAL' ? 'text-green-400' : 'text-yellow-500'}`}>
                            {health}
                        </span>
                    </div>

                    <div className="hidden sm:block h-4 w-[1px] bg-gray-800 shrink-0" />

                    <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-gray-500">Stream:</span>
                        <span className={`font-bold ${streamColor}`}>{derivedStreamStatus.toUpperCase()}</span>
                        {streamLagMs !== null && (
                            <span className="text-[9px] sm:text-[10px] text-gray-600">{(streamLagMs / 1000).toFixed(1)}s</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-4 sm:gap-6">
                    <div className="flex items-center space-x-2">
                        <span className="text-gray-500">Risk Deployed:</span>
                        <span className="text-white font-bold">{deployedPct.toFixed(2)}%</span>
                    </div>
                    <div className="flex items-center space-x-2">
                        <span className="text-gray-500">Signal Drift:</span>
                        <span className={`${pnlColor} font-bold`}>{dailyPnlProxy >= 0 ? '+' : ''}{dailyPnlProxy.toFixed(2)}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GlobalStatusBar;
