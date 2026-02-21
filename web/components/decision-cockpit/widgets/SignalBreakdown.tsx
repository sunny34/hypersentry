"use client";
import React from 'react';
import { useAlphaStore } from '../../../store/useAlphaStore';
import { useMarketStore } from '../../../store/useMarketStore';
import { formatCompact } from '@/lib/formatters';

const SignalBreakdown = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol || 'BTC');
    const conviction = useAlphaStore((s) => s.convictions[activeSymbol]);
    const governance = useAlphaStore((s) => s.governance[activeSymbol]);
    const stream = useAlphaStore((s) => s.stream);
    const market = useMarketStore((s) => s.marketData[activeSymbol]);

    const rows: Array<{ label: string; value: string; color?: string }> = conviction ? [
        { label: 'Symbol', value: activeSymbol, color: 'text-white' },
        { label: 'Bias', value: conviction.bias, color: conviction.bias === 'LONG' ? 'text-emerald-500' : conviction.bias === 'SHORT' ? 'text-red-500' : 'text-gray-400' },
        { label: 'Score', value: `${conviction.score}` },
        { label: 'Prob Up', value: `${(conviction.prob_up_1pct * 100).toFixed(1)}%` },
        { label: 'Prob Down', value: `${(conviction.prob_down_1pct * 100).toFixed(1)}%` },
        { label: 'Expected Move', value: `${conviction.expected_move.toFixed(2)}%` },
        { label: 'Realized Vol', value: `${(conviction.realized_vol * 100).toFixed(2)}%` },
        { label: 'CVD (Venue)', value: formatCompact(market?.cvd ?? 0) },
        { label: 'CVD (Spot 1m)', value: formatCompact(market?.external_spot?.cvd_spot_composite_1m ?? 0) },
        { label: 'OI', value: formatCompact(market?.oi ?? market?.external_oi?.open_interest ?? 0) },
        { label: 'Regime', value: governance?.active_regime || conviction.regime },
        { label: 'Health', value: governance?.calibration_status || 'UNKNOWN', color: governance?.calibration_status === 'OPTIMAL' ? 'text-emerald-500' : 'text-yellow-500' },
        { label: 'Stream', value: stream.status.toUpperCase(), color: stream.status === 'live' ? 'text-emerald-500' : stream.status === 'degraded' ? 'text-yellow-500' : 'text-red-500' }
    ] : [];

    return (
        <div className="h-full border-b border-gray-800 flex flex-col">
            <div className="h-10 bg-gray-950 px-4 flex items-center border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-widest">
                Analytics :: Signal DNA
            </div>
            {!conviction ? (
                <div className="p-6 flex items-center justify-center text-gray-600 text-xs font-mono">
                    {stream.connected ? 'Waiting for signal stream...' : 'Feed offline. Waiting for connection...'}
                </div>
            ) : (
                <div className="p-4 text-[11px] font-mono overflow-y-auto">
                    <div className="space-y-2">
                        {rows.map((row) => (
                            <div key={row.label} className="flex items-center justify-between border-b border-gray-900 pb-1">
                                <span className="text-gray-500 uppercase tracking-wide text-[10px]">{row.label}</span>
                                <span className={`font-semibold ${row.color || 'text-gray-300'}`}>{row.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SignalBreakdown;
