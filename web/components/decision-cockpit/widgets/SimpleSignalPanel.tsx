"use client";
import React from 'react';
import { useAlphaStore } from '@/store/useAlphaStore';
import { useModeStore } from '@/store/useModeStore';
import { ArrowUp, ArrowDown, Clock, Activity, CheckCircle2, XCircle } from 'lucide-react';

const SimpleSignalPanel: React.FC = () => {
    const activeSymbol = useAlphaStore((s) => s.activeSymbol || 'BTC');
    const convictions = useAlphaStore((s) => s.convictions);
    const mode = useModeStore((s) => s.mode);
    const activeConviction = convictions[activeSymbol];

    // Tracked symbols for table
    const symbols = Object.keys(convictions).length > 0
        ? Object.keys(convictions).sort()
        : ['BTC', 'ETH', 'SOL'];

    const getSignalColor = (bias: string) => {
        switch (bias) {
            case 'LONG': return 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10';
            case 'SHORT': return 'text-red-400 border-red-400/30 bg-red-400/10';
            default: return 'text-gray-400 border-gray-700 bg-gray-900/50';
        }
    };

    const getScoreColor = (score: number) => {
        if (score >= 65) return 'text-emerald-400';
        if (score >= 55) return 'text-yellow-400';
        if (score <= 35) return 'text-red-400';
        if (score <= 45) return 'text-orange-400';
        return 'text-gray-400';
    };

    // Active signal card
    const renderActiveSignal = () => {
        if (!activeConviction) {
            return (
                <div className="border border-gray-800 rounded-lg p-3 text-center text-gray-600 text-[10px]">
                    Awaiting signal data for {activeSymbol}...
                </div>
            );
        }

        const { bias, score } = activeConviction;
        const signalLabel = bias === 'LONG' ? 'BUY' : bias === 'SHORT' ? 'SELL' : 'WAIT';

        return (
            <div className={`border rounded-lg p-3 ${getSignalColor(bias)}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {bias === 'LONG' && <ArrowUp className="w-5 h-5" />}
                        {bias === 'SHORT' && <ArrowDown className="w-5 h-5" />}
                        {bias === 'NEUTRAL' && <Clock className="w-5 h-5" />}
                        <div>
                            <div className="text-xl font-black">{signalLabel}</div>
                            <div className="text-[9px] text-gray-400">{activeSymbol}</div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[9px] text-gray-500 uppercase">Conviction</div>
                        <div className={`text-lg font-bold ${getScoreColor(score)}`}>
                            {score}%
                        </div>
                    </div>
                </div>

                {/* Score bar */}
                <div className="mt-2">
                    <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-500 ${score >= 55 ? 'bg-emerald-500' : score <= 45 ? 'bg-red-500' : 'bg-gray-600'}`}
                            style={{ width: `${score}%` }}
                        />
                    </div>
                </div>

                {/* Explanation */}
                {activeConviction.explanation && activeConviction.explanation.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                        <div className="text-[9px] text-gray-500 uppercase mb-1">Reasoning</div>
                        <div className="text-[10px] text-gray-300 line-clamp-2">
                            {activeConviction.explanation.slice(0, 3).join('. ')}
                        </div>
                    </div>
                )}

                {/* Auto-Trade Gates */}
                <div className="mt-3 pt-3 border-t border-gray-700/50">
                    <div className="text-[9px] text-gray-400 uppercase tracking-widest mb-2 font-bold flex items-center justify-between">
                        <span>Autonomous Execution Gates</span>
                        <span className={`px-1.5 py-0.5 rounded-sm ${mode === 'autonomous' && score >= 65 && (activeConviction.bias_streak || 0) >= 5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                            {mode === 'autonomous' && score >= 65 && (activeConviction.bias_streak || 0) >= 5 ? 'READY' : 'WAITING'}
                        </span>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-1.5 text-gray-400">
                                {mode === 'autonomous' ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
                                <span>Autonomous Mode</span>
                            </div>
                            <span className="font-mono text-gray-300">{mode === 'autonomous' ? 'ON' : 'OFF'}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-1.5 text-gray-400">
                                {score >= 65 ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-yellow-500" />}
                                <span>High Conviction (≥65)</span>
                            </div>
                            <span className="font-mono text-gray-300">{score}/65</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-1.5 text-gray-400">
                                {(activeConviction.bias_streak || 0) >= 5 ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-yellow-500" />}
                                <span>Directional Streak (≥5)</span>
                            </div>
                            <span className="font-mono text-gray-300">{activeConviction.bias_streak || 0}/5</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Multi-symbol table
    const renderTable = () => (
        <div className="space-y-2">
            <h3 className="text-[10px] font-semibold text-gray-400 uppercase">All Signals</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                    <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                            <th className="text-left py-1">Sym</th>
                            <th className="text-center py-1">Signal</th>
                            <th className="text-center py-1">Conv.</th>
                            <th className="text-right py-1">Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {symbols.map(sym => {
                            const conv = convictions[sym];
                            if (!conv) return null;

                            const signalLabel = conv.bias === 'LONG' ? 'BUY' : conv.bias === 'SHORT' ? 'SELL' : 'WAIT';

                            return (
                                <tr
                                    key={sym}
                                    className={`border-b border-gray-800/30 hover:bg-gray-800/20 cursor-pointer ${sym === activeSymbol ? 'bg-gray-800/30' : ''}`}
                                    onClick={() => useAlphaStore.getState().setActiveSymbol(sym)}
                                >
                                    <td className="py-1 font-bold text-white">{sym}</td>
                                    <td className="py-1 text-center">
                                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${conv.bias === 'LONG' ? 'bg-emerald-400/20 text-emerald-400' :
                                            conv.bias === 'SHORT' ? 'bg-red-400/20 text-red-400' :
                                                'bg-gray-700 text-gray-400'
                                            }`}>
                                            {signalLabel}
                                        </span>
                                    </td>
                                    <td className={`py-1 text-center font-bold ${getScoreColor(conv.score)}`}>
                                        {conv.score}%
                                    </td>
                                    <td className="py-1 text-right text-gray-400 font-mono">
                                        {conv.score > 50 ? `+${conv.score - 50}` : conv.score < 50 ? `${conv.score - 50}` : '0'}
                                    </td>
                                </tr>
                            );
                        })}
                        {symbols.every(s => !convictions[s]) && (
                            <tr>
                                <td colSpan={4} className="py-3 text-center text-gray-600 text-[9px]">
                                    Waiting for conviction data...
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-gray-950/30">
            <div className="h-8 bg-gray-950 px-3 flex items-center border-b border-gray-800 gap-2">
                <Activity className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Conviction Engine</span>
            </div>
            <div className="p-3 flex-1 overflow-auto space-y-4">
                {renderActiveSignal()}
                <div className="pt-3 border-t border-gray-800">
                    {renderTable()}
                </div>
            </div>
        </div>
    );
};

export default SimpleSignalPanel;
