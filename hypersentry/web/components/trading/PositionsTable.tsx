'use client';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface Position {
    coin: string;
    size: number;
    value: number;
    entryPrice: number;
    markPrice: number;
    pnl: number;
    roe: number;
    liquidationPrice?: number;
    side: 'LONG' | 'SHORT';
    raw?: any;
}

interface PositionsTableProps {
    positions: Position[];
    isLoading: boolean;
    onSelectToken?: (symbol: string) => void;
    onClose?: (position: Position) => void;
    onAnalyze?: (position: Position) => void;
}

export default function PositionsTable({ positions, isLoading, onSelectToken, onClose, onAnalyze }: PositionsTableProps) {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-48 text-gray-500 gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading positions...</span>
            </div>
        );
    }

    if (positions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                <p className="font-medium mb-1">No open positions</p>
                <p className="text-xs opacity-60">Trades will appear here once executed</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-sm text-left border-separate border-spacing-0">
                <thead className="text-[10px] text-gray-500 uppercase bg-black/40 sticky top-0 z-10">
                    <tr>
                        <th className="px-4 py-3 font-black tracking-widest border-b border-white/5">Market Info</th>
                        <th className="px-4 py-3 font-black tracking-widest border-b border-white/5 text-right">Size / Value</th>
                        <th className="px-4 py-3 font-black tracking-widest border-b border-white/5 text-right">Entry / Mark</th>
                        <th className="px-4 py-3 font-black tracking-widest border-b border-white/5 text-right">Liq. Zone</th>
                        <th className="px-4 py-3 font-black tracking-widest border-b border-white/5 text-right">Performance</th>
                        <th className="px-4 py-3 font-black tracking-widest border-b border-white/5 text-right">Tactical</th>
                    </tr>
                </thead>
                <tbody className="bg-transparent">
                    {positions.map((pos) => (
                        <tr key={pos.coin} className="hover:bg-white/[0.02] transition-colors group border-b border-white/5">
                            <td className="px-4 py-4">
                                <button
                                    onClick={() => onSelectToken && onSelectToken(pos.coin)}
                                    className="flex flex-col gap-1 items-start group/btn"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${pos.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {pos.side}
                                        </span>
                                        <span className="font-bold text-white group-hover/btn:text-orange-400 transition-colors uppercase">{pos.coin}</span>
                                    </div>
                                    <span className="text-[9px] text-gray-600 font-mono tracking-tighter">Hyperliquid Perp</span>
                                </button>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <div className="flex flex-col font-mono">
                                    <span className="text-xs text-gray-200 font-bold">{pos.size.toLocaleString()}</span>
                                    <span className="text-[10px] text-gray-500">${pos.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                            </td>
                            <td className="px-4 py-4 text-right font-mono">
                                <div className="flex flex-col">
                                    <span className="text-xs text-gray-300 font-bold underline decoration-white/10 decoration-dotted underline-offset-4">${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    <span className="text-[10px] text-gray-600">${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            </td>
                            <td className="px-4 py-4 text-right font-mono">
                                <div className="flex flex-col items-end">
                                    <span className={`text-xs font-bold ${pos.liquidationPrice ? 'text-orange-500' : 'text-gray-700'}`}>
                                        {pos.liquidationPrice ? `$${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'UNLIMITED'}
                                    </span>
                                    <span className="text-[9px] text-gray-700 uppercase font-black">Safety Zone</span>
                                </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <div className="flex flex-col items-end group/pnl">
                                    <span className={`text-sm font-black tracking-tight flex items-center gap-1 ${pos.pnl >= 0 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'text-red-400'}`}>
                                        {pos.pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                        ${Math.abs(pos.pnl).toFixed(2)}
                                    </span>
                                    <span className={`text-[10px] font-bold ${pos.pnl >= 0 ? 'text-emerald-600' : 'text-red-800'}`}>
                                        {pos.pnl >= 0 ? '+' : ''}{pos.roe.toFixed(2)}%
                                    </span>
                                </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                    <button
                                        onClick={() => onAnalyze && onAnalyze(pos)}
                                        className="h-7 px-2.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all"
                                    >
                                        Intel
                                    </button>
                                    <button
                                        className="h-7 px-2.5 bg-white/5 hover:bg-white/10 text-gray-400 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all"
                                    >
                                        Adjust
                                    </button>
                                    <button
                                        onClick={() => onClose && onClose(pos)}
                                        className="h-7 px-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all hover:scale-[1.05] active:scale-[0.95]"
                                    >
                                        Close
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
