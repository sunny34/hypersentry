import React from 'react';
import { useAlphaStore } from '../../store/useAlphaStore';
import { BrainCircuit, Activity, AlertTriangle, TrendingUp, TrendingDown, Target } from 'lucide-react';

interface MicrostructureAIProps {
    symbol: string;
}

export const MicrostructureAI: React.FC<MicrostructureAIProps> = ({ symbol }) => {
    const conviction = useAlphaStore(s => s.convictions[symbol]);

    if (!conviction || !conviction.footprint || !conviction.liquidation) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center font-mono text-xs text-emerald-500/50 bg-[#050505]">
                <BrainCircuit className="w-6 h-6 mb-2 animate-pulse opacity-50" />
                Awaiting AI Telemetry...
            </div>
        );
    }

    const { footprint, liquidation } = conviction;

    // Helper functions for UI rendering
    const getSqueezeColor = (side: string) => {
        if (side === 'SHORT_SQUEEZE') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
        if (side === 'LONG_SQUEEZE') return 'text-red-400 bg-red-500/10 border-red-500/20';
        return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
    };

    const getSqueezeText = (side: string) => {
        if (side === 'SHORT_SQUEEZE') return 'Short Squeeze Probable';
        if (side === 'LONG_SQUEEZE') return 'Long Squeeze Probable';
        return 'Balanced Risk';
    };

    return (
        <div className="flex flex-col h-full bg-[#050505] font-mono p-4">
            <div className="flex items-center gap-2 mb-4">
                <BrainCircuit className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-bold text-purple-400 uppercase tracking-widest">AI Microstructure Intel</h3>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar flex-1">

                {/* Liquidation Gravity Section */}
                <div className="flex flex-col gap-2">
                    <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider flex items-center gap-2">
                        <Target className="w-3 h-3 text-gray-400" /> Liquidation Gravity
                    </div>

                    <div className={`p-3 rounded-lg border flex flex-col gap-1 relative overflow-hidden ${getSqueezeColor(liquidation.dominant_side)}`}>
                        <div className="text-xs font-bold uppercase z-10">{getSqueezeText(liquidation.dominant_side)}</div>
                        <div className="flex justify-between items-end z-10">
                            <span className="text-[10px] opacity-70">Imbalance Ratio:</span>
                            <span className="text-sm font-black">{liquidation.imbalance_ratio.toFixed(2)}x</span>
                        </div>
                    </div>
                </div>

                {/* AI Footprint Telemetry */}
                <div className="flex flex-col gap-2 flex-1">
                    <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider flex items-center gap-2">
                        <Activity className="w-3 h-3 text-gray-400" /> Orderflow Telemetry
                    </div>

                    <div className="flex flex-col gap-1.5">
                        {/* Sweep Event */}
                        <div className="p-2 bg-white/5 border border-white/5 rounded flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 uppercase">Aggressive Sweeps</span>
                            {footprint.sweep?.event ? (
                                <span className={`text-xs font-bold ${footprint.sweep.event === 'BUY_SWEEP' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {footprint.sweep.event === 'BUY_SWEEP' ? 'BUYERS' : 'SELLERS'} ({(footprint.sweep.strength * 100).toFixed(0)}%)
                                </span>
                            ) : (
                                <span className="text-xs font-bold text-gray-600">NONE DETECTED</span>
                            )}
                        </div>

                        {/* Absorption Event */}
                        <div className="p-2 bg-white/5 border border-white/5 rounded flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 uppercase">Passive Absorption</span>
                            {footprint.absorption?.event ? (
                                <span className={`text-xs font-bold ${footprint.absorption.event === 'BUY_ABSORPTION' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {footprint.absorption.event === 'BUY_ABSORPTION' ? 'BID SUPPORT' : 'ASK RESIST'} ({(footprint.absorption.strength * 100).toFixed(0)}%)
                                </span>
                            ) : (
                                <span className="text-xs font-bold text-gray-600">NONE DETECTED</span>
                            )}
                        </div>

                        {/* Impulse Event */}
                        <div className="p-2 bg-white/5 border border-white/5 rounded flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 uppercase">Momentum Impulse</span>
                            {footprint.impulse?.event ? (
                                <div className="flex items-center gap-1">
                                    {footprint.impulse.event === 'BULLISH_IMPULSE' ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
                                    <span className={`text-xs font-bold ${footprint.impulse.event === 'BULLISH_IMPULSE' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {footprint.impulse.event === 'BULLISH_IMPULSE' ? 'BULLISH' : 'BEARISH'} ({(footprint.impulse.strength * 10).toFixed(1)}x)
                                    </span>
                                </div>
                            ) : (
                                <span className="text-xs font-bold text-gray-600">NEUTRAL</span>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default MicrostructureAI;
