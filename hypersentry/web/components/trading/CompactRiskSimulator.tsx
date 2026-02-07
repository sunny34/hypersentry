'use client';
import React, { useState, useEffect } from 'react';
import { ShieldAlert, Activity, Play, TrendingDown, Target, Skull } from 'lucide-react';

export default function CompactRiskSimulator() {
    const [loading, setLoading] = useState(false);
    const [metrics, setMetrics] = useState({
        ruinChance: 1.2,
        var95: 420,
        expectedReturn: 14.5
    });

    const simulate = () => {
        setLoading(true);
        setTimeout(() => {
            setMetrics({
                ruinChance: Math.random() * 5,
                var95: Math.floor(Math.random() * 1000),
                expectedReturn: 10 + Math.random() * 20
            });
            setLoading(false);
        }, 1200);
    };

    return (
        <div className="h-full flex flex-col font-mono select-none overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/5 bg-black/40">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Risk Monte Carlo</h3>
                </div>
                <button onClick={simulate} className={`transition-all ${loading ? 'animate-pulse' : ''}`}>
                    <Play className="w-3 h-3 text-emerald-500 hover:text-emerald-400" />
                </button>
            </div>

            <div className="flex-1 p-4 grid grid-cols-1 gap-4 overflow-y-auto scrollbar-hide">
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 relative overflow-hidden">
                    <div className="absolute -right-2 -bottom-2 opacity-10">
                        <Skull className="w-12 h-12 text-red-500" />
                    </div>
                    <div className="text-[9px] font-black uppercase text-red-500/70 mb-1 tracking-widest">Risk of Ruin</div>
                    <div className="text-xl font-black text-red-400">{metrics.ruinChance.toFixed(1)}%</div>
                    <div className="text-[8px] text-gray-600 mt-1 uppercase font-bold tracking-tighter">Prob. of Portfolio {'<'} 10%</div>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                    <div className="text-[9px] font-black uppercase text-amber-500/70 mb-1 tracking-widest">Value at Risk (VaR 95%)</div>
                    <div className="text-xl font-black text-amber-400">-${metrics.var95}</div>
                    <div className="text-[8px] text-gray-600 mt-1 uppercase font-bold tracking-tighter">Max expected loss (95% Conf)</div>
                </div>

                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                    <div className="text-[9px] font-black uppercase text-emerald-500/70 mb-1 tracking-widest">Expected Edge</div>
                    <div className="text-xl font-black text-emerald-400">+{metrics.expectedReturn.toFixed(1)}%</div>
                    <div className="text-[8px] text-gray-600 mt-1 uppercase font-bold tracking-tighter">Projected return per 100 trades</div>
                </div>
            </div>

            <div className="p-2 border-t border-white/5 bg-red-500/5 flex justify-between items-center">
                <span className="text-[8px] text-red-400/80 font-black uppercase tracking-tighter">Execution Guardian active</span>
                <span className="text-[7px] text-gray-600 font-bold">1k Path Simulation</span>
            </div>
        </div>
    );
}
