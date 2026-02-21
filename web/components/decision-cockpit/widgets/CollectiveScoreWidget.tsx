"use client";

import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';
import { useAlphaDiagnostics } from '../../../hooks/useAlphaDiagnostics';

const CollectiveScoreWidget = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol || 'BTC');
    const { data: diag, loading, error } = useAlphaDiagnostics(activeSymbol, 2500);

    const biasColor = diag?.collective_bias === 'LONG'
        ? 'text-emerald-400'
        : diag?.collective_bias === 'SHORT'
            ? 'text-red-400'
            : 'text-gray-300';
    const barWidth = diag ? Math.max(0, Math.min(100, (diag.collective_raw + 1) * 50)) : 50;
    const reasons = (diag?.reasoning || []).slice(0, 2);
    const topComponents = diag
        ? Object.values(diag.components || {}).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3)
        : [];

    return (
        <div className="border border-gray-800 bg-black/60 p-4 rounded">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest">Collective Score</div>
                    <div className="text-[9px] text-gray-600 uppercase mt-1">Signal Fusion :: {activeSymbol}</div>
                </div>
                <div className="text-right">
                    <div className={`text-3xl font-black ${biasColor}`}>{diag?.collective_score ?? '--'}</div>
                    <div className={`text-[10px] font-bold uppercase ${biasColor}`}>{diag?.collective_bias || 'NEUTRAL'}</div>
                </div>
            </div>

            <div className="mt-3 h-1.5 bg-gray-900 rounded-full overflow-hidden">
                <div
                    className={`h-full ${diag?.collective_bias === 'LONG' ? 'bg-emerald-500' : diag?.collective_bias === 'SHORT' ? 'bg-red-500' : 'bg-gray-500'}`}
                    style={{ width: `${barWidth}%` }}
                />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase text-gray-500">
                <div>Conf <span className="text-gray-300 font-bold">{diag ? `${Math.round(diag.confidence * 100)}%` : '--'}</span></div>
                <div>Spread <span className="text-gray-300 font-bold">{diag?.metrics?.spread_bps?.toFixed(2) ?? '--'}bps</span></div>
                <div>Book <span className="text-gray-300 font-bold">{diag?.metrics?.orderbook_imbalance_signed?.toFixed(3) ?? '--'}</span></div>
                <div>Walls <span className="text-gray-300 font-bold">{diag?.metrics?.wall_count ?? 0}</span></div>
            </div>

            {topComponents.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                    {topComponents.map((component) => (
                        <div key={component.label} className="border border-gray-800 bg-gray-950/60 p-2">
                            <div className="text-[9px] text-gray-600 uppercase">{component.label}</div>
                            <div className={`text-xs font-bold ${component.contribution >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {(component.contribution >= 0 ? '+' : '')}{component.contribution.toFixed(3)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {reasons.length > 0 && (
                <div className="mt-3 space-y-1.5">
                    {reasons.map((reason, idx) => (
                        <div key={`${reason}-${idx}`} className="text-[10px] text-gray-300">
                            {reason}
                        </div>
                    ))}
                </div>
            )}

            {(loading || error) && (
                <div className="mt-2 text-[9px] uppercase text-yellow-500">
                    {loading ? 'Collective diagnostics loading...' : 'Collective diagnostics delayed'}
                </div>
            )}
        </div>
    );
};

export default CollectiveScoreWidget;

